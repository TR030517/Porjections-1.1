import 'dart:convert';
import 'booking.dart';

/// The original move command, without customer contact details or credentials.
class BookingRescheduleAttempt {
  final String actorId, bookingId, shopId, requestKey;
  final String date, startTime, timezone, baseline;

  const BookingRescheduleAttempt._({
    required this.actorId, required this.bookingId, required this.shopId,
    required this.requestKey, required this.date, required this.startTime,
    required this.timezone, required this.baseline,
  });

  static Map<String, dynamic> _request(dynamic selection) => {
    'therapistSelectionMode': selection.mode,
    'requestedTherapistIds': [...selection.requestedIds]..sort(),
  };

  static String _baseline(Booking booking) {
    final items = booking.reservationKind == 'PLAN'
        ? [for (final item in booking.items) {
            'id': item.id, 'request': _request(item.therapistSelection),
          }]
        : <Map<String, dynamic>>[];
    items.sort((a, b) => (a['id'] as String).compareTo(b['id'] as String));
    return jsonEncode({
      'reservationKind': booking.reservationKind,
      'priceCents': booking.priceCents, 'totalCents': booking.totalCents,
      'discountCents': booking.discountCents,
      'platformFeeCents': booking.platformFeeCents,
      'tipCents': booking.tipCents, 'currency': booking.currency,
      'request': _request(booking.therapistSelection), 'items': items,
    });
  }

  factory BookingRescheduleAttempt.create({
    required String actorId, required Booking booking, required String requestKey,
    required String date, required String startTime, required String timezone,
  }) => BookingRescheduleAttempt.fromJson({
    'version': 1, 'actorId': actorId, 'bookingId': booking.id,
    'shopId': booking.shopId, 'requestKey': requestKey, 'action': 'RESCHEDULE',
    'date': date, 'startTime': startTime, 'timezone': timezone,
    'baseline': _baseline(booking),
  });

  factory BookingRescheduleAttempt.fromJson(Map<String, dynamic> value) {
    bool id(dynamic raw) => raw is String && RegExp(r'^[1-9]\d*$').hasMatch(raw);
    final date = value['date'], time = value['startTime'];
    final parsed = date is String ? DateTime.tryParse(date) : null;
    final baseline = value['baseline'];
    if (value['version'] != 1 || value['action'] != 'RESCHEDULE' ||
        !id(value['actorId']) || !id(value['bookingId']) || !id(value['shopId']) ||
        value['requestKey'] is! String ||
        !RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$').hasMatch(value['requestKey'] as String) ||
        date is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(date) ||
        parsed == null || parsed.toIso8601String().substring(0, 10) != date ||
        time is! String || !RegExp(r'^([01]\d|2[0-3]):[0-5]\d$').hasMatch(time) ||
        value['timezone'] is! String || (value['timezone'] as String).isEmpty ||
        baseline is! String) {
      throw const FormatException('The original change record cannot be verified.');
    }
    final original = jsonDecode(baseline);
    if (original is! Map || original['reservationKind'] is! String ||
        original['priceCents'] is! int || original['discountCents'] is! int ||
        original['request'] is! Map || original['items'] is! List ||
        !original.containsKey('totalCents') || !original.containsKey('platformFeeCents') ||
        !original.containsKey('tipCents') || !original.containsKey('currency')) {
      throw const FormatException('The original change record cannot be verified.');
    }
    return BookingRescheduleAttempt._(
      actorId: value['actorId'] as String, bookingId: value['bookingId'] as String,
      shopId: value['shopId'] as String, requestKey: value['requestKey'] as String,
      date: date, startTime: time, timezone: value['timezone'] as String,
      baseline: baseline,
    );
  }

  Map<String, dynamic> get payload => Map.unmodifiable({'date': date, 'startTime': startTime});
  Map<String, dynamic> toJson() => {
    'version': 1, 'actorId': actorId, 'bookingId': bookingId, 'shopId': shopId,
    'requestKey': requestKey, 'action': 'RESCHEDULE', 'date': date,
    'startTime': startTime, 'timezone': timezone, 'baseline': baseline,
  };
  String get marker => jsonEncode(toJson());
  bool owns(Booking booking) => booking.id == bookingId &&
      booking.shopId == shopId && booking.userId == actorId;
  bool matches(Booking booking) => owns(booking) && booking.localDate == date &&
      booking.localStartTime == startTime && booking.timezone == timezone &&
      _baseline(booking) == baseline;

  /// A receipt proves the command outcome, not the current booking's target.
  String outcome(Map<String, dynamic> value) {
    if (value['bookingId'] != bookingId || value['shopId'] != shopId ||
        value['requestKey'] != requestKey ||
        !(value['outcome'] == 'COMMITTED' && value['action'] == 'RESCHEDULE' ||
          value['outcome'] == 'NOT_EXECUTED' && value['action'] == null)) {
      throw const FormatException('The original change outcome could not be verified.');
    }
    return value['outcome'] as String;
  }
}
