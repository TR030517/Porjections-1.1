import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking_order_policy.dart';
import '../providers/auth_provider.dart';
import '../screens/edit_profile_screen.dart';
import '../services/api_service.dart';

class BookingOrderNotice extends ConsumerWidget {
  final bool busy;
  const BookingOrderNotice({super.key, this.busy = false});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider), user = auth.user, email = bookingAccountEmail(user);
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Booking order · handled offline', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        const Text(bookingOrderExplanation, style: TextStyle(height: 1.6)),
        const SizedBox(height: 8),
        if (email != null) Text('Account email: $email')
        else if (!auth.isLoggedIn) const Text('Sign in to use the email on your account.')
        else ...[
          Text(user?.email?.isNotEmpty == true
              ? 'Verify your account email before submitting this order.'
              : 'Add and verify an email address before submitting this order.'),
          TextButton(onPressed: busy ? null : () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => const EditProfileScreen())), child: Text(user?.email?.isNotEmpty == true ? 'Verify account email' : 'Add account email')),
        ],
      ],
    )));
  }
}

Future<bool> requireBookingOrderEmail(BuildContext context, WidgetRef ref, {required bool orderOnly}) async {
  if (!orderOnly || bookingAccountEmail(ref.read(authProvider).user) != null) return true;
  final user = ref.read(authProvider).user, customer = user?.id, generation = ref.read(apiServiceProvider).sessionGeneration;
  final hasEmail = user?.email?.trim().isNotEmpty == true;
  final edit = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
    title: Text(hasEmail ? 'Verify your account email' : 'Add your account email'),
    content: Text(hasEmail
      ? 'This order uses the verified email saved on your account. Verify that you can receive messages at this address, then return and confirm the order. No booking has been submitted.'
      : 'This order uses the verified email saved on your account. Add an address you can access and verify it, then return and confirm the order. No booking has been submitted.'),
    actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep reviewing')),
      FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(hasEmail ? 'Verify email' : 'Edit account details'))],
  ));
  if (edit == true && context.mounted && ref.read(authProvider).user?.id == customer && ref.read(apiServiceProvider).sessionGeneration == generation) {
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => const EditProfileScreen()));
  }
  return false;
}
