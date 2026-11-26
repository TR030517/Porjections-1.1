import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/user.dart';
import '../services/api_service.dart';

/// Auth state
class AuthState {
  final bool isLoading;
  final User? user;
  final String? error;
  final bool isLoggedIn;
  final bool sessionUnavailable;

  const AuthState({
    this.isLoading = false,
    this.user,
    this.error,
    this.isLoggedIn = false,
    this.sessionUnavailable = false,
  });

  AuthState copyWith({
    bool? isLoading,
    User? user,
    String? error,
    bool? isLoggedIn,
    bool? sessionUnavailable,
  }) {
    return AuthState(
      isLoading: isLoading ?? this.isLoading,
      user: user ?? this.user,
      error: error,
      isLoggedIn: isLoggedIn ?? this.isLoggedIn,
      sessionUnavailable: sessionUnavailable ?? this.sessionUnavailable,
    );
  }
}

/// Auth Notifier
class AuthNotifier extends StateNotifier<AuthState> {
  final ApiService _api;
  late final StreamSubscription<int> _sessionSubscription;
  late final StreamSubscription<int> _verificationSubscription;
  int _operationVersion = 0;
  int _profileVersion = 0;

  AuthNotifier(this._api) : super(const AuthState()) {
    _sessionSubscription = _api.sessionExpired.listen((generation) {
      if (!mounted || generation != _api.sessionGeneration) return;
      _operationVersion++;
      _profileVersion++;
      state = const AuthState(
        error: 'Your session has expired. Please sign in again.',
      );
    });
    _verificationSubscription = _api.sessionUnverified.listen((generation) {
      if (!mounted ||
          generation != _api.sessionGeneration ||
          !_api.sessionNeedsVerification) {
        return;
      }
      state = state.copyWith(
        sessionUnavailable: true,
        error: const SessionVerificationUnavailable().toString(),
      );
    });
  }

  @override
  void dispose() {
    _operationVersion++;
    _profileVersion++;
    _sessionSubscription.cancel();
    _verificationSubscription.cancel();
    super.dispose();
  }

  int _beginOperation() {
    if (!mounted) throw StateError('The authentication view is closed.');
    return ++_operationVersion;
  }

  bool _current(int operation, int generation) =>
      mounted &&
      operation == _operationVersion &&
      generation == _api.sessionGeneration;

  void _requireCurrent(int operation, int generation) {
    if (!_current(operation, generation)) {
      throw StateError('The customer session changed.');
    }
  }

  Future<User> _authenticate(
    Future<User> Function() authenticate,
    String failureMessage,
  ) async {
    final operation = _beginOperation();
    state = state.copyWith(isLoading: true, error: null);
    var generation = _api.sessionGeneration;
    try {
      final request = authenticate();
      // Authentication starts its new API generation synchronously. Keep that
      // generation; never adopt whichever account finishes a later operation.
      generation = _api.sessionGeneration;
      final user = await request;
      _requireCurrent(operation, generation);
      state = AuthState(user: user, isLoggedIn: true);
      return user;
    } catch (_) {
      if (_current(operation, generation)) {
        state = AuthState(error: failureMessage);
      }
      rethrow;
    }
  }

  /// Check existing session on app start
  Future<void> checkSession() async {
    final operation = _beginOperation(), generation = _api.sessionGeneration;
    final profile = ++_profileVersion;
    bool current() =>
        _current(operation, generation) && profile == _profileVersion;
    _api.beginSessionVerification();
    state = state.copyWith(isLoading: true, sessionUnavailable: true);
    try {
      final hasToken = await _api.hasToken();
      if (!current()) return;
      if (hasToken) {
        // Verify token is still valid by fetching profile
        try {
          final user = await _api.getMyProfile();
          if (!current()) return;
          if (user.role != 'CUSTOMER' ||
              state.user != null && state.user?.id != user.id) {
            await logout();
            return;
          }
          state = state.copyWith(
            isLoggedIn: true,
            user: user,
            isLoading: false,
            sessionUnavailable: false,
          );
        } catch (_) {
          if (current()) {
            state = state.copyWith(
              isLoading: false,
              sessionUnavailable: true,
              error: const SessionVerificationUnavailable().toString(),
            );
          }
        }
      } else {
        _api.finishAbsentSessionVerification();
        state = const AuthState();
      }
    } catch (e) {
      if (current()) {
        state = state.copyWith(
          isLoading: false,
          sessionUnavailable: true,
          error: const SessionVerificationUnavailable().toString(),
        );
      }
    }
  }

  /// Send OTP
  Future<void> changePassword(String currentPassword, String newPassword) =>
      _changeCredential(() => _api.changeCustomerPassword(currentPassword, newPassword));

  Future<void> recoverPassword(String challengeId, String code, String newPassword) =>
      _changeCredential(() => _api.completeCustomerPasswordRecovery(challengeId, code, newPassword));

  Future<void> _changeCredential(Future<void> Function() action) async {
    final generation = _api.sessionGeneration;
    await action();
    if (mounted && _api.sessionGeneration == generation + 1) {
      _operationVersion++;
      _profileVersion++;
      state = const AuthState();
    }
  }

  Future<void> passwordLogin(String email, String password) async {
    await _authenticate(
      () => _api.passwordLogin(email, password),
      'Unable to sign in.',
    );
  }

