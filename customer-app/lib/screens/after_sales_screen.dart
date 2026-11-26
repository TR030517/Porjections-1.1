import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking.dart';
import '../models/money.dart';
import '../providers/auth_provider.dart';
import '../services/business_workflow_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/app_empty_state.dart';
import '../navigation/booking_center_navigation.dart';

String _text(BuildContext context, String en, String zh) =>
    customerText(context, en, zh);
String? _accountId(AuthState auth) => auth.isLoggedIn ? auth.user?.id : null;

Widget _accountChangedView(BuildContext context) => Center(
  child: Padding(
    padding: const EdgeInsets.all(24),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          _text(
            context,
            'Your account or session changed. Return to the list and reopen the request for your current account.',
            '账号或登录状态已变化，请返回列表后重新打开当前账号的工单。',
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => Navigator.maybePop(context),
          child: Text(_text(context, 'Go back', '返回')),
        ),
      ],
    ),
  ),
);
String _status(BuildContext context, String status) {
  const labels = {
    'OPEN': ['Open', '待受理'],
    'IN_PROGRESS': ['In progress', '处理中'],
    'WAITING_CUSTOMER': ['Your reply needed', '待您回复'],
    'RESOLVED': ['Resolved', '已解决'],
    'REJECTED': ['Declined', '已驳回'],
    'WITHDRAWN': ['Withdrawn', '已撤回'],
  };
  final pair = labels[status];
  return pair == null ? status : _text(context, pair[0], pair[1]);
}

String _type(BuildContext context, String type) {
  const labels = {
    'REFUND': ['Refund request', '退款申请'],
    'RESCHEDULE': ['Rescheduling help', '改期协助'],
    'COMPLAINT': ['Service concern', '服务投诉'],
    'OTHER': ['Other question', '其他问题'],
  };
  final pair = labels[type];
  return pair == null ? type : _text(context, pair[0], pair[1]);
}

bool _isInStoreRefund(Map<String, dynamic> item) =>
    item['type'] == 'REFUND' && item['refundMode'] == 'PAY_AT_STORE';

String _caseTitle(BuildContext context, Map<String, dynamic> item) {
  final type = _isInStoreRefund(item)
      ? _text(context, 'In-store refund request', '门店退款申请')
      : _type(context, item['type']);
  return '$type · ${_status(context, item['status'])}';
}

class AfterSalesScreen extends ConsumerStatefulWidget {
  const AfterSalesScreen({super.key});
  @override
  ConsumerState<AfterSalesScreen> createState() => _AfterSalesScreenState();
}

