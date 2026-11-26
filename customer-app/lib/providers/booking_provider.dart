import 'dart:async';
import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../models/booking.dart';
import '../models/booking_plan.dart';
import '../models/shop.dart';
import '../models/coupon.dart';
import '../models/booking_add_on.dart';
import '../models/booking_order_policy.dart';
import '../models/booking_contact.dart';
import '../models/booking_calendar.dart';
import '../models/service_duration.dart';
import '../services/booking_recovery_marker.dart';
import '../services/business_workflow_service.dart';
import 'auth_provider.dart';

const _unchanged = Object();

/// Provider for booking API calls
final bookingRepositoryProvider = Provider<BookingRepository>((ref) {
  return BookingRepository(ref.read(apiServiceProvider));
});

class BookingRepository {
  final ApiService _api;
  BookingRepository(this._api);

  Future<SlotResponse> getSlots({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    required String date,
  }) async {
    final data = await _api.getSlots(
      shopId: shopId,
      serviceId: serviceId,
      therapistId: therapistId,
      variantId: variantId,
      preferredTherapistIds: preferredTherapistIds,
      date: date,
    );
    return SlotResponse.fromJson(data);
  }

  Future<Booking> createBooking({
    required String shopId,
    required String serviceId,
    String? therapistId,
    String? variantId,
    List<String>? preferredTherapistIds,
    String? requestKey,
    required String date,
    required String startTime,
    int? durationMin,
    String? notes,
    String? couponId,
    String paymentMode = 'PAY_AT_STORE',
    Map<String, dynamic>? contact,
  }) async {
    final data = await _api.createBooking(
      shopId: shopId,
      serviceId: serviceId,
      therapistId: therapistId,
      variantId: variantId,
      preferredTherapistIds: preferredTherapistIds,
      requestKey: requestKey,
      date: date,
      startTime: startTime,
      durationMin: durationMin,
      notes: notes,
      couponId: couponId,
      paymentMode: paymentMode,
      contact: contact,
    );
    return Booking.fromJson(data);
  }

  Future<BookingPriceQuote> quote(Map<String,dynamic> selection) async => BookingPriceQuote.fromJson(await _api.getBookingQuote(selection));

  Future<Booking> createBookingWithAddOns(Map<String,dynamic> selection) async => Booking.fromJson(await _api.createQuotedBooking(selection));

  Future<List<Booking>> getUserBookings() async {
    final data = await _api.getUserBookings();
    return data
        .map((b) => Booking.fromJson(b as Map<String, dynamic>))
        .toList();
  }

  Future<BookingPage> getUserBookingPage(
    BookingListQuery query, {
    CancelToken? cancelToken,
  }) async => BookingPage.fromJson(
    await _api.getUserBookingPage(query.toJson(), cancelToken: cancelToken),
  );

  Future<void> cancelBooking(String bookingId) async {
    await _api.cancelBooking(bookingId);
  }

  Future<void> deleteBooking(String bookingId) async {
    await _api.deleteBooking(bookingId);
  }

  Future<void> requestRefund(String bookingId) async {
    await _api.requestRefund(bookingId);
  }

  Future<void> requestPartialRefund(String bookingId, int amountCents) async {
    await _api.requestPartialRefund(bookingId, amountCents);
  }

  // ─── Payment ─────────────────────────────────────────────

  /// Create a payment intent for a booking.
  /// Returns: {paymentIntentId, clientSecret, amountCents, platformFeeCents, merchantAmountCents}
  Future<Map<String, dynamic>> createPaymentIntent(String bookingId) async {
    return _api.createPaymentIntent(bookingId);
  }

  /// Confirm payment for a given payment intent.
  Future<Map<String, dynamic>> confirmPayment(String paymentIntentId) async {
    return _api.confirmPayment(paymentIntentId);
  }
}

/// One selected start time, with duration and per-person price fixed by the service variant.
class BookingFlowState {
  final ShopDetail? shop;
  final ShopService? selectedService;
  final ShopServiceVariant? selectedVariant;
  final Therapist? selectedTherapist;
  final DateTime? selectedDate;

