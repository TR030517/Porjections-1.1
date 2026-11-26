import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../models/booking.dart';
import '../models/money.dart';
import '../models/booking_order_email.dart';
import '../services/api_service.dart';
import '../services/business_workflow_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/responsive_content.dart';
import '../widgets/booking_add_ons.dart';
import '../navigation/customer_navigation.dart';
import '../providers/auth_provider.dart';
import '../services/booking_reschedule_journal.dart';

String _itemTime(Booking booking, BookingItem item) {
  if (item.localStartTime != null &&
      item.localEndTime != null &&
      booking.timezone?.isNotEmpty == true) {
    return '${item.localStartTime!.replaceFirst('T', ' ')} – ${item.localEndTime!.replaceFirst('T', ' ')} (${booking.timezone})';
  }
  if (!RegExp(r'(?:Z|[+-]\d{2}:?\d{2})$').hasMatch(item.startTime ?? '') ||
      !RegExp(r'(?:Z|[+-]\d{2}:?\d{2})$').hasMatch(item.endTime ?? '')) {
    return 'Shop time unavailable';
  }
  final start = DateTime.tryParse(item.startTime ?? '');
  final end = DateTime.tryParse(item.endTime ?? '');
  if (start == null || end == null) return '—';
  String stamp(DateTime value) =>
      value.toUtc().toIso8601String().replaceFirst('T', ' ').substring(0, 16);
  return '${stamp(start)} – ${stamp(end)} (UTC)';
}

String bookingPaymentModeLabel(BuildContext context, Booking booking) =>
    customerText(
      context,
      switch (booking.paymentMode) {
        'PAY_AT_STORE' =>
          booking.isOfflineOrder
              ? 'Booking order · handled offline'
              : 'Pay at the store',
        'ZERO' => 'No payment required',
        'ONLINE' => 'Online payment',
        _ => 'Payment arrangement unavailable',
      },
      switch (booking.paymentMode) {
        'PAY_AT_STORE' => booking.isOfflineOrder ? '预约订单 · 线下处理' : '到店付款',
        'ZERO' => '无需付款',
        'ONLINE' => '在线付款',
        _ => '付款方式未知',
      },
    );

String? _detailAccount(AuthState auth) =>
    auth.isLoggedIn && auth.user?.role == 'CUSTOMER' ? auth.user?.id : null;

String bookingPaymentGuidance(Booking booking) {
  switch (booking.status) {
    case 'CANCELLED':
      return 'This booking is cancelled. Cancellation does not issue a refund. Check the collected and refunded amounts above and contact the shop about any remaining collected balance.';
    case 'REFUNDING':
      return 'This booking is in refund handling. This status does not confirm that money has been returned. Check support and payment records.';
    case 'REFUNDED':
      return 'This booking is marked refunded. Check the recorded refunded amount and the payment result separately.';
    case 'COMPLETED':
      return booking.isOfflineOrder &&
              booking.paidCents == 0 &&
              booking.refundedCents == 0
          ? 'The shop marked this booking order completed. The order total and recorded money movements are separate; no online payment is requested.'
          : booking.amountDueCents != null && booking.amountDueCents! > 0
          ? 'The service is completed, but the records still show an outstanding balance. Contact the shop to check the payment records.'
          : 'The service is completed. Service completion and recorded money movements are separate; review the amounts above.';
  }
  if (booking.isOfflineOrder) {
    return booking.status == 'PENDING'
        ? 'Your booking order has been submitted. The shop will confirm and handle it offline. This order is not a payment receipt.'
        : 'The shop handles this booking order offline. Review the recorded collected and refunded amounts above; no online payment is requested.';
  }
  if (booking.paymentMode == 'PAY_AT_STORE') {
    return booking.status == 'PENDING'
        ? 'Waiting for the shop to accept. Submitting this request does not record a payment.'
        : booking.amountDueCents != null && booking.amountDueCents! > 0
        ? 'The booking is confirmed. Pay the outstanding amount at the store. Only the collected amounts above represent recorded payment.'
        : 'The booking status and money collected are separate. Review the collected, refunded and outstanding amounts above.';
  }
  if (booking.paymentMode == 'ZERO') {
    return 'This reservation was settled with no money collected. There is no cash payment to refund.';
  }
  return 'Only the collected and refunded amounts above represent recorded money movements.';
}

