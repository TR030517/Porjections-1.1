import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/api_config.dart';
import '../models/user.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'session_transport.dart';
import 'booking_reschedule_journal.dart';
import 'logout_intent.dart';

/// Riverpod provider for ApiService
final apiServiceProvider = Provider<ApiService>((ref) => ApiService());

class ProfileSaveUnverified implements Exception {
  const ProfileSaveUnverified();
  @override
  String toString() => 'The account save response could not be verified. Reload account details before saving again.';
}

class SessionVerificationUnavailable implements Exception {
  const SessionVerificationUnavailable();
  @override
  String toString() => 'We could not verify your session. Your sign-in is saved. Retry verification before making account changes.';
}

class _SessionIdentityMismatch implements Exception {}

/// API Service — handles all HTTP communication with the MJAPP backend
class ApiService {
  late final Dio _dio;
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const String _accessTokenKey = 'access_token';
  static const String _refreshTokenKey = 'refresh_token';
  static const String _userIdKey = 'user_id';
  String? _accessToken;
  String? _customerReauthToken;
  String? _customerId;
  Future<void> _storageWrites = Future.value();
  int _sessionEpoch = 0;
  bool _authenticationTransition = false;
  final _sessionExpired = StreamController<int>.broadcast();
  final _sessionUnverified = StreamController<int>.broadcast();
  bool _sessionNeedsVerification = false;
  int _profileVerificationVersion = 0;

  Stream<int> get sessionExpired => _sessionExpired.stream;
  Stream<int> get sessionUnverified => _sessionUnverified.stream;
  bool get sessionNeedsVerification => _sessionNeedsVerification;

  void beginSessionVerification() {
    _profileVerificationVersion++;
    _sessionNeedsVerification = true;
    _syncSessionOptions();
  }

  void finishAbsentSessionVerification() {
    if (_accessToken != null || _customerId != null) return;
    _sessionNeedsVerification = false;
    _syncSessionOptions();
  }

  void _unverifiedSession(int epoch, {int? profileVersion}) {
    if (epoch != _sessionEpoch || profileVersion != null && profileVersion != _profileVerificationVersion) return;
    _sessionNeedsVerification = true;
    _syncSessionOptions();
    _sessionUnverified.add(epoch);
  }

  Future<void> _expireSession({required int expectedEpoch}) async {
    if (expectedEpoch != _sessionEpoch) return;
    final invalidatedEpoch = ++_sessionEpoch;
    _accessToken = null;
    _customerReauthToken = null;
    _customerId = null;
    _authenticationTransition = false;
    _sessionNeedsVerification = false;
    _syncSessionOptions();
    try { if (!kIsWeb) await _queueStorage(invalidatedEpoch, () => _storage.delete(key: _refreshTokenKey)); }
    finally { if (invalidatedEpoch == _sessionEpoch) _sessionExpired.add(invalidatedEpoch); }
  }

  Future<void> _queueStorage(int epoch, Future<void> Function() write) {
    final task = _storageWrites.catchError((_) {}).then((_) async {
      if (epoch == _sessionEpoch) await write();
    });
    _storageWrites = task;
    return task;
  }

  DioException _changedSession(RequestOptions options) => DioException(
    requestOptions: options, type: DioExceptionType.cancel,
    error: StateError('The customer session changed. The original request was not replayed.'),
  );
  bool _anonymousAuthenticationCommand(RequestOptions options) =>
      options.method == 'POST' && const {
        '/auth/customer/password/login', '/auth/verify-otp',
        '/auth/send-otp', '/auth/google', '/auth/apple',
        '/auth/customer/email/request', '/auth/customer/email/verify',
        '/auth/customer/social/challenge', '/auth/customer/logout',
        '/auth/customer/password/recovery/request',
        '/auth/customer/password/recovery/complete',
      }.contains(options.path);
  bool _requestCurrent(RequestOptions options) => options.extra['sessionEpoch'] == _sessionEpoch &&
      (options.extra['authenticationTransitionBorn'] != true || _anonymousAuthenticationCommand(options)) &&
      (options.extra['sessionCustomerId'] == null
        ? _customerId == null || _anonymousAuthenticationCommand(options) ||
            options.method == 'GET' && options.path == '/auth/me'
        : options.extra['sessionCustomerId'] == _customerId);

