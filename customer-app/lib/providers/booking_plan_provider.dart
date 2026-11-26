import 'dart:async';
import 'dart:math';
import 'package:dio/dio.dart';
import '../models/booking_add_on.dart';
import '../models/booking_order_policy.dart';
import '../models/booking_contact.dart';
import '../models/booking_calendar.dart';
import '../models/service_duration.dart';
import '../services/booking_recovery_marker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking.dart';
import '../models/booking_plan.dart';
import '../models/coupon.dart';
import '../models/shop.dart';
import '../services/api_service.dart';
import '../services/business_workflow_service.dart';
import 'auth_provider.dart';

class BookingPlanRepository {
  final ApiService api;
  BookingPlanRepository(this.api);
  Future<BookingPlanQuote> slots(Map<String, dynamic> selection) async =>
      BookingPlanQuote.fromJson(await api.getBookingPlanSlots(selection));
  Future<BookingPriceQuote> priceQuote(Map<String,dynamic> selection) async => BookingPriceQuote.fromJson(await api.getBookingQuote(selection, plan: true));
  Future<Booking> create(Map<String, dynamic> selection) async =>
      Booking.fromJson(await api.createBookingPlan(selection));
}

final bookingPlanRepositoryProvider = Provider<BookingPlanRepository>(
  (ref) => BookingPlanRepository(ref.read(apiServiceProvider)),
);

const _keepPlanValue = Object();

class BookingPlanState {
  final ShopDetail shop;
  final List<List<PlanServiceSelection>> participants;
  final String? date;
  final String? startTime;
  final BookingPlanQuote? quote;
  final bool loading;
  final bool submitting;
  final String? error;
  final String? _paymentMode;
  String get paymentMode => shop.orderOnly ? 'PAY_AT_STORE' : _paymentMode ?? 'ONLINE';
  final int? _tipCents;
  int? get tipCents => shop.orderOnly ? 0 : _tipCents;
  final String notes;
  final UserCoupon? coupon;
  final BookingPriceQuote? priceQuote;
  final String? priceQuoteRequest;
  final bool loadingPriceQuote;
  final BookingRecoveryAttempt? pendingAttempt;
  final bool recoveryReminder;
  final BookingContactDraft contact;
  const BookingPlanState({
    required this.shop,
    this.participants = const [
      [PlanServiceSelection()],
    ],
    this.date,
    this.startTime,
    this.quote,
    this.loading = false,
    this.submitting = false,
    this.error,
    this._paymentMode,
    this._tipCents = 0,
    this.notes = '',
    this.coupon,
    this.priceQuote,
    this.priceQuoteRequest,
    this.loadingPriceQuote = false,
    this.pendingAttempt,
    this.recoveryReminder = false,
    this.contact = const BookingContactDraft(),
  });

  List<ShopService> get services => shop.services
      .where((service) => service.participantCount == 1 && service.requiredStaffCount == 1 && service.canBook)
      .toList();
  int get itemCount => participants.fold(0, (sum, rows) => sum + rows.length);
  ShopService? serviceFor(PlanServiceSelection item) {
    for (final service in services) {
      if (service.id == item.serviceId) return service;
    }
    return null;
  }

  List<Therapist> therapistsFor(PlanServiceSelection item) => shop.therapists
      .where(
        (therapist) =>
            therapist.services.any((service) => service.id == item.serviceId),
      )
      .toList();

  bool get validPlan =>
      shop.onlineBookingEnabled &&
      participants.isNotEmpty &&
      participants.length <= 6 &&
      itemCount <= 12 &&
      participants.every(
        (rows) =>
            rows.isNotEmpty &&
            rows.length <= 4 &&
            rows.every((item) {
              final service = serviceFor(item);
              return service != null && item.addOnIds.length <= 10 && item.addOnIds.toSet().length == item.addOnIds.length && item.addOnIds.every((id) => service.addOns.any((row) => row.id == id)) &&
                  (!service.hasVariants ||
                      service.activeVariants.any(
                        (variant) => variant.id == item.variantId,
                      )) &&
                  (item.therapistId == null ||
                      therapistsFor(
                        item,
                      ).any((person) => person.id == item.therapistId));
            }),
      );