class BookingDetailScreen extends ConsumerStatefulWidget {
  final String bookingId;
  final Booking? initialBooking;
  final VoidCallback? onChanged;
  const BookingDetailScreen({
    super.key,
    required this.bookingId,
    this.initialBooking,
    this.onChanged,
  });
  @override
  ConsumerState<BookingDetailScreen> createState() =>
      _BookingDetailScreenState();
}

class _BookingDetailScreenState extends ConsumerState<BookingDetailScreen> {
  Booking? _booking;
  bool _loading = true;
  String? _error;
  late final String? _openingAccount;
  late final int _openingEpoch;
  int _loadVersion = 0;
  bool _invalidated = false;
  BookingOrderEmail? _email;
  bool _emailLoading = false;
  String? _emailError;
  bool _checkingOriginalChange = false;
  String? _recoveryNotice;
  bool _current() =>
      mounted &&
      !_invalidated &&
      _openingAccount != null &&
      _detailAccount(ref.read(authProvider)) == _openingAccount &&
      ref.read(apiServiceProvider).sessionGeneration == _openingEpoch;
  void _invalidate() {
    if (!mounted || _invalidated) return;
    _loadVersion++;
    setState(() {
      _invalidated = true;
      _booking = null;
      _email = null;
      _emailError = null;
      _emailLoading = false;
      _loading = false;
      _error =
          'The customer session changed. Reopen this booking using the account that owns it.';
    });
  }

  @override
  void initState() {
    super.initState();
    _openingAccount = _detailAccount(ref.read(authProvider));
    _openingEpoch = ref.read(apiServiceProvider).sessionGeneration;
    _booking = widget.initialBooking;
    _load();
  }

