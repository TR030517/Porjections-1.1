class BookingOrderEmail {
  final String status;
  final bool localCapture;
  /// Null means an older response did not report this setting.
  final bool? workerEnabled;
  final bool? configured;
  final String? statusReasonCode;
  static const _customerReasons = {
    'ORDER_EMAIL_RECIPIENT_UNAVAILABLE',
    'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE',
    'ORDER_EMAIL_NOT_CONFIGURED',
    'ORDER_EMAIL_RATE_LIMITED',
    'ORDER_EMAIL_PROVIDER_REJECTED',
    'ORDER_EMAIL_ACCEPTANCE_UNKNOWN',
    'ORDER_EMAIL_EVENT_OBSOLETE',
  };
  const BookingOrderEmail(this.status, {
    this.localCapture = false,
    this.workerEnabled,
    this.configured,
    this.statusReasonCode,
  });
  factory BookingOrderEmail.fromJson(Map<String,dynamic> raw, String bookingId) {
    const statuses = {'QUEUED','PROCESSING','ACCEPTED','NOT_CONFIGURED','FAILED','ACCEPTANCE_UNKNOWN','CANCELLED','NOT_REQUESTED'};
    if (raw['bookingId'] != bookingId || raw['channel'] != 'EMAIL' || !statuses.contains(raw['status'])) {
      throw const FormatException('Invalid order email status');
    }
    final configuration = raw['configuration'];
    final local = configuration is Map && configuration['provider'] == 'local' && configuration['deliveryMode'] == 'LOCAL_CAPTURE';
    final reason = raw['statusReasonCode'];
    return BookingOrderEmail(raw['status'] as String,
      localCapture: local,
      workerEnabled: configuration is Map && configuration['workerEnabled'] is bool ? configuration['workerEnabled'] as bool : null,
      configured: configuration is Map && configuration['enabled'] is bool ? configuration['enabled'] as bool : null,
      statusReasonCode: reason is String && _customerReasons.contains(reason) ? reason : null,
    );
  }
  String get message {
    final detail = _reasonMessage;
    return detail == null ? _statusMessage : '$_statusMessage $detail';
  }

  // An uncertain acceptance must never become a definite failed send, even
  // when an older API reports FAILED alongside the safe reason code.
  String get _effectiveStatus => status == 'FAILED' && statusReasonCode == 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN'
      ? 'ACCEPTANCE_UNKNOWN' : status;

  String get _statusMessage {
    final current = _effectiveStatus;
    final waiting = current == 'QUEUED' || current == 'PROCESSING';
    if (localCapture) {
      if (current == 'ACCEPTED') return 'Your order email was captured locally for testing. No email was sent to your inbox.';
      if (waiting && configured == false) return 'Local email capture is not configured. No email will be sent to your inbox; review your saved order here.';
      if (waiting && workerEnabled == false) return 'The local email processor is disabled. Queued emails will not be captured automatically while it is disabled. No email will be sent to your inbox; review your saved order here.';
      if (waiting && workerEnabled == null) return 'Your order email is queued for local testing only. The email processor status has not been checked. No email will be sent to your inbox.';
      if (waiting) return 'Your order email is queued for local testing only. No email will be sent to your inbox.';
      return 'Local email test mode is active. No email is sent to your inbox; review your saved order here.';
    }
    if (waiting && configured == false) return 'Order email is not configured and cannot be sent automatically. Your saved order remains available here; contact the shop to confirm the appointment.';
    if (waiting && workerEnabled == false) return 'Email processing is disabled. Queued emails will not be processed automatically while it is disabled. Delivery has not been confirmed; use this saved order and contact the shop to confirm the appointment.';
    if (waiting && workerEnabled == null) return 'Your order email is ${current == 'PROCESSING' ? 'marked as processing' : 'queued'}, but the email processor status has not been checked. Delivery has not been confirmed; keep this saved order.';
    return switch (current) {
    'QUEUED' => 'Your order email is queued. Delivery has not yet been confirmed.',
    'PROCESSING' => 'Your order email is being processed. Delivery has not yet been confirmed.',
    'ACCEPTED' => 'The email service accepted the order email. This does not confirm delivery to your inbox.',
    'NOT_CONFIGURED' => 'Order email is not configured. Your saved order remains available here; contact the shop for offline handling.',
    'FAILED' => 'The latest order email attempt was not completed. Your saved order remains available here; contact the shop.',
    'ACCEPTANCE_UNKNOWN' => 'The email result is unknown. Check your inbox and this saved order; no duplicate order is needed.',
    'CANCELLED' => 'This order email task was cancelled. Review the saved order status below.',
    _ => 'No order email has been requested for this booking.',
  };
  }

  String? get _reasonMessage {
    // Never carry a stale failure into a completed task or infer a reason for
    // a missing task. Unknown and store-only codes have no customer projection.
    if (_effectiveStatus == 'ACCEPTED' || _effectiveStatus == 'NOT_REQUESTED') return null;
    return switch (statusReasonCode) {
      'ORDER_EMAIL_RECIPIENT_UNAVAILABLE' => 'The account or verified email for this notification is unavailable. Review your profile and email verification status, and contact the shop if you need appointment confirmation.',
      'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE' => 'The saved details for this email could not be verified. Review this order and contact the shop about its current status.',
      'ORDER_EMAIL_NOT_CONFIGURED' => localCapture
          ? 'Local email capture was not configured for the latest attempt. Keep this saved order; no inbox delivery is expected in local test mode.'
          : 'The email service was not configured for the latest attempt. Contact the shop to confirm the appointment and keep this saved order.',
      'ORDER_EMAIL_RATE_LIMITED' => 'The email service limited the latest attempt. Wait and refresh email status. Refreshing only checks the result; it does not resend the email or create another order.',
      'ORDER_EMAIL_PROVIDER_REJECTED' => 'The email service rejected the latest attempt. Contact the shop to confirm the appointment and ask support to review the notification.',
      'ORDER_EMAIL_ACCEPTANCE_UNKNOWN' => localCapture
          ? 'The local capture result is unknown. Ask support to check the original capture record before taking further action; do not request another order or notification.'
          : 'Ask the shop or support to check the original notification before taking further action. Do not request another order or notification.',
      'ORDER_EMAIL_EVENT_OBSOLETE' => 'This notification no longer matches the current order. Review the latest order status instead of requesting the old notification again.',
      _ => null,
    };
  }
}
