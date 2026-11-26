import 'package:flutter/foundation.dart';

/// MJAPP API Configuration
///
/// Base URL resolution order:
/// 1. `--dart-define=API_BASE_URL=...` (production builds,
///    e.g. `flutter build web --release --dart-define=API_BASE_URL=/api/v1`)
/// 2. Web: current page origin + `/api/v1` (same-origin reverse proxy)
/// 3. Fallback: `http://localhost:8000/api/v1` (local development)
class ApiConfig {
  static const String _definedBaseUrl = String.fromEnvironment('API_BASE_URL');

  static String get baseUrl {
    if (_definedBaseUrl.isNotEmpty) return _definedBaseUrl;
    if (kIsWeb) {
      try {
        return '${Uri.base.origin}/api/v1';
      } catch (_) {
        // ignore: fall through to local default
      }
    }
    return 'http://localhost:8000/api/v1';
  }

  static const Duration timeout = Duration(seconds: 30);
  static const String appName = 'Massajoy';
}