  List<Map<String, dynamic>> get requestItems => [
    for (var person = 0; person < participants.length; person++)
      for (var stage = 0; stage < participants[person].length; stage++)
        participants[person][stage].toJson(person + 1, stage + 1),
  ];
  Map<String, dynamic> get slotRequest => {
    'shopId': shop.id,
    'date': date,
    'items': requestItems,
  };
  List<BookingAddOnSelection> get addOnSelections => [
    for (var p = 0; p < participants.length; p++)
      for (var s = 0; s < participants[p].length; s++)
        if (participants[p][s].addOnIds.isNotEmpty) BookingAddOnSelection(participantIndex: p + 1, sequence: s + 1, addOnIds: participants[p][s].addOnIds),
  ];
  bool get hasAddOns => addOnSelections.isNotEmpty;
  List<MainDuration> get mainDurations {
    final result = <MainDuration>[];
    for (var p = 0; p < participants.length; p++) {
      for (var s = 0; s < participants[p].length; s++) {
        final item = participants[p][s], service = serviceFor(participants[p][s]);
        if (service == null) continue;
        final variants = service.activeVariants.where((row) => row.id == item.variantId);
        result.add(MainDuration(participantIndex: p + 1, sequence: s + 1, serviceId: service.id, variantId: item.variantId,
          durationKind: service.durationKind, reservedDurationMin: variants.isEmpty ? service.durationMin : variants.first.durationMin));
      }
    }
    return result;
  }
  bool get requiresServerQuote => validPlan && quote != null && startTime != null;
  Map<String,dynamic> get pricingRequest => {
    ...slotRequest, 'startTime': startTime, 'paymentMode': paymentMode, 'tipCents': tipCents,
    if (notes.trim().isNotEmpty) 'notes': notes.trim(),
    if (coupon != null) 'couponId': coupon!.id,
    if (hasAddOns) 'addOnSelections': addOnSelectionJson(addOnSelections),
  };
  bool get hasValidPriceQuote => validPlan && quote != null && startTime != null && priceQuote != null &&
    priceQuoteRequest == bookingQuoteFingerprint(pricingRequest) && priceQuote!.matches(shop.id, quote!.durationMin, addOnSelections, expectedDurations: mainDurations);
  bool get canConfirm =>
      pendingAttempt == null && !recoveryReminder && validPlan &&
      !loading &&
      !submitting &&
      !loadingPriceQuote && (!requiresServerQuote || hasValidPriceQuote) &&
      quote != null &&
      startTime != null &&
      tipCents != null &&
      tipCents! >= 0 &&
      tipCents! <= 9999999 &&
      notes.length <= 500 &&
      quote!.slots.any((slot) => slot.time == startTime && slot.available);

  BookingPlanState copyWith({
    ShopDetail? shop,
    List<List<PlanServiceSelection>>? participants,
    Object? date = _keepPlanValue,
    Object? startTime = _keepPlanValue,
    Object? quote = _keepPlanValue,
    Object? error = _keepPlanValue,
    bool? loading,
    bool? submitting,
    String? paymentMode,
    Object? tipCents = _keepPlanValue,
    String? notes,
    Object? coupon = _keepPlanValue,
    Object? priceQuote = _keepPlanValue,
    Object? priceQuoteRequest = _keepPlanValue,
    bool? loadingPriceQuote,
    Object? pendingAttempt = _keepPlanValue,
    bool? recoveryReminder,
    BookingContactDraft? contact,
  }) => BookingPlanState(
    shop: shop ?? this.shop,
    participants: participants ?? this.participants,
    date: identical(date, _keepPlanValue) ? this.date : date as String?,
    startTime: identical(startTime, _keepPlanValue)
        ? this.startTime
        : startTime as String?,
    quote: identical(quote, _keepPlanValue)
        ? this.quote
        : quote as BookingPlanQuote?,
    error: identical(error, _keepPlanValue) ? this.error : error as String?,
    loading: loading ?? this.loading,
    submitting: submitting ?? this.submitting,
    paymentMode: paymentMode ?? this.paymentMode,
    tipCents: identical(tipCents, _keepPlanValue)
        ? this.tipCents
        : tipCents as int?,
    notes: notes ?? this.notes,
    coupon: identical(coupon, _keepPlanValue)
        ? this.coupon
        : coupon as UserCoupon?,
    priceQuote: identical(priceQuote, _keepPlanValue) ? this.priceQuote : priceQuote as BookingPriceQuote?,
    priceQuoteRequest: identical(priceQuoteRequest, _keepPlanValue) ? this.priceQuoteRequest : priceQuoteRequest as String?,
    loadingPriceQuote: loadingPriceQuote ?? this.loadingPriceQuote,
    pendingAttempt: identical(pendingAttempt, _keepPlanValue) ? this.pendingAttempt : pendingAttempt as BookingRecoveryAttempt?,
    recoveryReminder: recoveryReminder ?? this.recoveryReminder,
      contact: contact ?? this.contact,
  );
}