class _AfterSalesScreenState extends ConsumerState<AfterSalesScreen> {
  WorkflowPage? _data;
  String? _error;
  bool _loading = true;
  int _page = 1;
  CancelToken? _cancel;
  String? _account;
  int _accountEpoch = 0;
  late final ProviderSubscription<AuthState> _authSubscription;
  @override
  void initState() {
    super.initState();
    _account = _accountId(ref.read(authProvider));
    _authSubscription = ref.listenManual(authProvider, (previous, next) {
      final account = _accountId(next);
      if (account == _account) return;
      _cancel?.cancel();
      final epoch = ++_accountEpoch;
      setState(() {
        _account = account;
        _page = 1;
        _data = null;
        _error = null;
        _loading = account != null;
      });
      if (account != null) {
        Future.microtask(() {
          if (_isCurrentAccount(account, epoch)) _load();
        });
      }
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _authSubscription.close();
    _cancel?.cancel();
    super.dispose();
  }

  bool _isCurrentAccount(String? account, int epoch) =>
      mounted &&
      account != null &&
      account == _account &&
      epoch == _accountEpoch &&
      _accountId(ref.read(authProvider)) == account;
  Future<void> _load() async {
    if (!mounted) return;
    final account = _account;
    final epoch = _accountEpoch;
    if (!_isCurrentAccount(account, epoch)) {
      setState(() {
        _loading = false;
        _data = null;
        _error = null;
      });
      return;
    }
    _cancel?.cancel();
    final cancel = CancelToken();
    _cancel = cancel;
    bool acceptsResponse() =>
        !cancel.isCancelled && _isCurrentAccount(account, epoch);
    setState(() {
      _loading = true;
      _error = null;
      _data = null;
    });
    try {
      final result = await ref
          .read(businessWorkflowProvider)
          .cases(page: _page, cancelToken: cancel);
      if (acceptsResponse()) setState(() => _data = result);
    } catch (error) {
      if (acceptsResponse()) setState(() => _error = businessError(error));
    } finally {
      if (acceptsResponse()) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    final epoch = _accountEpoch;
    return Scaffold(
      appBar: AppBar(
        title: Text(_text(context, 'Support requests', '售后服务')),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: !ref.watch(authProvider).isLoggedIn
          ? Center(
              child: Text(
                _text(context, 'Please sign in to view requests.', '请登录后查看工单。'),
              ),
            )
          : _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? AppErrorState(message: _error!, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    _text(
                      context,
                      'Need help with a booking? Open your bookings and choose Support.',
                      '需要预约协助？请从预约记录中的“售后服务”提交。',
                    ),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton.icon(
                      onPressed: () => openBookingCenter(context, ref),
                      icon: const Icon(Icons.calendar_today_outlined),
                      label: const Text('Choose a booking for support'),
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (_data?.items.isEmpty ?? true)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 60),
                      child: Center(
                        child: Text(
                          _text(context, 'No support requests yet.', '暂无售后工单。'),
                        ),
                      ),
                    ),
                  ...?_data?.items.map((item) {
                    final booking = item['booking'] as Map;
                    return Card(
                      child: ListTile(
                        contentPadding: const EdgeInsets.all(18),
                        leading: const Icon(
                          Icons.support_agent,
                          color: Color(0xFF0D6B5E),
                        ),
                        title: Text(_caseTitle(context, item)),
                        subtitle: Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            '${booking['shopName']}\n${booking['bookingNo']}\n${item['reason']}',
                            maxLines: 4,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () async {
                          if (!_isCurrentAccount(account, epoch)) return;
                          await Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => AfterSalesDetailScreen(
                                id: item['id'].toString(),
                                openingAccount: account,
                              ),
                            ),
                          );
                          if (_isCurrentAccount(account, epoch)) _load();
                        },
                      ),
                    );
                  }),
                  if (_data != null)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${_data!.total} · ${_text(context, 'Page', '页')} $_page',
                        ),
                        TextButton(
                          onPressed: _page > 1
                              ? () {
                                  _page--;
                                  _load();
                                }
                              : null,
                          child: Text(_text(context, 'Previous', '上一页')),
                        ),
                        TextButton(
                          onPressed: _data!.hasNext
                              ? () {
                                  _page++;
                                  _load();
                                }
                              : null,
                          child: Text(_text(context, 'Next', '下一页')),
                        ),
                      ],
                    ),
                ],
              ),
            ),
    );
  }
}

class CreateAfterSalesScreen extends ConsumerStatefulWidget {
  final Booking booking;
  final String initialType;
  const CreateAfterSalesScreen({
    super.key,
    required this.booking,
    this.initialType = 'OTHER',
  });
  @override
  ConsumerState<CreateAfterSalesScreen> createState() =>
      _CreateAfterSalesScreenState();
}

