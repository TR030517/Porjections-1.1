import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../models/gift_time.dart';
import '../services/business_workflow_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/app_empty_state.dart';

String _text(BuildContext context, String en, String zh) =>
    customerText(context, en, zh);
String? _accountId(AuthState auth) => auth.isLoggedIn ? auth.user?.id : null;
Widget _accountChangedView(BuildContext context) => Padding(
  padding: const EdgeInsets.all(24),
  child: Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(
        _text(
          context,
          'Your account or session changed. Close this page and reopen the benefit for your current account.',
          '账号或登录状态已变化，请关闭此页后重新打开当前账号的权益。',
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
);
String _status(BuildContext context, String value) {
  const labels = {
    'ACTIVE': ['Available', '可使用'],
    'EXHAUSTED': ['Fully used', '已用完'],
    'EXPIRED': ['Expired', '已过期'],
    'VOIDED': ['Voided', '已作废'],
  };
  final pair = labels[value];
  return pair == null ? value : _text(context, pair[0], pair[1]);
}

class GiftWalletScreen extends ConsumerStatefulWidget {
  const GiftWalletScreen({super.key});
  @override
  ConsumerState<GiftWalletScreen> createState() => _GiftWalletScreenState();
}

class _GiftWalletScreenState extends ConsumerState<GiftWalletScreen> {
  WorkflowPage? _data;
  int _page = 1;
  CancelToken? _cancel;
  bool _loading = true;
  String? _error;
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
          .giftRights(page: _page, cancelToken: cancel);
      if (acceptsResponse()) setState(() => _data = result);
    } catch (error) {
      if (acceptsResponse()) setState(() => _error = businessError(error));
    } finally {
      if (acceptsResponse()) setState(() => _loading = false);
    }
  }

  Future<void> _show(
    Map<String, dynamic> item,
    String? account,
    int epoch,
  ) async {
    if (!_isCurrentAccount(account, epoch)) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => GiftCredentialSheet(item: item, openingAccount: account),
    );
    if (_isCurrentAccount(account, epoch)) _load();
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    final epoch = _accountEpoch;
    return Scaffold(
      appBar: AppBar(
        title: Text(_text(context, 'My gift benefits', '我的礼品权益')),
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
                _text(context, 'Please sign in to view benefits.', '请登录后查看权益。'),
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
                      'Store benefits are valid only at the named store. Ask the store to redeem them when you arrive.',
                      '权益仅限指定门店使用。到店服务时，请向工作人员出示短时核销凭证。',
                    ),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 20),
                  if (_data?.items.isEmpty ?? true)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 70),
                      child: Center(
                        child: Text(
                          _text(context, 'No gift benefits yet.', '暂无礼品权益。'),
                        ),
                      ),
                    ),
                  ...?_data?.items.map((item) {
                    final shop = item['shop'] as Map;
                    final active =
                        item['status'] == 'ACTIVE' &&
                        (item['remainingUses'] as num) > 0 &&
                        DateTime.parse(
                          item['expiresAt'],
                        ).isAfter(DateTime.now());
                    return Card(
                      margin: const EdgeInsets.only(bottom: 16),
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(
                                  Icons.card_giftcard,
                                  color: Color(0xFF0D6B5E),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    item['productTitleSnapshot'] ??
                                        _text(context, 'Store benefit', '门店权益'),
                                    style: Theme.of(
                                      context,
                                    ).textTheme.titleMedium,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  _status(context, item['status']),
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Text(shop['name']),
                            const SizedBox(height: 10),
                            Text(
                              '${item['remainingUses']} / ${item['totalUses']} ${_text(context, 'uses remaining', '次可用')}',
                              style: const TextStyle(
                                color: Color(0xFF0D6B5E),
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              '${_text(context, 'Expires', '到期时间')} · ${giftShopTimestamp(item['expiresAtLocal'] as String?, item['timezone'] as String?)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              item['source'] == 'PROMOTIONAL'
                                  ? _text(
                                      context,
                                      'Complimentary store benefit',
                                      '门店赠送权益',
                                    )
                                  : (item['source'] == 'PURCHASED' ||
                                        item['source'] == 'PURCHASE')
                                  ? _text(context, 'Purchased benefit', '购买权益')
                                  : _text(
                                      context,
                                      'Historical benefit',
                                      '历史权益',
                                    ),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            const SizedBox(height: 14),
                            Wrap(
                              spacing: 12,
                              children: [
                                if (active)
                                  FilledButton.icon(
                                    onPressed: () =>
                                        _show(item, account, epoch),
                                    icon: const Icon(
                                      Icons.confirmation_number_outlined,
                                    ),
                                    label: Text(
                                      _text(
                                        context,
                                        'Show redemption code',
                                        '出示核销凭证',
                                      ),
                                    ),
                                  ),
                                TextButton(
                                  onPressed: () {
                                    if (_isCurrentAccount(account, epoch)) {
                                      Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => GiftHistoryScreen(
                                            id: item['id'].toString(),
                                            openingAccount: account,
                                          ),
                                        ),
                                      );
                                    }
                                  },
                                  child: Text(
                                    _text(context, 'Usage history', '使用记录'),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
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

class GiftCredentialSheet extends ConsumerStatefulWidget {
  final Map<String, dynamic> item;
  final String? openingAccount;
  const GiftCredentialSheet({
    super.key,
    required this.item,
    this.openingAccount,
  });
  @override
  ConsumerState<GiftCredentialSheet> createState() =>
      _GiftCredentialSheetState();
}

class _GiftCredentialSheetState extends ConsumerState<GiftCredentialSheet>
    with WidgetsBindingObserver {
  final _uses = TextEditingController(text: '1');
  Map<String, dynamic>? _credential;
  String? _error;
  bool _busy = false;
  Timer? _timer;
  int _seconds = 0;
  late final String? _openingAccount;
  late final ProviderSubscription<AuthState> _authSubscription;
  bool _accountInvalid = false;
  bool _foreground = true;
  int _requestEpoch = 0;
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
        _accountId(ref.read(authProvider)) != _openingAccount ||
        widget.item['userId']?.toString() != _openingAccount;
    _foreground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _authSubscription = ref.listenManual(authProvider, (previous, next) {
      if (_accountInvalid || _accountId(next) == _openingAccount) return;
      _requestEpoch++;
      _timer?.cancel();
      _uses.clear();
      setState(() {
        _accountInvalid = true;
        _credential = null;
        _seconds = 0;
        _error = null;
        _busy = false;
      });
    });
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    _authSubscription.close();
    WidgetsBinding.instance.removeObserver(this);
    _requestEpoch++;
    _timer?.cancel();
    _uses.dispose();
    _credential = null;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    if (state == AppLifecycleState.resumed) {
      setState(() => _foreground = true);
      return;
    }
    _requestEpoch++;
    _timer?.cancel();
    setState(() {
      _foreground = false;
      _credential = null;
      _seconds = 0;
      _error = null;
    });
  }

  Future<void> _generate() async {
    if (!_hasOpeningAccount || !_foreground || _busy) return;
    final uses = int.tryParse(_uses.text);
    if (uses == null ||
        uses < 1 ||
        uses > (widget.item['remainingUses'] as num)) {
      setState(
        () => _error = _text(
          context,
          'Enter a valid number of uses.',
          '请输入可用次数范围内的整数。',
        ),
      );
      return;
    }
    final epoch = ++_requestEpoch;
    bool acceptsResponse() =>
        _hasOpeningAccount && _foreground && epoch == _requestEpoch;
    _timer?.cancel();
    setState(() {
      _busy = true;
      _error = null;
      _credential = null;
    });
    try {
      final result = await ref
          .read(businessWorkflowProvider)
          .giftCredential(widget.item['id'].toString(), uses);
      if (!acceptsResponse()) return;
      final expiry = DateTime.parse(result['expiresAt']);
      setState(() {
        _credential = result;
        _seconds = expiry.difference(DateTime.now()).inSeconds;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!acceptsResponse()) {
          timer.cancel();
          return;
        }
        final remaining = expiry.difference(DateTime.now()).inSeconds;
        if (remaining <= 0) {
          timer.cancel();
          setState(() {
            _credential = null;
            _seconds = 0;
          });
        } else {
          setState(() => _seconds = remaining);
        }
      });
    } catch (error) {
      if (acceptsResponse()) setState(() => _error = businessError(error));
    } finally {
      // A hidden request still runs on the server. Wait for it to settle before
      // allowing another code to rotate the credential, but never reveal its result.
      if (_hasOpeningAccount) setState(() => _busy = false);
    }
  }

  Future<void> _copyCode(Map<String, dynamic> credential) async {
    final epoch = _requestEpoch;
    bool isCurrent() =>
        _hasOpeningAccount &&
        _foreground &&
        epoch == _requestEpoch &&
        identical(credential, _credential) &&
        _seconds > 0;
    if (!isCurrent()) return;
    try {
      await Clipboard.setData(ClipboardData(text: credential['token']));
      if (!mounted || !isCurrent()) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _text(
              context,
              'Code copied. Share it only with staff at this store.',
              '凭证已复制，仅向本店工作人员提供。',
            ),
          ),
        ),
      );
    } catch (_) {
      if (mounted && isCurrent()) {
        setState(
          () => _error = _text(
            context,
            'Unable to copy the code. Please try again.',
            '未能复制凭证，请重试。',
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_hasOpeningAccount) {
      return SafeArea(child: _accountChangedView(context));
    }
    final credential = _credential;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        24,
        24,
        MediaQuery.viewInsetsOf(context).bottom + 28,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _text(context, 'Redeem at the store', '到店核销'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            Text((widget.item['shop'] as Map)['name']),
            const SizedBox(height: 16),
            TextField(
              controller: _uses,
              enabled: !_busy && credential == null,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: _text(context, 'Uses for this visit', '本次使用次数'),
                helperText:
                    '${_text(context, 'Remaining', '剩余')} ${widget.item['remainingUses']}',
              ),
            ),
            const SizedBox(height: 16),
            Text(
              _text(
                context,
                'Generate a code only when staff are ready. The code is valid for up to 5 minutes and authorizes exactly the selected number of uses. A new code invalidates the previous one.',
                '请在工作人员准备核销时生成。凭证最多有效 5 分钟，仅授权本次指定次数；重新生成会使旧凭证失效。',
              ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            if (credential != null && _seconds > 0)
              Container(
                margin: const EdgeInsets.symmetric(vertical: 20),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F6F2),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${credential['usedUses']} ${_text(context, 'uses', '次')} · ${_text(context, 'Valid for', '剩余')} $_seconds s',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF0D6B5E),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SelectableText(
                      credential['token'],
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 15,
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () => _copyCode(credential),
                      icon: const Icon(Icons.copy, size: 16),
                      label: Text(_text(context, 'Copy code', '复制凭证')),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _busy || !_foreground ? null : _generate,
                child: Text(
                  _busy
                      ? _text(context, 'Generating…', '正在生成…')
                      : credential == null
                      ? _text(context, 'Generate code', '生成凭证')
                      : _text(context, 'Replace code', '重新生成凭证'),
                ),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: _busy ? null : () => Navigator.pop(context),
                child: Text(_text(context, 'Close', '关闭')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class GiftHistoryScreen extends ConsumerStatefulWidget {
  final String id;
  final String? openingAccount;
  const GiftHistoryScreen({super.key, required this.id, this.openingAccount});
  @override
  ConsumerState<GiftHistoryScreen> createState() => _GiftHistoryScreenState();
}

class _GiftHistoryScreenState extends ConsumerState<GiftHistoryScreen> {
  WorkflowPage? _data;
  CancelToken? _cancel;
  int _page = 1;
  bool _loading = true;
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
      setState(() {
        _accountInvalid = true;
        _data = null;
        _error = null;
        _loading = false;
        _page = 1;
      });
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _authSubscription.close();
    _cancel?.cancel();
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
      _data = null;
    });
    try {
      final result = await ref
          .read(businessWorkflowProvider)
          .giftHistory(widget.id, _page, cancelToken: cancel);
      if (acceptsResponse()) setState(() => _data = result);
    } catch (error) {
      if (acceptsResponse()) setState(() => _error = businessError(error));
    } finally {
      if (acceptsResponse()) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_hasOpeningAccount) {
      return Scaffold(
        appBar: AppBar(title: Text(_text(context, 'Usage history', '使用记录'))),
        body: Center(child: _accountChangedView(context)),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(_text(context, 'Usage history', '使用记录'))),
      body: !ref.watch(authProvider).isLoggedIn
          ? Center(child: Text(_text(context, 'Please sign in.', '请先登录。')))
          : _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? AppErrorState(message: _error!, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (_data?.items.isEmpty ?? true)
                  Text(_text(context, 'No redemptions recorded.', '尚无核销记录。')),
                ...?_data?.items.map(
                  (item) => Card(
                    child: ListTile(
                      leading: const Icon(
                        Icons.check_circle_outline,
                        color: Color(0xFF0D6B5E),
                      ),
                      title: Text(
                        '${item['usedUses']} ${_text(context, 'uses redeemed', '次已核销')}',
                      ),
                      subtitle: Text(giftShopTimestamp(item['createdAtLocal'] as String?, item['timezone'] as String?)),
                    ),
                  ),
                ),
                if (_data != null)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: _page > 1
                            ? () {
                                _page--;
                                _load();
                              }
                            : null,
                        child: Text(_text(context, 'Previous', '上一页')),
                      ),
                      Text('$_page'),
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
    );
  }
}
