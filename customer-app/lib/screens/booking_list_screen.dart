import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking.dart';
import '../models/booking_therapists.dart';
import '../models/booking_plan.dart';
import '../providers/booking_provider.dart';
import '../providers/shop_provider.dart';
import '../providers/auth_provider.dart';
import '../l10n/app_localizations.dart';
import '../widgets/app_empty_state.dart';
import 'review_form_screen.dart';
import '../navigation/customer_navigation.dart';
import 'payment_screen.dart';
import 'after_sales_screen.dart';
import 'booking_detail_screen.dart';
import '../theme/customer_theme.dart';
import '../services/business_workflow_service.dart';
import '../services/api_service.dart';
import '../services/booking_reschedule_journal.dart';

/// A full page for entries outside the home tab's existing Scaffold.
class BookingHistoryScreen extends StatelessWidget {
  final String? recoveryShopId;
  const BookingHistoryScreen({super.key, this.recoveryShopId});

  @override
  Widget build(BuildContext context) {
    final page = Scaffold(
      appBar: AppBar(title: const Text('My bookings')),
      body: const SafeArea(child: BookingListScreen()),
    );
    final shopId = recoveryShopId;
    if (shopId == null) return page;
    // Recovery must read anew without changing the normal center's filters or
    // cache. All three overrides stay local to this route and die on return.
    return ProviderScope(overrides: [
      bookingQueryProvider.overrideWith((ref) {
        ref.watch(authProvider.select((state) => state.user?.id));
        return BookingListQuery(shopId: shopId);
      }),
      bookingPageProvider.overrideWith(_loadBookingPage),
      bookingListProvider.overrideWith(_loadBookingList),
    ], child: page);
  }
}

/// Booking List Screen — shows user's bookings
class BookingListScreen extends ConsumerStatefulWidget {
  const BookingListScreen({super.key});

  @override
  ConsumerState<BookingListScreen> createState() => _BookingListScreenState();
}

class _BookingListScreenState extends ConsumerState<BookingListScreen> {
  final _filters = GlobalKey<FormState>();
  final _search = TextEditingController();
  final _start = TextEditingController();
  final _end = TextEditingController();
  String _status = '';
  String _paymentStatus = '';
  String _paymentMode = '';
  late final ProviderSubscription<BookingListQuery> _querySubscription;
  @override
  void initState() {
    super.initState();
    _syncQuery(ref.read(bookingQueryProvider));
    _querySubscription = ref.listenManual(bookingQueryProvider, (_, next) {
      if (mounted) setState(() => _syncQuery(next));
    });
  }

  void _syncQuery(BookingListQuery query) {
    if (_search.text != query.search) _search.text = query.search;
    if (_start.text != query.startDate) _start.text = query.startDate;
    if (_end.text != query.endDate) _end.text = query.endDate;
    _status = query.status;
    _paymentStatus = query.paymentStatus;
    _paymentMode = query.paymentMode;
  }

  @override
  void dispose() {
    _querySubscription.close();
    _search.dispose();
    _start.dispose();
    _end.dispose();
    super.dispose();
  }

  String _t(String en, String zh) => customerText(context, en, zh);