class BookingPlanNotifier extends StateNotifier<BookingPlanState> {
  final BookingPlanRepository repository;
  final _random = Random.secure();
  int _slotsVersion = 0;
  int _selectionVersion = 0;
  int _quoteVersion = 0;
  Timer? _quoteExpiry;
  Timer? _calendarExpiry;
  String? _requestKey;
  Future<Booking?>? _inFlight;
  Booking? _completed;
  final String? Function()? _readCustomerId;
  final String? Function()? _readCustomerEmail;
  final String? Function()? _readCustomerName, _readCustomerPhone;
  final bool Function(String, String) _rememberRequest;
  String? _customerId;
  String? get _actorId => _readCustomerId != null ? _readCustomerId() : _customerId;
  Booking? get completedBooking => _completed;
  BookingPlanNotifier(ShopDetail shop, this.repository, {String? Function()? currentCustomerId, String? Function()? currentCustomerEmail, String? Function()? currentCustomerName, String? Function()? currentCustomerPhone, bool Function(String, String)? rememberRequest})
    : _readCustomerId = currentCustomerId, _readCustomerEmail = currentCustomerEmail, _readCustomerName = currentCustomerName, _readCustomerPhone = currentCustomerPhone, _rememberRequest = rememberRequest ?? writeBookingRecoveryMarker, super(BookingPlanState(shop: shop, recoveryReminder: hasBookingRecoveryMarker())) { state = state.copyWith(contact: _accountContact()); adoptCalendar(shop.bookingCalendar); }

  void startAnotherBooking() {
    if (state.submitting || state.pendingAttempt != null) return;
    final shop = state.shop;
    _slotsVersion++;
    _calendarExpiry?.cancel();
    _invalidateAttempt();
    state = BookingPlanState(shop: shop, recoveryReminder: hasBookingRecoveryMarker(), contact: _accountContact());
    adoptCalendar(shop.bookingCalendar);
  }

  void adoptCalendar(BookingCalendar? calendar) {
    if (state.pendingAttempt != null || state.submitting || calendar == null || calendar.timezone != state.shop.timezone) return;
    _calendarExpiry?.cancel();
    if (calendar.isCurrent) _calendarExpiry=Timer(calendar.remaining,invalidateCalendarSelection);
  }

  void refreshShopDetails(ShopDetail shop) {
    if (_completed != null || state.pendingAttempt != null ||
        state.submitting || shop.id != state.shop.id) {
      return;
    }
    final refreshed = state.copyWith(shop: shop);
    final participants = [for (final rows in state.participants)
      [for (final item in rows) () {
        final service = refreshed.serviceFor(item);
        if (service == null) return const PlanServiceSelection();
        return PlanServiceSelection(serviceId: service.id,
          variantId: service.activeVariants.any((row) => row.id == item.variantId) ? item.variantId : null,
          therapistId: refreshed.therapistsFor(item).any((row) => row.id == item.therapistId) ? item.therapistId : null,
          addOnIds: List.unmodifiable(item.addOnIds.where((id) => service.addOns.any((row) => row.id == id))));
      }()]];
    _slotsVersion++;
    _invalidateAttempt();
    _calendarExpiry?.cancel();
    state = state.copyWith(shop: shop,
      participants: List.unmodifiable(participants.map((row) => List<PlanServiceSelection>.unmodifiable(row))),
      date: null, startTime: null, quote: null, loading: false, coupon: null,
      error: !shop.onlineBookingEnabled ? 'Online bookings are disabled for this shop.'
        : 'Shop details refreshed. Review your services and choose a date and arrival time again.');
    adoptCalendar(shop.bookingCalendar);
  }

  void onCustomerChanged(String? previousId, String? nextId) {
    _customerId = nextId;
    if (previousId == nextId) return;
    if (state.pendingAttempt != null) state = state.copyWith(pendingAttempt: null, recoveryReminder: true);
    _invalidateAttempt();
    if (previousId == null && nextId != null) {
      state = state.copyWith(coupon: null, submitting: false, contact: _accountContact());
    } else {
      _slotsVersion++;
      state = BookingPlanState(shop: state.shop, recoveryReminder: hasBookingRecoveryMarker(), contact: _accountContact());
    }
  }

