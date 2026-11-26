/// The customer's request, not the employees eventually assigned to an order.
class TherapistSelection {
  final String mode;
  final List<String> requestedIds;
  const TherapistSelection.legacy() : mode = 'LEGACY_UNKNOWN', requestedIds = const [];
  const TherapistSelection._(this.mode, this.requestedIds);

  factory TherapistSelection.fromJson(Map<String, dynamic> json) {
    final mode = json['therapistSelectionMode'];
    if (mode == null || mode == 'LEGACY_UNKNOWN') return const TherapistSelection.legacy();
    final raw = json['requestedTherapistIds'];
    if (!const {'AUTO', 'SPECIFIC'}.contains(mode) || raw is! List ||
        raw.any((id) => id is! String || !RegExp(r'^[1-9]\d*$').hasMatch(id)) ||
        raw.toSet().length != raw.length || mode == 'AUTO' && raw.isNotEmpty || mode == 'SPECIFIC' && raw.isEmpty) {
      throw const FormatException('The saved therapist request needs review');
    }
    return TherapistSelection._(mode as String, List<String>.unmodifiable(raw.cast<String>()));
  }

  String get summary => switch (mode) {
    'AUTO' => 'Automatic assignment',
    'SPECIFIC' => 'Requested: ${requestedIds.map((id) => '#$id').join(', ')}',
    _ => 'Original preference was not recorded',
  };

  String get rescheduleNotice => switch (mode) {
    'SPECIFIC' => 'Your requested therapist(s) will be kept. If unavailable, choose another time. Any remaining therapist is assigned automatically and may change.',
    'AUTO' => 'Therapists are assigned automatically and may change when you save the new time. Check the updated assignment after saving.',
    _ => 'This older order did not record the original therapist preference. Rescheduling may change the assigned therapists. Check the updated assignment after saving.',
  };

  bool sameRequestAs(TherapistSelection other) => mode == other.mode &&
      requestedIds.length == other.requestedIds.length && requestedIds.toSet().containsAll(other.requestedIds);
}
