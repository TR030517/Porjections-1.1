import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking.dart';
import '../models/booking_reschedule_attempt.dart';
import 'booking_reschedule_marker.dart';

class RescheduleJournalException implements Exception {
  final String message;
  const RescheduleJournalException(this.message);
  @override
  String toString() => message;
}

class RescheduleJournalStatus {
  final bool loaded, busy;
  final BookingRescheduleAttempt? attempt;
  final String? error;
  const RescheduleJournalStatus(this.loaded, this.busy, this.attempt, this.error);
  bool get blocked => !loaded || busy || attempt != null || error != null;
}

class _Entry {
  bool loaded = false, busy = false;
  BookingRescheduleAttempt? attempt;
  String? error;
  Future<void>? loading;
}

/// App-lifetime journal. A detail route, login change or ordinary GET cannot
/// erase a dispatched command. Storage is scoped to the original customer/order.
class BookingRescheduleJournal {
  final _entries = <String, _Entry>{};
  final _changes = StreamController<int>.broadcast();
  int _revision = 0;
  Stream<int> get changes => _changes.stream;
  void _emit() => _changes.add(++_revision);
  String _scope(String actor, String booking) =>
      'massajoy:reschedule:v1:$actor:$booking';
  _Entry _entry(String actor, String booking) =>
      _entries.putIfAbsent(_scope(actor, booking), _Entry.new);

  RescheduleJournalStatus status(String actor, String booking) {
    final entry = _entry(actor, booking);
    if (!entry.loaded && entry.loading == null) unawaited(prepare(actor, booking));
    return RescheduleJournalStatus(entry.loaded, entry.busy, entry.attempt, entry.error);
  }

  Future<void> prepare(String actor, String booking) {
    final entry = _entry(actor, booking);
    if (entry.loaded) return Future.value();
    return entry.loading ??= _load(actor, booking, entry);
  }

  Future<void> _load(String actor, String booking, _Entry entry) async {
    try {
      final raw = await readRescheduleMarker(_scope(actor, booking));
      if (raw != null) {
        final attempt = BookingRescheduleAttempt.fromJson(Map<String, dynamic>.from(jsonDecode(raw) as Map));
        if (attempt.actorId != actor || attempt.bookingId != booking) throw const FormatException();
        entry.attempt = attempt;
      }
      entry.error = null;
    } catch (_) {
      entry.error = 'The original change record cannot be read safely. This booking remains read-only. Check browser storage and try again.';
    } finally {
      entry.loaded = true;
      entry.loading = null;
      _emit();
    }
  }

  Future<void> retryStorage(String actor, String booking) async {
    final entry = _entry(actor, booking);
    if (entry.busy || entry.attempt != null) return;
    entry.loaded = false;
    await prepare(actor, booking);
  }

  Future<BookingRescheduleAttempt> begin({
    required String actor, required Booking booking, required String date,
    required String startTime, required String timezone,
  }) async {
    await prepare(actor, booking.id);
    final entry = _entry(actor, booking.id);
    if (status(actor, booking.id).blocked || booking.userId != actor) {
      throw const RescheduleJournalException('Check the original booking change before requesting another change.');
    }
    final random = Random.secure();
    final key = List.generate(16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final attempt = BookingRescheduleAttempt.create(actorId: actor, booking: booking,
      requestKey: key, date: date, startTime: startTime, timezone: timezone);
    // Hold in memory before the asynchronous durable write, including failures.
    entry.attempt = attempt;
    entry.error = null;
    _emit();
    try {
      await writeRescheduleMarker(_scope(actor, booking.id), attempt.marker);
      if (await readRescheduleMarker(_scope(actor, booking.id)) != attempt.marker) throw const FormatException();
    } catch (_) {
      entry.error = 'No change request was sent because its recovery record could not be saved. Check the original change outcome before trying again.';
      _emit();
      throw RescheduleJournalException(entry.error!);
    }
    return attempt;
  }

  bool startCheck(BookingRescheduleAttempt attempt) {
    final entry = _entry(attempt.actorId, attempt.bookingId);
    if (entry.busy || entry.attempt?.marker != attempt.marker) return false;
    entry.busy = true;
    entry.error = null;
    _emit();
    return true;
  }

  void endCheck(BookingRescheduleAttempt attempt, {String? error}) {
    final entry = _entry(attempt.actorId, attempt.bookingId);
    if (entry.attempt?.marker != attempt.marker) return;
    entry.busy = false;
    entry.error = error;
    _emit();
  }

  Future<bool> finish(BookingRescheduleAttempt attempt, bool Function() current) async {
    final entry = _entry(attempt.actorId, attempt.bookingId);
    if (!current() || entry.attempt?.marker != attempt.marker) return false;
    final scope = _scope(attempt.actorId, attempt.bookingId);
    try {
      final stored = await readRescheduleMarker(scope);
      if (!current() || entry.attempt?.marker != attempt.marker) return false;
      if (stored != null && stored != attempt.marker) throw const FormatException();
      if (stored != null) await removeRescheduleMarker(scope);
      if (await readRescheduleMarker(scope) != null) throw const FormatException();
      if (!current()) {
        // A different login must not turn an old completion into lost protection.
        await writeRescheduleMarker(scope, attempt.marker);
        return false;
      }
      entry.attempt = null;
      entry.busy = false;
      entry.error = null;
      _emit();
      return true;
    } catch (_) {
      entry.error = 'The original change was checked, but its recovery record could not be cleared safely. This booking remains read-only. Check the original change again.';
      _emit();
      throw RescheduleJournalException(entry.error!);
    }
  }

  /// Used at transport dispatch too, so queued handlers and other routes cannot
  /// bypass a pending move. Only its exact original POST may pass the fence.
  Future<void> guardWrite(String actor, String booking, {
    String? requestKey, Map<String, dynamic>? move,
  }) async {
    await prepare(actor, booking);
    final state = status(actor, booking);
    if (!state.blocked && move == null) return;
    final attempt = state.attempt;
    if (state.error == null && !state.busy && attempt != null &&
        requestKey == attempt.requestKey && move?.length == 2 &&
        move?['date'] == attempt.date && move?['startTime'] == attempt.startTime) {
      return;
    }
    throw const RescheduleJournalException('This booking has an unresolved time change. Open Booking details and check the original change before making another change.');
  }
}

final bookingRescheduleJournal = BookingRescheduleJournal();
final bookingRescheduleJournalProvider = Provider<BookingRescheduleJournal>((ref) => bookingRescheduleJournal);
final bookingRescheduleChangesProvider = StreamProvider<int>((ref) => ref.read(bookingRescheduleJournalProvider).changes);