  Future<void> sendOtp(String phone) async {
    final operation = _beginOperation(), generation = _api.sessionGeneration;
    state = state.copyWith(isLoading: true, error: null);
    try {
      await _api.sendOtp(phone);
      _requireCurrent(operation, generation);
      state = state.copyWith(isLoading: false);
    } catch (e) {
      if (_current(operation, generation)) {
        state = state.copyWith(isLoading: false, error: 'Failed to send OTP');
      }
      rethrow;
    }
  }

  /// Verify OTP
  Future<User> verifyOtp(String phone, String code) =>
      _authenticate(() => _api.verifyOtp(phone, code), 'Invalid OTP code');

  Future<User> verifyEmailLogin(String challengeId, String code) =>
      _authenticate(
        () => _api.verifyEmailLogin(challengeId, code),
        'Unable to verify your email code.',
      );

  /// Logout
  Future<void> logout() async {
    final operation = _beginOperation();
    final request = _api.logout();
    final generation = _api.sessionGeneration;
    // Clear account-bound drafts and views immediately, even if server logout
    // takes time or fails. A late receipt must not affect a newer sign-in.
    state = const AuthState();
    try {
      await request;
    } finally {
      if (_current(operation, generation)) state = const AuthState();
    }
  }

  /// A saved profile is an account-bound receipt, not a new authentication.
  Future<User> updateProfile({String? name, String? email}) async {
    if (!mounted ||
        !state.isLoggedIn ||
        state.sessionUnavailable ||
        _api.sessionNeedsVerification ||
        state.user?.role != 'CUSTOMER') {
      throw StateError('Sign in to update your account.');
    }
    final previous = state.user!,
        operation = _operationVersion,
        generation = _api.sessionGeneration;
    final profile = ++_profileVersion;
    final saved = await _api.updateProfile(
      previous.id,
      name: name,
      email: email,
    );
    _requireCurrent(operation, generation);
    if (profile != _profileVersion ||
        state.user?.id != previous.id ||
        saved.id != previous.id ||
        saved.role != 'CUSTOMER') {
      throw StateError('The customer session changed.');
    }
    final user = User(
      id: saved.id,
      phone: saved.phone,
      email: saved.email,
      name: saved.name,
      emailVerified: saved.emailVerified,
      avatarUrl: saved.avatarUrl,
      role: saved.role,
      status: previous.status,
    );
    state = AuthState(
      user: user,
      isLoggedIn: true,
      sessionUnavailable: _api.sessionNeedsVerification,
      error: _api.sessionNeedsVerification
          ? const SessionVerificationUnavailable().toString()
          : null,
    );
    return user;
  }

  Future<void> verifyCurrentEmail(String challengeId, String code) async {
    if (!mounted ||
        !state.isLoggedIn ||
        state.sessionUnavailable ||
        _api.sessionNeedsVerification ||
        state.user?.role != 'CUSTOMER') {
      throw StateError('Sign in to verify your account email.');
    }
    final previous = state.user!,
        operation = _operationVersion,
        generation = _api.sessionGeneration;
    final profile = ++_profileVersion;
    await _api.verifyCurrentCustomerEmail(challengeId, code);
    _requireCurrent(operation, generation);
    if (profile != _profileVersion ||
        state.user?.id != previous.id ||
        state.user?.email != previous.email ||
        previous.email?.isEmpty != false) {
      throw StateError(
        'The customer account changed before email verification.',
      );
    }
    state = AuthState(
      user: User(
        id: previous.id,
        phone: previous.phone,
        email: previous.email,
        emailVerified: true,
        name: previous.name,
        avatarUrl: previous.avatarUrl,
        role: previous.role,
        status: previous.status,
      ),
      isLoggedIn: true,
      sessionUnavailable: _api.sessionNeedsVerification,
      error: _api.sessionNeedsVerification
          ? const SessionVerificationUnavailable().toString()
          : null,
    );
  }

  /// Explicit read-back reports failure to the caller; it never resubmits a save.
  Future<User> reloadProfile() async {
    if (!mounted) throw StateError('The authentication view is closed.');
    final customer = state.user?.id;
    final operation = _operationVersion, generation = _api.sessionGeneration;
    final profile = ++_profileVersion;
    try {
      final user = await _api.getMyProfile();
      _requireCurrent(operation, generation);
      if (profile != _profileVersion ||
          customer == null ||
          state.user?.id != customer) {
        throw StateError('The customer profile could not be verified.');
      }
      if (user.role != 'CUSTOMER') {
        await logout();
        throw StateError('Use the management sign-in portal.');
      }
      if (user.id != customer) {
        throw StateError('The customer profile could not be verified.');
      }
      state = state.copyWith(
        user: user,
        isLoggedIn: true,
        sessionUnavailable: false,
        isLoading: false,
      );
      return user;
    } finally {
      // A newer explicit read owns the verification outcome and loading state.
      if (_current(operation, generation) &&
          profile == _profileVersion &&
          state.isLoading) {
        state = state.copyWith(isLoading: false, error: state.error);
      }
    }
  }

  /// Existing background callers keep their best-effort refresh contract.
  Future<void> refreshProfile() async {
    if (!mounted) return;
    try {
      await reloadProfile();
    } catch (_) {
      /* Explicit profile save/read callers receive errors directly. */
    }
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(apiServiceProvider));
});