  String? _dateError(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return null;
    final date = DateTime.tryParse(text);
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text) ||
        date == null ||
        '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}' !=
            text) {
      return _t('Use a valid YYYY-MM-DD date.', '请输入有效的 YYYY-MM-DD 日期。');
    }
    if (_start.text.trim().isNotEmpty &&
        _end.text.trim().isNotEmpty &&
        _start.text.trim().compareTo(_end.text.trim()) > 0) {
      return _t('End date must not precede start date.', '结束日期不能早于开始日期。');
    }
    return null;
  }

  void _apply() {
    if (!_filters.currentState!.validate()) return;
    ref.read(bookingQueryProvider.notifier).state = BookingListQuery(
      shopId: ref.read(bookingQueryProvider).shopId,
      view: ref.read(bookingQueryProvider).view,
      status: _status,
      paymentStatus: _paymentStatus,
      paymentMode: _paymentMode,
      search: _search.text.trim(),
      startDate: _start.text.trim(),
      endDate: _end.text.trim(),
    );
  }

  void _reset() {
    _search.clear();
    _start.clear();
    _end.clear();
    setState(() {
      _status = '';
      _paymentStatus = '';
      _paymentMode = '';
    });
    final query = ref.read(bookingQueryProvider);
    ref.read(bookingQueryProvider.notifier).state = BookingListQuery(shopId: query.shopId, view: query.view);
    _filters.currentState?.validate();
  }

  @override
  Widget build(BuildContext context) {
    final bookingsAsync = ref.watch(bookingListProvider);
    final pageAsync = ref.watch(bookingPageProvider);
    final query = ref.watch(bookingQueryProvider);
    final page = pageAsync.valueOrNull;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Wrap(spacing: 8, runSpacing: 8, children: [
              for (final view in ['ALL', 'HISTORY']) ChoiceChip(
                label: Text(view == 'ALL' ? 'All bookings' : 'Booking history'),
                selected: query.view == view,
                onSelected: (_) => ref.read(bookingQueryProvider.notifier).state = query.withView(view),
              ),
            ]),
          ),
        ),
        if (query.view == 'HISTORY') const Padding(
          padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Align(alignment: Alignment.centerLeft,
            child: Text('History includes completed, cancelled and refunded bookings. Pending refunds remain in All bookings.',
              style: TextStyle(color: CustomerPalette.muted, fontSize: 12))),
        ),
        ExpansionTile(
          title: Text(_t('Find a booking', '查询预约')),
          subtitle: Text(
            _t('Dates use the booking’s shop-local date.', '日期按各预约的门店当地日期筛选。'),
          ),
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight:
                    (MediaQuery.sizeOf(context).height -
                        MediaQuery.viewInsetsOf(context).bottom) *
                    0.45,
              ),
              child: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  child: Form(
                    key: _filters,
                    child: Column(
                      children: [
                        TextFormField(
                          controller: _search,
                          maxLength: 100,
                          decoration: InputDecoration(
                            labelText: _t(
                              'Booking number, service, or shop',
                              '预约编号、服务或门店',
                            ),
                          ),
                          onFieldSubmitted: (_) => _apply(),
                        ),
                        const SizedBox(height: 12),
                        LayoutBuilder(
                          builder: (context, constraints) {
                            final width = constraints.maxWidth < 600
                                ? constraints.maxWidth
                                : (constraints.maxWidth - 24) / 3;
                            return Wrap(
                              spacing: 12,
                              runSpacing: 12,
                              children: [
                                SizedBox(
                                  width: width,
                                  child: _filterSelect(
                                    'status',
                                    _status,
                                    _t('Booking status', '预约状态'),
                                    {
                                      'PENDING': _t('Pending', '待确认'),
                                      'CONFIRMED': _t('Confirmed', '已确认'),
                                      'COMPLETED': _t('Completed', '已完成'),
                                      'CANCELLED': _t('Cancelled', '已取消'),
                                      'REFUNDING': _t('Refunding', '退款中'),
                                      'REFUNDED': _t('Refunded', '已退款'),
                                    },
                                    (value) => setState(() => _status = value),
                                  ),
                                ),
                                SizedBox(
                                  width: width,
                                  child: _filterSelect(
                                    'payment',
                                    _paymentStatus,
                                    _t('Payment status', '付款状态'),
                                    {
                                      'UNPAID': _t('Unpaid', '未付款'),
                                      'PAID': _t('Paid', '已付款'),
                                      'PARTIALLY_REFUNDED': _t(
                                        'Partially refunded',
                                        '部分退款',
                                      ),
                                      'REFUNDED': _t('Refunded', '已退款'),
                                    },
                                    (value) =>
                                        setState(() => _paymentStatus = value),
                                  ),
                                ),
                                SizedBox(
                                  width: width,
                                  child: _filterSelect(
                                    'mode',
                                    _paymentMode,
                                    _t('Payment arrangement', '付款方式'),
                                    {
                                      'ONLINE': _t('Online', '在线付款'),
                                      'PAY_AT_STORE': _t(
                                        'Pay at store',
                                        '到店付款',
                                      ),
                                      'ZERO': _t('Zero total', '零金额'),
                                    },
                                    (value) =>
                                        setState(() => _paymentMode = value),
                                  ),
                                ),
                                SizedBox(
                                  width: width,
                                  child: TextFormField(
                                    controller: _start,
                                    decoration: InputDecoration(
                                      labelText: _t(
                                        'From date (YYYY-MM-DD)',
                                        '起始日期（YYYY-MM-DD）',
                                      ),
                                    ),
                                    validator: _dateError,
                                  ),
                                ),
                                SizedBox(
                                  width: width,
                                  child: TextFormField(
                                    controller: _end,
                                    decoration: InputDecoration(
                                      labelText: _t(
                                        'To date (YYYY-MM-DD)',
                                        '结束日期（YYYY-MM-DD）',
                                      ),
                                    ),
                                    validator: _dateError,
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                        const SizedBox(height: 16),
                        Wrap(
                          spacing: 12,
                          children: [
                            FilledButton(
                              onPressed: _apply,
                              child: Text(_t('Search', '查询')),
                            ),
                            TextButton(
                              onPressed: _reset,
                              child: Text(_t('Reset', '重置')),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        if (pageAsync.isLoading && page != null)
          const LinearProgressIndicator(),
        Expanded(
          child: bookingsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => SingleChildScrollView(
              child: AppErrorState(
                message:
                    '${AppLocalizations.of(context)!.failedToLoadBookings}: ${businessError(err)}',
                onRetry: () => ref.invalidate(bookingPageProvider),
              ),
            ),
            data: (bookings) {
              if (bookings.isEmpty) {
                return SingleChildScrollView(
                  child: AppEmptyState(
                    icon: Icons.calendar_month_outlined,
                    title: query.toJson().length > 2
                        ? _t('No matching bookings', '没有符合条件的预约')
                        : AppLocalizations.of(context)!.noBookingsYet,
                    subtitle: query.toJson().length > 2
                        ? _t('Change or reset the filters.', '请调整或重置筛选条件。')
                        : AppLocalizations.of(context)!.bookMassageHint,
                    actionLabel: AppLocalizations.of(context)!.bookNow,
                    onAction: () => openCustomerHome(context),
                  ),
                );
              }

              return RefreshIndicator(
                onRefresh: () async {
                  for (final shopId in bookings.map((v) => v.shopId).toSet()) {
                    if (shopId.isNotEmpty) {
                      ref.invalidate(shopDetailProvider(shopId));
                    }
                  }
                  ref.invalidate(bookingPageProvider);
                  await ref.read(bookingPageProvider.future);
                },
                child: ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: bookings.length,
                  itemBuilder: (context, index) {
                    final booking = bookings[index];
                    return _BookingCard(
                      key: ValueKey(booking.id),
                      booking: booking,
                    );
                  },
                ),
              );
            },
          ),
        ),
        if (page != null && page.total > 0)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _t(
                        '${page.total} bookings · page ${page.page}/${page.totalPages}',
                        '共 ${page.total} 条 · 第 ${page.page}/${page.totalPages} 页',
                      ),
                      style: const TextStyle(
                        color: CustomerPalette.muted,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _t('Previous page', '上一页'),
                    onPressed: pageAsync.isLoading || query.page <= 1
                        ? null
                        : () => ref.read(bookingQueryProvider.notifier).state =
                              query.atPage(query.page - 1),
                    icon: const Icon(Icons.chevron_left),
                  ),
                  IconButton(
                    tooltip: _t('Next page', '下一页'),
                    onPressed:
                        pageAsync.isLoading || query.page >= page.totalPages
                        ? null
                        : () => ref.read(bookingQueryProvider.notifier).state =
                              query.atPage(query.page + 1),
                    icon: const Icon(Icons.chevron_right),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _filterSelect(
    String key,
    String value,
    String label,
    Map<String, String> choices,
    ValueChanged<String> changed,
  ) => DropdownButtonFormField<String>(
    key: ValueKey('$key:$value'),
    initialValue: value,
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [
      DropdownMenuItem(value: '', child: Text(_t('All', '全部'))),
      ...choices.entries.map(
        (row) => DropdownMenuItem(value: row.key, child: Text(row.value)),
      ),
    ],
    onChanged: (value) {
      if (value != null) changed(value);
    },
  );
}

final bookingQueryProvider = StateProvider<BookingListQuery>((ref) {
  ref.watch(authProvider.select((state) => state.user?.id));
  return const BookingListQuery();
});
// Keep uncertain writes blocked when their card is rebuilt or reopened. Only a
// fresh read for the same customer/session can establish the current status.
final _cancellationChecksProvider = StateProvider<Set<String>>((ref) {
  ref.watch(authProvider.select((state) => state.user?.id));
  return <String>{};
});
Future<BookingPage> _loadBookingPage(Ref ref) async {
  final query = ref.watch(bookingQueryProvider);
  final account = ref.watch(authProvider.select((state) => state.user?.id));
  if (account == null) {
    return BookingPage(
      items: const [],
      total: 0,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: 0,
    );
  }
  final cancel = CancelToken();
  final api = ref.read(apiServiceProvider);
  final epoch = api.sessionGeneration;
  final checksAtReadStart = ref.read(_cancellationChecksProvider);
  ref.onDispose(() => cancel.cancel('Booking query changed'));
  final page = await ref
      .read(bookingRepositoryProvider)
      .getUserBookingPage(query, cancelToken: cancel);
  if (!cancel.isCancelled &&
      api.sessionGeneration == epoch &&
      ref.read(authProvider).user?.id == account) {
    final verified = {
      for (final booking in page.items)
        if (booking.userId == account) '$account:$epoch:${booking.id}',
    };
    ref
        .read(_cancellationChecksProvider.notifier)
        .update(
          (checks) =>
              checks.difference(verified.intersection(checksAtReadStart)),
        );
  }
  return page;
}

final bookingPageProvider = FutureProvider<BookingPage>(_loadBookingPage);

/// Compatibility projection; all real UI requests use the server-paged endpoint.
Future<List<Booking>> _loadBookingList(Ref ref) async =>
    (await ref.watch(bookingPageProvider.future)).items;
final bookingListProvider = FutureProvider<List<Booking>>(_loadBookingList);

class _BookingCard extends ConsumerStatefulWidget {
  final Booking booking;
  const _BookingCard({super.key, required this.booking});

  @override
  ConsumerState<_BookingCard> createState() => _BookingCardState();
}

class _BookingCardState extends ConsumerState<_BookingCard> {
  static final _pendingOrders = <String>{};
  bool _actionPending = false;
  Booking? _verifiedBooking;
  Booking get booking => _verifiedBooking ?? widget.booking;
  String get _actionKey =>
      '${ref.read(authProvider).user?.id}:${ref.read(apiServiceProvider).sessionGeneration}:${booking.id}';
  bool get _timeChangeBlocked {
    final auth = ref.read(authProvider);
    final actor = auth.isLoggedIn && auth.user?.role == 'CUSTOMER' ? auth.user?.id : null;
    return actor == null || ref.read(bookingRescheduleJournalProvider).status(actor, booking.id).blocked;
  }

  @override
  void didUpdateWidget(covariant _BookingCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(widget.booking, oldWidget.booking)) _verifiedBooking = null;
  }

  bool _canHide(Booking item) =>
      (item.paidCents ?? 0) == 0 &&
      (item.amountDueCents ?? 0) == 0 &&
      const ['CANCELLED', 'COMPLETED', 'REFUNDED'].contains(item.status);

  Future<void> _withBookingAction(
    String bookingId, {
    required bool hide,
    bool readOnly = false,
    required Future<void> Function(bool Function() current) action,
  }) async {
    final original = booking;
    final auth = ref.read(authProvider);
    final account = auth.isLoggedIn && auth.user?.role == 'CUSTOMER'
        ? auth.user?.id
        : null;
    final api = ref.read(apiServiceProvider);
    final epoch = api.sessionGeneration;
    bool current() {
      if (!mounted) return false;
      final next = ref.read(authProvider);
      return account != null &&
          next.isLoggedIn &&
          next.user?.role == 'CUSTOMER' &&
          next.user?.id == account &&
          api.sessionGeneration == epoch &&
          (readOnly || !_timeChangeBlocked) &&
          booking.id == bookingId &&
          original.id == bookingId &&
          booking.shopId == original.shopId &&
          (booking.userId.isEmpty || booking.userId == account);
    }

    final lock = '$account:$epoch:$bookingId';
    if (_actionPending ||
        !current() ||
        !readOnly &&
            (!(hide ? _canHide(booking) : booking.canCancel) ||
                !hide &&
                    ref.read(_cancellationChecksProvider).contains(lock)) ||
        !_pendingOrders.add(lock)) {
      return;
    }
    setState(() => _actionPending = true);
    try {
      await action(current);
    } finally {
      _pendingOrders.remove(lock);
      if (mounted) setState(() => _actionPending = false);
    }
  }

  Future<void> _refreshAfterAction(bool Function() current) async {
    if (!mounted || !current()) return;
    try {
      ref.invalidate(bookingPageProvider);
      await ref.read(bookingPageProvider.future);
    } catch (_) {
      // The existing list error state offers a read-only retry.
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(bookingRescheduleChangesProvider);
    final timeChangeBlocked = _timeChangeBlocked;
    final theme = Theme.of(context);
    final statusColor = _statusColor(booking.status);
    final statusIcon = _statusIcon(booking.status);
    var therapists = assignedBookingTherapists(booking);
    final reviewCandidate = booking.status == 'COMPLETED' && !booking.hasReview;
    final availability =
        booking.shopId.isNotEmpty &&
            (reviewCandidate || therapists.any((row) => row.name.isEmpty))
        ? ref.watch(shopDetailProvider(booking.shopId))
        : null;
    if (booking.shopId.isNotEmpty &&
        therapists.any((row) => row.name.isEmpty)) {
      final shop = availability?.valueOrNull;
      if (shop?.id == booking.shopId) {
        therapists = assignedBookingTherapists(
          booking,
          rosterNames: {for (final row in shop!.therapists) row.id: row.name},
        );
      }
    }
    final needsCancellationCheck = ref
        .watch(_cancellationChecksProvider)
        .contains(_actionKey);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header: shop name + status badge
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        booking.shop?.name ?? 'Massage Shop',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      if (booking.reservationKind == 'PLAN')
                        Text(
                          customerText(
                            context,
                            '${booking.items.map((row) => row.participantIndex).toSet().length} participants · ${booking.items.length} services',
                            '${booking.items.map((row) => row.participantIndex).toSet().length} 位参与者 · ${booking.items.length} 项服务',
                          ),
                          style: const TextStyle(
                            color: CustomerPalette.muted,
                            fontSize: 13,
                          ),
                        )
                      else if (booking.service != null)
                        Text(
                          booking.service!.name,
                          style: TextStyle(
                            color: Colors.grey[600],
                            fontSize: 13,
                          ),
                        ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: statusColor.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(statusIcon, size: 14, color: statusColor),
                      const SizedBox(width: 4),
                      Text(
                        booking.statusLabel,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: statusColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Booking details
            _InfoRow(icon: Icons.calendar_today, text: booking.formattedDate),
            const SizedBox(height: 4),
            _InfoRow(icon: Icons.access_time, text: booking.formattedTimeRange),
            if (booking.durationKind != 'TIMED' && booking.durationMin > 0)
              _InfoRow(
                icon: Icons.timer_outlined,
                text: booking.reservationLabel,
              ),
            const SizedBox(height: 4),
            _InfoRow(
              icon: Icons.attach_money,
              text: customerText(
                context,
                'Total: ${booking.formattedTotal}',
                '应付：${booking.formattedTotal}',
              ),
            ),
            const SizedBox(height: 4),
            _InfoRow(
              icon: Icons.account_balance_wallet_outlined,
              text: bookingPaymentModeLabel(context, booking),
            ),
            if (booking.amountDueCents != null) ...[
              const SizedBox(height: 4),
              _InfoRow(
                icon: Icons.receipt_long_outlined,
                text: customerText(
                  context,
                  'Amount due: ${booking.formattedDue}',
                  '待收：${booking.formattedDue}',
                ),
              ),
            ],
            if (booking.paymentMode == 'PAY_AT_STORE' &&
                booking.status == 'PENDING') ...[
              const SizedBox(height: 6),
              Text(
                customerText(
                  context,
                  booking.isOfflineOrder
                      ? 'Order submitted. The shop will confirm and handle it offline.'
                      : 'Waiting for the shop to accept.',
                  booking.isOfflineOrder ? '订单已提交，由门店线下确认和处理。' : '等待门店接受预约。',
                ),
                style: const TextStyle(
                  color: CustomerPalette.muted,
                  fontSize: 13,
                ),
              ),
            ],
            if ((booking.paidCents ?? 0) > 0) ...[
              const SizedBox(height: 4),
              _InfoRow(
                icon: Icons.payments_outlined,
                text: 'Paid: ${booking.formattedPaid}',
              ),
            ],
            if ((booking.refundedCents ?? 0) > 0) ...[
              const SizedBox(height: 4),
              _InfoRow(
                icon: Icons.undo,
                text: 'Refunded: ${booking.formattedRefunded}',
              ),
            ],
            if (therapists.isNotEmpty) ...[
              const SizedBox(height: 4),
              _InfoRow(
                icon: therapists.length > 1
                    ? Icons.people_outline
                    : Icons.person,
                text: therapists
                    .map(
                      (row) => row.name.isNotEmpty
                          ? row.name
                          : 'Therapist #${row.id}',
                    )
                    .join(', '),
              ),
            ],

            const SizedBox(height: 12),

            if (needsCancellationCheck) ...[
              const Text(
                'Check the current booking status before requesting cancellation again.',
                style: TextStyle(color: CustomerPalette.muted),
              ),
              const SizedBox(height: 8),
            ],
            // Actions
            if (timeChangeBlocked) const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text('Changes are paused while this booking’s original time change or recovery storage is being checked. Open Booking details to continue.')),
            Wrap(
              alignment: WrapAlignment.end,
              spacing: 8,
              runSpacing: 8,
              children: [
                TextButton(
                  onPressed: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => BookingDetailScreen(
                          bookingId: booking.id,
                          initialBooking: booking,
                          onChanged: () {
                            if (mounted) ref.invalidate(bookingPageProvider);
                          },
                        ),
                      ),
                    );
                    if (mounted) ref.invalidate(bookingPageProvider);
                  },
                  child: Text(customerText(context, 'Booking details', '预约详情')),
                ),
                if (booking.canOpenCheckout)
                  TextButton(
                    onPressed: timeChangeBlocked ? null : () async {
                      if (_timeChangeBlocked) return;
                      try {
                        final shop = await ref
                            .read(shopRepositoryProvider)
                            .getShopDetail(booking.shopId);
                        if (context.mounted && !_timeChangeBlocked) {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  PaymentScreen(booking: booking, shop: shop),
                            ),
                          );
                        }
                      } catch (_) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Unable to load payment details.'),
                            ),
                          );
                        }
                      }
                    },
                    child: const Text('Payment details'),
                  ),
                if (reviewCandidate &&
                    availability != null &&
                    !availability.isLoading &&
                    availability.hasError)
                  TextButton(
                    key: ValueKey('review-availability:${booking.id}'),
                    onPressed: () =>
                        ref.invalidate(shopDetailProvider(booking.shopId)),
                    child: const Text('Check review availability'),
                  ),
                if (reviewCandidate &&
                    canWriteShopReview(booking.shopId, availability))
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: TextButton.icon(
                      onPressed: timeChangeBlocked ? null : () {
                        if (_timeChangeBlocked) return;
                        if (!canWriteShopReview(
                          booking.shopId,
                          ref.read(shopDetailProvider(booking.shopId)),
                        )) {
                          return;
                        }
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => ReviewFormScreen(
                              bookingId: booking.id,
                              shopId: booking.shopId,
                            ),
                          ),
                        ).then((_) {
                          if (!mounted) return;
                          ref.invalidate(bookingPageProvider);
                          ref.invalidate(shopListProvider);
                          if (booking.shopId.isNotEmpty) {
                            ref.invalidate(shopDetailProvider(booking.shopId));
                          }
                        });
                      },
                      icon: const Icon(Icons.rate_review, size: 18),
                      label: Text(AppLocalizations.of(context)!.writeReview),
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.blue[700],
                      ),
                    ),
                  ),
                if (needsCancellationCheck)
                  OutlinedButton(
                    onPressed: _actionPending ? null : _checkCancellationStatus,
                    child: Text(
                      _actionPending
                          ? 'Checking booking status…'
                          : 'Check booking status',
                    ),
                  )
                else if (booking.canCancel)
                  OutlinedButton(
                    onPressed: _actionPending || timeChangeBlocked
                        ? null
                        : () => _cancelBooking(context, ref, booking.id),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.orange[700],
                      side: BorderSide(color: Colors.orange[300]!),
                    ),
                    child: Text(AppLocalizations.of(context)!.cancel),
                  ),
                if (booking.hasRefundableBalance &&
                    booking.status == 'CONFIRMED')
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: OutlinedButton(
                      onPressed: timeChangeBlocked ? null : () => _openSupport(
                        context,
                        ref,
                        booking,
                        initialType: 'REFUND',
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.purple[700],
                        side: BorderSide(color: Colors.purple[300]!),
                      ),
                      child: Text(AppLocalizations.of(context)!.requestRefund),
                    ),
                  ),
                if (!(booking.hasRefundableBalance &&
                    booking.status == 'CONFIRMED'))
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: OutlinedButton(
                      onPressed: timeChangeBlocked ? null : () => _openSupport(context, ref, booking),
                      child: Text(customerText(context, 'Support', '售后服务')),
                    ),
                  ),
                if (_canHide(booking))
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: OutlinedButton(
                      onPressed: _actionPending || timeChangeBlocked
                          ? null
                          : () => _deleteBooking(context, ref, booking.id),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.red[700],
                        side: BorderSide(color: Colors.red[300]!),
                      ),
                      child: Text(customerText(context, 'Hide record', '隐藏记录')),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'PENDING':
        return Colors.orange;
      case 'CONFIRMED':
        return Colors.green;
      case 'COMPLETED':
        return Colors.blue;
      case 'CANCELLED':
        return Colors.red;
      case 'REFUNDING':
        return Colors.purple;
      case 'REFUNDED':
        return Colors.grey;
      default:
        return Colors.grey;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'PENDING':
        return Icons.schedule;
      case 'CONFIRMED':
        return Icons.check_circle;
      case 'COMPLETED':
        return Icons.done_all;
      case 'CANCELLED':
        return Icons.cancel;
      case 'REFUNDING':
        return Icons.autorenew;
      case 'REFUNDED':
        return Icons.receipt;
      default:
        return Icons.help_outline;
    }
  }

  Future<void> _cancelBooking(
    BuildContext context,
    WidgetRef ref,
    String bookingId,
  ) async {
    await _withBookingAction(
      bookingId,
      hide: false,
      action: (current) async {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(AppLocalizations.of(context)!.cancelBooking),
            content: Text(AppLocalizations.of(context)!.cancelBookingConfirm),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(AppLocalizations.of(context)!.keep),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(AppLocalizations.of(context)!.cancelBooking),
              ),
            ],
          ),
        );

        if (confirmed == true && current() && booking.canCancel) {
          final key = _actionKey;
          try {
            await ref.read(bookingRepositoryProvider).cancelBooking(bookingId);
            if (mounted && context.mounted && current()) {
              ref
                  .read(_cancellationChecksProvider.notifier)
                  .update((checks) => {...checks, key});
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(AppLocalizations.of(context)!.bookingCancelled),
                  behavior: SnackBarBehavior.floating,
                ),
              );
              await _refreshAfterAction(current);
            }
          } catch (e) {
            if (mounted && context.mounted && current()) {
              final status = e is DioException ? e.response?.statusCode : null;
              if (status != null &&
                  status >= 400 &&
                  status < 500 &&
                  status != 408) {
                ref
                    .read(_cancellationChecksProvider.notifier)
                    .update((checks) => {...checks}..remove(key));
              } else {
                ref
                    .read(_cancellationChecksProvider.notifier)
                    .update((checks) => {...checks, key});
              }
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    businessError(
                      e,
                      fallback:
                          'Unable to cancel this booking. Refresh your bookings to check its current status.',
                    ),
                  ),
                  behavior: SnackBarBehavior.floating,
                ),
              );
              await _refreshAfterAction(current);
            }
          }
        }
      },
    );
  }

  Future<void> _checkCancellationStatus() async {
    await _withBookingAction(
      booking.id,
      hide: false,
      readOnly: true,
      action: (current) async {
        final key = _actionKey;
        try {
          final data = await ref
              .read(apiServiceProvider)
              .getBooking(booking.id);
          if (!mounted || !current()) return;
          final latest = Booking.fromJson(data);
          final account = ref.read(authProvider).user?.id;
          if (latest.id != booking.id ||
              latest.shopId != booking.shopId ||
              latest.userId != account) {
            throw const FormatException('Invalid booking status response');
          }
          setState(() => _verifiedBooking = latest);
          ref
              .read(_cancellationChecksProvider.notifier)
              .update((checks) => {...checks}..remove(key));
          await _refreshAfterAction(current);
        } catch (error) {
          if (mounted && context.mounted && current()) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  businessError(
                    error,
                    fallback:
                        'Booking status could not be verified. Check again before requesting cancellation.',
                  ),
                ),
                behavior: SnackBarBehavior.floating,
              ),
            );
          }
        }
      },
    );
  }

  Future<void> _deleteBooking(
    BuildContext context,
    WidgetRef ref,
    String bookingId,
  ) async {
    await _withBookingAction(
      bookingId,
      hide: true,
      action: (current) async {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(
              customerText(context, 'Hide booking record?', '隐藏此预约记录？'),
            ),
            content: Text(
              customerText(
                context,
                'This unpaid, finished booking will be hidden from your list. Financial records are retained.',
                '这条已结束、未付款的预约将从您的列表隐藏。系统会保留必要记录。',
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: Text(AppLocalizations.of(context)!.keep),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: FilledButton.styleFrom(backgroundColor: Colors.red),
                child: Text(customerText(context, 'Hide record', '隐藏记录')),
              ),
            ],
          ),
        );

        if (confirmed == true && current() && _canHide(booking)) {
          try {
            await ref.read(bookingRepositoryProvider).deleteBooking(bookingId);
            if (mounted && context.mounted && current()) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(AppLocalizations.of(context)!.bookingDeleted),
                  behavior: SnackBarBehavior.floating,
                ),
              );
              await _refreshAfterAction(current);
            }
          } catch (e) {
            if (mounted && context.mounted && current()) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    businessError(
                      e,
                      fallback:
                          'Unable to hide this booking. Refresh your bookings to check its current status.',
                    ),
                  ),
                  behavior: SnackBarBehavior.floating,
                ),
              );
              await _refreshAfterAction(current);
            }
          }
        }
      },
    );
  }

  Future<void> _openSupport(
    BuildContext context,
    WidgetRef ref,
    Booking booking, {
    String initialType = 'OTHER',
  }) async {
    if (_timeChangeBlocked) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            CreateAfterSalesScreen(booking: booking, initialType: initialType),
      ),
    );
    ref.invalidate(bookingPageProvider);
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _InfoRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.grey[500]),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(color: Colors.grey[700], fontSize: 13),
          ),
        ),
      ],
    );
  }
}
