import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

String? customerPasswordError(String? value) {
  final bytes = utf8.encode(value ?? '').length;
  if (bytes < 6 || bytes > 72 || RegExp(r'[\x00\r\n]').hasMatch(value ?? '')) {
    return 'Use 6–72 UTF-8 bytes without line breaks.';
  }
  return null;
}

class CustomerPasswordScreen extends ConsumerStatefulWidget {
  const CustomerPasswordScreen({
    super.key,
    this.recovery = false,
    this.initialEmail,
  });
  final bool recovery;
  final String? initialEmail;
  @override
  ConsumerState<CustomerPasswordScreen> createState() =>
      _CustomerPasswordScreenState();
}

class _CustomerPasswordScreenState
    extends ConsumerState<CustomerPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _current = TextEditingController();
  final _password = TextEditingController();
  final _confirmation = TextEditingController();
  final _code = TextEditingController();
  late final int _openingGeneration;
  late final String? _openingCustomer;
  late bool _recovery;
  bool _busy = false, _uncertain = false, _complete = false;
  bool _recoveryAvailable = false, _configLoaded = false;
  String? _challenge, _challengeEmail, _error;
  int _resendSeconds = 0;
  Timer? _timer;

  bool get _sameSession =>
      mounted &&
      ref.read(apiServiceProvider).sessionGeneration == _openingGeneration &&
      ref.read(authProvider).user?.id == _openingCustomer;

  @override
  void initState() {
    super.initState();
    _recovery = widget.recovery;
    final user = ref.read(authProvider).user;
    _openingCustomer = user?.id;
    _openingGeneration = ref.read(apiServiceProvider).sessionGeneration;
    _email.text = widget.initialEmail ?? user?.email ?? '';
    unawaited(_loadConfig());
  }

  Future<void> _loadConfig() async {
    try {
      final config = await ref.read(apiServiceProvider).customerAuthConfig();
      if (_sameSession) {
        setState(() {
          _configLoaded = true;
          _recoveryAvailable = config['passwordRecoveryEnabled'] == true;
        });
      }
    } catch (_) {
      if (_sameSession) {
        setState(() => _configLoaded = true);
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final controller in [
      _email,
      _current,
      _password,
      _confirmation,
      _code,
    ]) {
      controller.clear();
      controller.dispose();
    }
    super.dispose();
  }

  void _emailChanged(String value) {
    if (value.trim().toLowerCase() == _challengeEmail) return;
    setState(() {
      _challenge = null;
      _challengeEmail = null;
      _code.clear();
      _error = null;
    });
  }

  Future<void> _requestCode() async {
    if (_busy || !_sameSession || !_recoveryAvailable || _resendSeconds > 0) {
      return;
    }
    final email = _email.text.trim().toLowerCase();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      setState(() => _error = 'Enter your account email.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final reply = await ref
          .read(apiServiceProvider)
          .requestCustomerPasswordRecovery(email);
      if (!_sameSession) return;
      if (reply['challengeId'] is! String ||
          (reply['challengeId'] as String).isEmpty) {
        throw StateError('Unconfirmed recovery request');
      }
      setState(() {
        _challenge = reply['challengeId'] as String;
        _challengeEmail = email;
        _code.clear();
        _resendSeconds =
            (reply['resendAfter'] is num
                    ? (reply['resendAfter'] as num).toInt()
                    : 60)
                .clamp(1, 600);
      });
      _timer?.cancel();
      _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted || _resendSeconds <= 1) {
          timer.cancel();
          if (mounted) setState(() => _resendSeconds = 0);
        } else {
          setState(() => _resendSeconds--);
        }
      });
    } catch (error) {
      if (_sameSession) {
        setState(() => _error = _message(error, sendingCode: true));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _message(Object error, {bool sendingCode = false}) {
    final status = error is DioException ? error.response?.statusCode : null;
    final data = error is DioException ? error.response?.data : null;
    final code = data is Map ? data['code'] : null;
    if (code == 'PASSWORD_UNCHANGED') {
      return 'Choose a password different from your current password. Your recovery code can still be used.';
    }
    if (code == 'PASSWORD_POLICY') {
      return 'Use a new password of 6–72 UTF-8 bytes without null characters or line breaks.';
    }
    if (code == 'EMAIL_LOGIN_RATE_LIMITED') {
      return 'Please wait before requesting another recovery code.';
    }
    if (status == 429) {
      return 'Too many attempts. Please wait before trying again.';
    }
    if (status == 401 || status == 400) {
      return sendingCode
          ? 'Check your email and try again.'
          : _recovery
          ? 'This code is invalid or expired. Request a new code.'
          : 'Check your current password and the new password requirements. If your session has expired, sign in again.';
    }
    if (status == 503 && sendingCode) {
      return 'Password recovery is temporarily unavailable. Please try later.';
    }
    if (sendingCode) {
      return 'Unable to confirm that a code was sent. Please wait before requesting another.';
    }
    return 'We could not confirm the password change. It may have completed. Sign in again, or request a new recovery code. This request will not be sent again automatically.';
  }

  Future<void> _save() async {
    if (_busy ||
        _uncertain ||
        !_sameSession ||
        !(_form.currentState?.validate() ?? false)) {
      return;
    }
    if (_recovery &&
        (!_recoveryAvailable ||
            _challenge == null ||
            _challengeEmail != _email.text.trim().toLowerCase())) {
      return;
    }
    final auth = ref.read(authProvider);
    if (!_recovery &&
        (!auth.isLoggedIn ||
            auth.sessionUnavailable ||
            auth.user?.role != 'CUSTOMER')) {
      setState(
        () => _error =
            'Sign in and verify your session before changing your password.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final notifier = ref.read(authProvider.notifier);
      if (_recovery) {
        await notifier.recoverPassword(
          _challenge!,
          _code.text.trim(),
          _password.text,
        );
      } else {
        await notifier.changePassword(_current.text, _password.text);
      }
      if (!mounted ||
          ref.read(apiServiceProvider).sessionGeneration !=
              _openingGeneration + 1 ||
          ref.read(authProvider).isLoggedIn) {
        return;
      }
      for (final controller in [_current, _password, _confirmation, _code]) {
        controller.clear();
      }
      setState(() => _complete = true);
    } catch (error) {
      if (_sameSession) {
        setState(() {
          _error = _message(error);
          final status = error is DioException
              ? error.response?.statusCode
              : null;
          _uncertain = status == null || status == 408 || status >= 500;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = _sameSession;
    return Scaffold(
      appBar: AppBar(
        title: Text(_recovery ? 'Reset password' : 'Account password'),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              if (_complete) ...[
                const Icon(Icons.check_circle_outline, size: 48),
                const SizedBox(height: 16),
                const Text(
                  'Your password has been changed. All previous customer sessions have been signed out. Sign in again with your new password.',
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop(true),
                  child: const Text('Return to sign in'),
                ),
              ] else ...[
                Text(
                  _recovery
                      ? 'Verify your account email to reset your password.'
                      : 'Changing your password signs out all your customer sessions.',
                ),
                const SizedBox(height: 20),
                if (!current)
                  const Text(
                    'The customer session changed. Close this page and start again.',
                  ),
                if (_recovery && _configLoaded && !_recoveryAvailable)
                  const Text(
                    'Email password recovery is currently unavailable. You can still use an available sign-in method or contact support.',
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                Form(
                  key: _form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_recovery) ...[
                        TextFormField(
                          controller: _email,
                          readOnly: _busy || _uncertain || !current,
                          onChanged: _emailChanged,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            labelText: 'Account email',
                          ),
                          validator: (value) =>
                              RegExp(
                                r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                              ).hasMatch(value?.trim() ?? '')
                              ? null
                              : 'Enter your account email.',
                        ),
                        const SizedBox(height: 12),
                        OutlinedButton(
                          onPressed:
                              _busy ||
                                  _uncertain ||
                                  !current ||
                                  !_recoveryAvailable ||
                                  _resendSeconds > 0
                              ? null
                              : _requestCode,
                          child: Text(
                            _resendSeconds > 0
                                ? 'Send another code in ${_resendSeconds}s'
                                : 'Send recovery code',
                          ),
                        ),
                        if (_challenge != null)
                          const Text(
                            'Check your email for a recovery code. If no code arrives, wait and try again.',
                          ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _code,
                          readOnly: _busy || _uncertain || !current,
                          keyboardType: TextInputType.number,
                          maxLength: 6,
                          decoration: const InputDecoration(
                            labelText: 'Recovery code',
                          ),
                          validator: (value) =>
                              _challenge != null &&
                                  RegExp(
                                    r'^\d{6}$',
                                  ).hasMatch(value?.trim() ?? '')
                              ? null
                              : 'Request and enter the 6-digit recovery code.',
                        ),
                      ] else ...[
                        TextFormField(
                          controller: _current,
                          obscureText: true,
                          readOnly: _busy || _uncertain || !current,
                          decoration: const InputDecoration(
                            labelText: 'Current password',
                          ),
                          validator: (value) => value == null || value.isEmpty
                              ? 'Enter your current password.'
                              : null,
                        ),
                      ],
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _password,
                        obscureText: true,
                        readOnly: _busy || _uncertain || !current,
                        autofillHints: const [AutofillHints.newPassword],
                        decoration: const InputDecoration(
                          labelText: 'New password',
                          helperText: '6–72 UTF-8 bytes. No line breaks.',
                        ),
                        validator: customerPasswordError,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _confirmation,
                        obscureText: true,
                        readOnly: _busy || _uncertain || !current,
                        decoration: const InputDecoration(
                          labelText: 'Confirm new password',
                        ),
                        validator: (value) => value == _password.text
                            ? null
                            : 'The passwords do not match.',
                      ),
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed:
                            _busy ||
                                _uncertain ||
                                !current ||
                                _recovery && !_recoveryAvailable
                            ? null
                            : _save,
                        child: Text(
                          _busy
                              ? 'Please wait…'
                              : _recovery
                              ? 'Reset password'
                              : 'Change password',
                        ),
                      ),
                      if (!_recovery)
                        TextButton(
                          onPressed: _busy || _uncertain || !current
                              ? null
                              : () => setState(() {
                                  _recovery = true;
                                  _current.clear();
                                  _error = null;
                                }),
                          child: const Text('Forgot your password?'),
                        ),
                      if (_uncertain)
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Close'),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