  BookingContactDraft _accountContact() => BookingContactDraft(
    name: _readCustomerName?.call() ?? '', phone: _readCustomerPhone?.call() ?? '',
    email: BookingContact.normalizeEmail(_readCustomerEmail?.call()));

  void updateContact({String? name, String? phone}) {
    if (state.submitting || state.pendingAttempt != null || state.recoveryReminder) return;
    if ((name == null || name == state.contact.name) && (phone == null || phone == state.contact.phone)) return;
    // Contact edits change the command, never the selection's price quote.
    _selectionVersion++; _requestKey = null; _inFlight = null; _completed = null;
    state = state.copyWith(contact: state.contact.copyWith(name: name, phone: phone), error: null);
  }

  void syncAccountEmail() {
    if (_completed != null) return;
    final email = BookingContact.normalizeEmail(_readCustomerEmail?.call());
    if (state.contact.email == email) return;
    final unresolved = state.submitting || state.pendingAttempt != null;
    _selectionVersion++; _requestKey = null; _inFlight = null; _completed = null;
    if (unresolved) {
      state = state.copyWith(submitting: false, recoveryReminder: true, error: bookingContactRecoveryError);
      return;
    }
    state = state.copyWith(contact: BookingContactDraft(name: state.contact.name, phone: state.contact.phone, email: email),
      error: 'Your account email changed. Review your contact details before submitting.');
  }

  bool _canRetryContact(BookingRecoveryAttempt attempt) {
    final contact = BookingContact.fromJson(attempt.payload['contact']);
    if (contact != null && contact.email == BookingContact.normalizeEmail(_readCustomerEmail?.call())) return true;
    state = state.copyWith(error: bookingContactRecoveryError);
    return false;
  }

  void _invalidateAttempt() {
    _quoteVersion++; _quoteExpiry?.cancel();
    state = state.copyWith(priceQuote: null, priceQuoteRequest: null, loadingPriceQuote: false);
    _selectionVersion++;
    _requestKey = null;
    _inFlight = null;
    _completed = null;
  }

  void _change(List<List<PlanServiceSelection>> participants) {
    if (state.pendingAttempt != null || state.submitting) return;
    _invalidateAttempt();
    state = state.copyWith(
      participants: List.unmodifiable(
        participants.map(
          (rows) => List<PlanServiceSelection>.unmodifiable(rows),
        ),
      ),
      startTime: null,
      quote: null,
      coupon: null,
      error: null,
    );
    loadSlots();
  }

  List<List<PlanServiceSelection>> _editable() =>
      state.participants.map((rows) => rows.toList()).toList();

  void addParticipant() {
    if (state.participants.length >= 6 || state.itemCount >= 12) return;
    _change([
      ..._editable(),
      [const PlanServiceSelection()],
    ]);
  }

  void removeParticipant(int person) {
    if (state.participants.length <= 1 ||
        person < 0 ||
        person >= state.participants.length) {
      return;
    }
    final rows = _editable()..removeAt(person);
    _change(rows);
  }

  void addStage(int person) {
    if (!_has(person) ||
        state.participants[person].length >= 4 ||
        state.itemCount >= 12) {
      return;
    }
    final rows = _editable();
    rows[person].add(const PlanServiceSelection());
    _change(rows);
  }

  void removeStage(int person, int stage) {
    if (!_has(person, stage) || state.participants[person].length <= 1) return;
    final rows = _editable();
    rows[person].removeAt(stage);
    _change(rows);
  }

  void moveStage(int person, int stage, int direction) {
    if (!_has(person, stage) || !_has(person, stage + direction)) return;
    final rows = _editable();
    final item = rows[person].removeAt(stage);
    rows[person].insert(stage + direction, item);
    _change(rows);
  }

  bool _has(int person, [int? stage]) =>
      person >= 0 &&
      person < state.participants.length &&
      (stage == null ||
          stage >= 0 && stage < state.participants[person].length);

  void selectService(int person, int stage, String? serviceId) {
    if (!_has(person, stage) ||
        serviceId != null &&
            !state.services.any((row) => row.id == serviceId)) {
      return;
    }
    final rows = _editable();
    rows[person][stage] = PlanServiceSelection(serviceId: serviceId);
    _change(rows);
  }

