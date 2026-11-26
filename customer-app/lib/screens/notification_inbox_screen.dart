import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../services/notification_inbox_service.dart';
import '../services/business_workflow_service.dart';
import '../theme/customer_theme.dart';
import '../widgets/responsive_content.dart';
import 'booking_detail_screen.dart';

class NotificationInboxScreen extends ConsumerStatefulWidget {
  const NotificationInboxScreen({super.key});
  @override
  ConsumerState<NotificationInboxScreen> createState() =>
      _NotificationInboxScreenState();
}

class _NotificationInboxScreenState
    extends ConsumerState<NotificationInboxScreen> {
  late final String? _account;
  late final ProviderSubscription<AuthState> _auth;
  CancelToken? _cancel;
  CancelToken? _mutation;
  InboxPage? _data;
  int _page = 1;
  bool _unread = false;
  bool _loading = true;
  bool _busy = false;
  bool _invalid = false;
  String? _error;
  bool get _current =>
      mounted &&
      !_invalid &&
      _account != null &&
      ref.read(authProvider).isLoggedIn &&
      ref.read(authProvider).user?.id == _account;
  String _t(String en, String zh) => customerText(context, en, zh);
  @override
  void initState() {
    super.initState();
    _account = ref.read(authProvider).user?.id;
    _auth = ref.listenManual(authProvider, (_, next) {
      if (_invalid || next.isLoggedIn && next.user?.id == _account) return;
      _cancel?.cancel();
      _mutation?.cancel();
      setState(() {
        _invalid = true;
        _data = null;
        _loading = false;
        _busy = false;
        _error = null;
      });
    });
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _auth.close();
    _cancel?.cancel();
    _mutation?.cancel();
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
          .read(notificationInboxProvider)
          .inbox(_page, unreadOnly: _unread, cancelToken: cancel);
      if (!_current || cancel.isCancelled) return;
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

  Future<void> _readAll() async {
    if (!_current || _busy) return;
    final cancel = CancelToken();
    _mutation = cancel;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(notificationInboxProvider).readAll(cancelToken: cancel);
      if (_current && !cancel.isCancelled) await _load();
    } catch (error) {
      if (_current && !cancel.isCancelled) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current && !cancel.isCancelled) setState(() => _busy = false);
    }
  }

  Future<void> _open(InboxMessage message) async {
    if (!_current || _busy) return;
    final cancel = CancelToken();
    _mutation = cancel;
    setState(() => _busy = true);
    try {
      final item = message.readAt == null
          ? await ref
                .read(notificationInboxProvider)
                .read(message.id, cancelToken: cancel)
          : message;
      if (!_current || cancel.isCancelled) return;
      await _load();
      if (!mounted || !_current) return;
      final open = await showDialog<bool>(
        context: context,
        builder: (_) => _InboxDialog(message: item, account: _account!),
      );
      if (open == true && mounted && _current && item.canOpenBooking) {
        await Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => BookingDetailScreen(bookingId: item.bookingId!),
          ),
        );
      }
    } catch (error) {
      if (_current && !cancel.isCancelled) {
        setState(() => _error = businessError(error));
      }
    } finally {
      if (_current && !cancel.isCancelled) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: CustomerPalette.background,
    appBar: AppBar(
      title: Text(_t('Inbox', '站内消息')),
      actions: [
        IconButton(
          tooltip: _t('Reload', '刷新'),
          onPressed: _loading || _busy ? null : _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: !_current
        ? Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                _t(
                  'Your session changed. Close this page and reopen the inbox for your current account.',
                  '登录状态已变化，请关闭此页后重新进入当前账号的消息。',
                ),
              ),
            ),
          )
        : ResponsiveContent(
            maxWidth: 850,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        _t(
                          'Updates recorded in your account. This page does not confirm that a push notification or SMS was delivered.',
                          '此处展示账号内已记录的消息，不代表推送或短信已经送达。',
                        ),
                        style: const TextStyle(
                          color: CustomerPalette.muted,
                          height: 1.6,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 16,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          FilterChip(
                            label: Text(_t('Unread only', '仅看未读')),
                            selected: _unread,
                            onSelected: _busy
                                ? null
                                : (value) {
                                    setState(() {
                                      _unread = value;
                                      _page = 1;
                                    });
                                    _load();
                                  },
                          ),
                          if (_data != null)
                            Text(
                              _t(
                                '${_data!.unreadCount} unread',
                                '${_data!.unreadCount} 条未读',
                              ),
                              style: const TextStyle(
                                color: CustomerPalette.muted,
                              ),
                            ),
                          TextButton(
                            onPressed:
                                _busy ||
                                    _loading ||
                                    (_data?.unreadCount ?? 0) == 0
                                ? null
                                : _readAll,
                            child: Text(_t('Mark all read', '全部标为已读')),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (_busy) const LinearProgressIndicator(),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _error!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: _load,
                          child: Text(_t('Retry', '重试')),
                        ),
                      ],
                    ),
                  ),
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: [
                              if (_data?.items.isEmpty ?? true)
                                Padding(
                                  padding: const EdgeInsets.all(32),
                                  child: Text(
                                    _t('No messages in this view.', '当前没有消息。'),
                                  ),
                                ),
                              ...?_data?.items.map(
                                (item) => Card(
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.all(16),
                                    leading: Icon(
                                      item.readAt == null
                                          ? Icons.mark_email_unread_outlined
                                          : Icons.drafts_outlined,
                                      color: CustomerPalette.action,
                                    ),
                                    title: Text(
                                      item.title,
                                      style: TextStyle(
                                        fontWeight: item.readAt == null
                                            ? FontWeight.w600
                                            : FontWeight.normal,
                                      ),
                                    ),
                                    subtitle: Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: Text(
                                        item.body,
                                        maxLines: 3,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    onTap: _busy ? null : () => _open(item),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                ),
                if (_data != null && _data!.total > 0)
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _t(
                                'Page $_page/${_data!.totalPages}',
                                '第 $_page/${_data!.totalPages} 页',
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: _t('Previous', '上一页'),
                            onPressed: _loading || _busy || _page <= 1
                                ? null
                                : () {
                                    _page--;
                                    _load();
                                  },
                            icon: const Icon(Icons.chevron_left),
                          ),
                          IconButton(
                            tooltip: _t('Next', '下一页'),
                            onPressed:
                                _loading || _busy || _page >= _data!.totalPages
                                ? null
                                : () {
                                    _page++;
                                    _load();
                                  },
                            icon: const Icon(Icons.chevron_right),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
  );
}

class _InboxDialog extends ConsumerWidget {
  final InboxMessage message;
  final String account;
  const _InboxDialog({required this.message, required this.account});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final current = auth.isLoggedIn && auth.user?.id == account;
    return AlertDialog(
      title: Text(
        current
            ? message.title
            : customerText(context, 'Session changed', '登录状态已变化'),
      ),
      content: SingleChildScrollView(
        child: Text(
          current
              ? message.body
              : customerText(
                  context,
                  'Reopen the inbox for your current account.',
                  '请重新进入当前账号的消息。',
                ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(customerText(context, 'Close', '关闭')),
        ),
        if (current && message.canOpenBooking)
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(customerText(context, 'View booking', '查看预约')),
          ),
      ],
    );
  }
}