  bool _blockedUnverifiedWrite(RequestOptions options) =>
      (_sessionNeedsVerification || options.extra['verificationRequiredBorn'] == true)
      && !const ['GET', 'HEAD'].contains(options.method) && !_anonymousAuthenticationCommand(options);

  Future<void> _guardBookingChange(RequestOptions options) async {
    if (options.method == 'GET' || options.method == 'HEAD' ||
        options.extra['publicRead'] == true) {
      return;
    }
    final actor = options.extra['sessionCustomerId'];
    if (actor is! String) return;
    final path = options.path;
    final command = RegExp(r'^/bookings/([1-9]\d*)(?:/(reschedule|cancel|refund|refund-partial))?$').firstMatch(path);
    if (RegExp(r'^/bookings/[1-9]\d*/operations/[^/]+/reconcile$').hasMatch(path)) return;
    // Pricing is read-only even though its transport uses POST.
    if (path == '/payments/quote') return;
    final body = options.data;
    final booking = command?.group(1) ?? (options.extra['guardBookingId'] as String?) ??
        (body is Map && body['bookingId'] is String ? body['bookingId'] as String : null);
    if (booking == null) return;
    final move = command?.group(2) == 'reschedule' && body is Map
        ? Map<String, dynamic>.from(body) : null;
    final key = options.headers['Idempotency-Key'] ?? options.headers['idempotency-key'];
    await bookingRescheduleJournal.guardWrite(actor, booking,
      requestKey: key is String ? key : null, move: move);
  }
  int _beginAuthentication() {
    _accessToken = null; _customerReauthToken = null; _customerId = null;
    _authenticationTransition = true;
    _sessionNeedsVerification = false;
    _sessionEpoch++;
    _syncSessionOptions();
    return _sessionEpoch;
  }
  void _endAuthentication(int epoch) {
    if (epoch != _sessionEpoch) return;
    _authenticationTransition = false;
    _syncSessionOptions();
  }
  Future<User> _authenticateRequest(Future<Response<dynamic>> Function() request) async {
    final epoch = _beginAuthentication();
    final intent = explicitLogoutIntent();
    try {
      final response = await request();
      return await _saveSession(Map<String,dynamic>.from(response.data as Map), epoch, logoutIntentAtStart: intent);
    } finally {
      _endAuthentication(epoch);
    }
  }
  void _syncSessionOptions() {
    // Dio copies these defaults while creating RequestOptions, before its
    // asynchronous interceptor queue can encounter a different login.
    _dio.options.extra['sessionEpoch'] = _sessionEpoch;
    _dio.options.extra['sessionCustomerId'] = _customerId;
    _dio.options.extra['authenticationTransitionBorn'] = _authenticationTransition;
    _dio.options.extra['verificationRequiredBorn'] = _sessionNeedsVerification;
  }

  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;

  /// Shared refresh future to prevent concurrent 401 race conditions
  Future<bool>? _refreshFuture;
  int? _refreshEpoch;