  void selectVariant(int person, int stage, String? variantId) {
    if (!_has(person, stage)) return;
    final item = state.participants[person][stage];
    final service = state.serviceFor(item);
    if (service == null ||
        variantId != null &&
            !service.activeVariants.any((row) => row.id == variantId)) {
      return;
    }
    final rows = _editable();
    rows[person][stage] = PlanServiceSelection(
      serviceId: item.serviceId,
      variantId: variantId,
      therapistId: item.therapistId,
      addOnIds: item.addOnIds,
    );
    _change(rows);
  }

  void selectTherapist(int person, int stage, String? therapistId) {
    if (!_has(person, stage)) return;
    final item = state.participants[person][stage];
    if (therapistId != null &&
        !state.therapistsFor(item).any((row) => row.id == therapistId)) {
      return;
    }
    final rows = _editable();
    rows[person][stage] = PlanServiceSelection(
      serviceId: item.serviceId,
      variantId: item.variantId,
      therapistId: therapistId,
      addOnIds: item.addOnIds,
    );
    _change(rows);
  }

  void selectDate(String date) {
    if (state.pendingAttempt != null || state.submitting) return;
    _invalidateAttempt();
    state = state.copyWith(
      date: date,
      startTime: null,
      quote: null,
      error: null,
    );
    loadSlots();
  }

  void invalidateCalendarSelection() {
    if (_completed != null || state.pendingAttempt != null || state.submitting) return;
    _slotsVersion++;_invalidateAttempt();
    state=state.copyWith(date:null,startTime:null,quote:null,loading:false,error:'Refresh the shop calendar and choose a date and arrival time again.');
  }

  void selectTime(String time) {
    if (state.pendingAttempt != null || state.submitting ||
        state.loading ||
        !(state.quote?.slots.any(
              (slot) => slot.time == time && slot.available,
            ) ??
            false)) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(startTime: time, error: null);
  }

  void setPaymentMode(String mode) {
    if (state.pendingAttempt != null || state.submitting ||
        !const {'ONLINE', 'PAY_AT_STORE'}.contains(mode) ||
        state.shop.orderOnly && mode != 'PAY_AT_STORE' ||
        mode == 'PAY_AT_STORE' && !state.shop.orderOnly && !state.shop.payAtStoreEnabled ||
        state.paymentMode == mode) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(paymentMode: mode, error: null);
  }

  void setTipCents(int? cents) {
    if (state.shop.orderOnly || state.pendingAttempt != null || state.submitting ||
        cents != null && (cents < 0 || cents > 9999999) ||
        state.tipCents == cents) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(tipCents: cents, error: null);
  }

  void setNotes(String notes) {
    if (state.pendingAttempt != null || state.submitting || state.notes == notes) return;
    _invalidateAttempt();
    state = state.copyWith(notes: notes, error: null);
  }

  void selectCoupon(UserCoupon? coupon) {
    if (state.pendingAttempt != null || state.submitting) return;
    _invalidateAttempt();
    state = state.copyWith(coupon: coupon, error: null);
  }

  void toggleAddOn(int person, int stage, String id, bool selected) {
    if (state.pendingAttempt != null || state.submitting || !_has(person, stage)) return;
    final current = state.participants[person][stage], service = state.serviceFor(state.participants[person][stage]);
    if (service == null || !service.addOns.any((row) => row.id == id)) return;
    final ids = current.addOnIds.toSet();
    if (ids.contains(id) == selected) return;
    if (selected && ids.length >= 10 && !ids.contains(id)) return;
    if (selected) { ids.add(id); } else { ids.remove(id); }
    final rows = _editable();
    rows[person][stage] = PlanServiceSelection(serviceId: current.serviceId, variantId: current.variantId, therapistId: current.therapistId, addOnIds: List.unmodifiable(ids));
    _invalidateAttempt();
    state = state.copyWith(participants: List.unmodifiable(rows.map((row) => List<PlanServiceSelection>.unmodifiable(row))), error: null);
  }