  /// Compatibility for existing presentation widgets: always empty or one start time.
  final List<String> selectedSlots;
  final List<TimeSlot>? availableSlots;
  final SlotResponse? availability;
  final bool isLoadingSlots;
  final bool isCreating;
  final String? _paymentMode;
  String get paymentMode => shop?.orderOnly == true ? 'PAY_AT_STORE' : _paymentMode ?? 'ONLINE';
  final String? error;

  /// UserCoupon selected to redeem for this booking (null = no coupon)
  final UserCoupon? selectedCoupon;
  final List<BookingAddOnSelection> addOnSelections;
  final BookingPriceQuote? priceQuote;
  final String? priceQuoteRequest;
  final bool isLoadingQuote;
  final BookingRecoveryAttempt? pendingAttempt;
  final bool recoveryReminder;
  final BookingContactDraft contact;

  const BookingFlowState({
    this.shop,
    this.selectedService,
    this.selectedVariant,
    this.selectedTherapist,
    this.selectedDate,
    this.selectedSlots = const [],
    this.availableSlots,
    this.availability,
    this.isLoadingSlots = false,
    this.isCreating = false,
    this._paymentMode,
    this.error,
    this.selectedCoupon,
    this.addOnSelections = const [],
    this.priceQuote,
    this.priceQuoteRequest,
    this.isLoadingQuote = false,
    this.pendingAttempt,
    this.recoveryReminder = false,
    this.contact = const BookingContactDraft(),
  });

  bool get hasServiceSelection =>
      shop?.onlineBookingEnabled == true && selectedService?.canBook == true &&
      (!selectedService!.hasVariants ||
          selectedService!.activeVariants.any(
            (item) => item.id == selectedVariant?.id,
          ));
  int get selectedDuration => !hasServiceSelection
      ? 0
      : selectedVariant?.durationMin ?? selectedService!.durationMin;
  String get selectedDurationKind => selectedService?.durationKind ?? 'TIMED';
  String get selectedDurationLabel => reservedDurationLabel(selectedDurationKind, selectedDuration);
  String get selectedReservationWindow => selectedStartTime == null ? '—' : '$selectedStartTime – $selectedEndTime (${availability?.timezone ?? shop?.timezone ?? 'shop time unavailable'})';
  List<MainDuration> get mainDurations => !hasServiceSelection ? const [] : [for (var guest = 1; guest <= selectedService!.participantCount; guest++)
    MainDuration(participantIndex: guest, sequence: 1, serviceId: selectedService!.id, variantId: selectedVariant?.id,
      durationKind: selectedDurationKind, reservedDurationMin: selectedDuration)];
  bool get requiresServerQuote => hasSelection;
  int? get selectedPriceCents => !hasServiceSelection
      ? null
      : (selectedVariant?.priceCents ?? selectedService!.priceCents) *
            (selectedPriceBasis == 'PER_BOOKING'
                ? 1
                : selectedService!.participantCount);
  String? get selectedPriceBasis =>
      shop?.usesOrderPricing == true ? 'PER_BOOKING' : selectedVariant?.priceBasis ?? selectedService?.priceBasis;
  String? get selectedCurrency =>
      selectedVariant?.currency ?? selectedService?.currency;

  /// Earliest selected start time
  String? get selectedStartTime =>
      selectedSlots.isNotEmpty ? selectedSlots.first : null;

  /// End of the selected specification, never a sum of selected slot buttons.
  String? get selectedEndTime => selectedStartTime == null ? null : planClockTime(selectedStartTime!, selectedDuration);

  bool get hasSelection =>
      selectedSlots.length == 1 && hasServiceSelection && selectedDate != null && (selectedDurationKind == 'TIMED' || availability != null && availability!.durationKind == selectedDurationKind && availability!.reservedDurationMin == selectedDuration);