  ApiService._internal() {
    _dio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: ApiConfig.timeout,
        receiveTimeout: ApiConfig.timeout,
        headers: {'Content-Type': 'application/json'},
        extra: {'sessionEpoch': 0, 'sessionCustomerId': null, 'authenticationTransitionBorn': false},
      ),
    );
    configureSessionTransport(_dio);

    // Add interceptor for auth token
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.method == 'GET' &&
              (const {
                    '/shops',
                    '/shops/nearby',
                    '/shops/resolve',
                    '/services',
                    '/therapists',
                    '/banners',
                    '/banners/active',
                  }.contains(options.path) ||
                  RegExp(
                    r'^/(shops|services|therapists)/[1-9][0-9]*$',
                  ).hasMatch(options.path) ||
                  RegExp(
                    r'^/reviews/shop/[1-9][0-9]*$',
                  ).hasMatch(options.path))) {
            options.extra['publicRead'] = true;
          }
          if (options.extra['publicRead'] != true) {
            options.extra.putIfAbsent('sessionEpoch', () => _sessionEpoch);
            options.extra.putIfAbsent('sessionCustomerId', () => _customerId);
            options.extra.putIfAbsent('authenticationTransitionBorn', () => _authenticationTransition);
            if (!_requestCurrent(options)) { handler.reject(_changedSession(options)); return; }
            if (_blockedUnverifiedWrite(options)) {
              handler.reject(DioException(requestOptions: options, type: DioExceptionType.cancel,
                error: const SessionVerificationUnavailable()));
              return;
            }
            try {
              await _guardBookingChange(options);
            } catch (error) {
              handler.reject(DioException(requestOptions: options,
                type: DioExceptionType.cancel, error: error));
              return;
            }
            // Reading recovery storage may yield across a different login.
            if (!_requestCurrent(options)) { handler.reject(_changedSession(options)); return; }
            if (_blockedUnverifiedWrite(options)) {
              handler.reject(DioException(requestOptions: options, type: DioExceptionType.cancel,
                error: const SessionVerificationUnavailable()));
              return;
            }
          }
          final token = options.extra['publicRead'] == true
              ? null
              : _accessToken;
          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          } else {
            options.headers.remove('Authorization');
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          if (response.requestOptions.extra['publicRead'] != true && !_requestCurrent(response.requestOptions)) {
            handler.reject(_changedSession(response.requestOptions)); return;
          }
          handler.next(response);
        },
        onError: (error, handler) async {
          // Anonymous/public failures must not refresh or expire a session.
          if (error.requestOptions.extra['publicRead'] == true) {
            handler.next(error);
            return;
          }
          if (!_requestCurrent(error.requestOptions)) { handler.reject(_changedSession(error.requestOptions)); return; }
          // Credential mutations have their own proof. Never replay them through
          // a refreshed cookie after an invalid current password or proof.
          if (error.requestOptions.extra['noAuthReplay'] == true) {
            handler.next(error); return;
          }
          // Only authentication bootstrap may discover an unknown customer.
          // An unauthenticated business command must not adopt a shared cookie
          // and replay that command as whichever account the cookie names.
          if (error.response?.statusCode == 401 && error.requestOptions.extra['sessionCustomerId'] == null && error.requestOptions.path != '/auth/me') {
            handler.next(error); return;
          }
          if (error.response?.statusCode == 401 &&
              error.requestOptions.extra['sessionRetried'] == true &&
              error.requestOptions.extra['sessionEpoch'] == _sessionEpoch) {
            await _expireSession(expectedEpoch: _sessionEpoch);
          }
          if (error.response?.statusCode == 401 &&
              error.requestOptions.extra['sessionRetried'] != true &&
              !_anonymousAuthenticationCommand(error.requestOptions)) {
            // Share the refresh attempt among concurrent 401s
            bool refreshed;
            try { refreshed = await _refreshSession(); }
            on SessionVerificationUnavailable catch (unavailable) {
              handler.reject(DioException(requestOptions: error.requestOptions, type: DioExceptionType.unknown, error: unavailable));
              return;
            }
            if (!_requestCurrent(error.requestOptions)) { handler.reject(_changedSession(error.requestOptions)); return; }

            if (refreshed) {
              try {
                final retryResponse = await _retry(error.requestOptions);
                handler.resolve(retryResponse);
              } on DioException catch (retryError) {
                handler.next(retryError);
              }
              return;
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  Future<bool> _refreshSession() {
    if (kIsWeb && explicitLogoutIntent() != null) return Future.value(false);
    final epoch = _sessionEpoch, expectedCustomer = _customerId;
    if (_refreshFuture == null || _refreshEpoch != epoch) {
      _refreshEpoch = epoch;
      final task = _doRefresh(epoch, expectedCustomer);
      _refreshFuture = task;
      void complete() { if (identical(_refreshFuture, task)) { _refreshFuture = null; _refreshEpoch = null; } }
      task.then<void>((_) => complete(), onError: (Object _, StackTrace _) { complete(); });
    }
    return _refreshFuture!;
  }

  /// A known customer cannot be replaced by a different shared refresh cookie.
  Future<bool> _doRefresh(int epoch, String? expectedCustomer) async {
    final profileVersion = _profileVerificationVersion;
    try {
      final refreshToken = kIsWeb ? null : await _storage.read(key: _refreshTokenKey);
      if (epoch != _sessionEpoch) return false;
      if (!kIsWeb && refreshToken == null) {
        if (_accessToken != null || expectedCustomer != null) await _expireSession(expectedEpoch: epoch);
        return false;
      }
      final transport = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl, connectTimeout: ApiConfig.timeout, receiveTimeout: ApiConfig.timeout));
      configureSessionTransport(transport);
      final response = await transport.post('/auth/customer/refresh', data: kIsWeb ? null : {'refreshToken': refreshToken});
      if (epoch != _sessionEpoch) return false;
      if (kIsWeb && explicitLogoutIntent() != null) return false;
      final raw = response.data;
      if (raw is! Map || raw['user'] is! Map || raw['accessToken'] is! String || (raw['accessToken'] as String).isEmpty) throw const FormatException('Invalid session response');
      final data = Map<String, dynamic>.from(raw), profile = data['user'] as Map;
      if (profile['id'] is! String || (profile['id'] as String).trim().isEmpty || !const ['CUSTOMER','MERCHANT','ADMIN','STAFF'].contains(profile['role']) ||
          raw['refreshToken'] != null && (raw['refreshToken'] is! String || (raw['refreshToken'] as String).isEmpty) ||
          raw['reauthToken'] != null && raw['reauthToken'] is! String ||
          profile.containsKey('emailVerified') && profile['emailVerified'] is! bool ||
          const ['phone','email','name','avatarUrl','status'].any((key) => profile[key] != null && profile[key] is! String)) {
        throw const FormatException('Invalid session identity');
      }
      final user = User.fromJson(Map<String, dynamic>.from(profile));
      if (user.role != 'CUSTOMER' || expectedCustomer != null && user.id != expectedCustomer) throw _SessionIdentityMismatch();
      await _saveSession(data, epoch, preserveVerification: true);
      return epoch == _sessionEpoch;
    } catch (error) {
      if (epoch != _sessionEpoch) return false;
      if (error is _SessionIdentityMismatch || error is DioException && error.response?.statusCode == 401) {
        try { await _expireSession(expectedEpoch: epoch); } catch (_) { /* Memory identity was already invalidated. */ }
        return false;
      }
      _unverifiedSession(epoch, profileVersion: profileVersion);
      throw const SessionVerificationUnavailable();
    }
  }

  /// Public access to Dio for shop repository and other services
  Dio get dio => _dio;
  int get sessionGeneration => _sessionEpoch;

  static Options get publicReadOptions => Options(extra: {'publicRead': true});

  /// Send OTP to phone number
  Future<void> sendOtp(String phone) async {
    await _dio.post('/auth/send-otp', data: {'phone': phone});
  }

  /// Social login (Apple / Google)
  /// Requires a provider-issued identity token; no development fallback.
  Future<User> socialLogin({
    required String provider,
    required String idToken,
    required String challengeId,
    String? email,
    String? name,
  }) => _authenticateRequest(() => _dio.post(
      '/auth/$provider',
      data: {
        'idToken': idToken,
        'challengeId': challengeId,
        // ignore: use_null_aware_elements
        if (email != null) 'email': email,
        // ignore: use_null_aware_elements
        if (name != null) 'name': name,
      },
    ));

  /// Verify OTP and login/register
  Future<User> verifyOtp(String phone, String code) => _authenticateRequest(() => _dio.post(
      '/auth/verify-otp',
      data: {'phone': phone, 'code': code},
    ));

  Future<User> passwordLogin(String email, String password) => _authenticateRequest(() => _dio.post(
      '/auth/customer/password/login',
      data: {'email': email, 'password': password},
    ));

  Future<Map<String, dynamic>> requestCustomerPasswordRecovery(String email) async {
    final response = await _dio.post('/auth/customer/password/recovery/request',
      data: {'email': email.trim()}, options: Options(extra: {'noAuthReplay': true}));
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<void> changeCustomerPassword(String currentPassword, String newPassword) =>
      _changeCustomerCredential('/auth/customer/password/change', {
        'currentPassword': currentPassword, 'newPassword': newPassword,
      });

  Future<void> completeCustomerPasswordRecovery(String challengeId, String code, String newPassword) =>
      _changeCustomerCredential('/auth/customer/password/recovery/complete', {
        'challengeId': challengeId, 'code': code, 'newPassword': newPassword,
      });

  Future<void> _changeCustomerCredential(String route, Map<String, dynamic> body) async {
    final generation = _sessionEpoch;
    final response = await _dio.post(route, data: body,
      options: Options(extra: {'noAuthReplay': true}));
    if (generation != _sessionEpoch) throw StateError('The customer session changed.');
    final data = response.data;
    if (data is! Map || data['changed'] != true || data['reauthenticationRequired'] != true) {
      throw StateError('The password change could not be confirmed.');
    }
    // The server revoked all old sessions without touching a shared cookie
    // that a newer sign-in may have replaced while this request was in flight.
    // Only the matching local generation may be discarded by this receipt.
    await _expireSession(expectedEpoch: generation);
  }

  Future<User> _saveSession(Map<String, dynamic> data, int epoch, {bool preserveVerification = false, String? logoutIntentAtStart}) async {
    if (epoch != _sessionEpoch) throw StateError('The customer session changed.');
    final user = User.fromJson(data['user'] as Map<String, dynamic>);
    final token = data['accessToken'] as String;
    if (user.role != 'CUSTOMER') {
      _accessToken = null;
      throw StateError('Use the separate management sign-in portal.');
    }
    if (token.isEmpty || user.id.isEmpty) {
      throw StateError('Invalid session response');
    }
    if (!kIsWeb) {
      await _queueStorage(epoch, () async {
        await _storage.delete(key: _accessTokenKey);
        await _storage.delete(key: _userIdKey);
        if (epoch == _sessionEpoch && data['refreshToken'] is String) await _storage.write(key: _refreshTokenKey, value: data['refreshToken'] as String);
      });
    }
    if (epoch != _sessionEpoch) throw StateError('The customer session changed.');
    if (!preserveVerification && !acceptExplicitLogin(logoutIntentAtStart)) {
      throw StateError('You signed out while sign-in was pending. Sign in again.');
    }
    _accessToken = token;
    _customerId = user.id;
    _customerReauthToken = data['reauthToken'] as String?;
    if (!preserveVerification) _sessionNeedsVerification = false;
    _syncSessionOptions();
    return user;
  }

  Future<Map<String, dynamic>> customerAuthConfig() async =>
      Map<String, dynamic>.from(
        (await _dio.get(
              '/auth/customer/config',
              options: publicReadOptions,
            )).data
            as Map,
      );
  Future<Map<String, dynamic>> socialChallenge(String provider) async =>
      Map<String, dynamic>.from(
        (await _dio.post(
              '/auth/customer/social/challenge',
              data: {'provider': provider},
            )).data
            as Map,
      );
  Future<Map<String, dynamic>> requestEmailLogin(String email) async =>
      Map<String, dynamic>.from(
        (await _dio.post(
              '/auth/customer/email/request',
              data: {'email': email.trim()},
            )).data
            as Map,
      );
  Future<User> verifyEmailLogin(String challengeId, String code) => _authenticateRequest(() => _dio.post(
              '/auth/customer/email/verify',
              data: {'challengeId': challengeId, 'code': code},
            ));

  Future<void> verifyCurrentCustomerEmail(String challengeId, String code) async {
    final response = await _dio.post('/auth/customer/email/verify-current', data: {
      'challengeId': challengeId,
      'code': code,
    });
    if (response.data is! Map || (response.data as Map)['verified'] != true) {
      throw StateError('Email verification could not be confirmed.');
    }
  }

  Future<void> linkCustomerProvider(
    String provider,
    String idToken,
    String challengeId,
    String password,
  ) async {
    await _dio.post(
      '/auth/customer/providers/$provider/link',
      data: {
        'idToken': idToken,
        'challengeId': challengeId,
        if (password.isNotEmpty) 'password': password,
        if (password.isEmpty && _customerReauthToken != null)
          'reauthToken': _customerReauthToken,
      },
    );
  }

  /// Retry failed request
  /// Note: do NOT manually set Authorization header here — the interceptor
  /// (onRequest) will read the (possibly refreshed) token from memory
  /// automatically and set it on the retry request.
  Future<Response> _retry(RequestOptions requestOptions) async {
    if (!_requestCurrent(requestOptions)) throw _changedSession(requestOptions);
    requestOptions.extra['sessionRetried'] = true;
    requestOptions.data = cloneRetryBody(requestOptions.data);
    return _dio.fetch(requestOptions);
  }

  static dynamic cloneRetryBody(dynamic body) =>
      body is FormData ? body.clone() : body;

  /// Update user profile
  Future<User> updateProfile(
    String userId, {
    String? name,
    String? email,
  }) async {
    final data = <String, dynamic>{};
    if (name != null) data['name'] = name;
    if (email != null) data['email'] = email;

    final response = await _dio.patch('/users/$userId', data: data);
    final raw = response.data;
    if (raw is! Map || raw['id'] != userId || raw['role'] != 'CUSTOMER' ||
        const ['phone','email','name','avatarUrl'].any((key) => !raw.containsKey(key) || raw[key] != null && raw[key] is! String) ||
        name != null && raw['name'] != name.trim() ||
        email != null && raw['email'] != email.trim().toLowerCase()) {
      throw const ProfileSaveUnverified();
    }
    return User.fromJson(Map<String,dynamic>.from(raw));
  }

  /// Get current user's profile
  Future<User> getMyProfile() async {
    final epoch = _sessionEpoch, profileVersion = ++_profileVerificationVersion;
    try {
    final response = await _dio.get('/auth/me');
    final raw = response.data;
    if (raw is! Map ||
        raw['id'] is! String ||
        (raw['id'] as String).trim().isEmpty ||
        !const ['CUSTOMER', 'MERCHANT', 'ADMIN', 'STAFF'].contains(raw['role']) ||
        raw['emailVerified'] is! bool ||
        const ['phone', 'email', 'name', 'avatarUrl'].any(
          (key) => !raw.containsKey(key) ||
              raw[key] != null && raw[key] is! String,
        )) {
      throw const FormatException('The account details could not be verified.');
    }
    final user = User.fromJson(Map<String, dynamic>.from(raw));
    if (user.role != 'CUSTOMER' || _customerId != null && user.id != _customerId) {
      if (profileVersion != _profileVerificationVersion) throw const FormatException('The account details could not be verified.');
      await _expireSession(expectedEpoch: epoch);
      throw _SessionIdentityMismatch();
    }
    if (epoch != _sessionEpoch) throw _changedSession(response.requestOptions);
    if (profileVersion == _profileVerificationVersion) {
      _sessionNeedsVerification = false;
      _syncSessionOptions();
    }
    return user;
    } catch (_) {
      _unverifiedSession(epoch, profileVersion: profileVersion);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> requestAvatarUpload(String extension) async {
    final response = await _dio.get(
      '/upload/avatar-presigned',
      queryParameters: {'ext': extension},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> uploadManagedAvatar(
    List<int> bytes,
    String mime,
    String extension,
    String requestKey,
  ) async {
    final response = await _dio.post(
      '/upload/media',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(
          bytes,
          filename: 'avatar.$extension',
          contentType: DioMediaType.parse(mime),
        ),
        'scope': 'AVATAR',
        'purpose': 'avatar',
        'requestKey': requestKey,
      }),
      options: Options(contentType: 'multipart/form-data'),
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> confirmManagedMedia(String id) async {
    final response = await _dio.post(
      '/upload/media/${Uri.encodeComponent(id)}/confirm',
      data: <String, dynamic>{},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> commitManagedAvatar(String id) async {
    final response = await _dio.post(
      '/upload/media/${Uri.encodeComponent(id)}/commit-avatar',
      data: <String, dynamic>{},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<void> abandonManagedMedia(String id) async {
    final response = await _dio.delete(
      '/upload/media/${Uri.encodeComponent(id)}',
    );
    if (response.data['abandoned'] != true) {
      throw const FormatException('Unused image cleanup was not confirmed.');
    }
  }

  Future<Map<String, dynamic>> confirmAvatarUpload(String fileUrl) async {
    final response = await _dio.post(
      '/upload/avatar/confirm',
      data: {'fileUrl': fileUrl},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Get available time slots for a shop/service/date (uses booking-level endpoint)
  Future<Map<String, dynamic>> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) async {
    final params = <String, dynamic>{
      'shopId': shopId,
      'serviceId': serviceId,
      'date': date,
    };
    if (therapistId != null) params['therapistId'] = therapistId;
    if (variantId != null) params['variantId'] = variantId;
    if (preferredTherapistIds != null && preferredTherapistIds.isNotEmpty) {
      params['preferredTherapistIds'] = preferredTherapistIds.join(',');
    }
    final response = await _dio.get(
      '/bookings/slots',
      queryParameters: params,
      options: publicReadOptions,
    );
    return response.data as Map<String, dynamic>;
  }

  /// Create a new booking
  Future<Map<String, dynamic>> createBooking({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    String? requestKey,
    required String date,
    required String startTime,
    int? durationMin,
    String? notes,
    String? couponId,
    String paymentMode = 'PAY_AT_STORE',
    Map<String, dynamic>? contact,
  }) async {
    final data = <String, dynamic>{
      'shopId': shopId,
      'serviceId': serviceId,
      'date': date,
      'startTime': startTime,
      'paymentMode': paymentMode,
      'contact': ?contact,
    };
    if (therapistId != null) data['therapistId'] = therapistId;
    if (variantId != null) data['variantId'] = variantId;
    if (preferredTherapistIds != null) {
      data['preferredTherapistIds'] = preferredTherapistIds;
    }
    if (requestKey != null) data['requestKey'] = requestKey;
    if (durationMin != null) data['durationMin'] = durationMin;
    if (notes != null) data['notes'] = notes;
    if (couponId != null) data['couponId'] = couponId;
    final response = await _dio.post('/bookings', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Get user bookings
  Future<List<dynamic>> getUserBookings() async {
    final response = await _dio.get('/bookings');
    return response.data as List<dynamic>;
  }

  Future<Map<String, dynamic>> getUserBookingPage(
    Map<String, dynamic> query, {
    CancelToken? cancelToken,
  }) async {
    final response = await _dio.get(
      '/bookings',
      queryParameters: query,
      cancelToken: cancelToken,
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> getBookingPlanSlots(
    Map<String, dynamic> selection,
  ) async {
    final response = await _dio.post(
      '/bookings/plan-slots',
      data: selection,
      options: publicReadOptions,
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> createBookingPlan(
    Map<String, dynamic> selection,
  ) async {
    final response = await _dio.post('/bookings/plan', data: selection);
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Authenticated, read-only pricing. No booking, hold or coupon consumption.
  Future<Map<String,dynamic>> getBookingQuote(Map<String,dynamic> selection, {bool plan = false}) async {
    final response = await _dio.post(plan ? '/bookings/plan-quote' : '/bookings/quote', data: selection);
    return Map<String,dynamic>.from(response.data as Map);
  }

  Future<Map<String,dynamic>> createQuotedBooking(Map<String,dynamic> selection) async {
    final response = await _dio.post('/bookings', data: selection);
    return Map<String,dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> getRescheduleSlots(
    String bookingId, {
    required String date,
  }) async {
    final response = await _dio.get(
      '/bookings/${Uri.encodeComponent(bookingId)}/reschedule-slots',
      queryParameters: {'date': date},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Cancel a booking
  Future<Map<String, dynamic>> cancelBooking(String bookingId) async {
    final response = await _dio.post('/bookings/$bookingId/cancel');
    return response.data as Map<String, dynamic>;
  }

  /// Delete a booking (hard delete)
  Future<Map<String, dynamic>> deleteBooking(String bookingId) async {
    final response = await _dio.delete('/bookings/$bookingId');
    return response.data as Map<String, dynamic>;
  }

  /// Request a full refund for a booking
  Future<Map<String, dynamic>> requestRefund(String bookingId) async {
    final response = await _dio.post('/bookings/$bookingId/refund');
    return response.data as Map<String, dynamic>;
  }

  /// Request a partial refund for a booking
  Future<Map<String, dynamic>> requestPartialRefund(
    String bookingId,
    int amountCents,
  ) async {
    final response = await _dio.post(
      '/bookings/$bookingId/refund-partial',
      data: {'amountCents': amountCents},
    );
    return response.data as Map<String, dynamic>;
  }

  // ─── Payment API ─────────────────────────────────────────

  /// Create a payment intent for a booking
  /// Backend returns: {paymentIntentId, clientSecret, amountCents, platformFeeCents, merchantAmountCents}
  Future<Map<String, dynamic>> createPaymentIntent(String bookingId) async {
    final response = await _dio.post(
      '/payments/create-intent',
      data: {'bookingId': bookingId},
    );
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getPaymentConfig() async {
    final response = await _dio.get('/payments/config');
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getPaymentQuote(String bookingId) async {
    final response = await _dio.post(
      '/payments/quote',
      data: {'bookingId': bookingId},
    );
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getBooking(String bookingId) async {
    final response = await _dio.get('/bookings/$bookingId');
    return response.data as Map<String, dynamic>;
  }
  Future<Map<String,dynamic>> getBookingOrderEmail(String bookingId) async {
    final response = await _dio.get('/notifications/bookings/${Uri.encodeComponent(bookingId)}/order-email');
    return Map<String,dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> rescheduleBooking(
    String bookingId, {
    required String date,
    required String startTime,
    String? requestKey,
  }) async {
    if (requestKey == null) {
      throw const RescheduleJournalException('A saved original change record is required before rescheduling.');
    }
    final response = await _dio.post(
      '/bookings/${Uri.encodeComponent(bookingId)}/reschedule',
      data: {'date': date, 'startTime': startTime},
      options: Options(headers: {'Idempotency-Key': requestKey}),
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> reconcileBookingReschedule(String bookingId, String requestKey) async {
    final response = await _dio.post(
      '/bookings/${Uri.encodeComponent(bookingId)}/operations/${Uri.encodeComponent(requestKey)}/reconcile',
      data: <String, dynamic>{},
    );
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Confirm a payment (mock or real depending on backend mode)
  /// Backend returns: {status: 'succeeded'|'failed', paymentIntentId, mock: bool}
  Future<Map<String, dynamic>> confirmPayment(String paymentIntentId, {String? bookingId}) async {
    // Intent identifiers alone cannot establish which booking's pending move
    // must be respected. No current customer UI calls this legacy endpoint.
    if (bookingId == null) throw const RescheduleJournalException('Reopen the booking before confirming a payment.');
    final response = await _dio.post(
      '/payments/confirm',
      data: {'paymentIntentId': paymentIntentId},
      options: Options(extra: {'guardBookingId': bookingId}),
    );
    return response.data as Map<String, dynamic>;
  }

  // ─── Review API ──────────────────────────────────────────

  /// Create a review for a completed booking
  Future<Map<String, dynamic>> createReview({
    required String bookingId,
    required int rating,
    String? content,
  }) async {
    final data = <String, dynamic>{'bookingId': bookingId, 'rating': rating};
    if (content != null && content.isNotEmpty) data['content'] = content;
    final response = await _dio.post('/reviews', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Get reviews for a shop (public)
  Future<Map<String, dynamic>> getShopReviews(
    String shopId, {
    int page = 1,
    int limit = 10,
  }) async {
    final response = await _dio.get(
      '/reviews/shop/$shopId',
      queryParameters: {'page': page, 'limit': limit},
      options: publicReadOptions,
    );
    return response.data as Map<String, dynamic>;
  }

  /// Get current user's reviews
  Future<List<dynamic>> getMyReviews() async {
    final response = await _dio.get('/reviews/my');
    // Response format: {items: [...], total, page, limit} or direct list
    final data = response.data;
    if (data is List) return data;
    if (data is Map && data.containsKey('items')) {
      return data['items'] as List<dynamic>;
    }
    return [];
  }

  /// Update own review
  Future<Map<String, dynamic>> updateReview({
    required String reviewId,
    int? rating,
    String? content,
  }) async {
    final data = <String, dynamic>{};
    if (rating != null) data['rating'] = rating;
    if (content != null) data['content'] = content;
    final response = await _dio.patch('/reviews/$reviewId', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Delete own review
  Future<void> deleteReview(String reviewId) async {
    await _dio.delete('/reviews/$reviewId');
  }

  /// Logout (clear stored tokens)
  Future<void> logout() async {
    if (kIsWeb) markExplicitLogout();
    final epoch = _beginAuthentication();
    try {
      final refreshToken = kIsWeb ? null : await _storage.read(key: _refreshTokenKey);
      if (epoch != _sessionEpoch) return;
      await _dio.post('/auth/customer/logout', data: kIsWeb ? null : {'refreshToken': refreshToken});
    } finally {
      try {
        if (epoch == _sessionEpoch && !kIsWeb) await _queueStorage(epoch, () => _storage.deleteAll());
      } finally {
        _endAuthentication(epoch);
      }
    }
  }

  /// Check if user has stored token
  Future<bool> hasToken() async {
    if (kIsWeb && explicitLogoutIntent() != null) return false;
    if (_accessToken != null) return true;
    return _refreshSession();
  }

  /// Read stored access token
  Future<String?> getAccessToken() async {
    return _accessToken;
  }
}