class _CreateAfterSalesScreenState
    extends ConsumerState<CreateAfterSalesScreen> {
  final _form = GlobalKey<FormState>();
  final _reason = TextEditingController(), _amount = TextEditingController();
  late String _typeValue;
  bool _busy = false;
  String? _error;
  late final String? _openingAccount;
  late final ProviderSubscription<AuthState> _authSubscription;
  bool _accountInvalid = false;
  bool get _hasOpeningAccount =>
      mounted &&
      !_accountInvalid &&
      _openingAccount != null &&
      _accountId(ref.read(authProvider)) == _openingAccount;
  @override
  void initState() {
    super.initState();
    _openingAccount = _accountId(ref.read(authProvider));
    _accountInvalid =
        _openingAccount == null || widget.booking.userId != _openingAccount;
    final refundable =
        (widget.booking.paidCents ?? 0) - (widget.booking.refundedCents ?? 0);
    final types = [
      'OTHER',
      'RESCHEDULE',
      'COMPLAINT',
      if (refundable > 0 && widget.booking.currency != null) 'REFUND',
    ];
    _typeValue = types.contains(widget.initialType)
        ? widget.initialType
        : 'OTHER';
    _authSubscription = ref.listenManual(authProvider, (previous, next) {
      if (_accountInvalid || _accountId(next) == _openingAccount) return;
      _reason.clear();
      _amount.clear();
      setState(() {
        _accountInvalid = true;
        _busy = false;
        _error = null;
      });
    });
  }

  @override
  void dispose() {
    _authSubscription.close();
    _reason.dispose();
    _amount.dispose();
    super.dispose();
  }

  int? _cents() {
    final value = _amount.text.trim();
    if (!RegExp(r'^\d{1,6}(\.\d{1,2})?$').hasMatch(value)) return null;
    final parts = value.split('.');
    return int.parse(parts[0]) * 100 +
        (parts.length == 2 ? int.parse(parts[1].padRight(2, '0')) : 0);
  }

  Future<void> _submit() async {
    if (!_hasOpeningAccount ||
        _busy ||
        !(_form.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final item = await ref
          .read(businessWorkflowProvider)
          .createCase(
            bookingId: widget.booking.id,
            type: _typeValue,
            reason: _reason.text.trim(),
            requestedAmountCents: _typeValue == 'REFUND' ? _cents() : null,
          );
      if (!mounted || !_hasOpeningAccount) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => AfterSalesDetailScreen(
            id: item['id'].toString(),
            openingAccount: _openingAccount,
          ),
        ),
      );
    } catch (error) {
      if (_hasOpeningAccount) setState(() => _error = businessError(error));
    } finally {
      if (_hasOpeningAccount) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_hasOpeningAccount) {
      return Scaffold(
        appBar: AppBar(
          title: Text(_text(context, 'New support request', '提交售后申请')),
        ),
        body: _accountChangedView(context),
      );
    }
    final booking = widget.booking;
    final refundable = (booking.paidCents ?? 0) - (booking.refundedCents ?? 0);
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        appBar: AppBar(
          title: Text(_text(context, 'New support request', '提交售后申请')),
        ),
        body: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                booking.shop?.name ?? booking.bookingNo,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text('${booking.bookingNo} · ${booking.formattedDate}'),
              const SizedBox(height: 24),
              DropdownButtonFormField<String>(
                initialValue: _typeValue,
                decoration: InputDecoration(
                  labelText: _text(context, 'Request type', '问题类型'),
                ),
                items:
                    [
                          'OTHER',
                          'RESCHEDULE',
                          'COMPLAINT',
                          if (refundable > 0 && booking.currency != null)
                            'REFUND',
                        ]
                        .map(
                          (type) => DropdownMenuItem(
                            value: type,
                            child: Text(_type(context, type)),
                          ),
                        )
                        .toList(),
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _typeValue = value!),
              ),
              if (_typeValue == 'REFUND') ...[
                const SizedBox(height: 20),
                TextFormField(
                  controller: _amount,
                  enabled: !_busy,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: _text(context, 'Requested amount', '申请退款金额'),
                    suffixText: booking.currency?.toUpperCase(),
                    helperText:
                        '${_text(context, 'Available', '最多可申请')} ${formatCents(refundable, booking.currency!)}',
                  ),
                  validator: (_) {
                    final cents = _cents();
                    return cents == null || cents <= 0 || cents > refundable
                        ? _text(
                            context,
                            'Enter an amount within the available balance.',
                            '请输入可退余额内的金额，最多两位小数。',
                          )
                        : null;
                  },
                ),
              ],
              const SizedBox(height: 20),
              TextFormField(
                controller: _reason,
                enabled: !_busy,
                maxLength: 2000,
                minLines: 5,
                maxLines: 10,
                decoration: InputDecoration(
                  labelText: _text(context, 'Tell us what happened', '问题说明'),
                  alignLabelWithHint: true,
                ),
                validator: (value) => value == null || value.trim().isEmpty
                    ? _text(
                        context,
                        'Please describe your request.',
                        '请填写具体说明。',
                      )
                    : value.trim().length > 2000
                    ? _text(
                        context,
                        'Use no more than 2,000 characters.',
                        '请将说明控制在 2000 个字符以内。',
                      )
                    : null,
              ),
              const SizedBox(height: 12),
              Text(
                _text(
                  context,
                  'Submitting a request does not cancel or reschedule your booking.',
                  '提交工单不会自动取消或改期。',
                ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (_typeValue == 'REFUND') ...[
                const SizedBox(height: 6),
                Text(switch (booking.paymentMode) {
                  'PAY_AT_STORE' => _text(
                    context,
                    'The shop handles approved refunds for payments made in store.',
                    '到店付款的退款申请经审核通过后，由门店处理。',
                  ),
                  'ONLINE' => _text(
                    context,
                    'Refunds are returned through the original payment method after review.',
                    '退款经审核后退回原付款渠道。',
                  ),
                  _ => _text(
                    context,
                    'Refund requests are reviewed before a refund is issued.',
                    '退款申请审核通过后才会退款。',
                  ),
                }, style: Theme.of(context).textTheme.bodySmall),
              ],
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy || !ref.watch(authProvider).isLoggedIn
                    ? null
                    : _submit,
                child: Text(
                  _busy
                      ? _text(context, 'Submitting…', '正在提交…')
                      : _text(context, 'Submit request', '提交申请'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AfterSalesDetailScreen extends ConsumerStatefulWidget {
  final String id;
  final String? openingAccount;
  const AfterSalesDetailScreen({
    super.key,
    required this.id,
    this.openingAccount,
  });
  @override
  ConsumerState<AfterSalesDetailScreen> createState() =>
      _AfterSalesDetailScreenState();
}

class _AfterSalesDetailScreenState
    extends ConsumerState<AfterSalesDetailScreen> {
  Map<String, dynamic>? _item;
  WorkflowPage? _events;
  final _reply = TextEditingController();
  CancelToken? _cancel;
  int _eventPage = 1;
  bool _busy = false, _loading = true;
  String? _error;
  late final String? _openingAccount;
  late final ProviderSubscription<AuthState> _authSubscription;
  bool _accountInvalid = false;
  bool get _hasOpeningAccount =>
      mounted &&
      !_accountInvalid &&
      _openingAccount != null &&
      _accountId(ref.read(authProvider)) == _openingAccount;
  @override
  void initState() {
    super.initState();
    _openingAccount =
        widget.openingAccount ?? _accountId(ref.read(authProvider));
    _accountInvalid =
        _openingAccount == null ||
        _accountId(ref.read(authProvider)) != _openingAccount;
    _authSubscription = ref.listenManual(authProvider, (previous, next) {
      if (_accountInvalid || _accountId(next) == _openingAccount) return;
      _cancel?.cancel();
      _reply.clear();
      setState(() {
        _accountInvalid = true;
        _item = null;
        _events = null;
        _error = null;
        _loading = false;
        _busy = false;
        _eventPage = 1;
      });
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _authSubscription.close();
    _cancel?.cancel();
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!_hasOpeningAccount) return;
    _cancel?.cancel();
    final cancel = CancelToken();
    _cancel = cancel;
    bool acceptsResponse() => _hasOpeningAccount && !cancel.isCancelled;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final service = ref.read(businessWorkflowProvider);
      final results = await Future.wait([
        service.caseDetail(widget.id, cancelToken: cancel),
        service.caseEvents(widget.id, _eventPage, cancelToken: cancel),
      ]);
      if (acceptsResponse()) {
        setState(() {
          _item = results[0] as Map<String, dynamic>;
          _events = results[1] as WorkflowPage;
        });
      }
    } catch (error) {
      if (acceptsResponse()) setState(() => _error = businessError(error));
    } finally {
      if (acceptsResponse()) setState(() => _loading = false);
    }
  }

  Future<void> _write({bool withdraw = false}) async {
    if (!_hasOpeningAccount ||
        _busy ||
        _loading ||
        _item == null ||
        _reply.text.trim().isEmpty) {
      return;
    }
    if (_reply.text.trim().length > 2000) {
      setState(
        () => _error = _text(
          context,
          'Use no more than 2,000 characters.',
          '请将说明控制在 2000 个字符以内。',
        ),
      );
      return;
    }
    final item = _item!;
    if (withdraw &&
        await showDialog<bool>(
              context: context,
              builder: (context) => AlertDialog(
                title: Text(_text(context, 'Withdraw request?', '撤回此申请？')),
                content: Text(
                  _text(
                    context,
                    'This closes the request. Processing history will be retained.',
                    '撤回后工单结束，处理记录将保留。',
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: Text(_text(context, 'Keep', '保留')),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: Text(_text(context, 'Withdraw', '撤回')),
                  ),
                ],
              ),
            ) !=
            true) {
      return;
    }
    if (!_hasOpeningAccount || _busy || _loading) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final service = ref.read(businessWorkflowProvider);
      final result = withdraw
          ? await service.withdraw(item, _reply.text.trim())
          : await service.reply(item, _reply.text.trim());
      if (!_hasOpeningAccount) return;
      setState(() {
        _item = result;
        _reply.clear();
        _eventPage = 1;
      });
      await _load();
    } catch (error) {
      if (_hasOpeningAccount) {
        if (error is DioException && error.response?.statusCode == 409) {
          await _load();
        }
        if (_hasOpeningAccount) setState(() => _error = businessError(error));
      }
    } finally {
      if (_hasOpeningAccount) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_hasOpeningAccount) {
      return Scaffold(
        appBar: AppBar(title: Text(_text(context, 'Request details', '售后详情'))),
        body: _accountChangedView(context),
      );
    }
    final item = _item;
    final actions = (item?['allowedActions'] as List?) ?? [];
    final booking = item?['booking'] as Map?;
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        appBar: AppBar(
          title: Text(_text(context, 'Request details', '售后详情')),
          actions: [
            IconButton(
              onPressed: _busy || _loading ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: !ref.watch(authProvider).isLoggedIn
            ? Center(child: Text(_text(context, 'Please sign in.', '请先登录。')))
            : _loading && item == null
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        _error!,
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  if (item != null) ...[
                    Text(
                      _caseTitle(context, item),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    Text('${booking?['shopName']} · ${booking?['bookingNo']}'),
                    const SizedBox(height: 16),
                    Text(item['reason']),
                    if (item['requestedAmountCents'] != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: Text(
                          '${_text(context, 'Requested refund', '申请退款')}: ${formatCents((item['requestedAmountCents'] as num).toInt(), item['currency'])}',
                        ),
                      ),
                    if (item['type'] == 'REFUND')
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_refundLabel(item)),
                      ),
                    const SizedBox(height: 24),
                    Text(
                      _text(context, 'Conversation & updates', '沟通与进展'),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 12),
                    ...?_events?.items.map(
                      (event) => Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${event['actorRole'] == 'CUSTOMER' ? _text(context, 'You', '您') : _text(context, 'Support team', '服务团队')} · ${DateTime.parse(event['createdAt']).toLocal().toString().split('.').first}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                event['content'] ??
                                    _text(
                                      context,
                                      'Request updated',
                                      '工单状态已更新',
                                    ),
                              ),
                              if (event['toStatus'] != event['fromStatus'])
                                Text(
                                  _status(context, event['toStatus']),
                                  style: const TextStyle(
                                    color: Color(0xFF0D6B5E),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (_events != null)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: _busy || _loading || _eventPage <= 1
                                ? null
                                : () {
                                    _eventPage--;
                                    _load();
                                  },
                            child: Text(_text(context, 'Previous', '上一页')),
                          ),
                          Text('$_eventPage'),
                          TextButton(
                            onPressed: _busy || _loading || !_events!.hasNext
                                ? null
                                : () {
                                    _eventPage++;
                                    _load();
                                  },
                            child: Text(_text(context, 'Next', '下一页')),
                          ),
                        ],
                      ),
                    if (actions.contains('NOTE') ||
                        actions.contains('WITHDRAW')) ...[
                      const SizedBox(height: 20),
                      TextField(
                        controller: _reply,
                        enabled: !_busy,
                        minLines: 3,
                        maxLines: 8,
                        maxLength: 2000,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: _text(
                            context,
                            'Reply or withdrawal reason',
                            '补充说明或撤回理由',
                          ),
                          alignLabelWithHint: true,
                        ),
                      ),
                      Wrap(
                        spacing: 12,
                        children: [
                          if (actions.contains('NOTE'))
                            FilledButton(
                              onPressed:
                                  _busy ||
                                      _loading ||
                                      _reply.text.trim().isEmpty
                                  ? null
                                  : () => _write(),
                              child: Text(_text(context, 'Send reply', '发送回复')),
                            ),
                          if (actions.contains('WITHDRAW'))
                            OutlinedButton(
                              onPressed:
                                  _busy ||
                                      _loading ||
                                      _reply.text.trim().isEmpty
                                  ? null
                                  : () => _write(withdraw: true),
                              child: Text(
                                _text(context, 'Withdraw request', '撤回申请'),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ],
              ),
      ),
    );
  }

  String _refundLabel(Map<String, dynamic> item) {
    if (_isInStoreRefund(item)) {
      final cents = item['offlineRefundRecordedCents'];
      if (cents is int && cents > 0) {
        final label = _text(context, 'Refund recorded by the shop', '门店已登记退款');
        return '$label: ${formatCents(cents, item['currency'])}';
      }
      final booking = item['booking'] as Map?;
      final refundedCents = booking?['refundedCents'];
      if (booking?['paymentStatus'] == 'REFUNDED' ||
          (refundedCents is int && refundedCents > 0)) {
        return _text(
          context,
          'The booking shows a refund. Contact the shop to verify whether it covers this request.',
          '此预约显示有退款，请联系门店核实是否对应本次申请。',
        );
      }
      return _text(context, 'No in-store refund recorded yet', '门店尚未登记退款');
    }
    const labels = {
      'NONE': ['Not submitted to payment provider', '尚未向支付渠道提交'],
      'IN_FLIGHT': ['Refund request in progress', '退款请求处理中'],
      'PENDING': ['Processing with payment provider', '支付渠道处理中'],
      'RETRYABLE': ['Awaiting refund reconciliation', '等待退款同步确认'],
      'SUCCEEDED': ['Refund succeeded', '退款成功'],
      'FAILED': ['Refund failed — support is required', '退款失败，需服务团队处理'],
    };
    final state = item['refundState'] as String;
    final pair = labels[state];
    return pair == null ? state : _text(context, pair[0], pair[1]);
  }
}
