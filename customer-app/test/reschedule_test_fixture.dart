import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/services/booking_reschedule_journal.dart';

/// Only fixture isolation: every test uses synthetic actor 41 and order 42.
/// Reset the app-lifetime singleton inside the widget test's fake-clock zone.
/// Product recovery tests must reconcile over their mock transport instead.
Future<void> resetSyntheticReschedule(WidgetTester tester) async {
  FlutterSecureStorage.setMockInitialValues({});
  var complete = false;
  final reset = () async {
    await bookingRescheduleJournal.prepare('41', '42');
    final previous = bookingRescheduleJournal.status('41', '42').attempt;
    if (previous != null) {
      await bookingRescheduleJournal.finish(previous, () => true);
    }
    await bookingRescheduleJournal.retryStorage('41', '42');
  }().whenComplete(() => complete = true);
  for (var i = 0; i < 100 && !complete; i++) {
    await tester.pump(const Duration(milliseconds: 10));
  }
  expect(
    complete,
    isTrue,
    reason: 'The synthetic recovery journal must reset.',
  );
  await reset;
  expect(bookingRescheduleJournal.status('41', '42').blocked, isFalse);
}
