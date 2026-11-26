import '../l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking.dart';
import '../models/booking_plan.dart';
import '../models/booking_add_on.dart';
import '../models/booking_order_policy.dart';
import '../models/coupon.dart';
import '../models/money.dart';
import '../models/shop.dart';
import '../models/service_duration.dart';
import '../providers/booking_plan_provider.dart';
import '../providers/auth_provider.dart';
import '../providers/coupon_provider.dart';
import '../services/api_service.dart';
import '../services/business_workflow_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/responsive_content.dart';
import '../widgets/customer_access.dart';
import '../widgets/booking_add_ons.dart';
import '../widgets/booking_order_notice.dart';
import '../widgets/booking_contact_fields.dart';
import '../widgets/booking_calendar_picker.dart';
import 'booking_detail_screen.dart';
import 'payment_screen.dart';
import 'booking_list_screen.dart';

/// Parallel participants, with an ordered itinerary for each participant.
/// The server chooses offsets, resource assignments, prices, and final fees.
class BookingPlanScreen extends ConsumerStatefulWidget {
  final ShopDetail shop;
  const BookingPlanScreen({super.key, required this.shop});
  @override
  ConsumerState<BookingPlanScreen> createState() => _BookingPlanScreenState();
}

class _BookingPlanScreenState extends ConsumerState<BookingPlanScreen> {
  int _step = 0;
  final _tip = TextEditingController();
  final _notes = TextEditingController();
  bool _checkingCoupon = false;
  final _contactFields = GlobalKey<BookingContactFieldsState>();
  bool _confirming = false;
  bool _reviewing = false;
  BookingPlanNotifier get _flow =>
      ref.read(bookingPlanProvider(widget.shop).notifier);
  ShopDetail get _shop => ref.read(bookingPlanProvider(widget.shop)).shop;
  String _t(String en, String zh) => customerText(context, en, zh);
  @override
  void dispose() {
    _tip.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _checkRecoveryBookings() async {
    if (await requireCustomerSignIn(context, ref) && mounted) await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => BookingHistoryScreen(recoveryShopId: _shop.id)));
  }
  Future<void> _retryOriginalBooking() async {
    if (!await requireCustomerSignIn(context, ref) || !mounted) return;
    final booking = await _flow.retryOriginalRequest();
    if (booking != null && mounted) {
      ref.invalidate(bookingPageProvider);
      Navigator.push(context, MaterialPageRoute<void>(builder: (_) => booking.canOpenCheckout
        ? PaymentScreen(booking: booking, shop: _shop) : BookingDetailScreen(bookingId: booking.id, initialBooking: booking)));
    }
  }
  Widget _recovery(BookingPlanState state) => BookingRecoveryPanel(attempt: state.pendingAttempt, reminder: state.recoveryReminder,
    busy: state.submitting, error: state.pendingAttempt != null ? state.error : null,
    onCheck: () { _checkRecoveryBookings(); }, onRetry: () { _retryOriginalBooking(); }, onAbandon: () => _flow.abandonRecovery(acknowledged: true));

  void _openCompletedBooking(Booking booking) {
    ref.invalidate(bookingPageProvider);
    Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => booking.canOpenCheckout
            ? PaymentScreen(booking: booking, shop: _shop)
            : BookingDetailScreen(
                bookingId: booking.id,
                initialBooking: booking,
              ),
      ),
    );
  }

  void _startAnotherBooking() {
    _flow.startAnotherBooking();
    _tip.clear();
    _notes.clear();
    setState(() => _step = 0);
  }

  bool _canContinue(BookingPlanState state) => state.pendingAttempt != null || state.recoveryReminder ? false : switch (_step) {
    0 || 1 => state.validPlan,
    2 => !state.loading && state.quote != null && state.startTime != null,
    _ => state.canConfirm,
  };

  bool _canReview(BookingPlanState state) =>
      state.requiresServerQuote && !state.loading && !state.submitting &&
      !state.loadingPriceQuote && !_reviewing &&
      state.pendingAttempt == null && !state.recoveryReminder &&
      state.tipCents != null && state.notes.length <= 500 &&
      state.quote!.slots.any((slot) => slot.time == state.startTime && slot.available);

  Future<void> _reviewTotal() async {
    if (!_canReview(ref.read(bookingPlanProvider(widget.shop)))) return;
    setState(() => _reviewing = true);
    try {
      if (await requireCustomerSignIn(context, ref) && mounted) {
        await _flow.refreshPriceQuote();
      }
    } finally {
      if (mounted) setState(() => _reviewing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingPlanProvider(widget.shop));
    final completedBooking = _flow.completedBooking;
    final needsQuote = completedBooking == null && _step == 3 && state.requiresServerQuote && !state.hasValidPriceQuote;
    final reviewing = _reviewing || state.loadingPriceQuote;
    final reviewLabel = bookingTotalReviewLabel(context, ref.watch(authProvider));
    ref.listen(bookingPlanProvider(widget.shop).select((value) => value.shop), (previous, next) {
      if (previous != next && !ref.read(bookingPlanProvider(widget.shop)).validPlan && _step > 0) {
        setState(() => _step = 0);
      }
    });
    final labels = [
      _t('People & services', '参与者与项目'),
      _t('Therapist preferences', '技师偏好'),
      _t('Arrival time', '统一到店时间'),
      'Contact & confirm',
    ];
    return PopScope(
      canPop: !state.submitting && state.pendingAttempt == null,
      child: Scaffold(
        backgroundColor: CustomerPalette.background,
        appBar: AppBar(
          title: Text(_t('Plan your visit', '多人 / 连续项目预约')),
          actions: [
            if (completedBooking != null)
              TextButton.icon(
                onPressed: state.submitting || state.pendingAttempt != null
                    ? null
                    : _startAnotherBooking,
                icon: const Icon(Icons.restart_alt, size: 18),
                label: Text(_t('Start another booking', '重新开始预约')),
              ),
          ],
        ),
        body: ResponsiveContent(
          maxWidth: 1000,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  state.shop.name,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                if (completedBooking == null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _t(
                      'Everyone arrives together. Each person’s services run in order; participants run in parallel. Couple packages remain in the regular booking flow.',
                      '所有参与者同时开始，各人的项目按顺序进行，不同参与者并行。双人同款套餐请使用普通预约。',
                    ),
                    style: const TextStyle(
                      color: CustomerPalette.muted,
                      height: 1.6,
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                if (completedBooking == null) ...[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var i = 0; i < labels.length; i++)
                        Chip(
                          label: Text('${i + 1}. ${labels[i]}'),
                          backgroundColor: i == _step
                              ? CustomerPalette.tint
                              : CustomerPalette.surface,
                          side: BorderSide(
                            color: i == _step
                                ? CustomerPalette.brand
                                : CustomerPalette.border,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  _recovery(state),
                ],
                if (completedBooking != null)
                  _submittedBookingPanel(completedBooking)
                else if (state.error != null && state.pendingAttempt == null)
                  _panel(
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          state.error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                        if (_step == 2)
                          TextButton(
                            onPressed: state.loading || state.submitting ? null : _flow.loadSlots,
                            child: Text(_t('Retry availability', '重试查询')),
                          ),
                      ],
                    ),
                  ),
                if (completedBooking != null) const SizedBox.shrink()
                else if (state.pendingAttempt != null || state.recoveryReminder) const SizedBox.shrink()
                else if (!state.shop.onlineBookingEnabled)
                  _panel(
                    Text(
                      _t(
                        'Online bookings are disabled for this shop.',
                        '此门店尚未开放线上预约。',
                      ),
                    ),
                  )
                else
                  switch (_step) {
                    0 => _people(state),
                    1 => _therapists(state),
                    2 => _time(state),
                    _ => _review(state, reviewLabel),
                  },
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          minimum: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Container(
            decoration: const BoxDecoration(
              color: CustomerPalette.surface,
              border: Border(top: BorderSide(color: CustomerPalette.border)),
            ),
            padding: const EdgeInsets.all(16),
            child: ResponsiveContent(
              maxWidth: 1000,
              child: Row(
                children: [
                  if (_step > 0 && completedBooking == null) ...[
                    TextButton(
                      key: const ValueKey('booking-plan-previous-action'),
                      onPressed: state.submitting || state.pendingAttempt != null
                          ? null
                          : () => setState(() => _step--),
                      child: Text(_t('Back', '上一步')),
                    ),
                    const SizedBox(width: 12),
                  ],
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey('booking-plan-primary-action'),
                      onPressed: (completedBooking == null && !_canContinue(state) && !(needsQuote && _canReview(state))) || state.submitting || reviewing
                          ? null
                          : () => completedBooking != null
                                ? _openCompletedBooking(completedBooking)
                                : _step < 3
                                ? setState(() => _step++)
                                : needsQuote ? _reviewTotal() : _confirm(state),
                      child: Text(
                        state.submitting
                            ? _t('Creating…', '提交中…')
                            : completedBooking != null
                            ? _t('View submitted booking', '查看已提交预约')
                            : _step == 3
                                ? reviewing
                                ? _t('Checking current total…', '正在核对总价…')
                                : needsQuote
                                ? reviewLabel
                                : _t('Submit booking request', '提交预约申请')
                            : _t('Continue', '下一步'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _panel(Widget child) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: CustomerPalette.surface,
      border: Border.all(color: CustomerPalette.border),
      borderRadius: BorderRadius.circular(14),
    ),
    child: child,
  );

  Widget _submittedBookingPanel(Booking booking) {
    final orderNumber = booking.bookingNo.trim().isEmpty ? booking.id : booking.bookingNo;
    final appointment = [
      booking.localDate ?? booking.bookingDate,
      booking.localStartTime ?? booking.startTime,
    ].where((value) => value.isNotEmpty).join(' · ');

    return _panel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _t('Request submitted', '预约已提交'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text("${_t('Order', '订单')} $orderNumber"),
          if (appointment.isNotEmpty)
            Text(
              appointment,
              style: const TextStyle(color: CustomerPalette.muted),
            ),
        ],
      ),
    );
  }

  Widget _people(BookingPlanState state) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (state.services.isEmpty)
        _panel(
          Text(
            _t(
              'No individual services are available for a combined visit.',
              '此门店暂无可用于组合预约的单人服务。',
            ),
          ),
        ),
      for (var p = 0; p < state.participants.length; p++)
        _panel(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _t('Participant ${p + 1}', '参与者 ${p + 1}'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (state.participants.length > 1)
                    IconButton(
                      tooltip: _t('Remove participant', '移除参与者'),
                      onPressed: () => _flow.removeParticipant(p),
                      icon: const Icon(Icons.person_remove_outlined),
                    ),
                ],
              ),
              for (var s = 0; s < state.participants[p].length; s++)
                _stage(state, p, s),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed:
                      state.itemCount >= 12 || state.participants[p].length >= 4
                      ? null
                      : () => _flow.addStage(p),
                  icon: const Icon(Icons.add),
                  label: Text(_t('Add next service', '添加下一项服务')),
                ),
              ),
            ],
          ),
        ),
      OutlinedButton.icon(
        onPressed: state.participants.length >= 6 || state.itemCount >= 12
            ? null
            : _flow.addParticipant,
        icon: const Icon(Icons.person_add_alt),
        label: Text(_t('Add participant', '添加参与者')),
      ),
      const SizedBox(height: 10),
      Text(
        _t(
          'Up to 6 participants, 4 services per person, and 12 services in total. The complete visit may span up to 8 hours.',
          '最多 6 位参与者，每人最多 4 项，总计最多 12 项；完整行程跨度不超过 8 小时。',
        ),
        style: const TextStyle(
          color: CustomerPalette.muted,
          fontSize: 12,
          height: 1.6,
        ),
      ),
    ],
  );

  Widget _stage(BookingPlanState state, int person, int stage) {
    final item = state.participants[person][stage];
    final service = state.serviceFor(item);
    return Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: CustomerPalette.background,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 2,
            children: [
              Text(
                _t('Service ${stage + 1}', '第 ${stage + 1} 项'),
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              IconButton(
                tooltip: _t('Move earlier', '向前移动'),
                onPressed: stage == 0
                    ? null
                    : () => _flow.moveStage(person, stage, -1),
                icon: const Icon(Icons.arrow_upward, size: 18),
              ),
              IconButton(
                tooltip: _t('Move later', '向后移动'),
                onPressed: stage == state.participants[person].length - 1
                    ? null
                    : () => _flow.moveStage(person, stage, 1),
                icon: const Icon(Icons.arrow_downward, size: 18),
              ),
              if (state.participants[person].length > 1)
                IconButton(
                  tooltip: _t('Remove service', '移除此项目'),
                  onPressed: () => _flow.removeStage(person, stage),
                  icon: const Icon(Icons.close, size: 18),
                ),
            ],
          ),
          DropdownButtonFormField<String>(
            key: ValueKey('service:$person:$stage:${item.serviceId}'),
            initialValue: service?.id,
            isExpanded: true,
            decoration: InputDecoration(labelText: _t('Service', '服务项目')),
            items: state.services
                .map(
                  (row) => DropdownMenuItem(
                    value: row.id,
                    child: Text(row.name, overflow: TextOverflow.ellipsis),
                  ),
                )
                .toList(),
            onChanged: (value) => _flow.selectService(person, stage, value),
          ),
          if (service != null && service.hasVariants) ...[
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              key: ValueKey(
                'variant:$person:$stage:${item.serviceId}:${item.variantId}',
              ),
              initialValue: item.variantId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: _t('Specification (required)', '服务规格（必选）'),
              ),
              items: service.activeVariants
                  .map(
                    (row) => DropdownMenuItem(
                      value: row.id,
                      child: Text(
                        '${row.name} · ${service.reservationLabel(row.durationMin)} · ${row.formattedPrice}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (value) => _flow.selectVariant(person, stage, value),
            ),
          ] else if (service != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                '${service.reservationLabel(service.durationMin)} · ${service.formattedPrice}',
                style: const TextStyle(color: CustomerPalette.muted),
              ),
            ),
          if (service != null && (!service.hasVariants || item.variantId != null)) BookingAddOnPicker(
            available: service.addOns, selected: item.addOnIds, guest: person + 1, segment: stage + 1, disabled: state.submitting,
            onChanged: (id, checked) => _flow.toggleAddOn(person, stage, id, checked)),
        ],
      ),
    );
  }

  Widget _therapists(BookingPlanState state) => Column(
    children: [
      _panel(
        Text(
          _t(
            'Preferences apply to each service. Availability still requires a qualified therapist, shift, room, and preparation time for the entire itinerary.',
            '每项可单独指定偏好技师；系统仍会校验完整行程的技师资格、班次、房间及准备时间。',
          ),
          style: const TextStyle(height: 1.6, color: CustomerPalette.muted),
        ),
      ),
      for (var p = 0; p < state.participants.length; p++)
        _panel(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _t('Participant ${p + 1}', '参与者 ${p + 1}'),
                style: Theme.of(context).textTheme.titleMedium,
              ),
              for (var s = 0; s < state.participants[p].length; s++)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: DropdownButtonFormField<String>(
                    key: ValueKey(
                      'therapist:$p:$s:${state.participants[p][s].therapistId}',
                    ),
                    initialValue: state.participants[p][s].therapistId ?? '',
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText:
                          '${s + 1}. ${state.serviceFor(state.participants[p][s])?.name ?? '—'}',
                    ),
                    items: [
                      DropdownMenuItem(
                        value: '',
                        child: Text(_t('Assign automatically', '自动分配')),
                      ),
                      ...state
                          .therapistsFor(state.participants[p][s])
                          .map(
                            (person) => DropdownMenuItem(
                              value: person.id,
                              child: Text(
                                person.name,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                    ],
                    onChanged: (value) =>
                        _flow.selectTherapist(p, s, value == '' ? null : value),
                  ),
                ),
            ],
          ),
        ),
    ],
  );

  Widget _time(BookingPlanState state) => _panel(
    Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _t('One arrival time for all participants', '为所有参与者选择统一开始时间'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        if (state.shop.timezone != null)
          Text(
            state.shop.timezone!,
            style: const TextStyle(color: CustomerPalette.muted),
          ),
        const SizedBox(height: 12),
        BookingCalendarPicker(shop:state.shop,selectedDate:state.date,compact:true,
          disabled:state.submitting||state.pendingAttempt!=null,
          onSelected:(date)=>_flow.selectDate(date.toIso8601String().substring(0,10)),
          onCalendar:_flow.adoptCalendar,
          onShopRefreshed:_flow.refreshShopDetails,
          onInvalidated:_flow.invalidateCalendarSelection),
        const SizedBox(height: 16),
        if (state.loading)
          const Center(child: CircularProgressIndicator())
        else if (state.quote != null) ...[
          Text(
            _t(
              '${reservedDurationLabel(state.quote!.durationKind, state.quote!.durationMin, span: true)} · ${state.quote!.timezone}',
              '行程跨度：${state.quote!.durationMin} 分钟 · ${state.quote!.timezone}',
            ),
            style: const TextStyle(color: CustomerPalette.muted),
          ),
          const SizedBox(height: 16),
          if (!state.quote!.slots.any((slot) => slot.available))
            Text(
              _t(
                'No start times fit the whole plan. Try another date or adjust the services or preferences.',
                '当日暂无能容纳完整组合的时段。请更换日期，或调整项目与技师偏好。',
              ),
            ),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: state.quote!.slots
                .map(
                  (slot) => ChoiceChip(
                    label: Text(slot.time),
                    selected: state.startTime == slot.time,
                    onSelected: slot.available
                        ? (_) {
                            if (!identical(
                              ref.read(bookingPlanProvider(widget.shop)).quote,
                              state.quote,
                            )) {
                              return;
                            }
                            _flow.selectTime(slot.time);
                          }
                        : null,
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: state.submitting ? null : _flow.loadSlots,
              icon: const Icon(Icons.refresh),
              label: Text(_t('Refresh availability', '刷新可约时段')),
            ),
          ),
        ] else
          Text(
            _t(
              'Select a date to check the complete plan.',
              '选择日期后查询完整组合的可约时段。',
            ),
            style: const TextStyle(color: CustomerPalette.muted),
          ),
      ],
    ),
  );

  Widget _review(BookingPlanState state, String reviewLabel) {
    final quote = state.quote;
    if (quote == null || state.startTime == null) {
      return _panel(
        Text(
          _t('Please select an available arrival time again.', '请重新选择可约的开始时间。'),
        ),
      );
    }
    final reviewedQuote = state.hasValidPriceQuote ? state.priceQuote : null;
    final currency = reviewedQuote?.currency ?? quote.currency;
    final price = reviewedQuote?.totalCents ?? quote.priceCents;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _panel(BookingContactFields(key: _contactFields, contact: state.contact,
          locked: state.submitting || state.pendingAttempt != null || state.recoveryReminder,
          onChanged: _flow.updateContact)),
        _panel(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Reservation window: ${state.date} · ${state.startTime} – ${planClockTime(state.startTime!, quote.durationMin)}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(
                quote.timezone,
                style: const TextStyle(color: CustomerPalette.muted),
              ),
              for (var p = 1; p <= state.participants.length; p++) ...[
                const Divider(height: 28),
                Text(
                  _t('Participant $p', '参与者 $p'),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                for (final row
                    in quote.items
                        .where((item) => item.participantIndex == p)
                        .toList()
                      ..sort((a, b) => a.sequence.compareTo(b.sequence)))
                  Padding(
                    padding: const EdgeInsets.only(top: 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${row.sequence}. ${row.serviceName}${row.variantName == null ? '' : ' · ${row.variantName}'}',
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${row.reservationLabel} · ${planClockTime(state.startTime!, row.offsetMin)} – ${planClockTime(state.startTime!, row.offsetMin + row.durationMin)} · ${formatCents(row.priceCents, row.currency)}',
                          style: const TextStyle(
                            color: CustomerPalette.muted,
                            height: 1.6,
                          ),
                        ),
                        if (row.preparationMin > 0)
                          Text(
                            _t(
                              'Preparation: ${row.preparationMin} min',
                              '准备时间：${row.preparationMin} 分钟',
                            ),
                            style: const TextStyle(
                              fontSize: 12,
                              color: CustomerPalette.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ],
          ),
        ),
        _panel(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                reviewedQuote == null
                    ? AppLocalizations.of(context)!.estimatedServicePrice
                    : _t('Reviewed total', '已核对总价'),
                style: const TextStyle(color: CustomerPalette.muted),
              ),
              const SizedBox(height: 6),
              Text(
                currency == null ? '—' : formatCents(price, currency),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              if (state.shop.orderOnly) ...[
                const SizedBox(height: 12),
                Text(
                  AppLocalizations.of(context)!.reviewTotalBeforeConfirming,
                  style: const TextStyle(
                    color: CustomerPalette.muted,
                    height: 1.6,
                  ),
                ),
              ],
              const SizedBox(height: 18),
              OutlinedButton.icon(
                onPressed: state.submitting || _checkingCoupon
                    ? null
                    : () => _chooseCoupon(state),
                icon: const Icon(Icons.local_offer_outlined),
                label: Text(
                  _checkingCoupon
                      ? _t('Checking…', '校验中…')
                      : state.coupon?.coupon.title ??
                            _t('Choose coupon', '选择优惠券'),
                ),
              ),
              if (state.coupon != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: state.submitting
                        ? null
                        : () => _flow.selectCoupon(null),
                    child: Text(_t('Remove coupon', '移除优惠券')),
                  ),
                ),
              const SizedBox(height: 18),
              if (!state.shop.orderOnly) TextField(
                controller: _tip,
                enabled: !state.submitting,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(
                  labelText: _t(
                    'Optional tip (${currency?.toUpperCase() ?? '—'})',
                    '小费（可选，${currency?.toUpperCase() ?? '—'}）',
                  ),
                  helperText: _t(
                    'Up to two decimal places; no tip is added automatically.',
                    '最多两位小数，不会自动添加小费。',
                  ),
                  errorText: state.tipCents == null
                      ? _t(
                          'Enter an amount from 0 to 99999.99.',
                          '请输入 0 至 99999.99 的金额。',
                        )
                      : null,
                ),
                onChanged: (value) => _flow.setTipCents(parseTipCents(value)),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: _notes,
                enabled: !state.submitting,
                minLines: 2,
                maxLines: 4,
                maxLength: 500,
                decoration: InputDecoration(
                  labelText: _t('Notes (optional)', '备注（可选）'),
                ),
                onChanged: _flow.setNotes,
              ),
              if (!state.shop.orderOnly && state.shop.payAtStoreEnabled) ...[
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  key: ValueKey('plan-payment:${state.paymentMode}'),
                  initialValue: state.paymentMode,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: _t('Payment arrangement', '付款方式'),
                  ),
                  items: [
                    DropdownMenuItem(
                      value: 'ONLINE',
                      child: Text(_t('Online payment', '在线付款')),
                    ),
                    DropdownMenuItem(
                      value: 'PAY_AT_STORE',
                      child: Text(_t('Pay at the store', '到店付款')),
                    ),
                  ],
                  onChanged: state.submitting
                      ? null
                      : (value) {
                          if (value != null) _flow.setPaymentMode(value);
                        },
                ),
              ],
              const SizedBox(height: 16),
              if (state.shop.orderOnly) BookingOrderNotice(busy: state.submitting)
              else Text(
                state.paymentMode == 'PAY_AT_STORE'
                    ? _t(
                        'The shop must accept the booking. No online payment is requested; the amount remains due at the store.',
                        '预约须由门店接受，不会发起线上付款；费用仍需到店支付。',
                      )
                    : _t(
                        'An online booking is held briefly while you complete payment. A zero-total booking does not open checkout.',
                        '线上付款预约仅短时保留资源，请及时付款；零金额预约不会进入收银台。',
                      ),
                style: const TextStyle(
                  fontSize: 12,
                  color: CustomerPalette.muted,
                  height: 1.6,
                ),
              ),
            ],
          ),
        ),
        if (state.requiresServerQuote) BookingPriceQuotePanel(orderOnly: state.shop.orderOnly, quote: state.hasValidPriceQuote ? state.priceQuote : null, loading: _reviewing || state.loadingPriceQuote || state.submitting,
          reviewLabel: reviewLabel,
          onRefresh: _reviewTotal),
      ],
    );
  }

  Future<void> _chooseCoupon(BookingPlanState selection) async {
    final quote = selection.quote;
    if (_checkingCoupon || quote == null || !selection.validPlan ||
        selection.startTime == null || selection.submitting ||
        selection.pendingAttempt != null || selection.recoveryReminder) {
      return;
    }
    final openingShop = widget.shop;
    final request = bookingQuoteFingerprint(selection.pricingRequest);
    final api = ref.read(apiServiceProvider);
    String? customerId;
    int? session;
    bool currentSelection() {
      if (!mounted || !identical(widget.shop, openingShop)) return false;
      final auth = ref.read(authProvider);
      final current = ref.read(bookingPlanProvider(openingShop));
      return customerId != null && auth.isLoggedIn &&
          auth.user?.role == 'CUSTOMER' && auth.user?.id == customerId &&
          session == api.sessionGeneration &&
          identical(current.shop, selection.shop) &&
          identical(current.quote, quote) && current.validPlan &&
          current.startTime != null && !current.submitting &&
          current.pendingAttempt == null && !current.recoveryReminder &&
          bookingQuoteFingerprint(current.pricingRequest) == request;
    }
    setState(() => _checkingCoupon = true);
    try {
      if (!await requireCustomerSignIn(context, ref) || !mounted) return;
      customerId = ref.read(authProvider).user?.id;
      session = api.sessionGeneration;
      if (!mounted || !currentSelection()) return;
      final repo = ref.read(couponRepositoryProvider);
      final wallet = await repo.myCoupons(status: 'UNUSED');
      if (!mounted || !currentSelection() || ModalRoute.of(context)?.isCurrent != true) return;
      final rows = wallet
          .where(
            (row) =>
                row.coupon.shopId == null ||
                row.coupon.shopId == selection.shop.id,
          )
          .toList();
      final selected = await showModalBottomSheet<UserCoupon>(
        context: context,
        isScrollControlled: true,
        builder: (context) => SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(context).height * 0.65,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text(_t('Choose coupon', '选择优惠券')),
                ),
                if (rows.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(20),
                    child: Text(
                      _t('No unused coupons for this shop.', '暂无可用于此门店的未用优惠券。'),
                    ),
                  ),
                Expanded(
                  child: ListView(
                    children: rows
                        .map(
                          (row) => ListTile(
                            title: Text(row.coupon.title),
                            subtitle: Text(
                              row.coupon.discountLabel(compact: false),
                            ),
                            onTap: () => Navigator.pop(context, row),
                          ),
                        )
                        .toList(),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (selected == null || !currentSelection()) return;
      final result = await repo.validateCoupon(
        userCouponId: selected.id,
        shopId: selection.shop.id,
        priceCents: quote.priceCents,
      );
      if (!mounted || !currentSelection()) return;
      if (result['valid'] != true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _t(
                'This coupon does not apply to the service subtotal.',
                '此券不适用于当前服务小计。',
              ),
            ),
          ),
        );
      } else {
        _flow.selectCoupon(selected);
      }
    } catch (error) {
      if (mounted && currentSelection()) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(businessError(error))));
      }
    } finally {
      if (mounted) setState(() => _checkingCoupon = false);
    }
  }

  Future<void> _confirm(BookingPlanState initial) async {
    if (_confirming) return;
    final pageShop = widget.shop;
    if (!initial.canConfirm) return;
    final selection = bookingQuoteFingerprint(initial.pricingRequest);
    final reviewedQuote = initial.priceQuote;
    // Access checks may yield while the contact or verified account email changes.
    final reviewedContact = initial.contact;
    final api = ref.read(apiServiceProvider);
    final openingAuth = ref.read(authProvider);
    final openingCustomer = openingAuth.isLoggedIn && openingAuth.user?.role == 'CUSTOMER'
        ? openingAuth.user?.id : null;
    final reviewedEmail = bookingAccountEmail(openingAuth.user);
    final openingSession = api.sessionGeneration;
    String? customerId;
    int? session;
    bool currentAccount() {
      if (!mounted || !identical(widget.shop, pageShop)) return false;
      final auth = ref.read(authProvider);
      return customerId != null && auth.isLoggedIn && !auth.isLoading &&
          auth.user?.role == 'CUSTOMER' && auth.user?.id == customerId &&
          api.sessionGeneration == session;
    }
    bool currentSelection() {
      if (!currentAccount() || _step != 3 || ModalRoute.of(context)?.isCurrent != true) return false;
      final current = ref.read(bookingPlanProvider(pageShop));
      return identical(current.shop, initial.shop) && current.canConfirm &&
          identical(current.priceQuote, reviewedQuote) &&
          current.contact.name == reviewedContact.name &&
          current.contact.phone == reviewedContact.phone &&
          current.contact.email == reviewedContact.email &&
          bookingAccountEmail(ref.read(authProvider).user) == reviewedEmail &&
          bookingQuoteFingerprint(current.pricingRequest) == selection;
    }
    void reviewChangedSelection() {
      if (!mounted || !currentAccount() || ModalRoute.of(context)?.isCurrent != true) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Your booking details changed. Review the current itinerary, arrival time, contact details, and total before confirming again.'),
      ));
    }
    _confirming = true;
    try {
      if (!await requireCustomerSignIn(context, ref) || !mounted) return;
      customerId = ref.read(authProvider).user?.id;
      session = api.sessionGeneration;
      if (openingCustomer != null && (customerId != openingCustomer || session != openingSession)) return;
      if (!currentSelection()) { reviewChangedSelection(); return; }
      if (!await requireBookingOrderEmail(context, ref, orderOnly: true) || !mounted) return;
      if (!currentSelection()) { reviewChangedSelection(); return; }
      if (_contactFields.currentState?.validate() != true) return;
      await _createBooking(shop: initial.shop, currentAccount: currentAccount);
    } finally {
      _confirming = false;
    }
  }

  Future<void> _createBooking({required ShopDetail shop, required bool Function() currentAccount}) async {
    final result = await _flow.confirm();
    if (result == null || !mounted || !currentAccount() || ModalRoute.of(context)?.isCurrent != true) return;
    ref.invalidate(bookingPageProvider);
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => Consumer(builder: (context, ref, _) {
        ref.watch(authProvider);
        if (!currentAccount()) {
          return AlertDialog(
          title: const Text('Customer session changed'),
          content: const Text('Reopen your bookings using the account that placed this order.'),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
        );
        }
        return PopScope(
        canPop: false,
        child: AlertDialog(
          title: Text(result.isOfflineOrder ? 'Booking order created — total' : _t('Booking created — final amount', '预约已创建 · 最终金额')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  result.formattedTotal,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 12),
                Text(
                  result.isOfflineOrder ? 'Your booking order is saved. The shop will confirm and handle it offline. Check the email status in order details; saving an order does not record a payment.' : _t(
                    'This is the server-calculated total, including applicable discounts, fees, and your tip. Creating a booking does not mean payment succeeded.',
                    '此为服务器核定的最终合计，已计入适用优惠、费用与所选小费。创建预约不代表付款成功。',
                  ),
                  style: const TextStyle(height: 1.6),
                ),
                const SizedBox(height: 12),
                Text(bookingPaymentModeLabel(context, result)),
              ],
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: Text(
                result.canOpenCheckout
                    ? _t('Continue to payment', '继续付款')
                    : _t('View booking', '查看预约'),
              ),
            ),
          ],
        ),
      );
      }),
    );
    if (!mounted || !currentAccount() || ModalRoute.of(context)?.isCurrent != true) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => result.canOpenCheckout
            ? PaymentScreen(booking: result, shop: shop)
            : BookingDetailScreen(bookingId: result.id, initialBooking: result),
      ),
    );
  }
}
