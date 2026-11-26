/// Server calendar dates are wall dates, never converted to the device zone.
class BookingCalendar {
  final DateTime today;
  final String timezone;
  final DateTime serverNow, validUntil;
  final Stopwatch _age = Stopwatch()..start();
  BookingCalendar._(this.today,this.timezone,this.serverNow,this.validUntil);
  Duration get remaining => validUntil.difference(serverNow) - _age.elapsed;
  bool get isCurrent => remaining > Duration.zero;
  static BookingCalendar? parse(dynamic value,{String? timezone}) {
    if(value is! Map || value['timezone'] is! String || (value['timezone'] as String).isEmpty ||
        timezone != null && value['timezone'] != timezone || value['today'] is! String ||
        !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value['today'] as String)) {
      return null;
    }
    final date=DateTime.tryParse('${value['today']}T00:00:00Z');
    final now=value['serverNow'],until=value['validUntil'];
    if(date==null || date.toIso8601String().substring(0,10)!=value['today'] || now is! String || until is! String || !now.endsWith('Z') || !until.endsWith('Z')) {
      return null;
    }
    final server=DateTime.tryParse(now),expires=DateTime.tryParse(until);
    if(server==null||expires==null||!expires.isAfter(server)||expires.difference(server)>const Duration(hours:26)) {
      return null;
    }
    return BookingCalendar._(date,value['timezone'] as String,server,expires);
  }
}
