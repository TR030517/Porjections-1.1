import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../widgets/public_information_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../services/social_auth_service.dart';
import '../services/api_service.dart';
import '../theme/customer_theme.dart';
import 'home_screen.dart';
import 'customer_password_screen.dart';

class LoginScreen extends ConsumerStatefulWidget {
  final bool returnToPrevious;
  final String? initialEmail;
  final bool openEmailCode;

  /// Only this screen's explicit successful sign-in may resume its caller.
  final void Function(String customerId, int sessionGeneration)?
  onAuthenticated;
  const LoginScreen({
    super.key,
    this.returnToPrevious = false,
    this.initialEmail,
    this.openEmailCode = false,
    this.onAuthenticated,
  });
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _loading = false;
  bool _emailCodeMode = false;
  Map<String, dynamic>? _authConfig;
  String? _challengeId;
  String? _challengeEmail;
  String _emailKey = '';
  String? _devCode;
  int _resendSeconds = 0;
  final _resendWaitByEmail = <String, int>{};
  Timer? _resendTimer;
  CustomerAccountLinkRequired? _pendingLink;
  String? _error;
  @override
  void initState() {
    super.initState();
    _email.text = widget.initialEmail ?? '';
    _emailKey = _normalizedEmail;
    _emailCodeMode = widget.openEmailCode;
    _loadConfig();
  }

  String get _normalizedEmail => _email.text.trim().toLowerCase();

  void _emailChanged(String _) {
    final email = _normalizedEmail;
    if (email == _emailKey) return;
    setState(() {
      _emailKey = email;
      _challengeId = null;
      _challengeEmail = null;
      _code.clear();
      _devCode = null;
      _error = null;
      _resendSeconds = _resendWaitByEmail[email] ?? 0;
    });
  }

