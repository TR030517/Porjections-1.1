import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/money.dart';
import '../models/gift_time.dart';
import '../providers/auth_provider.dart';
import '../services/business_workflow_service.dart';
import '../services/gift_order_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/customer_access.dart';
import '../widgets/responsive_content.dart';
import 'gift_wallet_screen.dart';

String _giftText(BuildContext context, String en, String zh) =>
    customerText(context, en, zh);
String? _giftAccount(WidgetRef ref) {
  final auth = ref.read(authProvider);
  return auth.isLoggedIn ? auth.user?.id : null;
}

String _giftStatus(BuildContext context, String value) => switch (value) {
  'PENDING' => _giftText(context, 'Awaiting store payment', '待到店付款'),
  'PAID' => _giftText(context, 'Payment recorded', '已登记收款'),
  'CANCELLED' => _giftText(context, 'Cancelled', '已取消'),
  'REFUNDED' => _giftText(context, 'Refund recorded', '已登记退款'),
  _ => value,
};
Widget _giftPanel(Widget child) => Container(
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
Widget _giftSessionChanged(BuildContext context) => Padding(
  padding: const EdgeInsets.all(24),
  child: Text(
    _giftText(
      context,
      'Your account or session changed. Close this page and reopen it for your current account.',
      '账号或登录状态已变化，请关闭此页后重新进入当前账号的页面。',
    ),
  ),
);

class GiftProductsScreen extends ConsumerStatefulWidget {
  final String shopId;
  final String shopName;
  const GiftProductsScreen({
    super.key,
    required this.shopId,
    required this.shopName,
  });
  @override
  ConsumerState<GiftProductsScreen> createState() => _GiftProductsScreenState();
}

class _GiftProductsScreenState extends ConsumerState<GiftProductsScreen> {
  GiftProductPage? _data;
  Map<String, dynamic>? _config;
  CancelToken? _cancel;
  CancelToken? _write;
  late final ProviderSubscription<AuthState> _auth;
  int _page = 1;
  bool _loading = true;
  bool _creating = false;
  String? _error;
  String? _key;
  String? _fingerprint;
  @override
  void initState() {
    super.initState();
    _auth = ref.listenManual(authProvider, (previous, next) {
      if (previous?.user?.id != next.user?.id || !next.isLoggedIn) {
        _write?.cancel();
        _key = null;
        _fingerprint = null;
        if (mounted) setState(() => _creating = false);
      }
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _auth.close();
    _cancel?.cancel();
    _write?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    _cancel?.cancel();
    final cancel = CancelToken();
    _cancel = cancel;
    setState(() {
      _loading = true;
      _data = null;
      _config = null;
      _error = null;
    });
    try {
      final service = ref.read(giftOrderServiceProvider);
      final values = await Future.wait([
        service.products(widget.shopId, _page, cancelToken: cancel),
        service.config(cancelToken: cancel),
      ]);
      if (mounted && !cancel.isCancelled) {
        setState(() {
          _data = values[0] as GiftProductPage;
          _config = values[1] as Map<String, dynamic>;
        });
      }
    } catch (error) {
      if (mounted && !cancel.isCancelled) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (mounted && !cancel.isCancelled) setState(() => _loading = false);
    }
  }

  bool _saleEnabled(Map<String, dynamic> row) =>
      _config?['salesEnabled'] == true &&
      row['salesEnabled'] == true &&
      row['paymentMethods'] is List &&
      (row['paymentMethods'] as List).contains('PAY_AT_STORE');
  Future<void> _create(Map<String, dynamic> product) async {
    if (_creating || !_saleEnabled(product)) return;
    if (!await requireCustomerSignIn(context, ref) || !mounted) return;
    final account = _giftAccount(ref);
    if (account == null) return;
    final accept = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          _giftText(context, 'Create a pay-at-store gift order?', '创建到店付礼品订单？'),
        ),
        content: SingleChildScrollView(
          child: Text(
            '${product['title']}\n${formatCents(product['priceCents'] as int, product['currency'] as String)}\n\n${_giftText(context, 'No payment is taken now and no benefit is issued. Pay the named shop in person; staff must record the payment before your benefit is issued.', '现在不会扣款，也不会发放权益。请向指定门店实际付款，门店登记收款后才会发放权益。')}',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_giftText(context, 'Back', '返回')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_giftText(context, 'Create order', '创建订单')),
          ),
        ],
      ),
    );
    if (accept != true || !mounted || _giftAccount(ref) != account) return;
    final fingerprint = '$account:${widget.shopId}:${product['id']}';
    if (_fingerprint != fingerprint) {
      _fingerprint = fingerprint;
      final random = Random.secure();
      _key = List.generate(
        16,
        (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
      ).join();
    }
    final cancel = CancelToken();
    _write = cancel;
    setState(() {
      _creating = true;
      _error = null;
    });
    bool current() =>
        mounted && !cancel.isCancelled && _giftAccount(ref) == account;
    try {
      final order = await ref
          .read(giftOrderServiceProvider)
          .create(product['id'] as String, _key!, cancelToken: cancel);
      if (!mounted || !current()) return;
      if (order.userId != account || order.shopId != widget.shopId) {
        throw const FormatException('Invalid gift owner');
      }
      _key = null;
      _fingerprint = null;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => GiftPurchaseDetailScreen(
            orderId: order.id,
            openingAccount: account,
            initialOrder: order,
          ),
        ),
      );
    } catch (error) {
      if (current()) {
        setState(
          () => _error =
              '${businessError(error)} ${_giftText(context, 'An unchanged retry reuses the same request. Check your gift orders before changing the product.', '原样重试会复用同一请求；更改产品前请先核对礼品订单。')}',
        );
      }
    } finally {
      if (current()) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_creating,
    child: Scaffold(
      backgroundColor: CustomerPalette.background,
      appBar: AppBar(
        title: Text(_giftText(context, 'Store gift products', '门店礼品产品')),
        actions: [
          IconButton(
            tooltip: _giftText(context, 'Reload', '刷新'),
            onPressed: _loading || _creating ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ResponsiveContent(
        maxWidth: 850,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    widget.shopName,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 12),
                  _giftPanel(
                    Text(
                      _giftText(
                        context,
                        'Online gift-card payment is not available. Products are valid only at this shop. Purchased benefits and complimentary grants are separate.',
                        '礼品线上付款尚未开放。产品仅限本门店使用，付费购买权益与免费赠送分开记录。',
                      ),
                      style: const TextStyle(
                        color: CustomerPalette.muted,
                        height: 1.6,
                      ),
                    ),
                  ),
                  if (_error != null)
                    _giftPanel(
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _error!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                          TextButton(
                            onPressed: _load,
                            child: Text(_giftText(context, 'Retry', '重试')),
                          ),
                        ],
                      ),
                    ),
                  if (_data?.items.isEmpty ?? true)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        _giftText(
                          context,
                          'No active gift products for this shop.',
                          '此门店暂无已启用礼品产品。',
                        ),
                      ),
                    ),
                  ...?_data?.items.map(
                    (product) => _giftPanel(
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            product['title'] as String,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          if (product['description'] is String &&
                              (product['description'] as String).isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(product['description'] as String),
                            ),
                          const SizedBox(height: 14),
                          Text(
                            formatCents(
                              product['priceCents'] as int,
                              product['currency'] as String,
                            ),
                            style: const TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _giftText(
                              context,
                              '${product['useTimes']} uses · ${product['expireDays']} days validity after issuance',
                              '${product['useTimes']} 次 · 发放后有效 ${product['expireDays']} 天',
                            ),
                            style: const TextStyle(
                              color: CustomerPalette.muted,
                            ),
                          ),
                          const SizedBox(height: 16),
                          FilledButton(
                            onPressed: _creating || !_saleEnabled(product)
                                ? null
                                : () => _create(product),
                            child: Text(
                              !_saleEnabled(product)
                                  ? _giftText(
                                      context,
                                      'Store sales not enabled',
                                      '本店尚未开放购买',
                                    )
                                  : _creating
                                  ? _giftText(context, 'Creating…', '正在创建…')
                                  : _giftText(
                                      context,
                                      'Order · pay at store',
                                      '下单 · 到店付款',
                                    ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_data != null && _data!.total > 0)
                    _giftPager(
                      context,
                      _page,
                      _data!.totalPages,
                      _loading || _creating,
                      (value) {
                        _page = value;
                        _load();
                      },
                    ),
                ],
              ),
      ),
    ),
  );
}