  @override
  void didUpdateWidget(covariant BookingDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.bookingId != widget.bookingId) {
      _loadVersion++;
      _booking = null;
      _email = null;
      _emailError = null;
      _emailLoading = false;
      _load();
    }
  }

  Future<void> _load() async {
    if (!_current()) {
      _invalidate();
      return;
    }
    final version = ++_loadVersion;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ref
          .read(apiServiceProvider)
          .getBooking(widget.bookingId);
      if (!_current()) {
        _invalidate();
        return;
      }
      if (version != _loadVersion) return;
      final item = Booking.fromJson(data);
      if (item.userId.isNotEmpty && item.userId != _openingAccount ||
          item.id != widget.bookingId ||
          _booking != null && item.shopId != _booking!.shopId) {
        throw StateError('Invalid booking response');
      }
      if (_current() && version == _loadVersion) {
        setState(() => _booking = item);
        if (item.isOfflineOrder) _loadEmail(version);
      }
    } catch (error) {
      if (!_current()) {
        _invalidate();
        return;
      }
      if (version == _loadVersion) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current() && version == _loadVersion) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _loadEmail(int version) async {
    if (!_current()) return;
    setState(() {
      _emailLoading = true;
      _email = null;
      _emailError = null;
    });
    try {
      final data = await ref
          .read(apiServiceProvider)
          .getBookingOrderEmail(widget.bookingId);
      if (!_current() || version != _loadVersion) return;
      final value = BookingOrderEmail.fromJson(data, widget.bookingId);
      setState(() => _email = value);
    } catch (_) {
      if (_current() && version == _loadVersion) {
        setState(
          () => _emailError =
              'Email status could not be checked. Your saved order is available below.',
        );
      }
    } finally {
      if (_current() && version == _loadVersion) {
        setState(() => _emailLoading = false);
      }
    }
  }

  Future<void> _reschedule(Booking booking) async {
    if (!_current()) {
      _invalidate();
      return;
    }
    if (booking.id != widget.bookingId || !identical(_booking, booking)) return;
    if (ref.read(bookingRescheduleJournalProvider).status(_openingAccount!, booking.id).blocked) return;
    final openingVersion = _loadVersion;
    bool currentBooking() =>
        _current() &&
        openingVersion == _loadVersion &&
        widget.bookingId == booking.id &&
        identical(_booking, booking);
    final result = await showDialog<Object>(
      context: context,
      builder: (_) => _RescheduleDialog(
        booking: booking,
        openingAccount: _openingAccount,
        openingEpoch: _openingEpoch,
        isCurrentBooking: currentBooking,
      ),
    );
    if (!mounted || !currentBooking()) return;
    if (result is Booking) {
      final version = ++_loadVersion;
      setState(() {
        _booking = result;
        _email = null;
        _emailError = null;
        _emailLoading = false;
      });
      if (result.isOfflineOrder) _loadEmail(version);
      widget.onChanged?.call();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            customerText(context, 'Booking time updated.', '预约时间已更新。'),
          ),
        ),
      );
    } else if (result == _RescheduleAction.reload) {
      await _checkOriginalChange();
    }
  }

  Future<void> _checkOriginalChange() async {
    if (!_current() || _checkingOriginalChange) return;
    final journal = ref.read(bookingRescheduleJournalProvider);
    final actor = _openingAccount!;
    final id = widget.bookingId;
    final status = journal.status(actor, id);
    final attempt = status.attempt;
    if (attempt == null) {
      await journal.retryStorage(actor, id);
      return;
    }
    if (!journal.startCheck(attempt)) return;
    final version = _loadVersion;
    bool current() => _current() && widget.bookingId == id && _loadVersion == version;
    setState(() { _checkingOriginalChange = true; _recoveryNotice = null; });
    String? failure;
    try {
      final api = ref.read(apiServiceProvider);
      final receipt = await api.reconcileBookingReschedule(id, attempt.requestKey);
      if (!current()) return;
      final outcome = attempt.outcome(receipt);
      final booking = Booking.fromJson(await api.getBooking(id));
      if (!current()) return;
      if (!attempt.owns(booking)) throw const FormatException('Invalid booking response');
      if (outcome == 'COMMITTED' && !attempt.matches(booking)) {
        failure = 'The original time change was committed, but the current booking differs from its original target or saved details. This booking remains read-only. Review the current order and contact the shop; the original change will not be sent again.';
        setState(() => _booking = booking);
        return;
      }
      if (!await journal.finish(attempt, current) || !current()) return;
      ++_loadVersion;
      setState(() {
        _booking = booking;
        _email = null;
        _emailError = null;
        _recoveryNotice = outcome == 'COMMITTED'
            ? 'The original time change was verified. The current booking is shown below.'
            : 'The original time change was not executed. Its delayed request has been stopped. You may choose a new time.';
      });
      widget.onChanged?.call();
    } catch (error) {
      failure = error is RescheduleJournalException ? error.message
          : 'The original time change could not be verified. This booking remains read-only. Check the original change again; no new time change was sent.';
    } finally {
      journal.endCheck(attempt, error: failure);
      if (_current() && widget.bookingId == id) setState(() => _checkingOriginalChange = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(bookingRescheduleChangesProvider);
    ref.listen<AuthState>(authProvider, (previous, next) {
      if (_detailAccount(next) != _openingAccount ||
          ref.read(apiServiceProvider).sessionGeneration != _openingEpoch) {
        _invalidate();
      }
    });
    final booking = _booking;
    final cancelReason = booking?.cancelReason;
    final change = _openingAccount == null ? null : ref.read(bookingRescheduleJournalProvider).status(_openingAccount, widget.bookingId);
    final originalTarget = change?.attempt;
    return Scaffold(
      backgroundColor: CustomerPalette.background,
      appBar: AppBar(
        title: Text(customerText(context, 'Booking order', '预约订单')),
        actions: [
          IconButton(
            onPressed: _loading || _checkingOriginalChange || !_current() ? null : _load,
            tooltip: customerText(context, 'Reload', '刷新'),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null || booking == null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _error ??
                          customerText(
                            context,
                            'Booking unavailable.',
                            '预约暂不可用。',
                          ),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton(
                      onPressed: _current() ? _load : null,
                      child: Text(customerText(context, 'Retry', '重试')),
                    ),
                  ],
                ),
              ),
            )
          : ResponsiveContent(
              maxWidth: 760,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (change?.blocked == true || _recoveryNotice != null) ...[
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: CustomerPalette.surface,
                        border: Border.all(color: CustomerPalette.border),
                        borderRadius: BorderRadius.circular(14)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(change?.blocked == true
                            ? change?.error ?? 'A time change for this booking is not yet resolved. Reading the current order does not cancel or verify that change. Other changes are paused.'
                            : _recoveryNotice!),
                        if (originalTarget != null) Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text('Original target: ${originalTarget.date} ${originalTarget.startTime} (${originalTarget.timezone}).')),
                        if (change?.blocked == true) TextButton(
                          onPressed: change == null || !change.loaded || change.busy || _checkingOriginalChange ? null : _checkOriginalChange,
                          child: Text(_checkingOriginalChange ? 'Checking original change…'
                              : originalTarget == null ? 'Retry recovery storage' : 'Check original time change')),
                      ]),
                    ),
                  ],
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: CustomerPalette.surface,
                      border: Border.all(color: CustomerPalette.border),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          booking.shop?.name ?? '',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 12),
                        SelectableText(
                          booking.bookingNo,
                          style: const TextStyle(color: CustomerPalette.muted),
                        ),
                        const SizedBox(height: 20),
                        _line(
                          customerText(context, 'Booking status', '预约状态'),
                          booking.statusLabel,
                        ),
                        if (booking.status == 'CANCELLED' &&
                            cancelReason != null &&
                            cancelReason.isNotEmpty)
                          _line(
                            customerText(context, 'Cancellation reason', '取消原因'),
                            cancelReason,
                          ),
                        _line(
                          customerText(context, 'Payment arrangement', '付款安排'),
                          bookingPaymentModeLabel(context, booking),
                        ),
                        _line(
                          customerText(context, 'Date', '预约日期'),
                          booking.formattedDate,
                        ),
                        _line(
                          customerText(context, 'Reservation window', '预约预留时段'),
                          booking.formattedTimeRange,
                        ),
                        if (booking.durationMin > 0)
                          _line(
                            'Reserved appointment block',
                            booking.reservationLabel,
                          ),
                        const Divider(height: 30),
                        Text('Booking contact', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 10),
                        if (booking.contact != null) ...[
                          _line('Contact name', booking.contact!.name),
                          _line('Phone number', booking.contact!.phone),
                          _line('Email at submission', booking.contact!.email),
                          const Text('Recorded when this request was submitted. Later account changes do not change this contact snapshot.',
                            style: TextStyle(color: CustomerPalette.muted, fontSize: 12)),
                        ] else
                          Text(booking.contactRecorded ? 'The recorded contact details could not be verified.' : 'Historical booking has no recorded contact.',
                            style: const TextStyle(color: CustomerPalette.muted)),
                        const Divider(height: 30),
                        _line(
                          customerText(context, 'Total', '应付合计'),
                          booking.formattedTotal,
                        ),
                        if (booking.discountCents > 0 &&
                            booking.currency?.isNotEmpty == true)
                          _line(
                            'Coupon discount included',
                            formatCents(
                              booking.discountCents,
                              booking.currency!,
                            ),
                          ),
                        if (booking.tipCents != null &&
                            booking.tipCents! > 0 &&
                            booking.currency != null)
                          _line(
                            customerText(context, 'Tip included', '其中小费'),
                            formatCents(booking.tipCents!, booking.currency!),
                          ),
                        _line(
                          customerText(context, 'Collected', '已收款'),
                          booking.formattedPaid,
                        ),
                        _line(
                          customerText(context, 'Refunded', '已退款'),
                          booking.formattedRefunded,
                        ),
                        _line(
                          customerText(context, 'Amount due', '待收金额'),
                          booking.formattedDue,
                        ),
                        const SizedBox(height: 14),
                        Text(
                          bookingPaymentGuidance(booking),
                          style: const TextStyle(
                            color: CustomerPalette.muted,
                            height: 1.6,
                          ),
                        ),
                        if (booking.isOfflineOrder) ...[
                          const SizedBox(height: 14),
                          Text(
                            'Order email',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            _emailLoading
                                ? 'Checking email status…'
                                : _email?.message ??
                                      _emailError ??
                                      'Email status has not been checked.',
                          ),
                          TextButton(
                            onPressed: _emailLoading || !_current()
                                ? null
                                : () => _loadEmail(_loadVersion),
                            child: const Text('Refresh email status'),
                          ),
                        ],
                        if (booking.addOns.isNotEmpty) ...[
                          const Divider(height: 30),
                          BookingAddOnSummary(
                            addOns: booking.addOns,
                            saved: true,
                          ),
                        ],
                        Text(
                          booking.reservationKind == 'PLAN'
                              ? 'Therapist requests are saved per service segment.'
                              : 'Therapist request: ${booking.therapistSelection.summary}',
                        ),
                        if (booking.items.isNotEmpty) ...[
                          const Divider(height: 30),
                          Text(
                            customerText(context, 'Reserved services', '已预约项目'),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          for (final item
                              in booking.items.toList()..sort(
                                (a, b) =>
                                    a.participantIndex == b.participantIndex
                                    ? a.sequence.compareTo(b.sequence)
                                    : a.participantIndex.compareTo(
                                        b.participantIndex,
                                      ),
                              ))
                            Padding(
                              padding: const EdgeInsets.only(top: 14),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    customerText(
                                      context,
                                      'Participant ${item.participantIndex} · ${item.sequence}. ${item.serviceName}',
                                      '参与者 ${item.participantIndex} · 第 ${item.sequence} 项 ${item.serviceName}',
                                    ),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  if (item.variantName?.isNotEmpty == true)
                                    Text(item.variantName!),
                                  Text(
                                    _itemTime(booking, item),
                                    style: const TextStyle(
                                      color: CustomerPalette.muted,
                                      fontSize: 13,
                                      height: 1.6,
                                    ),
                                  ),
                                  if (booking.reservationKind == 'PLAN')
                                    Text(
                                      'Therapist request: ${item.therapistSelection.summary}',
                                    ),
                                  if (item.therapistName?.isNotEmpty == true)
                                    Text(
                                      'Assigned therapist: ${item.therapistName!}',
                                    ),
                                  if (item.assignedTherapistIds.isNotEmpty)
                                    Text(
                                      customerText(
                                        context,
                                        'Assigned therapists: ${item.assignedTherapistIds.map((id) => '#$id').join(', ')}',
                                        '已安排技师：${item.assignedTherapistIds.map((id) => '#$id').join('、')}',
                                      ),
                                    ),
                                  Text(
                                    [
                                      if (item.durationMin != null)
                                        item.reservationLabel,
                                      if (item.priceCents != null &&
                                          booking.currency != null)
                                        formatCents(
                                          item.priceCents!,
                                          booking.currency!,
                                        ),
                                    ].join(' · '),
                                    style: const TextStyle(
                                      color: CustomerPalette.muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                        if (booking.canReschedule && change?.blocked != true) ...[
                          const SizedBox(height: 24),
                          OutlinedButton.icon(
                            onPressed: () => _reschedule(booking),
                            icon: const Icon(Icons.edit_calendar_outlined),
                            label: Text(
                              customerText(
                                context,
                                'Change booking time',
                                '更改预约时间',
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextButton(
                    onPressed: () => openCustomerHome(context, initialTab: 1),
                    child: Text(
                      customerText(context, 'View my bookings', '查看我的预约'),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _line(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 112,
          child: Text(
            label,
            style: const TextStyle(color: CustomerPalette.muted),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(child: Text(value)),
      ],
    ),
  );
}

enum _RescheduleAction { reload }

class _RescheduleDialog extends ConsumerStatefulWidget {
  final Booking booking;
  final String openingAccount;
  final int openingEpoch;
  final bool Function() isCurrentBooking;
  const _RescheduleDialog({
    required this.booking,
    required this.openingAccount,
    required this.openingEpoch,
    required this.isCurrentBooking,
  });
  @override
  ConsumerState<_RescheduleDialog> createState() => _RescheduleDialogState();
}

class _RescheduleDialogState extends ConsumerState<_RescheduleDialog> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _date;
  late final TextEditingController _time;
  bool _saving = false;
  bool _outcomeUnknown = false;
  bool _loadingSlots = false;
  int _slotsVersion = 0;
  Timer? _availabilityExpiry;
  SlotResponse? _availability;
  String? _loadedDate;
  String? _error;
  bool _invalidated = false;
  bool _current() =>
      mounted &&
      !_invalidated &&
      _detailAccount(ref.read(authProvider)) == widget.openingAccount &&
      ref.read(apiServiceProvider).sessionGeneration == widget.openingEpoch &&
      widget.isCurrentBooking();
  void _invalidate() {
    if (!mounted || _invalidated) return;
    _slotsVersion++;
    _availabilityExpiry?.cancel();
    setState(() {
      _invalidated = true;
      _availability = null;
      _loadedDate = null;
      _loadingSlots = false;
      _saving = false;
    });
  }

  @override
  void initState() {
    super.initState();
    _date = TextEditingController(
      text: widget.booking.localDate ?? widget.booking.formattedDate,
    );
    _time = TextEditingController();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _loadSlots();
    });
  }

  @override
  void dispose() {
    _availabilityExpiry?.cancel();
    _date.dispose();
    _time.dispose();
    super.dispose();
  }

  Future<void> _save({
    required int version,
    required SlotResponse? availability,
    required String date,
    required String time,
  }) async {
    if (!_current()) {
      _invalidate();
      return;
    }
    if (_saving ||
        _outcomeUnknown ||
        ref.read(bookingRescheduleJournalProvider).status(widget.openingAccount, widget.booking.id).blocked ||
        version != _slotsVersion ||
        !identical(availability, _availability) ||
        date != _date.text.trim() ||
        time != _time.text.trim() ||
        !_form.currentState!.validate() ||
        !_hasAvailableTime) {
      return;
    }
    _availabilityExpiry?.cancel();
    final timezone = _availability!.bookingCalendar!.timezone;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final journal = ref.read(bookingRescheduleJournalProvider);
      final attempt = await journal.begin(actor: widget.openingAccount,
        booking: widget.booking, date: date, startTime: time, timezone: timezone);
      if (!_current()) { _invalidate(); return; }
      final data = await ref
          .read(apiServiceProvider)
          .rescheduleBooking(widget.booking.id, date: attempt.date,
            startTime: attempt.startTime, requestKey: attempt.requestKey);
      if (!_current()) {
        _invalidate();
        return;
      }
      final result = Booking.fromJson(data);
      if (result.userId.isNotEmpty && result.userId != widget.openingAccount ||
          result.id != widget.booking.id ||
          result.shopId != widget.booking.shopId ||
          result.localDate != date ||
          result.localStartTime != time ||
          result.timezone != timezone ||
          result.priceCents != widget.booking.priceCents ||
          result.totalCents != widget.booking.totalCents ||
          result.discountCents != widget.booking.discountCents ||
          result.platformFeeCents != widget.booking.platformFeeCents ||
          result.tipCents != widget.booking.tipCents ||
          result.currency != widget.booking.currency ||
          !result.therapistSelection.sameRequestAs(
            widget.booking.therapistSelection,
          ) ||
          widget.booking.reservationKind == 'PLAN' &&
              (result.items.length != widget.booking.items.length ||
                  widget.booking.items.any(
                    (before) => !result.items.any(
                      (after) =>
                          after.id == before.id &&
                          after.therapistSelection.sameRequestAs(
                            before.therapistSelection,
                          ),
                    ),
                  ))) {
        throw StateError('Invalid booking response');
      }
      if (!attempt.matches(result)) throw StateError('Invalid original booking response');
      if (!await journal.finish(attempt, _current) || !_current()) return;
      if (mounted && _current()) Navigator.pop(context, result);
    } catch (error) {
      if (!_current()) {
        _invalidate();
        return;
      }
      final status = error is DioException ? error.response?.statusCode : null;
      final rejected =
          status != null && status >= 400 && status < 500 && status != 408;
      if (rejected) {
        _slotsVersion++;
        setState(() {
          _availability = null;
          _loadedDate = null;
          _time.clear();
          _error =
              '${businessError(error)}\nPrevious availability was cleared. Check available times again before saving.';
        });
      }
      // Even a later rejection cannot establish that an earlier dispatched
      // request has stopped. Only keyed reconciliation may release its journal.
      setState(() {
        _outcomeUnknown = true;
        _error = error is RescheduleJournalException ? error.message
            : 'The change could not be verified. Check the original time change before requesting another change.';
      });
    } finally {
      if (_current()) setState(() => _saving = false);
    }
  }

  bool get _hasAvailableTime =>
      !_outcomeUnknown &&
      !_loadingSlots &&
      (_availability?.bookingCalendar?.isCurrent ?? false) &&
      _loadedDate == _date.text.trim() &&
      (_availability?.slots.any(
            (slot) => slot.time == _time.text && slot.available,
          ) ??
          false);

  void _expireAvailability(int version) {
    if (!_current() || version != _slotsVersion || _saving || _outcomeUnknown) {
      return;
    }
    _availabilityExpiry?.cancel();
    _slotsVersion++;
    setState(() {
      _availability = null;
      _loadedDate = null;
      _time.clear();
      _loadingSlots = false;
      _error = 'Available times have expired. Check available times again.';
    });
  }

  Future<void> _loadSlots() async {
    if (!_current()) {
      _invalidate();
      return;
    }
    if (_saving || _outcomeUnknown || !_form.currentState!.validate()) return;
    final date = _date.text.trim();
    final version = ++_slotsVersion;
    _availabilityExpiry?.cancel();
    setState(() {
      _loadingSlots = true;
      _availability = null;
      _loadedDate = null;
      _time.text = '';
      _error = null;
    });
    try {
      final data = await ref
          .read(apiServiceProvider)
          .getRescheduleSlots(widget.booking.id, date: date);
      final availability = SlotResponse.fromJson(data);
      if (!_current()) {
        _invalidate();
        return;
      }
      if (version != _slotsVersion) return;
      if (availability.date != date) {
        throw const FormatException('Invalid availability response');
      }
      final calendar = availability.bookingCalendar;
      if (calendar == null || !calendar.isCurrent) {
        setState(
          () => _error =
              'Available times could not be verified. Check available times again.',
        );
        return;
      }
      setState(() {
        _availability = availability;
        _loadedDate = date;
      });
      _availabilityExpiry = Timer(
        calendar.remaining,
        () => _expireAvailability(version),
      );
    } catch (error) {
      if (!_current()) {
        _invalidate();
        return;
      }
      if (version == _slotsVersion) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current() && version == _slotsVersion) {
        setState(() => _loadingSlots = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authProvider, (previous, next) {
      if (_detailAccount(next) != widget.openingAccount ||
          ref.read(apiServiceProvider).sessionGeneration != widget.openingEpoch) {
        _invalidate();
      }
    });
    if (_invalidated) {
      return AlertDialog(
        title: Text(
          _detailAccount(ref.read(authProvider)) == widget.openingAccount &&
                  ref.read(apiServiceProvider).sessionGeneration ==
                      widget.openingEpoch
              ? 'Booking changed'
              : 'Customer session changed',
        ),
        content: Text(
          _detailAccount(ref.read(authProvider)) == widget.openingAccount &&
                  ref.read(apiServiceProvider).sessionGeneration ==
                      widget.openingEpoch
              ? 'Close this dialog and reopen the current booking.'
              : 'Reopen this booking using the account that owns it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      );
    }
    final availability = _availability;
    final version = _slotsVersion;
    final date = _date.text.trim();
    final time = _time.text.trim();
    final outcomeUnknown = _outcomeUnknown;
    return PopScope(
      canPop: !_saving && !_outcomeUnknown,
      child: AlertDialog(
        title: Text(customerText(context, 'Change booking time', '更改预约时间')),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Form(
              key: _form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    customerText(
                      context,
                      'Choose a date, then check available arrival times for the booked itinerary. Saved service, price, and tip snapshots remain unchanged. Availability is checked again when saving.',
                      '输入门店当地日期，查询已成交行程的可约开始时间。改期保留原项目、价格和小费快照，保存时会再次校验资源。',
                    ),
                    style: const TextStyle(
                      color: CustomerPalette.muted,
                      height: 1.6,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      widget.booking.reservationKind == 'PLAN'
                          ? 'Each segment keeps its saved therapist request. Automatically assigned or unrecorded segments may have different therapists after rescheduling. Check the updated assignments after saving.'
                          : widget.booking.therapistSelection.rescheduleNotice,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _availability == null
                          ? 'Available times use the shop time zone, which is checked with availability.'
                          : 'Available times are in ${_availability!.bookingCalendar!.timezone} (shop time).',
                    ),
                  ),
                  if (_availability != null &&
                      widget.booking.timezone != null &&
                      widget.booking.timezone !=
                          _availability!.bookingCalendar!.timezone)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(
                        'The shop time zone has been updated since this order was placed. Your new arrival time will use the shop time zone shown above.',
                      ),
                    ),
                  const SizedBox(height: 20),
                  TextFormField(
                    controller: _date,
                    enabled: !_saving && !_outcomeUnknown,
                    onChanged: (value) {
                      if (!_current() ||
                          _saving ||
                          _outcomeUnknown ||
                          version != _slotsVersion ||
                          time != _time.text.trim() ||
                          value != _date.text) {
                        return;
                      }
                      _slotsVersion++;
                      _availabilityExpiry?.cancel();
                      setState(() {
                        _availability = null;
                        _loadedDate = null;
                        _time.text = '';
                        _loadingSlots = false;
                      });
                    },
                    decoration: InputDecoration(
                      labelText: customerText(
                        context,
                        'Date (YYYY-MM-DD)',
                        '日期（YYYY-MM-DD）',
                      ),
                    ),
                    validator: (value) {
                      final text = value?.trim() ?? '';
                      final parsed = DateTime.tryParse(text);
                      if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text) ||
                          parsed == null ||
                          '${parsed.year.toString().padLeft(4, '0')}-${parsed.month.toString().padLeft(2, '0')}-${parsed.day.toString().padLeft(2, '0')}' !=
                              text) {
                        return customerText(
                          context,
                          'Enter a valid date.',
                          '请输入有效日期。',
                        );
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: _saving || _outcomeUnknown || _loadingSlots
                        ? null
                        : _loadSlots,
                    icon: const Icon(Icons.search),
                    label: Text(
                      customerText(context, 'Check available times', '查询可约时段'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_loadingSlots)
                    const Center(child: CircularProgressIndicator()),
                  if (_availability != null) ...[
                    if (!_availability!.slots.any((slot) => slot.available))
                      Text(
                        customerText(
                          context,
                          'No arrival times fit the booked itinerary on this date.',
                          '该日期没有能容纳原预约行程的时段。',
                        ),
                      ),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _availability!.slots
                          .map(
                            (slot) => ChoiceChip(
                              label: Text(slot.time),
                              selected: _time.text == slot.time,
                              onSelected:
                                  _saving ||
                                      _outcomeUnknown ||
                                      !slot.available ||
                                      !(_availability
                                              ?.bookingCalendar
                                              ?.isCurrent ??
                                          false)
                                  ? null
                                  : (_) {
                                      if (!_current() ||
                                          _saving ||
                                          _outcomeUnknown ||
                                          version != _slotsVersion ||
                                          !identical(
                                            availability,
                                            _availability,
                                          ) ||
                                          date != _date.text.trim() ||
                                          time != _time.text.trim()) {
                                        return;
                                      }
                                      if (!(_availability
                                              ?.bookingCalendar
                                              ?.isCurrent ??
                                          false)) {
                                        _expireAvailability(_slotsVersion);
                                        return;
                                      }
                                      setState(() => _time.text = slot.time);
                                    },
                            ),
                          )
                          .toList(),
                    ),
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving
                ? null
                : () {
                    if (!_current() ||
                        _saving ||
                        outcomeUnknown != _outcomeUnknown) {
                      return;
                    }
                    Navigator.pop(
                      context,
                      outcomeUnknown ? _RescheduleAction.reload : null,
                    );
                  },
            child: Text(
              _outcomeUnknown
                  ? 'Check original time change'
                  : customerText(context, 'Cancel', '取消'),
            ),
          ),
          if (!_outcomeUnknown)
            FilledButton(
              onPressed: _saving || !_hasAvailableTime
                  ? null
                  : () => _save(
                      version: version,
                      availability: availability,
                      date: date,
                      time: time,
                    ),
              child: Text(
                customerText(
                  context,
                  _saving ? 'Saving…' : 'Save time',
                  _saving ? '保存中…' : '保存时间',
                ),
              ),
            ),
        ],
      ),
    );
  }
}