  void _startResendWait(String email, int seconds) {
    if (seconds > 0) _resendWaitByEmail[email] = seconds;
    _resendSeconds = _resendWaitByEmail[_normalizedEmail] ?? 0;
    _resendTimer?.cancel();
    if (_resendWaitByEmail.isEmpty) return;
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _resendWaitByEmail.updateAll((_, value) => value - 1);
        _resendWaitByEmail.removeWhere((_, value) => value <= 0);
        _resendSeconds = _resendWaitByEmail[_normalizedEmail] ?? 0;
      });
      if (_resendWaitByEmail.isEmpty) timer.cancel();
    });
  }

  Future<void> _loadConfig() async {
    try {
      final config = await ApiService().customerAuthConfig();
      if (mounted) setState(() => _authConfig = config);
    } catch (_) {
      if (mounted) setState(() => _authConfig = <String, dynamic>{});
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    _resendTimer?.cancel();
    _pendingLink = null;
    super.dispose();
  }

  Future<void> _requestCode() async {
    if (_loading || _resendSeconds > 0) return;
    final email = _normalizedEmail;
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(_email.text.trim())) {
      setState(
        () =>
            _error = customerText(context, 'Enter a valid email.', '请输入有效邮箱。'),
      );
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _challengeId = null;
      _challengeEmail = null;
      _code.clear();
      _devCode = null;
    });
    try {
      final result = await ApiService().requestEmailLogin(email);
      if (!mounted) return;
      final challenge = result['challengeId'];
      if (challenge is! String || challenge.isEmpty) {
        throw StateError('The email challenge could not be confirmed.');
      }
      setState(() {
        _challengeId = challenge;
        _challengeEmail = email;
        _devCode = result['devCode'] as String?;
        _startResendWait(email, (result['resendAfter'] as num?)?.toInt() ?? 60);
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = customerText(
            context,
            'Unable to send a code. Check your email or try later.',
            '无法发送验证码，请检查邮箱或稍后重试。',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _login({String? provider}) async {
    if (_loading) return;
    if (provider == null && !_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ApiService();
      int authenticationGeneration;
      if (provider != null) {
        final user = await SocialAuthService().login(
          provider,
          _authConfig ?? {},
        );
        if (user == null) return;
        authenticationGeneration = api.sessionGeneration;
        await ref.read(authProvider.notifier).checkSession();
      } else if (_emailCodeMode) {
        if (_challengeId == null || _challengeEmail != _normalizedEmail) {
          throw StateError('Request a code for this email first');
        }
        final authentication = ref
            .read(authProvider.notifier)
            .verifyEmailLogin(_challengeId!, _code.text.trim());
        authenticationGeneration = api.sessionGeneration;
        await authentication;
        if (!mounted) return;
        if (_pendingLink != null) {
          final pending = _pendingLink!;
          await ApiService().linkCustomerProvider(
            pending.provider,
            pending.idToken,
            pending.challengeId,
            '',
          );
          _pendingLink = null;
        }
      } else {
        final authentication = ref
            .read(authProvider.notifier)
            .passwordLogin(_email.text.trim(), _password.text);
        authenticationGeneration = api.sessionGeneration;
        await authentication;
        if (!mounted) return;
        if (_pendingLink != null) {
          final pending = _pendingLink!;
          await ApiService().linkCustomerProvider(
            pending.provider,
            pending.idToken,
            pending.challengeId,
            _password.text,
          );
          _pendingLink = null;
        }
      }
      if (!mounted ||
          api.sessionGeneration != authenticationGeneration ||
          ModalRoute.of(context)?.isCurrent != true) {
        return;
      }
      final auth = ref.read(authProvider);
      if (!auth.isLoggedIn ||
          auth.isLoading ||
          auth.sessionUnavailable ||
          auth.user?.role != 'CUSTOMER') {
        return;
      }
      if (widget.returnToPrevious) {
        widget.onAuthenticated?.call(auth.user!.id, authenticationGeneration);
        Navigator.of(context).pop(true);
        return;
      }
      final router = GoRouter.maybeOf(context);
      if (router != null) {
        router.go('/');
        return;
      }
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const HomeScreen()),
        (_) => false,
      );
    } on CustomerAccountLinkRequired catch (pending) {
      if (mounted) {
        setState(() {
          _pendingLink = pending;
          _emailCodeMode = false;
          _password.clear();
          _error = customerText(
            context,
            'This email already has an account. Reauthenticate with your existing customer password or a new email code to explicitly link this sign-in.',
            '该邮箱已有账户。请使用已有顾客账户密码或新的邮箱验证码重新认证，再明确绑定。',
          );
        });
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error =
              error is DioException && error.response?.statusCode == 503
              ? customerText(
                  context,
                  'This sign-in method is unavailable. Use customer password sign-in.',
                  '此登录方式暂不可用，请使用顾客账户密码登录。',
                )
              : _emailCodeMode
              ? customerText(
                  context,
                  'The code is invalid, expired or already used. Request a new code if needed.',
                  '验证码无效、已过期或已使用，请按需重新获取。',
                )
              : customerText(
                  context,
                  'Unable to sign in. Check your account details and connection.',
                  '无法登录。请检查账户信息和网络连接。',
                ),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    if (widget.returnToPrevious &&
        !_loading &&
        !auth.isLoading &&
        !auth.sessionUnavailable &&
        auth.isLoggedIn &&
        auth.user?.role == 'CUSTOMER') {
      final customerId = auth.user!.id;
      final generation = ApiService().sessionGeneration;
      // Verification elsewhere can restore a saved account while this layer
      // is open. Returning explicitly is navigation, never action approval.
      return Scaffold(
        appBar: AppBar(title: Text(customerText(context, 'Sign in', '登录'))),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  customerText(
                    context,
                    'Your sign-in has been restored. Return to the previous page and choose your action again.',
                    '登录已恢复。请返回刚才页面，再次选择需要执行的操作。',
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () {
                    final current = ref.read(authProvider);
                    if (ModalRoute.of(context)?.isCurrent == true &&
                        ApiService().sessionGeneration == generation &&
                        current.user?.id == customerId &&
                        current.isLoggedIn &&
                        !current.isLoading &&
                        !current.sessionUnavailable) {
                      Navigator.of(context).pop(false);
                    }
                  },
                  child: Text(
                    customerText(context, 'Return to previous page', '返回刚才页面'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final theme = Theme.of(context);
    final desktop = MediaQuery.sizeOf(context).width >= 1000;
    return PopScope(
      canPop: !_loading,
      child: Scaffold(
        backgroundColor: CustomerPalette.background,
        appBar: widget.returnToPrevious
            ? AppBar(
                title: Text(customerText(context, 'Sign in', '登录')),
                leading: _loading
                    ? IconButton(
                        tooltip: MaterialLocalizations.of(
                          context,
                        ).backButtonTooltip,
                        onPressed: null,
                        icon: const BackButtonIcon(),
                      )
                    : const BackButton(),
              )
            : null,
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(
                horizontal: desktop ? 48 : 20,
                vertical: desktop ? 48 : 28,
              ),
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: desktop ? 1040 : 480),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const CustomerBrand(),
                    if (!widget.returnToPrevious)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: _loading
                              ? null
                              : () {
                                  final router = GoRouter.maybeOf(context);
                                  if (router != null) {
                                    router.go('/');
                                  } else {
                                    Navigator.of(context).pushReplacement(
                                      MaterialPageRoute<void>(
                                        builder: (_) => const HomeScreen(),
                                      ),
                                    );
                                  }
                                },
                          icon: const Icon(Icons.storefront_outlined, size: 18),
                          label: Text(
                            customerText(
                              context,
                              'Browse without signing in',
                              '暂不登录，浏览门店',
                            ),
                          ),
                        ),
                      ),
                    SizedBox(height: desktop ? 48 : 28),
                    if (desktop)
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(right: 72),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    customerText(
                                      context,
                                      'Your next appointment,\nin one place.',
                                      '发现服务，\n安排下一次放松。',
                                    ),
                                    style: theme.textTheme.headlineLarge,
                                  ),
                                  const SizedBox(height: 20),
                                  Text(
                                    customerText(
                                      context,
                                      'Explore massage shops, choose a service and keep track of your bookings.',
                                      '浏览按摩门店，选择合适的服务，随时查看和管理预约。',
                                    ),
                                    style: theme.textTheme.bodyLarge?.copyWith(
                                      color: CustomerPalette.muted,
                                    ),
                                  ),
                                  const SizedBox(height: 32),
                                  _introItem(
                                    Icons.storefront_outlined,
                                    customerText(
                                      context,
                                      'Explore local shops',
                                      '浏览门店与服务',
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  _introItem(
                                    Icons.calendar_today_outlined,
                                    customerText(
                                      context,
                                      'Choose a time that works for you',
                                      '选择适合的预约时间',
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  _introItem(
                                    Icons.favorite_border,
                                    customerText(
                                      context,
                                      'Keep your favorites close',
                                      '收藏喜欢的门店',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          SizedBox(width: 440, child: _buildForm(theme)),
                        ],
                      )
                    else
                      _buildForm(theme),
                    const SizedBox(height: 20),
                    Center(child: PublicInformationLinks(enabled: !_loading)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _introItem(IconData icon, String label) => Row(
    children: [
      Icon(icon, size: 20, color: CustomerPalette.action),
      const SizedBox(width: 12),
      Expanded(
        child: Text(
          label,
          style: const TextStyle(color: CustomerPalette.ink, fontSize: 14),
        ),
      ),
    ],
  );

  Widget _buildForm(ThemeData theme) => Container(
    padding: EdgeInsets.all(MediaQuery.sizeOf(context).width >= 600 ? 32 : 24),
    decoration: BoxDecoration(
      color: CustomerPalette.surface,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: CustomerPalette.border),
    ),
    child: Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _emailCodeMode
                ? customerText(
                    context,
                    'Continue with verified email',
                    '使用已验证邮箱继续',
                  )
                : customerText(context, 'Welcome back', '欢迎回来'),
            style: theme.textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            _emailCodeMode
                ? customerText(
                    context,
                    'Email verification signs you in or creates a customer account if needed.',
                    '验证邮箱后登录；如果该邮箱尚未注册，将为您创建顾客账户。',
                  )
                : customerText(
                    context,
                    'Sign in to manage your appointments',
                    '登录后查看和管理您的预约',
                  ),
            style: const TextStyle(
              color: CustomerPalette.muted,
              fontSize: 14,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 28),
          TextFormField(
            controller: _email,
            readOnly: _loading,
            onChanged: _emailChanged,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username, AutofillHints.email],
            decoration: InputDecoration(
              labelText: customerText(context, 'Email', '电子邮箱'),
              prefixIcon: const Icon(Icons.email_outlined, size: 20),
            ),
            validator: (value) => value == null || !value.contains('@')
                ? customerText(context, 'Enter your account email.', '请输入账户邮箱。')
                : null,
          ),
          const SizedBox(height: 18),
          if (!_emailCodeMode)
            TextFormField(
              controller: _password,
              readOnly: _loading,
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              decoration: InputDecoration(
                labelText: customerText(context, 'Password', '密码'),
                prefixIcon: const Icon(Icons.lock_outline, size: 20),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return customerText(
                    context,
                    'Enter your password.',
                    '请输入密码。',
                  );
                }
                return null;
              },
              onFieldSubmitted: (_) {
                if (!_loading) _login();
              },
            ),
          if (!_emailCodeMode && _pendingLink == null)
            Align(alignment: Alignment.centerRight, child: TextButton(
              onPressed: _loading ? null : () async {
                final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
                  builder: (_) => CustomerPasswordScreen(recovery: true, initialEmail: _email.text.trim())));
                if (mounted && changed == true) {
                  setState(() { _password.clear(); _error = null; });
                }
              },
              child: const Text('Forgot password?'),
            )),
          if (_emailCodeMode) ...[
            TextFormField(
              controller: _code,
              readOnly: _loading,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: InputDecoration(
                labelText: customerText(context, 'Email code', '邮箱验证码'),
              ),
              validator: (value) =>
                  _challengeId == null ||
                      !RegExp(r'^\d{6}$').hasMatch(value?.trim() ?? '')
                  ? customerText(
                      context,
                      'Request and enter the 6-digit code.',
                      '请先获取并输入6位验证码。',
                    )
                  : null,
            ),
            OutlinedButton(
              onPressed: _loading || _resendSeconds > 0 ? null : _requestCode,
              child: Text(
                _resendSeconds > 0
                    ? customerText(
                        context,
                        'Resend in ${_resendSeconds}s',
                        '$_resendSeconds秒后可重发',
                      )
                    : customerText(context, 'Send email code', '发送邮箱验证码'),
              ),
            ),
            if (_devCode != null)
              Text(
                customerText(
                  context,
                  'Local development code: $_devCode (no email sent)',
                  '本地开发验证码：$_devCode（未发送邮件）',
                ),
                style: const TextStyle(
                  fontSize: 12,
                  color: CustomerPalette.muted,
                ),
              ),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 18),
              child: Text(
                _error!,
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          const SizedBox(height: 26),
          FilledButton(
            onPressed: _loading ? null : () => _login(),
            child: _loading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: CustomerPalette.surface,
                    ),
                  )
                : Text(
                    _pendingLink != null
                        ? customerText(
                            context,
                            'Authenticate and link',
                            '重新认证并绑定',
                          )
                        : _emailCodeMode
                        ? customerText(context, 'Verify email code', '验证邮箱验证码')
                        : customerText(context, 'Sign in', '登录'),
                  ),
          ),
          const SizedBox(height: 14),
          if (_pendingLink != null &&
              (_authConfig?['emailOtp'] as Map?)?['enabled'] == true)
            TextButton(
              onPressed: _loading
                  ? null
                  : () => setState(() {
                      _emailCodeMode = !_emailCodeMode;
                      _challengeId = null;
                      _code.clear();
                      _devCode = null;
                    }),
              child: Text(
                _emailCodeMode
                    ? customerText(
                        context,
                        'Reauthenticate with password',
                        '使用密码重新认证',
                      )
                    : customerText(
                        context,
                        'Reauthenticate with an email code',
                        '使用邮箱验证码重新认证',
                      ),
              ),
            ),
          if (_pendingLink == null) ...[
            TextButton(
              onPressed:
                  _loading ||
                      (!_emailCodeMode &&
                          (_authConfig?['emailOtp'] as Map?)?['enabled'] !=
                              true)
                  ? null
                  : () => setState(() {
                      _emailCodeMode = !_emailCodeMode;
                      _error = null;
                      _challengeId = null;
                      _code.clear();
                      _devCode = null;
                    }),
              child: Text(
                _emailCodeMode
                    ? customerText(context, 'Use password instead', '改用密码登录')
                    : customerText(
                        context,
                        'Use email code or create account',
                        '使用邮箱验证码或创建账户',
                      ),
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed:
                  !_loading &&
                      kIsWeb &&
                      (_authConfig?['google'] as Map?)?['webEnabled'] == true
                  ? () => _login(provider: 'GOOGLE')
                  : null,
              icon: const Icon(Icons.g_mobiledata),
              label: Text(
                customerText(context, 'Continue with Google', '使用 Google 继续'),
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed:
                  !_loading &&
                      kIsWeb &&
                      (_authConfig?['apple'] as Map?)?['webEnabled'] == true
                  ? () => _login(provider: 'APPLE')
                  : null,
              icon: const Icon(Icons.apple),
              label: Text(
                customerText(context, 'Continue with Apple', '使用 Apple 继续'),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              customerText(
                context,
                'Unavailable methods are not enabled for this deployment. Management accounts use the separate admin or merchant portal.',
                '灰色登录方式尚未在当前环境开通。管理账户请使用平台或商家独立入口。',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: CustomerPalette.muted,
              ),
            ),
          ],
        ],
      ),
    ),
  );
}