  Future<void> refreshPriceQuote() async {
    if (state.pendingAttempt != null || state.submitting || !state.validPlan || state.quote == null || state.startTime == null || state.tipCents == null) return;
    final version = ++_quoteVersion, selection = state;
    _quoteExpiry?.cancel();
    state = state.copyWith(priceQuote: null, priceQuoteRequest: null, loadingPriceQuote: true, error: null);
    try {
      final price = await repository.priceQuote(selection.pricingRequest);
      if (!mounted || version != _quoteVersion || bookingQuoteFingerprint(state.pricingRequest) != bookingQuoteFingerprint(selection.pricingRequest)) return;
      if (!price.matches(selection.shop.id, selection.quote!.durationMin, selection.addOnSelections, expectedDurations: selection.mainDurations) || price.tipCents != selection.tipCents || selection.coupon == null && price.discountCents != 0 || selection.paymentMode == 'PAY_AT_STORE' && price.platformFeeCents != 0) throw const FormatException('Invalid plan price quote');
      state = state.copyWith(priceQuote: price, priceQuoteRequest: bookingQuoteFingerprint(selection.pricingRequest), loadingPriceQuote: false);
      _quoteExpiry = Timer(DateTime.parse(price.quoteExpiresAt).difference(DateTime.now().toUtc()), () {
        if (mounted && version == _quoteVersion && !state.submitting) state = state.copyWith(priceQuote: null, priceQuoteRequest: null, error: 'Quote expired. Get a new quote and review the total before confirming.');
      });
    } catch (_) {
      if (mounted && version == _quoteVersion) state = state.copyWith(loadingPriceQuote: false, priceQuote: null, error: 'Unable to verify the current price. Get a new quote before confirming.');
    }
  }

  void abandonRecovery({required bool acknowledged}) {
    if (!acknowledged || state.submitting) return;
    clearBookingRecoveryMarker(state.pendingAttempt?.requestKey);
    _invalidateAttempt();
    // Only explicit abandonment starts a fresh contact draft; the original
    // command kept its immutable email while recovery was unresolved.
    state = state.copyWith(pendingAttempt: null, recoveryReminder: false,
      contact: BookingContactDraft(name: state.contact.name, phone: state.contact.phone,
        email: BookingContact.normalizeEmail(_readCustomerEmail?.call())),
      error: 'Recovery stopped. This does not cancel an existing booking; check its status before starting another.');
  }

  Future<Booking?> retryOriginalRequest() {
    if (_inFlight != null) return _inFlight!;
    final attempt = state.pendingAttempt;
    if (attempt == null || attempt.actorId.isEmpty || _actorId != attempt.actorId || state.submitting) return Future.value(null);
    if (!_canRetryContact(attempt)) return Future.value(null);
    final version = _selectionVersion;
    final future = _retryOriginal(attempt, version);
    _inFlight = future;
    future.then((_) { if (mounted && version == _selectionVersion) _inFlight = null; });
    return future;
  }

  Future<Booking?> _retryOriginal(BookingRecoveryAttempt attempt, int version) async {
    state = state.copyWith(submitting: true, error: null);
    try {
      final booking = await repository.create(attempt.payload);
      if (!mounted || version != _selectionVersion || _actorId != attempt.actorId) return null;
      if (!BookingContact.fromJson(attempt.payload['contact'])!.sameAs(booking.contact) || booking.userId.isNotEmpty && booking.userId != attempt.actorId || !attempt.matchesSaved(
        id: booking.id, shop: booking.shopId, reservationKind: booking.reservationKind,
        localDate: booking.localDate, localStartTime: booking.localStartTime,
        therapistSelection: booking.therapistSelection, participantCount: booking.participantCount,
        requiredStaffCount: booking.requiredStaffCount, staffItems: booking.staffItems,
        priceCents: booking.priceCents, totalCents: booking.totalCents,
        durationMin: booking.durationMin, savedDurationKind: booking.durationKind,
        mainDurations: booking.mainDurations, addOns: booking.addOns,
      )) {
        throw const FormatException('Invalid original result');
      }
      clearBookingRecoveryMarker(attempt.requestKey);
      _completed = booking;
      state = state.copyWith(pendingAttempt: null, recoveryReminder: false);
      return booking;
    } catch (_) {
      if (mounted && version == _selectionVersion && _actorId == attempt.actorId) state = state.copyWith(error: 'The original request could not be resolved. It may already exist. Check your bookings before making another request; no automatic retry was made.');
      return null;
    } finally { if (mounted && version == _selectionVersion) state = state.copyWith(submitting: false); }
  }

  @override
  void dispose() { _calendarExpiry?.cancel(); _quoteExpiry?.cancel(); _quoteVersion++; super.dispose(); }

