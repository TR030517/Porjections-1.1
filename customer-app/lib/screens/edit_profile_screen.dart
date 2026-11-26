import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/profile_error.dart';
import '../l10n/app_localizations.dart';
import '../models/user.dart';

/// Edit Profile Screen — allows user to update name and email
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameCtrl;
  late TextEditingController _emailCtrl;
  late String _savedName;
  late String _savedEmail;
  final _codeCtrl = TextEditingController();
  bool _saving = false;
  bool _allowPop = false;
  bool _confirmingLeave = false;
  bool _needsReadback = false;
  bool _emailOtpEnabled = false;
  String? _verificationMessage;
  String? _challengeId;
  String? _devCode;
  int _resendSeconds = 0;
  Timer? _resendTimer;
  late final String? _openingCustomer;
  late int _openingGeneration;
  bool get _current =>
      mounted &&
      ref.read(authProvider).user?.id == _openingCustomer &&
      ref.read(authProvider).isLoggedIn &&
      _openingCustomer != null &&
      ref.read(apiServiceProvider).sessionGeneration == _openingGeneration;
  bool get _dirty =>
      _nameCtrl.text != _savedName || _emailCtrl.text != _savedEmail;
  bool get _canLeave => _allowPop || (!_saving && !_needsReadback && !_dirty);

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    _openingCustomer = user?.role == 'CUSTOMER' ? user?.id : null;
    _openingGeneration = ref.read(apiServiceProvider).sessionGeneration;
    _nameCtrl = TextEditingController(text: user?.name ?? '');
    _emailCtrl = TextEditingController(text: user?.email ?? '');
    _savedName = _nameCtrl.text;
    _savedEmail = _emailCtrl.text;
    _nameCtrl.addListener(_draftChanged);
    _emailCtrl.addListener(_draftChanged);
    unawaited(_loadEmailAuthConfig());
  }

  void _draftChanged() {
    if (mounted) setState(() {});
  }

  void _rememberSaved(User saved, {bool replaceDraft = false}) {
    _savedName = saved.name ?? '';
    _savedEmail = saved.email ?? '';
    if (replaceDraft) {
      _nameCtrl.text = _savedName;
      _emailCtrl.text = _savedEmail;
    }
  }

  void _leave() {
    if (!_current || _allowPop) return;
    setState(() => _allowPop = true);
    // Rebuild PopScope before popping, including when a save is still finishing.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_current && _allowPop) Navigator.of(context).pop();
    });
  }

  Future<void> _requestLeave() async {
    if (!_current || _confirmingLeave) return;
    if (_canLeave) {
      _leave();
      return;
    }
    if (_saving) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Your account request is still in progress. Please wait before leaving.',
          ),
        ),
      );
      return;
    }
    _confirmingLeave = true;
    try {
      final needsReadback = _needsReadback;
      final action = await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(
            needsReadback
                ? 'Save result not confirmed'
                : 'Discard unsaved changes?',
          ),
          content: Text(
            needsReadback
                ? 'Reload account details before leaving to confirm the last save. Your draft will be kept and no extra save will be sent.'
                : 'Your changes have not been saved.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Continue editing'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(
                dialogContext,
                needsReadback ? 'reload' : 'discard',
              ),
              child: Text(
                needsReadback ? 'Reload account details' : 'Discard changes',
              ),
            ),
          ],
        ),
      );
      if (!_current || _saving) return;
      if (action == 'reload' && _needsReadback) {
        await _readBack();
      } else if (action == 'discard' && !_needsReadback) {
        _leave();
      }
    } finally {
      _confirmingLeave = false;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    _codeCtrl.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadEmailAuthConfig() async {
    try {
      final config = await ApiService().customerAuthConfig();
      if (mounted && _current) {
        setState(
          () => _emailOtpEnabled =
              (config['emailOtp'] as Map?)?['enabled'] == true,
        );
      }
    } catch (_) {
      if (mounted && _current) setState(() => _emailOtpEnabled = false);
    }
  }

  Future<void> _requestVerificationCode() async {
    final user = ref.read(authProvider).user,
        email = _emailCtrl.text.trim().toLowerCase();
    if (!_current ||
        _saving ||
        !_emailOtpEnabled ||
        email.isEmpty ||
        email != user?.email?.toLowerCase()) {
      return;
    }
    setState(() {
      _saving = true;
      _verificationMessage = null;
      _devCode = null;
      _challengeId = null;
      _codeCtrl.clear();
    });
    try {
      final result = await ApiService().requestEmailLogin(email);
      if (!_current || ref.read(authProvider).user?.email != email) return;
      setState(() {
        _challengeId = result['challengeId'] as String;
        _devCode = result['devCode'] as String?;
        _resendSeconds = (result['resendAfter'] as num?)?.toInt() ?? 60;
      });
      _resendTimer?.cancel();
      _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        setState(() {
          if (_resendSeconds <= 1) {
            timer.cancel();
            _resendSeconds = 0;
          } else {
            _resendSeconds--;
          }
        });
      });
    } catch (_) {
      if (mounted && _current) {
        setState(
          () => _verificationMessage =
              'Unable to send a code. Check the saved email address or try later.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _verifyEmail() async {
    if (!_current ||
        _saving ||
        _challengeId == null ||
        !RegExp(r'^\d{6}$').hasMatch(_codeCtrl.text.trim())) {
      return;
    }
    setState(() {
      _saving = true;
      _verificationMessage = null;
    });
    try {
      await ref
          .read(authProvider.notifier)
          .verifyCurrentEmail(_challengeId!, _codeCtrl.text.trim());
      if (!_current) return;
      setState(() {
        _challengeId = null;
        _devCode = null;
        _codeCtrl.clear();
        _resendSeconds = 0;
        _verificationMessage =
            'Email verified. You can now submit booking orders.';
      });
      _resendTimer?.cancel();
    } catch (_) {
      if (mounted && _current) {
        setState(
          () => _verificationMessage =
              'The code is invalid, expired, or no longer matches this account email. Request a new code if needed.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _save() async {
    if (!_current ||
        _saving ||
        _needsReadback ||
        !_formKey.currentState!.validate()) {
      return;
    }

    setState(() => _saving = true);
    try {
      final previousEmail = ref.read(authProvider).user?.email;
      final saved = await ref
          .read(authProvider.notifier)
          .updateProfile(
            name: _nameCtrl.text.trim().isEmpty ? null : _nameCtrl.text.trim(),
            email: _emailCtrl.text.trim().isEmpty
                ? null
                : _emailCtrl.text.trim(),
          );
      if (!_current) return;
      _rememberSaved(saved, replaceDraft: true);

      if (saved.email != previousEmail && saved.emailVerified != true) {
        setState(
          () => _verificationMessage =
              'Email saved. Verify that you can receive messages at this address before submitting an order.',
        );
        return;
      }

      if (mounted && _current) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.profileUpdated),
            behavior: SnackBarBehavior.floating,
          ),
        );
        _leave();
      }
    } catch (e) {
      if (mounted && _current) {
        if (e is ProfileSaveUnverified) {
          setState(() {
            _needsReadback = true;
            _verificationMessage =
                'A save response was received, but the account details could not be verified. Reload your account before saving again. No extra save has been sent.';
          });
          return;
        }
        final failure = profileSaveError(e);
        if (failure.needsReadback) {
          setState(() {
            _needsReadback = true;
            _verificationMessage = failure.message;
          });
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(failure.message),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _readBack() async {
    if (!_current || _saving || !_needsReadback) return;
    setState(() => _saving = true);
    try {
      final saved = await ref.read(authProvider.notifier).reloadProfile();
      if (!mounted || !_current) return;
      final email = _emailCtrl.text.trim().toLowerCase(),
          name = _nameCtrl.text.trim();
      final previousEmail = _savedEmail;
      _rememberSaved(saved);
      if (saved.name == name && (email.isEmpty || saved.email == email)) {
        _rememberSaved(saved, replaceDraft: true);
        if (saved.email != previousEmail && saved.emailVerified != true) {
          setState(() {
            _needsReadback = false;
            _verificationMessage =
                'Email saved. Verify that you can receive messages at this address before submitting an order.';
          });
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context)!.profileUpdated)),
        );
        _leave();
      } else {
        setState(() {
          _needsReadback = false;
          _verificationMessage =
              'Current account details have been reloaded. Your draft is preserved; review it before choosing to save.';
        });
      }
    } catch (_) {
      if (mounted && _current) {
        setState(
          () => _verificationMessage =
              'Account details could not be reloaded. Your draft is preserved and no extra save was sent. Try reloading again.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider), currentUser = auth.user;
    if (!_current) {
      return Scaffold(
        appBar: AppBar(title: const Text('Account details')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              auth.isLoggedIn
                  ? 'Your customer session changed. Reopen account details using your current account.'
                  : 'Your session has expired. Sign in again to update account details.',
            ),
          ),
        ),
      );
    }
    return PopScope(
      canPop: _canLeave,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_requestLeave());
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(AppLocalizations.of(context)!.editProfile),
          leading: BackButton(onPressed: _requestLeave),
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Form(
            key: _formKey,
            child: Column(
              children: [
                if (_verificationMessage != null) ...[
                  Text(_verificationMessage!),
                  if (_needsReadback)
                    TextButton(
                      onPressed: _saving ? null : _readBack,
                      child: const Text('Reload account details'),
                    ),
                  const SizedBox(height: 16),
                ],
                TextFormField(
                  controller: _nameCtrl,
                  readOnly: _saving || _needsReadback,
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context)!.name,
                    prefixIcon: Icon(Icons.person_outline),
                    border: OutlineInputBorder(),
                  ),
                  validator: (v) => (v == null || v.trim().isEmpty)
                      ? 'Name is required'
                      : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _emailCtrl,
                  readOnly: _saving || _needsReadback,
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context)!.email,
                    prefixIcon: Icon(Icons.email_outlined),
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return null;
                    final emailRegex = RegExp(
                      r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
                    );
                    if (!emailRegex.hasMatch(v.trim())) {
                      return 'Enter a valid email';
                    }
                    return null;
                  },
                  onChanged: (_) {
                    if (_challengeId != null) {
                      setState(() {
                        _challengeId = null;
                        _devCode = null;
                        _codeCtrl.clear();
                        _resendSeconds = 0;
                      });
                    }
                    _resendTimer?.cancel();
                  },
                ),
                if (!_needsReadback &&
                    currentUser?.emailVerified != true &&
                    _emailCtrl.text.trim().isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Text(
                    'Booking orders require a verified account email.',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  if (currentUser?.email?.trim().isNotEmpty != true)
                    const Text(
                      'Save this address before requesting a verification code.',
                    ),
                  if (!_emailOtpEnabled)
                    const Text(
                      'Email verification is not configured for this deployment.',
                    )
                  else ...[
                    OutlinedButton(
                      onPressed:
                          _saving ||
                              _resendSeconds > 0 ||
                              currentUser?.email?.toLowerCase() !=
                                  _emailCtrl.text.trim().toLowerCase()
                          ? null
                          : _requestVerificationCode,
                      child: Text(
                        _resendSeconds > 0
                            ? 'Resend in ${_resendSeconds}s'
                            : 'Send email verification code',
                      ),
                    ),
                    if (_challengeId != null) ...[
                      TextFormField(
                        controller: _codeCtrl,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        decoration: const InputDecoration(
                          labelText: 'Email verification code',
                        ),
                      ),
                      if (_devCode != null)
                        Text(
                          'Local development code: $_devCode (no email sent)',
                        ),
                      OutlinedButton(
                        onPressed: _saving ? null : _verifyEmail,
                        child: const Text('Verify email'),
                      ),
                    ],
                  ],
                ],
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: FilledButton(
                    onPressed: _saving || _needsReadback ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(AppLocalizations.of(context)!.save),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
