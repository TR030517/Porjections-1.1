import '../config/api_config.dart';

final managedMediaPath = RegExp(
  r'^/api/v1/upload/media/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/file$',
  caseSensitive: false,
);

// Fixed, versioned display-menu subjects; no encoded paths, query or fragment.
final serviceGalleryPath = RegExp(
  r'^/service-gallery/v1/[a-z][a-z0-9-]{0,79}\.webp$',
);

/// Managed paths are resolved against the API origin, never the current page path.
/// Display-menu callers may also opt into the exact static service gallery path.
/// Other relative paths, explicit HTTP URLs and credential-bearing URLs are rejected.
String? resolveCustomerMediaUrl(
  dynamic value, {
  String? apiBaseUrl,
  Uri? pageUri,
  bool allowServiceGallery = false,
}) {
  if (value is! String) {
    return null;
  }
  final text = value.trim();
  if (text.isEmpty ||
      text.length > 500 ||
      RegExp(r'[\s\\\x00-\x1f\x7f]').hasMatch(text)) {
    return null;
  }
  if (managedMediaPath.hasMatch(text) ||
      (allowServiceGallery && serviceGalleryPath.hasMatch(text))) {
    final api = Uri.tryParse(apiBaseUrl ?? ApiConfig.baseUrl);
    if (api == null || api.userInfo.isNotEmpty) {
      return null;
    }
    Uri? origin;
    if (['http', 'https'].contains(api.scheme) && api.host.isNotEmpty) {
      origin = api;
    } else if (!api.hasScheme &&
        !api.hasAuthority &&
        api.path.startsWith('/')) {
      origin = pageUri ?? Uri.base;
    }
    if (origin == null ||
        !['http', 'https'].contains(origin.scheme) ||
        origin.host.isEmpty ||
        origin.userInfo.isNotEmpty) {
      return null;
    }
    return Uri.parse(origin.origin).resolve(text).toString();
  }
  final uri = Uri.tryParse(text);
  return uri != null &&
          uri.scheme == 'https' &&
          uri.host.isNotEmpty &&
          uri.userInfo.isEmpty
      ? uri.toString()
      : null;
}
