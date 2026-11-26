import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/therapist_selection.dart';

void main() {
  test('missing intent stays unknown despite an actual assignment', () {
    final request = TherapistSelection.fromJson({'therapistId': '11'});
    expect(request.mode, 'LEGACY_UNKNOWN');
    expect(request.requestedIds, isEmpty);
  });
  test('explicit choice and automatic assignment have different reschedule disclosures', () {
    final automatic = TherapistSelection.fromJson({'therapistSelectionMode': 'AUTO', 'requestedTherapistIds': []});
    final specific = TherapistSelection.fromJson({'therapistSelectionMode': 'SPECIFIC', 'requestedTherapistIds': ['12'], 'therapistId': '13'});
    expect(automatic.rescheduleNotice, contains('may change'));
    expect(specific.requestedIds, ['12']);
    expect(specific.summary, 'Requested: #12');
    expect(specific.rescheduleNotice, contains('will be kept'));
    expect(specific.sameRequestAs(automatic), isFalse);
  });
  test('a malformed persisted request is not presented as automatic', () {
    expect(() => TherapistSelection.fromJson({'therapistSelectionMode': 'SPECIFIC', 'requestedTherapistIds': []}), throwsFormatException);
    expect(() => TherapistSelection.fromJson({'therapistSelectionMode': 'AUTO', 'requestedTherapistIds': ['12']}), throwsFormatException);
  });
}
