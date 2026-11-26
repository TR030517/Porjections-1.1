import 'package:dio/dio.dart';
import '../models/user.dart';
import 'api_service.dart';
import 'social_auth_platform_stub.dart'
    if (dart.library.js_interop) 'social_auth_platform_web.dart'
    as platform;

class CustomerAccountLinkRequired implements Exception {
  final String provider;
  final String idToken;
  final String challengeId;
  const CustomerAccountLinkRequired(
    this.provider,
    this.idToken,
    this.challengeId,
  );
}

/// Identity claims are verified by the server. No email-based account merging.
class SocialAuthService {
  final ApiService api;
  SocialAuthService({ApiService? api}) : api = api ?? ApiService();
  Future<Map<String, dynamic>> config() => api.customerAuthConfig();
  Future<User?> login(
    String provider,
    Map<String, dynamic> configuration,
  ) async {
    if (!platform.socialWebSupported) {
      throw UnsupportedError(
        'Native social sign-in is not enabled in this build.',
      );
    }
    final settings =
        configuration[provider.toLowerCase()] as Map<String, dynamic>?;
    if (settings?['enabled'] != true || settings?['webEnabled'] != true) {
      throw StateError('This sign-in provider is not configured.');
    }
    final challenge = await api.socialChallenge(provider);
    final token = await platform.obtainIdentityToken(
      provider: provider,
      clientId: settings!['webClientId'] as String,
      redirectUri: settings['redirectUri'] as String?,
      nonce: challenge['nonce'] as String,
    );
    if (token == null) return null;
    final id = challenge['challengeId'] as String;
    try {
      return await api.socialLogin(
        provider: provider.toLowerCase(),
        idToken: token,
        challengeId: id,
      );
    } on DioException catch (error) {
      if (error.response?.statusCode == 409 &&
          error.response?.data is Map &&
          (error.response?.data as Map)['message'] ==
              'CUSTOMER_ACCOUNT_LINK_REQUIRED') {
        throw CustomerAccountLinkRequired(provider, token, id);
      }
      rethrow;
    }
  }
}