class GiftOrdersScreen extends ConsumerStatefulWidget {
  const GiftOrdersScreen({super.key});
  @override
  ConsumerState<GiftOrdersScreen> createState() => _GiftOrdersScreenState();
}

class _GiftOrdersScreenState extends ConsumerState<GiftOrdersScreen> {
  late final String? _account;
  late final ProviderSubscription<AuthState> _auth;
  GiftOrderPage? _data;
  CancelToken? _cancel;
  int _page = 1;
  String _status = '';
  bool _loading = true;
  bool _invalid = false;
  String? _error;
  bool get _current =>
      mounted && !_invalid && _account != null && _giftAccount(ref) == _account;
  @override
  void initState() {
    super.initState();
    _account = _giftAccount(ref);
    _auth = ref.listenManual(authProvider, (_, next) {
      if (_invalid || next.isLoggedIn && next.user?.id == _account) return;
      _cancel?.cancel();
      setState(() {
        _invalid = true;
        _data = null;
        _error = null;
        _loading = false;
      });
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _auth.close();
    _cancel?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (!_current) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    _cancel?.cancel();
    final cancel = CancelToken();
    _cancel = cancel;
    setState(() {
      _loading = true;
      _data = null;
      _error = null;
    });
    try {
      final result = await ref
          .read(giftOrderServiceProvider)
          .orders(_page, status: _status, cancelToken: cancel);
      if (!_current || cancel.isCancelled) return;
      if (result.items.any((row) => row.userId != _account)) {
        throw const FormatException('Invalid gift owner');
      }
      if (result.items.isEmpty && _page > 1 && _page > result.totalPages) {
        _page = result.totalPages < 1 ? 1 : result.totalPages;
        await _load();
        return;
      }
      setState(() => _data = result);
    } catch (error) {
      if (_current && !cancel.isCancelled) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current && !cancel.isCancelled) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: CustomerPalette.background,
    appBar: AppBar(
      title: Text(_giftText(context, 'My gift orders', '我的礼品订单')),
      actions: [
        IconButton(
          tooltip: _giftText(context, 'Reload', '刷新'),
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: !_current
        ? _giftSessionChanged(context)
        : ResponsiveContent(
            maxWidth: 850,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: DropdownButtonFormField<String>(
                    initialValue: _status,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: _giftText(context, 'Order status', '订单状态'),
                    ),
                    items: [
                      DropdownMenuItem(
                        value: '',
                        child: Text(_giftText(context, 'All', '全部')),
                      ),
                      for (final value in [
                        'PENDING',
                        'PAID',
                        'CANCELLED',
                        'REFUNDED',
                      ])
                        DropdownMenuItem(
                          value: value,
                          child: Text(_giftStatus(context, value)),
                        ),
                    ],
                    onChanged: (value) {
                      if (value != null) {
                        _status = value;
                        _page = 1;
                        _load();
                      }
                    },
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.all(16),
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: [
                              if (_data?.items.isEmpty ?? true)
                                Padding(
                                  padding: const EdgeInsets.all(24),
                                  child: Text(
                                    _giftText(
                                      context,
                                      'No gift orders in this view.',
                                      '当前没有礼品订单。',
                                    ),
                                  ),
                                ),
                              ...?_data?.items.map(
                                (item) => _giftPanel(
                                  Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        item.title.isEmpty
                                            ? _giftText(
                                                context,
                                                'Historical gift order',
                                                '历史礼品订单',
                                              )
                                            : item.title,
                                        style: Theme.of(
                                          context,
                                        ).textTheme.titleMedium,
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        _giftStatus(context, item.status),
                                        style: const TextStyle(
                                          color: CustomerPalette.action,
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        _giftText(
                                          context,
                                          'Order amount: ${formatCents(item.amountCents, item.currency)}',
                                          '订单原价：${formatCents(item.amountCents, item.currency)}',
                                        ),
                                      ),
                                      Text(
                                        _giftText(
                                          context,
                                          'Recorded paid: ${formatCents(item.paidCents, item.currency)} · refunded: ${formatCents(item.refundedCents, item.currency)}',
                                          '已登记收款：${formatCents(item.paidCents, item.currency)} · 退款：${formatCents(item.refundedCents, item.currency)}',
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      OutlinedButton(
                                        onPressed: () async {
                                          await Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder: (_) =>
                                                  GiftPurchaseDetailScreen(
                                                    orderId: item.id,
                                                    openingAccount: _account!,
                                                    initialOrder: item,
                                                  ),
                                            ),
                                          );
                                          if (_current) _load();
                                        },
                                        child: Text(
                                          _giftText(
                                            context,
                                            'Order details',
                                            '订单详情',
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                ),
                if (_data != null && _data!.total > 0)
                  _giftPager(context, _page, _data!.totalPages, _loading, (
                    value,
                  ) {
                    _page = value;
                    _load();
                  }),
              ],
            ),
          ),
  );
}

class GiftPurchaseDetailScreen extends ConsumerStatefulWidget {
  final String orderId;
  final String openingAccount;
  final GiftPurchaseOrder? initialOrder;
  const GiftPurchaseDetailScreen({
    super.key,
    required this.orderId,
    required this.openingAccount,
    this.initialOrder,
  });
  @override
  ConsumerState<GiftPurchaseDetailScreen> createState() =>
      _GiftPurchaseDetailScreenState();
}

class _GiftPurchaseDetailScreenState
    extends ConsumerState<GiftPurchaseDetailScreen> {
  GiftPurchaseOrder? _order;
  CancelToken? _cancel;
  late final ProviderSubscription<AuthState> _auth;
  bool _loading = true;
  bool _busy = false;
  bool _invalid = false;
  String? _error;
  bool get _current =>
      mounted && !_invalid && _giftAccount(ref) == widget.openingAccount;
  @override
  void initState() {
    super.initState();
    _order = widget.initialOrder;
    if (_order?.userId != widget.openingAccount) _order = null;
    _auth = ref.listenManual(authProvider, (_, next) {
      if (_invalid ||
          next.isLoggedIn && next.user?.id == widget.openingAccount) {
        return;
      }
      _cancel?.cancel();
      setState(() {
        _invalid = true;
        _order = null;
        _error = null;
        _loading = false;
        _busy = false;
      });
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _auth.close();
    _cancel?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (!_current) return;
    _cancel?.cancel();
    final cancel = CancelToken();
    _cancel = cancel;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final row = await ref
          .read(giftOrderServiceProvider)
          .order(widget.orderId, cancelToken: cancel);
      if (!_current || cancel.isCancelled) return;
      if (row.userId != widget.openingAccount ||
          _order != null && row.shopId != _order!.shopId) {
        throw const FormatException('Invalid gift owner');
      }
      setState(() => _order = row);
    } catch (error) {
      if (_current && !cancel.isCancelled) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current && !cancel.isCancelled) setState(() => _loading = false);
    }
  }

  Future<void> _cancelOrder() async {
    if (!_current || _busy || _order?.canCancel != true) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          _giftText(context, 'Cancel unpaid gift order?', '取消未付款礼品订单？'),
        ),
        content: Text(
          _giftText(
            context,
            'This does not refund a payment or void a separately granted benefit.',
            '此操作不退款，也不会撤销独立赠送的权益。',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_giftText(context, 'Keep order', '保留订单')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_giftText(context, 'Cancel order', '取消订单')),
          ),
        ],
      ),
    );
    if (confirm != true || !_current) return;
    final cancel = CancelToken();
    _cancel?.cancel();
    _cancel = cancel;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final row = await ref
          .read(giftOrderServiceProvider)
          .cancel(widget.orderId, cancelToken: cancel);
      if (!_current || cancel.isCancelled) return;
      if (row.userId != widget.openingAccount) {
        throw const FormatException('Invalid gift owner');
      }
      setState(() => _order = row);
    } catch (error) {
      if (_current && !cancel.isCancelled) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current && !cancel.isCancelled) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = _order;
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        backgroundColor: CustomerPalette.background,
        appBar: AppBar(
          title: Text(_giftText(context, 'Gift order details', '礼品订单详情')),
          actions: [
            IconButton(
              tooltip: _giftText(context, 'Reload', '刷新'),
              onPressed: _busy || _loading ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: !_current
            ? _giftSessionChanged(context)
            : ResponsiveContent(
                maxWidth: 850,
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          if (_error != null)
                            _giftPanel(
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _error!,
                                    style: TextStyle(
                                      color: Theme.of(
                                        context,
                                      ).colorScheme.error,
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: _busy ? null : _load,
                                    child: Text(
                                      _giftText(
                                        context,
                                        'Reload order',
                                        '重新核对订单',
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          if (row != null)
                            _giftPanel(
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    row.title.isEmpty
                                        ? _giftText(
                                            context,
                                            'Product snapshot unavailable',
                                            '产品快照未提供',
                                          )
                                        : row.title,
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleLarge,
                                  ),
                                  const SizedBox(height: 12),
                                  SelectableText(row.orderNo),
                                  const SizedBox(height: 12),
                                  Text(
                                    _giftStatus(context, row.status),
                                    style: const TextStyle(
                                      color: CustomerPalette.action,
                                    ),
                                  ),
                                  const Divider(height: 28),
                                  _moneyLine(
                                    context,
                                    'Order amount',
                                    '订单原价',
                                    row.amountCents,
                                    row.currency,
                                  ),
                                  _moneyLine(
                                    context,
                                    'Recorded paid',
                                    '已登记收款',
                                    row.paidCents,
                                    row.currency,
                                  ),
                                  _moneyLine(
                                    context,
                                    'Recorded refunded',
                                    '已登记退款',
                                    row.refundedCents,
                                    row.currency,
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    '${row.uses ?? '—'} ${_giftText(context, 'uses', '次')} · ${row.expireDays ?? '—'} ${_giftText(context, 'days validity', '天有效期')}',
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    _giftText(
                                      context,
                                      'Created: ${row.createdAtLabel}',
                                      '创建时间：${row.createdAtLabel}',
                                    ),
                                    style: const TextStyle(
                                      color: CustomerPalette.muted,
                                    ),
                                  ),
                                  const SizedBox(height: 16),
                                  Text(
                                    row.paymentMethod == 'LEGACY'
                                        ? _giftText(
                                            context,
                                            'This historical order has no supported payment arrangement. Cancel it if permitted and create a new order; do not treat it as paid.',
                                            '此历史订单未记录可用付款方式。若允许，请取消后重新下单，不应视为已付款。',
                                          )
                                        : row.status == 'PENDING'
                                        ? _giftText(
                                            context,
                                            'Awaiting actual payment at the shop. No benefit is issued until staff record full payment.',
                                            '等待到店实际付款；门店登记全额收款前不会发放权益。',
                                          )
                                        : row.status == 'REFUNDED'
                                        ? _giftText(
                                            context,
                                            'The shop recorded an externally completed refund. Linked purchased benefits are void; this is not a new online refund request.',
                                            '门店已登记外部实际完成的退款，关联购买权益已作废；此页不会再发起线上退款。',
                                          )
                                        : _giftText(
                                            context,
                                            'Amounts and status come from the store’s recorded transaction. For questions, contact the named shop.',
                                            '金额与状态来自门店实际办理记录。如有疑问，请联系指定门店。',
                                          ),
                                    style: const TextStyle(
                                      color: CustomerPalette.muted,
                                      height: 1.6,
                                    ),
                                  ),
                                  if (row.entitlementId != null) ...[
                                    const SizedBox(height: 16),
                                    SelectableText(
                                      '${_giftText(context, 'Benefit ID', '权益 ID')}：${row.entitlementId}',
                                    ),
                                    TextButton(
                                      onPressed: _busy
                                          ? null
                                          : () => Navigator.push(
                                              context,
                                              MaterialPageRoute(
                                                builder: (_) =>
                                                    const GiftWalletScreen(),
                                              ),
                                            ),
                                      child: Text(
                                        _giftText(
                                          context,
                                          'View my benefits',
                                          '查看我的权益',
                                        ),
                                      ),
                                    ),
                                  ],
                                  if (row.canCancel) ...[
                                    const SizedBox(height: 16),
                                    OutlinedButton(
                                      onPressed: _busy ? null : _cancelOrder,
                                      child: Text(
                                        _busy
                                            ? _giftText(
                                                context,
                                                'Saving…',
                                                '办理中…',
                                              )
                                            : _giftText(
                                                context,
                                                'Cancel unpaid order',
                                                '取消未付款订单',
                                              ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          if (row != null) ...[
                            _evidence(
                              context,
                              _giftText(
                                context,
                                'Actual payment records',
                                '实际收款记录',
                              ),
                              row.receipts,
                              row.currency,
                              row.timezone,
                            ),
                            _evidence(
                              context,
                              _giftText(
                                context,
                                'Actual refund records',
                                '实际退款记录',
                              ),
                              row.refunds,
                              row.currency,
                              row.timezone,
                            ),
                          ],
                        ],
                      ),
              ),
      ),
    );
  }
}

Widget _moneyLine(
  BuildContext context,
  String en,
  String zh,
  int amount,
  String currency,
) => Padding(
  padding: const EdgeInsets.only(bottom: 10),
  child: Wrap(
    spacing: 12,
    runSpacing: 4,
    children: [
      Text(
        _giftText(context, en, zh),
        style: const TextStyle(color: CustomerPalette.muted),
      ),
      Text(
        formatCents(amount, currency),
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ],
  ),
);
Widget _evidence(
  BuildContext context,
  String title,
  List<Map<String, dynamic>> rows,
  String currency,
  String? timezone,
) => _giftPanel(
  Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(title, style: Theme.of(context).textTheme.titleMedium),
      if (rows.isEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Text(
            _giftText(context, 'No records.', '暂无记录。'),
            style: const TextStyle(color: CustomerPalette.muted),
          ),
        ),
      for (final row in rows)
        Padding(
          padding: const EdgeInsets.only(top: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${formatCents(row['amountCents'] as int, currency)} · ${row['method']}',
              ),
              Text(
                giftShopTimestamp(row['createdAtLocal'] as String?, timezone),
                style: const TextStyle(
                  color: CustomerPalette.muted,
                  fontSize: 12,
                ),
              ),
              if (row['reference'] is String)
                SelectableText(row['reference'] as String),
              if (row['reason'] is String)
                Text(
                  row['reason'] as String,
                  style: const TextStyle(height: 1.6),
                ),
            ],
          ),
        ),
    ],
  ),
);
Widget _giftPager(
  BuildContext context,
  int page,
  int totalPages,
  bool busy,
  ValueChanged<int> change,
) => SafeArea(
  top: false,
  child: Padding(
    padding: const EdgeInsets.all(12),
    child: Row(
      children: [
        Expanded(
          child: Text(
            _giftText(
              context,
              'Page $page/${totalPages < 1 ? 1 : totalPages}',
              '第 $page/${totalPages < 1 ? 1 : totalPages} 页',
            ),
          ),
        ),
        IconButton(
          tooltip: _giftText(context, 'Previous', '上一页'),
          onPressed: busy || page <= 1 ? null : () => change(page - 1),
          icon: const Icon(Icons.chevron_left),
        ),
        IconButton(
          tooltip: _giftText(context, 'Next', '下一页'),
          onPressed: busy || page >= totalPages ? null : () => change(page + 1),
          icon: const Icon(Icons.chevron_right),
        ),
      ],
    ),
  ),
);