  bool get hasAddOns => addOnSelections.any((row) => row.addOnIds.isNotEmpty);
  List<String> addOnIdsFor(int guest) => addOnSelections.where((row) => row.participantIndex == guest && row.sequence == 1).expand((row) => row.addOnIds).toList(growable: false);
  Map<String,dynamic> get quoteRequest => {
    'shopId': shop!.id, 'serviceId': selectedService!.id,
    if (selectedVariant != null) 'variantId': selectedVariant!.id,
    'preferredTherapistIds': selectedTherapist == null ? <String>[] : [selectedTherapist!.id],
    'date': '${selectedDate!.year}-${selectedDate!.month.toString().padLeft(2, '0')}-${selectedDate!.day.toString().padLeft(2, '0')}',
    'startTime': selectedStartTime, 'durationMin': selectedDuration,
    'paymentMode': paymentMode,
    if (selectedCoupon != null) 'couponId': selectedCoupon!.id,
    if (hasAddOns) 'addOnSelections': addOnSelectionJson(addOnSelections),
  };
  bool get hasValidPriceQuote => hasSelection && priceQuote != null &&
      priceQuoteRequest == bookingQuoteFingerprint(quoteRequest) && priceQuote!.matches(shop!.id, selectedDuration, addOnSelections, expectedDurations: mainDurations);
  bool get canConfirm => pendingAttempt == null && !recoveryReminder && hasSelection && !isCreating && !isLoadingQuote && (!requiresServerQuote || hasValidPriceQuote);

  List<Therapist> get eligibleTherapists => selectedService == null
      ? const []
      : (shop?.therapists ?? const <Therapist>[])
            .where(
              (therapist) => therapist.services.any(
                (service) => service.id == selectedService!.id,
              ),
            )
            .toList();

  BookingFlowState copyWith({
    Object? shop = _unchanged,
    Object? selectedService = _unchanged,
    Object? selectedVariant = _unchanged,
    Object? selectedTherapist = _unchanged,
    Object? selectedDate = _unchanged,
    List<String>? selectedSlots,
    Object? availableSlots = _unchanged,
    Object? availability = _unchanged,
    bool? isLoadingSlots,
    bool? isCreating,
    String? paymentMode,
    Object? error = _unchanged,
    bool clearError = false,
    Object? selectedCoupon = _unchanged,
    List<BookingAddOnSelection>? addOnSelections,
    Object? priceQuote = _unchanged,
    Object? priceQuoteRequest = _unchanged,
    bool? isLoadingQuote,
    Object? pendingAttempt = _unchanged,
    bool? recoveryReminder,
    BookingContactDraft? contact,
  }) {
    return BookingFlowState(
      shop: identical(shop, _unchanged) ? this.shop : shop as ShopDetail?,
      selectedService: identical(selectedService, _unchanged)
          ? this.selectedService
          : selectedService as ShopService?,
      selectedVariant: identical(selectedVariant, _unchanged)
          ? this.selectedVariant
          : selectedVariant as ShopServiceVariant?,
      selectedTherapist: identical(selectedTherapist, _unchanged)
          ? this.selectedTherapist
          : selectedTherapist as Therapist?,
      selectedDate: identical(selectedDate, _unchanged)
          ? this.selectedDate
          : selectedDate as DateTime?,
      selectedSlots: selectedSlots ?? this.selectedSlots,
      availableSlots: identical(availableSlots, _unchanged)
          ? this.availableSlots
          : availableSlots as List<TimeSlot>?,
      availability: identical(availability, _unchanged) ? this.availability : availability as SlotResponse?,
      isLoadingSlots: isLoadingSlots ?? this.isLoadingSlots,
      isCreating: isCreating ?? this.isCreating,
      paymentMode: paymentMode ?? this.paymentMode,
      error: clearError
          ? null
          : (identical(error, _unchanged) ? this.error : error as String?),
      addOnSelections: addOnSelections ?? this.addOnSelections,
      priceQuote: identical(priceQuote, _unchanged) ? this.priceQuote : priceQuote as BookingPriceQuote?,
      priceQuoteRequest: identical(priceQuoteRequest, _unchanged) ? this.priceQuoteRequest : priceQuoteRequest as String?,
      isLoadingQuote: isLoadingQuote ?? this.isLoadingQuote,
      pendingAttempt: identical(pendingAttempt, _unchanged) ? this.pendingAttempt : pendingAttempt as BookingRecoveryAttempt?,
      recoveryReminder: recoveryReminder ?? this.recoveryReminder,
      contact: contact ?? this.contact,
      selectedCoupon: identical(selectedCoupon, _unchanged)
          ? this.selectedCoupon
          : selectedCoupon as UserCoupon?,
    );
  }

