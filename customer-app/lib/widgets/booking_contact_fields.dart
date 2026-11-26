import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking_contact.dart';
import '../providers/auth_provider.dart';
import '../screens/edit_profile_screen.dart';

class BookingContactFields extends ConsumerStatefulWidget {
  final BookingContactDraft contact;
  final bool locked;
  final void Function({String? name, String? phone}) onChanged;
  const BookingContactFields({
    super.key,
    required this.contact,
    required this.locked,
    required this.onChanged,
  });
  @override
  ConsumerState<BookingContactFields> createState() =>
      BookingContactFieldsState();
}

class BookingContactFieldsState extends ConsumerState<BookingContactFields> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController(), _phone = TextEditingController();
  final _nameFocus = FocusNode(), _phoneFocus = FocusNode();
  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant BookingContactFields oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    if (_name.text != widget.contact.name) _name.text = widget.contact.name;
    if (_phone.text != widget.contact.phone) _phone.text = widget.contact.phone;
  }

  bool validate() {
    final valid = _form.currentState?.validate() ?? false;
    FocusNode? invalidFocus;
    if (BookingContact.nameError(_name.text) != null) {
      invalidFocus = _nameFocus;
    } else if (BookingContact.phoneError(_phone.text) != null) {
      invalidFocus = _phoneFocus;
    }
    if (invalidFocus != null) {
      invalidFocus.requestFocus();
      final focus = invalidFocus;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final target = focus.context;
        if (mounted && focus.hasFocus && target != null) {
          Scrollable.ensureVisible(
            target,
            alignment: 0,
            duration: const Duration(milliseconds: 180),
          );
        }
      });
    }
    return valid && widget.contact.email != null;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _nameFocus.dispose();
    _phoneFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Form(
    key: _form,
    child: AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Confirm who the shop should contact about this visit. Submitting sends a request to the shop; it does not confirm the appointment or record a payment.',
          ),
          const SizedBox(height: 16),
          TextFormField(
            key: const ValueKey('booking-contact-name'),
            controller: _name,
            focusNode: _nameFocus,
            enabled: !widget.locked,
            autofillHints: const [AutofillHints.name],
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Contact name *'),
            validator: (value) => BookingContact.nameError(value ?? ''),
            errorBuilder: _contactError,
            onChanged: (value) => widget.onChanged(name: value),
          ),
          const SizedBox(height: 14),
          TextFormField(
            key: const ValueKey('booking-contact-phone'),
            controller: _phone,
            focusNode: _phoneFocus,
            enabled: !widget.locked,
            autofillHints: const [AutofillHints.telephoneNumber],
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Phone number *',
              hintText: '+1 (206) 555-0123',
              helperText: 'Include + and the country code.',
            ),
            validator: (value) => BookingContact.phoneError(value ?? ''),
            errorBuilder: _contactError,
            onChanged: (value) => widget.onChanged(phone: value),
          ),
          const SizedBox(height: 14),
          InputDecorator(
            decoration: const InputDecoration(
              labelText: 'Verified account email *',
            ),
            child: SelectableText(
              widget.contact.email ?? 'Sign in and verify your account email.',
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Booking updates use this verified email. To change it, update and verify your account email first.',
          ),
          if (ref.watch(authProvider).isLoggedIn)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const ValueKey('booking-contact-change-email'),
                onPressed: widget.locked
                    ? null
                    : () => Navigator.push<void>(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const EditProfileScreen(),
                        ),
                      ),
                icon: const Icon(Icons.manage_accounts_outlined, size: 18),
                label: const Text('Change account email'),
              ),
            ),
          const SizedBox(height: 24),
        ],
      ),
    ),
  );

  Widget _contactError(BuildContext context, String message) => Text(
    message,
    softWrap: true,
    overflow: TextOverflow.visible,
    style: Theme.of(
      context,
    ).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.error),
  );
}
