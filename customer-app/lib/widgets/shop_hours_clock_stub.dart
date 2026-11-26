/// Native platforms without an IANA database must not guess a shop's offset.
({DateTime date, int minute, String zoneName})? shopHoursLocalClock(
  DateTime instant,
  String timezone,
) {
  if (!const {'UTC', 'Etc/UTC', 'Etc/GMT'}.contains(timezone)) return null;
  final utc = instant.toUtc();
  return (
    date: DateTime.utc(utc.year, utc.month, utc.day),
    minute: utc.hour * 60 + utc.minute,
    zoneName: 'Coordinated Universal Time',
  );
}