  /// Clear the selected coupon
  BookingFlowState copyWithCouponCleared() {
    return copyWith(selectedCoupon: null);
  }
}

/// Notifier for the booking flow
class BookingFlowNotifier extends StateNotifier<BookingFlowState> {
  final BookingRepository _repo;
  final Random _random = Random.secure();
  int _slotsVersion = 0;
  int _flowVersion = 0;
  int _quoteVersion = 0;
  Timer? _quoteExpiry;
  Timer? _calendarExpiry;
  String? _requestKey;
  Future<Booking?>? _bookingFuture;
  Booking? _completedBooking;

  final String? Function()? _readCustomerId;
  final String? Function()? _readCustomerEmail;
  final String? Function()? _readCustomerName, _readCustomerPhone;
  final bool Function(String, String) _rememberRequest;
  String? _customerId;
  String? get _actorId => _readCustomerId != null ? _readCustomerId() : _customerId;
  Booking? get completedBooking => _completedBooking;
  BookingFlowNotifier(this._repo, {String? Function()? currentCustomerId, String? Function()? currentCustomerEmail, String? Function()? currentCustomerName, String? Function()? currentCustomerPhone, bool Function(String, String)? rememberRequest}) : _readCustomerId = currentCustomerId, _readCustomerEmail = currentCustomerEmail, _readCustomerName = currentCustomerName, _readCustomerPhone = currentCustomerPhone, _rememberRequest = rememberRequest ?? writeBookingRecoveryMarker, super(const BookingFlowState()) {
    state = state.copyWith(recoveryReminder: hasBookingRecoveryMarker(), contact: _accountContact());
  }

  BookingContactDraft _accountContact() => BookingContactDraft(
    name: _readCustomerName?.call() ?? '', phone: _readCustomerPhone?.call() ?? '',
    email: BookingContact.normalizeEmail(_readCustomerEmail?.call()));

  void updateContact({String? name, String? phone}) {
    if (state.isCreating || state.pendingAttempt != null || state.recoveryReminder) return;
    if ((name == null || name == state.contact.name) && (phone == null || phone == state.contact.phone)) return;
    // Contact edits change the command, never the selection's price quote.
    _flowVersion++; _requestKey = null; _bookingFuture = null; _completedBooking = null;
    state = state.copyWith(contact: state.contact.copyWith(name: name, phone: phone), error: null);
  }

