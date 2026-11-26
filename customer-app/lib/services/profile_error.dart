import 'package:dio/dio.dart';

class ProfileSaveError {
  const ProfileSaveError(this.message, {this.needsReadback = false});

  final String message;
  final bool needsReadback;
}

/// Use local copy only: server text and exception details are not customer copy.
ProfileSaveError profileSaveError(Object error) {
  const unverified = ProfileSaveError(
    'Unable to verify whether your account details were saved. Your draft is preserved. Reload account details before saving again. No extra save has been sent.',
    needsReadback: true,
  );
  if (error is! DioException) return unverified;
  final status = error.response?.statusCode;
  // A missing response, timeout, or server failure does not confirm rejection.
  if (status == null || status < 400 || status == 408 || status >= 500) {
    return unverified;
  }

  switch (status) {
    case 400:
      return const ProfileSaveError(
        'Unable to save your account details. Check your name and email address, then try again. Your draft is preserved.',
      );
    case 401:
      return const ProfileSaveError(
        'Your session has expired. Sign in again to update account details.',
      );
    case 403:
      return const ProfileSaveError(
        'This account update is not permitted. Your draft is preserved.',
      );
    case 404:
      return const ProfileSaveError(
        'This account is no longer available. Sign in again or contact support.',
      );
    case 409:
      return const ProfileSaveError(
        'These account details conflict with an existing account. Check your email address before trying again. Your draft is preserved.',
      );
    case 429:
      return const ProfileSaveError(
        'Too many requests. Please wait a moment before trying again. Your draft is preserved.',
      );
    default:
      return const ProfileSaveError(
        'Unable to save your account details. Your draft is preserved. Please try again.',
      );
  }
}
