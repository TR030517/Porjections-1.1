const serviceDurationKinds = {'TIMED', 'PER_SESSION', 'VARIABLE'};

String readDurationKind(Map<dynamic, dynamic> json, {String key = 'durationKind', bool allowMixed = false}) {
  if (!json.containsKey(key)) return 'TIMED';
  final value = json[key];
  if (value is! String || !(serviceDurationKinds.contains(value) || allowMixed && value == 'MIXED')) {
    throw const FormatException('Invalid service duration type. Refresh this information.');
  }
  return value;
}

int readReservedMinutes(Map<dynamic, dynamic> json, {int legacyDefault = 0}) {
  final raw = json.containsKey('durationMin') ? json['durationMin'] : legacyDefault;
  if (raw is! num || !raw.isFinite || raw.remainder(1) != 0 || raw < 0 || raw > 99999999) throw const FormatException('Invalid reserved duration');
  if (json.containsKey('reservedDurationMin')) {
    final alias = json['reservedDurationMin'];
    if (alias is! num || !alias.isFinite || alias.remainder(1) != 0 || alias != raw) throw const FormatException('Reservation duration needs review');
  }
  return raw.toInt();
}

String readItemDurationKind(Map<dynamic, dynamic> json) {
  final kind = json.containsKey('durationKindSnapshot') ? readDurationKind(json, key: 'durationKindSnapshot') : readDurationKind(json);
  if (json.containsKey('durationKind') && readDurationKind(json) != kind) throw const FormatException('Saved duration type needs review');
  return kind;
}

String combinedDurationKind(Iterable<String> kinds) {
  final values = kinds.toSet();
  if (values.isEmpty) return 'TIMED';
  if (values.any((value) => !serviceDurationKinds.contains(value))) throw const FormatException('Invalid saved duration type');
  return values.length == 1 ? values.single : 'MIXED';
}

bool validReservedMinutes(int minutes) => minutes >= 5 && minutes <= 240;
String durationKindLabel(String kind) => switch (kind) {
  'TIMED' => 'Fixed duration', 'PER_SESSION' => 'Per session',
  'VARIABLE' => 'Duration varies', 'MIXED' => 'Mixed services', _ => 'Duration unavailable',
};
String reservedDurationLabel(String kind, int minutes, {bool span = false}) =>
    '${kind == 'TIMED' ? '' : '${durationKindLabel(kind)} · '}Reserved ${span ? 'visit span ' : ''}$minutes min';

String _durationId(dynamic value) {
  if (value is! String || !RegExp(r'^[1-9]\d{0,18}$').hasMatch(value) || BigInt.parse(value) > BigInt.parse('9223372036854775807')) throw const FormatException('Invalid primary service identity');
  return value;
}

class MainDuration {
  final int participantIndex, sequence, reservedDurationMin;
  final String serviceId, durationKind;
  final String? variantId;
  const MainDuration({required this.participantIndex, required this.sequence, required this.serviceId,
    required this.variantId, required this.durationKind, required this.reservedDurationMin});
  factory MainDuration.fromJson(Map<dynamic, dynamic> json) {
    int integer(String key, int min, int max) {
      final value = json[key];
      if (value is! num || !value.isFinite || value.remainder(1) != 0 || value < min || value > max) throw FormatException('Invalid $key');
      return value.toInt();
    }
    if (!json.containsKey('variantId')) throw const FormatException('Missing primary variant');
    return MainDuration(participantIndex: integer('participantIndex', 1, 6), sequence: integer('sequence', 1, 4),
      serviceId: _durationId(json['serviceId']), variantId: json['variantId'] == null ? null : _durationId(json['variantId']),
      durationKind: readDurationKind(json), reservedDurationMin: integer('reservedDurationMin', 5, 240));
  }
  static List<MainDuration> parseList(dynamic value) {
    if (value == null) throw const FormatException('Invalid primary duration vector');
    if (value is! List || value.isEmpty || value.length > 12) throw const FormatException('Invalid primary duration vector');
    final rows = <MainDuration>[], seen = <String>{};
    for (final raw in value) {
      if (raw is! Map) throw const FormatException('Invalid primary duration');
      final row = MainDuration.fromJson(raw);
      if (!seen.add('${row.participantIndex}:${row.sequence}')) throw const FormatException('Duplicate primary duration coordinate');
      rows.add(row);
    }
    return List.unmodifiable(rows);
  }
  bool sameAs(MainDuration other) => participantIndex == other.participantIndex && sequence == other.sequence &&
    serviceId == other.serviceId && variantId == other.variantId && durationKind == other.durationKind && reservedDurationMin == other.reservedDurationMin;
  Map<String,dynamic> toJson() => {'participantIndex': participantIndex, 'sequence': sequence, 'serviceId': serviceId,
    'variantId': variantId, 'durationKind': durationKind, 'reservedDurationMin': reservedDurationMin};
}

bool sameMainDurations(List<MainDuration> expected, List<MainDuration> actual) => expected.length == actual.length &&
    expected.every((row) => actual.any(row.sameAs));