  Future<void> loadSlots() async {
    if (state.pendingAttempt != null || state.submitting) return;
    _invalidateAttempt();
    final version = ++_slotsVersion;
    if (!state.validPlan || state.date == null) {
      state = state.copyWith(loading: false, quote: null, startTime: null);
      return;
    }
    final selection = state;
    state = state.copyWith(
      loading: true,
      quote: null,
      startTime: null,
      error: null,
    );
    try {
      final quote = await repository.slots(selection.slotRequest);
      if (!mounted || version != _slotsVersion) return;
      if (!_matches(selection, quote)) {
        throw const FormatException('Invalid plan quote');
      }
      state = state.copyWith(quote: quote, loading: false);
      adoptCalendar(quote.bookingCalendar);
    } catch (error) {
      if (mounted && version == _slotsVersion) {
        state = state.copyWith(loading: false, error: businessError(error));
      }
    }
  }

  bool _matches(BookingPlanState selection, BookingPlanQuote quote) {
    if (quote.date != selection.date ||
        quote.participantCount != selection.participants.length ||
        quote.items.length != selection.itemCount ||
        quote.currency != 'usd' || quote.durationKind != combinedDurationKind(selection.mainDurations.map((row) => row.durationKind)) ||
        quote.durationMin < 1 ||
        quote.durationMin > 480 ||
        quote.priceCents < 0 ||
        quote.timezone.isEmpty ||
        selection.shop.timezone != null && quote.timezone != selection.shop.timezone) {
      return false;
    }
    final requested = selection.requestItems;
    final seen = <String>{};
    var latestEnd = 0;
    for (final item in quote.items) {
      final key = '${item.participantIndex}:${item.sequence}';
      if (!seen.add(key) ||
          !requested.any(
            (row) =>
                row['participantIndex'] == item.participantIndex &&
                row['sequence'] == item.sequence &&
                row['serviceId'] == item.serviceId &&
                row['variantId'] == item.variantId,
          ) ||
          !validReservedMinutes(item.durationMin) || !selection.mainDurations.any((row) => row.participantIndex == item.participantIndex && row.sequence == item.sequence && row.durationKind == item.durationKind && row.reservedDurationMin == item.durationMin) ||
          item.offsetMin < 0 ||
          item.preparationMin < 0 ||
          item.priceCents < 0 ||
          item.offsetMin + item.durationMin > quote.durationMin) {
        return false;
      }
      final end = item.offsetMin + item.durationMin;
      if (end > latestEnd) latestEnd = end;
    }
    // Keep the server's preparation gaps, but never show overlapping stages
    // or an itinerary that contradicts the shared arrival/reservation window.
    for (var person = 1; person <= selection.participants.length; person++) {
      final itinerary = quote.items
          .where((item) => item.participantIndex == person)
          .toList()
        ..sort((a, b) => a.sequence.compareTo(b.sequence));
      if (itinerary.isEmpty || itinerary.first.offsetMin != 0) return false;
      for (var stage = 1; stage < itinerary.length; stage++) {
        final previous = itinerary[stage - 1];
        if (itinerary[stage].offsetMin < previous.offsetMin + previous.durationMin) {
          return false;
        }
      }
    }
    if (latestEnd != quote.durationMin) return false;
    return quote.items.fold<int>(0, (sum, row) => sum + row.priceCents) ==
        quote.priceCents;
  }