  void syncAccountEmail() {
    if (_completedBooking != null) return;
    final email = BookingContact.normalizeEmail(_readCustomerEmail?.call());
    if (state.contact.email == email) return;
    final unresolved = state.isCreating || state.pendingAttempt != null;
    _flowVersion++; _requestKey = null; _bookingFuture = null; _completedBooking = null;
    if (unresolved) {
      state = state.copyWith(isCreating: false, recoveryReminder: true, error: bookingContactRecoveryError);
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
    state = state.copyWith(priceQuote: null, priceQuoteRequest: null, isLoadingQuote: false);
    _flowVersion++;
    _requestKey = null;
    _bookingFuture = null;
    _completedBooking = null;
  }

  void initFlow(ShopDetail shop) {
    if (state.pendingAttempt != null) return;
    _slotsVersion++;
    _invalidateAttempt();
    state = BookingFlowState(shop: shop, recoveryReminder: hasBookingRecoveryMarker(), contact: _accountContact());
    adoptCalendar(shop.bookingCalendar);
  }

  void adoptCalendar(BookingCalendar? calendar) {
    if (state.pendingAttempt != null || state.isCreating || calendar == null || calendar.timezone != state.shop?.timezone) return;
    _calendarExpiry?.cancel();
    if (calendar.isCurrent) _calendarExpiry=Timer(calendar.remaining,invalidateCalendarSelection);
  }

  void refreshShopDetails(ShopDetail shop) {
    if (_completedBooking != null || state.pendingAttempt != null ||
        state.isCreating || shop.id != state.shop?.id) {
      return;
    }
    final services = shop.services.where((item) => item.id == state.selectedService?.id && item.canBook);
    final service = services.isEmpty ? null : services.first;
    final variants = service?.activeVariants.where((item) => item.id == state.selectedVariant?.id);
    final therapists = shop.therapists.where((item) => item.id == state.selectedTherapist?.id && item.services.any((row) => row.id == service?.id));
    final addOns = <BookingAddOnSelection>[
      if (service != null)
        for (final row in state.addOnSelections)
          if (row.participantIndex <= service.participantCount && row.sequence == 1)
            BookingAddOnSelection(participantIndex: row.participantIndex, sequence: 1,
              addOnIds: List.unmodifiable(row.addOnIds.where((id) => service.addOns.any((item) => item.id == id)))),
    ];
    _slotsVersion++;
    _invalidateAttempt();
    _calendarExpiry?.cancel();
    state = state.copyWith(shop: shop, selectedService: service,
      selectedVariant: variants == null || variants.isEmpty ? null : variants.first,
      selectedTherapist: therapists.isEmpty ? null : therapists.first,
      addOnSelections: List.unmodifiable(addOns), selectedCoupon: null,
      selectedDate: null, selectedSlots: const [], availableSlots: null, availability: null, isLoadingSlots: false,
      error: !shop.onlineBookingEnabled ? 'Online bookings are disabled for this shop.'
        : 'Shop details refreshed. Review your service and choose a date and arrival time again.');
    adoptCalendar(shop.bookingCalendar);
  }

  void selectService(ShopService service) {
    final matches = state.shop?.services.where((item) => item.id == service.id && item.canBook);
    if (state.pendingAttempt != null || state.isCreating || state.shop?.onlineBookingEnabled != true ||
        matches == null || matches.isEmpty) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(
      selectedService: matches.first,
      addOnSelections: const [],
      selectedVariant: null,
      selectedTherapist: null,
      selectedSlots: const [],
      availableSlots: null,
      availability: null,
      selectedCoupon: null,
      clearError: true,
    );
    _loadSlots();
  }

  void selectVariant(ShopServiceVariant variant) {
    if (state.pendingAttempt != null || state.isCreating ||
        !(state.selectedService?.activeVariants.any(
              (item) => item.id == variant.id,
            ) ??
            false)) {
      return;
    }
    _invalidateAttempt();
    final authoritative = state.selectedService!.activeVariants.firstWhere(
      (item) => item.id == variant.id,
    );
    state = state.copyWith(
      selectedVariant: authoritative,
      selectedSlots: const [],
      availableSlots: null,
      availability: null,
      selectedCoupon: null,
      clearError: true,
    );
    _loadSlots();
  }

  void selectTherapist(Therapist? therapist) {
    if (state.pendingAttempt != null || state.isCreating ||
        (therapist != null &&
            !state.eligibleTherapists.any(
              (candidate) => candidate.id == therapist.id,
            ))) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(
      selectedTherapist: therapist,
      selectedSlots: const [],
      availableSlots: null,
      availability: null,
      clearError: true,
    );
    _loadSlots();
  }

  void selectDate(DateTime date) {
    if (state.pendingAttempt != null || state.isCreating) return;
    _invalidateAttempt();
    state = state.copyWith(
      selectedDate: date,
      selectedSlots: const [],
      availableSlots: null,
      availability: null,
      clearError: true,
    );
    _loadSlots();
  }

  void invalidateCalendarSelection() {
    if (_completedBooking != null || state.pendingAttempt != null || state.isCreating) return;
    _slotsVersion++;_invalidateAttempt();
    state=state.copyWith(selectedDate:null,selectedSlots:const [],availableSlots:null,availability:null,isLoadingSlots:false,error:'Refresh the shop calendar and choose a date and arrival time again.');
  }

  void toggleTimeSlot(String time) {
    if (state.pendingAttempt != null || state.isCreating ||
        state.isLoadingSlots ||
        !state.hasServiceSelection ||
        !(state.availableSlots?.any(
              (slot) => slot.time == time && slot.available,
            ) ??
            false)) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(
      selectedSlots: state.selectedStartTime == time ? const [] : [time],
      clearError: true,
    );
  }

  void reset() {
    if (state.pendingAttempt != null) return;
    _slotsVersion++;
    _calendarExpiry?.cancel();
    _invalidateAttempt();
    state = BookingFlowState(recoveryReminder: hasBookingRecoveryMarker(), contact: _accountContact());
  }

  /// Guest selections are public data and survive the sign-in return trip.
  /// A previous customer's session must never carry coupons or attempts over.
  void onCustomerChanged(String? previousId, String? nextId) {
    _customerId = nextId;
    if (previousId == nextId) return;
    if (state.pendingAttempt != null) state = state.copyWith(pendingAttempt: null, recoveryReminder: true);
    if (previousId == null && nextId != null) {
      _invalidateAttempt();
      state = state.copyWith(selectedCoupon: null, isCreating: false, contact: _accountContact());
    } else {
      reset();
    }
  }

  void selectCoupon(UserCoupon? coupon) {
    if (state.pendingAttempt != null || state.isCreating) return;
    _invalidateAttempt();
    state = state.copyWith(selectedCoupon: coupon, clearError: true);
  }

  void selectPaymentMode(String mode) {
    if (state.pendingAttempt != null || state.isCreating ||
        !const {'ONLINE', 'PAY_AT_STORE'}.contains(mode) ||
        state.shop?.orderOnly == true && mode != 'PAY_AT_STORE' ||
        mode == 'PAY_AT_STORE' && state.shop?.orderOnly != true && state.shop?.payAtStoreEnabled != true ||
        state.paymentMode == mode) {
      return;
    }
    _invalidateAttempt();
    state = state.copyWith(paymentMode: mode, clearError: true);
  }

  void toggleAddOn(int guest, String addOnId, bool selected) {
    final service = state.selectedService;
    if (state.pendingAttempt != null || state.isCreating || !state.hasServiceSelection || service == null || guest < 1 || guest > service.participantCount || !service.addOns.any((row) => row.id == addOnId)) return;
    final ids = state.addOnIdsFor(guest).toSet();
    if (ids.contains(addOnId) == selected) return;
    if (selected && ids.length >= 10 && !ids.contains(addOnId)) return;
    if (selected) { ids.add(addOnId); } else { ids.remove(addOnId); }
    _invalidateAttempt();
    state = state.copyWith(addOnSelections: List.unmodifiable([
      ...state.addOnSelections.where((row) => row.participantIndex != guest),
      if (ids.isNotEmpty) BookingAddOnSelection(participantIndex: guest, sequence: 1, addOnIds: List.unmodifiable(ids)),
    ]), clearError: true);
  }

  Future<void> refreshPriceQuote() async {
    if (state.pendingAttempt != null || state.isCreating || !state.hasSelection) return;
    final version = ++_quoteVersion, selection = state;
    _quoteExpiry?.cancel();
    state = state.copyWith(priceQuote: null, priceQuoteRequest: null, isLoadingQuote: true, clearError: true);
    try {
      final quote = await _repo.quote(selection.quoteRequest);
      if (!mounted || version != _quoteVersion || !state.hasSelection || bookingQuoteFingerprint(state.quoteRequest) != bookingQuoteFingerprint(selection.quoteRequest)) return;
      if (!quote.matches(selection.shop!.id, selection.selectedDuration, selection.addOnSelections, expectedDurations: selection.mainDurations) || quote.tipCents != 0 || selection.selectedCoupon == null && quote.discountCents != 0 || selection.paymentMode == 'PAY_AT_STORE' && quote.platformFeeCents != 0) throw const FormatException('Quote does not match this selection');
      state = state.copyWith(priceQuote: quote, priceQuoteRequest: bookingQuoteFingerprint(selection.quoteRequest), isLoadingQuote: false);
      _quoteExpiry = Timer(DateTime.parse(quote.quoteExpiresAt).difference(DateTime.now().toUtc()), () {
        if (mounted && version == _quoteVersion && !state.isCreating) state = state.copyWith(priceQuote: null, priceQuoteRequest: null, error: 'Quote expired. Get a new quote and review the total before confirming.');
      });
    } catch (_) {
      if (mounted && version == _quoteVersion) state = state.copyWith(isLoadingQuote: false, priceQuote: null, error: 'Unable to verify the current price. Get a new quote before confirming.');
    }
  }

  void abandonRecovery({required bool acknowledged}) {
    if (!acknowledged || state.isCreating) return;
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
    if (_bookingFuture != null) return _bookingFuture!;
    final attempt = state.pendingAttempt;
    if (attempt == null || attempt.actorId.isEmpty || _actorId != attempt.actorId || state.isCreating) return Future.value(null);
    if (!_canRetryContact(attempt)) return Future.value(null);
    final version = _flowVersion;
    final future = _retryOriginal(attempt, version);
    _bookingFuture = future;
    future.then((_) { if (mounted && version == _flowVersion) _bookingFuture = null; });
    return future;
  }

  Future<Booking?> _retryOriginal(BookingRecoveryAttempt attempt, int version) async {
    state = state.copyWith(isCreating: true, clearError: true);
    try {
      final booking = await _sendOriginal(attempt);
      if (!mounted || version != _flowVersion || _actorId != attempt.actorId) return null;
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
      _completedBooking = booking;
      state = state.copyWith(pendingAttempt: null, recoveryReminder: false);
      return booking;
    } catch (_) {
      if (mounted && version == _flowVersion && _actorId == attempt.actorId) state = state.copyWith(error: 'The original request could not be resolved. It may already exist. Check your bookings before making another request; no automatic retry was made.');
      return null;
    } finally { if (mounted && version == _flowVersion) state = state.copyWith(isCreating: false); }
  }

  @override
  void dispose() { _calendarExpiry?.cancel(); _quoteExpiry?.cancel(); _quoteVersion++; super.dispose(); }

  /// Reuse one request key and in-flight result for an unchanged booking attempt.
  Future<Booking?> confirmBooking() {
    if (_bookingFuture != null) return _bookingFuture!;
    if (_completedBooking != null) return Future.value(_completedBooking);
    if (state.pendingAttempt != null || state.recoveryReminder || !state.hasSelection || state.shop == null) return Future.value(null);
    if (_actorId == null || state.contact.validatedFor(_readCustomerEmail?.call()) == null) {
      state = state.copyWith(error: 'Confirm your contact name, international phone number, and verified account email before submitting.');
      return Future.value(null);
    }
    if (state.requiresServerQuote && !state.hasValidPriceQuote) {
      state = state.copyWith(priceQuote: null, priceQuoteRequest: null, error: 'Get a new server quote and review it before confirming this reservation.');
      return Future.value(null);
    }
    _requestKey ??= List.generate(
      16,
      (_) => _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    final version = _flowVersion;
    final future = _submit(state, version, _requestKey!);
    _bookingFuture = future;
    future.then((_) {
      if (mounted && version == _flowVersion) _bookingFuture = null;
    });
    return future;
  }

  Future<Booking?> _submit(
    BookingFlowState selection,
    int version,
    String requestKey,
  ) async {
    state = state.copyWith(isCreating: true, clearError: true);
    final original = BookingRecoveryAttempt(actorId: _actorId ?? '', quote: selection.requiresServerQuote ? selection.priceQuote : null,
      participantCount: selection.selectedService!.participantCount, requiredStaffCount: selection.selectedService!.requiredStaffCount,
      mainDurations: selection.mainDurations, reservedDurationMin: selection.selectedDuration, payload: {
        ...selection.quoteRequest, 'requestKey': requestKey,
        'contact': selection.contact.validatedFor(_readCustomerEmail?.call())!.toJson(),
        if (selection.requiresServerQuote) ...{'quoteHash': selection.priceQuote!.quoteHash, 'quoteExpiresAt': selection.priceQuote!.quoteExpiresAt},
      });
    if (!_rememberRequest(requestKey, original.shopId)) {
      clearBookingRecoveryMarker(requestKey);
      state=state.copyWith(isCreating:false,error:'This page cannot safely retain a booking reminder. No request was sent. Check browser storage settings before trying again.');
      return null;
    }
    state = state.copyWith(pendingAttempt: original);
    try {
      final booking = await _sendOriginal(original);
      if (!mounted || version != _flowVersion || (_actorId ?? '') != original.actorId) return null;
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
      _completedBooking = booking;
      state = state.copyWith(pendingAttempt: null);
      clearBookingRecoveryMarker(requestKey);
      return booking;
    } catch (error) {
      if (mounted && version == _flowVersion) {
        final changed = error is DioException && error.response?.statusCode == 409;
        final status = error is DioException ? error.response?.statusCode : null;
        final uncertain = status == null || status == 408 || status >= 500;
        if (uncertain) {
          state = state.copyWith(pendingAttempt: original, recoveryReminder: true, error: 'The result of the original booking request is unknown. Check your bookings or explicitly retry that same request.');
        } else {
          clearBookingRecoveryMarker(requestKey);
          state = state.copyWith(pendingAttempt: null, error: changed ? 'The quote or availability changed. Get a new quote and review it; no automatic retry was made.' : 'This booking was not accepted. Get a new quote and review it before trying again.',
            priceQuote: null, priceQuoteRequest: null);
        }
      }
      return null;
    } finally {
      if (mounted && version == _flowVersion) {
        state = state.copyWith(isCreating: false);
      }
    }
  }

  Future<Booking> _sendOriginal(BookingRecoveryAttempt attempt) {
    final payload = attempt.payload;
    if (attempt.quote != null) return _repo.createBookingWithAddOns(payload);
    return _repo.createBooking(shopId: payload['shopId'] as String, serviceId: payload['serviceId'] as String, therapistId:payload['therapistId'] as String?,
      variantId: payload['variantId'] as String?, preferredTherapistIds: List<String>.from(payload['preferredTherapistIds'] as List),
      requestKey: payload['requestKey'] as String, date: payload['date'] as String, startTime: payload['startTime'] as String,
      durationMin: payload['durationMin'] as int, notes:payload['notes'] as String?, couponId: payload['couponId'] as String?, paymentMode: payload['paymentMode'] as String, contact: Map<String,dynamic>.from(payload['contact'] as Map));
  }

  void _loadSlots() {
    final version = ++_slotsVersion;
    if (state.shop == null ||
        !state.hasServiceSelection ||
        state.selectedDate == null) {
      state = state.copyWith(isLoadingSlots: false);
      return;
    }
    final selection = state;
    state = state.copyWith(isLoadingSlots: true, clearError: true);
    _repo
        .getSlots(
          shopId: state.shop!.id,
          serviceId: state.selectedService!.id,
          variantId: state.selectedVariant?.id,
          preferredTherapistIds: state.selectedTherapist == null
              ? const []
              : [state.selectedTherapist!.id],
          date: _formatDate(state.selectedDate!),
        )
        .then((response) {
          if (!mounted || version != _slotsVersion) return;
          if (response.date != _formatDate(selection.selectedDate!) ||
              response.timezone != null && selection.shop!.timezone != null && response.timezone != selection.shop!.timezone ||
              response.durationKind != selection.selectedDurationKind ||
              selection.selectedDurationKind != 'TIMED' && (!response.hasDurationMetadata || response.durationMin == null) ||
              response.durationMin != null && response.durationMin != selection.selectedDuration ||
              response.participantCount != null && response.participantCount != selection.selectedService!.participantCount ||
              response.requiredStaffCount != null && response.requiredStaffCount != selection.selectedService!.requiredStaffCount ||
              (response.hasDurationMetadata || response.variantId != null) && response.variantId != selection.selectedVariant?.id) {
            throw const FormatException('Availability changed. Refresh the service before choosing a time.');
          }
          state = state.copyWith(
            availability: response,
            availableSlots: response.slots,
            isLoadingSlots: false,
            selectedSlots: const [],
          );
          adoptCalendar(response.bookingCalendar);
        })
        .catchError((error) {
          if (!mounted || version != _slotsVersion) return;
          state = state.copyWith(
            availableSlots: null,
      availability: null,
            isLoadingSlots: false,
            error: businessError(error, fallback: 'Unable to load available times. Choose another date or refresh availability.'),
          );
        });
  }

  String _formatDate(DateTime date) =>
      '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}

/// Provider for the booking flow
final bookingFlowProvider =
    StateNotifierProvider<BookingFlowNotifier, BookingFlowState>((ref) {
      final notifier = BookingFlowNotifier(ref.read(bookingRepositoryProvider), currentCustomerId: () => ref.read(authProvider).user?.id,
        currentCustomerName: () => ref.read(authProvider).user?.name,
        currentCustomerPhone: () => ref.read(authProvider).user?.phone,
        currentCustomerEmail: () => bookingAccountEmail(ref.read(authProvider).user));
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
