const socialWebSupported = false;
Future<String?> obtainIdentityToken({
  required String provider,
  required String clientId,
  required String nonce,
  String? redirectUri,
}) async {
  throw UnsupportedError(
    'Native Google/Apple sign-in requires a configured native application.',
  );
}