  Future<Booking?> confirm() {
    if (_inFlight != null) return _inFlight!;
    if (_completed != null) return Future.value(_completed);
    if (!state.canConfirm) return Future.value(null);
    if (_actorId == null || state.contact.validatedFor(_readCustomerEmail?.call()) == null) {
      state = state.copyWith(error: 'Confirm your contact name, international phone number, and verified account email before submitting.');
      return Future.value(null);
    }
    _requestKey ??= List.generate(
      16,
      (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    final version = _selectionVersion;
    final future = _submit(state, _requestKey!, version);
    _inFlight = future;
    future.then((_) {
      if (mounted && version == _selectionVersion) _inFlight = null;
    });
    return future;
  }

  Future<Booking?> _submit(
    BookingPlanState selection,
    String key,
    int version,
  ) async {
    state = state.copyWith(submitting: true, error: null);
    final payload = <String,dynamic>{
        ...selection.slotRequest,
        'startTime': selection.startTime,
        'requestKey': key,
        'contact': selection.contact.validatedFor(_readCustomerEmail?.call())!.toJson(),
        'paymentMode': selection.paymentMode,
        'tipCents': selection.tipCents,
        if (selection.notes.trim().isNotEmpty) 'notes': selection.notes.trim(),
        if (selection.coupon != null) 'couponId': selection.coupon!.id,
        if (selection.hasAddOns) 'addOnSelections': addOnSelectionJson(selection.addOnSelections),
        if (selection.requiresServerQuote) ...{
          'quoteHash': selection.priceQuote!.quoteHash,
          'quoteExpiresAt': selection.priceQuote!.quoteExpiresAt,
        },
      };
    final original = BookingRecoveryAttempt(actorId: _actorId ?? '', quote: selection.requiresServerQuote ? selection.priceQuote : null, payload: payload,
      participantCount: selection.participants.length, requiredStaffCount: selection.participants.length,
      mainDurations: selection.mainDurations, reservedDurationMin: selection.quote!.durationMin);
    if (!_rememberRequest(key, original.shopId)) {
      clearBookingRecoveryMarker(key);
      state=state.copyWith(submitting:false,error:'This page cannot safely retain a booking reminder. No request was sent. Check browser storage settings before trying again.');
      return null;
    }
    state = state.copyWith(pendingAttempt: original);
    try {
      final booking = await repository.create(original.payload);
      if (!mounted || version != _selectionVersion || (_actorId ?? '') != original.actorId) return null;
      if (original.actorId.isNotEmpty && booking.userId.isNotEmpty && booking.userId!=original.actorId) throw const FormatException('Booking customer does not match the original request');
      if (!BookingContact.fromJson(original.payload['contact'])!.sameAs(booking.contact) || !original.matchesSaved(
        id: booking.id, shop: booking.shopId, reservationKind: booking.reservationKind,
        localDate: booking.localDate, localStartTime: booking.localStartTime,
        therapistSelection: booking.therapistSelection, participantCount: booking.participantCount,
        requiredStaffCount: booking.requiredStaffCount, staffItems: booking.staffItems,
        priceCents: booking.priceCents, totalCents: booking.totalCents,
        durationMin: booking.durationMin, savedDurationKind: booking.durationKind,
        mainDurations: booking.mainDurations, addOns: booking.addOns,
      )) {
        throw const FormatException('Unable to verify the saved booking');
      }
      _completed = booking;
      state = state.copyWith(pendingAttempt: null);
      clearBookingRecoveryMarker(key);
      return booking;
    } catch (error) {
      if (mounted && version == _selectionVersion) {
        final changed = error is DioException && error.response?.statusCode == 409;
        final status = error is DioException ? error.response?.statusCode : null;
        final uncertain = status == null || status == 408 || status >= 500;
        if (uncertain) {
          state = state.copyWith(pendingAttempt: original, recoveryReminder: true, error: 'The result of the original booking request is unknown. Check your bookings or explicitly retry that same request.');
        } else {
          clearBookingRecoveryMarker(key);
        state = state.copyWith(pendingAttempt: null, error: changed ? 'The quote or availability changed. Get a new quote and review it; no automatic retry was made.' : businessError(error),
          priceQuote: null, priceQuoteRequest: null);
        }
      }
      return null;
    } finally {
      if (mounted && version == _selectionVersion) {
        state = state.copyWith(submitting: false);
      }
    }
  }
}

final bookingPlanProvider = StateNotifierProvider.autoDispose
    .family<BookingPlanNotifier, BookingPlanState, ShopDetail>((ref, shop) {
      final notifier = BookingPlanNotifier(
        shop,
        ref.read(bookingPlanRepositoryProvider),
        currentCustomerId: () => ref.read(authProvider).user?.id,
        currentCustomerName: () => ref.read(authProvider).user?.name,
        currentCustomerPhone: () => ref.read(authProvider).user?.phone,
        currentCustomerEmail: () => bookingAccountEmail(ref.read(authProvider).user),
      );
      ref.listen(authProvider.select((state) => state.user?.id), (
        previous,
        next,
      ) {
        notifier.onCustomerChanged(previous, next);
      });
      ref.listen(authProvider.select((state) => (state.user?.id, bookingAccountEmail(state.user))), (previous, next) {
        if (previous?.$1 == next.$1) notifier.syncAccountEmail();
      });
      return notifier;
    });
