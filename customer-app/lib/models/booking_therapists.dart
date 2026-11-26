import 'booking.dart';

/// Saved item assignments are authoritative. The current shop roster supplies
/// missing display names only; it must not add or replace an assigned calendar.
List<TherapistInfo> assignedBookingTherapists(
  Booking booking, {
  Map<String, String> rosterNames = const {},
}) {
  final ids = <String>{};
  final names = <String, String>{...rosterNames};
  final primary = booking.therapist;
  if (primary != null && primary.name.trim().isNotEmpty) {
    names[primary.id] = primary.name.trim();
  }
  for (final item in booking.items) {
    final assigned = item.assignedTherapistIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty);
    ids.addAll(assigned);
    final id = item.therapistId?.trim();
    if (assigned.isEmpty && id != null && id.isNotEmpty) ids.add(id);
    final name = item.therapistName?.trim();
    if (id != null && id.isNotEmpty && name != null && name.isNotEmpty) {
      names[id] = name;
    }
  }
  if (ids.isEmpty) {
    final id = primary?.id.trim().isNotEmpty == true
        ? primary!.id.trim()
        : booking.therapistId?.trim();
    if (id != null && id.isNotEmpty) {
      ids.add(id);
    } else if (primary != null && primary.name.trim().isNotEmpty) {
      return [TherapistInfo(id: '', name: primary.name.trim())];
    }
  }
  return [
    for (final id in ids) TherapistInfo(id: id, name: names[id]?.trim() ?? ''),
  ];
}
