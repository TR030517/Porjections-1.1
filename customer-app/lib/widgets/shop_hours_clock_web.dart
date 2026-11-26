import 'dart:js_interop';

@JS('Intl.DateTimeFormat')
extension type _HoursDateFormat._(JSObject _) implements JSObject {
  external factory _HoursDateFormat(JSString locale, JSObject options);
  external JSArray<_HoursDatePart> formatToParts(JSNumber instant);
}

extension type _HoursDatePart._(JSObject _) implements JSObject {
  external JSString get type;
  external JSString get value;
}

/// Intl applies the shop's IANA zone at this exact instant, including DST.
({DateTime date, int minute, String zoneName})? shopHoursLocalClock(
  DateTime instant,
  String timezone,
) {
  try {
    final format = _HoursDateFormat(
      'en-US'.toJS,
      {
            'timeZone': timezone,
            'year': 'numeric',
            'month': '2-digit',
            'day': '2-digit',
            'hour': '2-digit',
            'minute': '2-digit',
            'hourCycle': 'h23',
            'timeZoneName': 'longGeneric',
          }.jsify()
          as JSObject,
    );
    final parts = <String, String>{
      for (final part in format.formatToParts(instant.millisecondsSinceEpoch.toJS).toDart)
        part.type.toDart: part.value.toDart,
    };
    final year = int.tryParse(parts['year'] ?? '');
    final month = int.tryParse(parts['month'] ?? '');
    final day = int.tryParse(parts['day'] ?? '');
    final hour = int.tryParse(parts['hour'] ?? '');
    final minute = int.tryParse(parts['minute'] ?? '');
    if (year == null || month == null || day == null || hour == null || minute == null
        || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    final date = DateTime.utc(year, month, day);
    if (date.year != year || date.month != month || date.day != day) return null;
    return (date: date, minute: hour * 60 + minute, zoneName: parts['timeZoneName'] ?? timezone);
  } catch (_) {
    return null;
  }
}
