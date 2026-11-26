import 'package:dio/dio.dart';

/// Customer copy comes only from this allowlist, never from server text.
String reviewWriteError(Object error) => _reviewError(
  error,
  fallback:
      'Unable to save your review. Your draft has been kept. Please try again.',
  unverified:
      'Unable to verify whether your review was saved. Your draft has been kept. Check My Reviews before trying again.',
  writing: true,
);

String reviewDeleteError(Object error) => _reviewError(
  error,
  fallback: 'Unable to delete your review. Please try again.',
  unverified:
      'Unable to verify whether your review was deleted. Refresh My Reviews before trying again.',
);

String _reviewError(
  Object error, {
  required String fallback,
  required String unverified,
  bool writing = false,
}) {
  if (error is! DioException) return fallback;
  final status = error.response?.statusCode;
  // A missing or server-error response does not prove a write was rejected.
  if (status == null || status == 408 || status >= 500) return unverified;

  if (writing && status == 400) {
    final data = error.response?.data;
    if (data is Map) {
      final nested = data['error'];
      final payload = nested is Map ? nested : data;
      if (payload['code'] == 'REVIEWS_DISABLED') {
        return 'This shop is no longer accepting new or updated reviews. Your draft has been kept.';
      }
    }
  }

  switch (status) {
    case 401:
      return 'Your session has expired. Sign in again to continue.';
    case 403:
      return 'This review action is not available for your account.';
    case 404:
      return 'This review or booking is no longer available. Refresh My Reviews and your bookings.';
    case 409:
      return 'The review details changed. Refresh My Reviews before trying again.';
    case 429:
      return 'Too many requests. Please wait a moment before trying again.';
    default:
      return fallback;
  }
}
