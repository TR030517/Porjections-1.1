import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/customer_theme.dart';
import '../widgets/responsive_content.dart';
import 'support_screen.dart';

enum PublicInformationPage { privacy, terms }

/// Reviewable local content, never presented as an approved legal policy.
class PublicInformationScreen extends StatelessWidget {
  final PublicInformationPage page;
  const PublicInformationScreen({super.key, required this.page});

  @override
  Widget build(BuildContext context) {
    final privacy = page == PublicInformationPage.privacy;
    final sections = privacy
        ? const [
            (
              'Information used in the app',
              'Browsing shop pages does not require a customer account. Signing in and making a booking use the account, contact and appointment details you provide. Photos and messages you choose to submit are also part of the relevant feature.',
            ),
            (
              'Shop and external services',
              'Your chosen shop uses the booking details to manage the appointment. Opening maps, email, phone or an external sign-in service takes you to that service; review its information before continuing.',
            ),
            (
              'Questions about your information',
              'Use Contact support to view the contact details published by the platform. For a specific booking, open the booking and choose Support. Do not send passwords or payment card numbers in a support message.',
            ),
            (
              'Operator review still required',
              'The operator must confirm the responsible business, contact address, purposes and legal grounds, service providers, retention periods, regional rights and request process before publishing a final privacy notice. This draft does not promise an unconfirmed retention period or legal process.',
            ),
          ]
        : const [
            (
              'Before you book',
              'Review the shop, selected service, duration, price and appointment time before submitting. Appointment and order times use the shop time zone. A listed service or price is not a guarantee that a time slot is available.',
            ),
            (
              'Booking status and changes',
              'Check the confirmation and current status in your booking. Cancellation and rescheduling availability is shown for that booking. For an issue with an existing appointment, choose Support from the booking details.',
            ),
            (
              'Payments and shop information',
              'Use the payment methods and amounts actually shown at checkout. A shop directory listing is not a statement that its details have been independently verified. Where details are incomplete, online booking is unavailable until the information is reviewed.',
            ),
            (
              'Operator review still required',
              'The operator must confirm the contracting business, eligibility, cancellation and refund terms, liabilities, applicable law and dispute process before publishing final terms. This draft does not create an unconfirmed refund promise or legal commitment.',
            ),
          ];
    return Scaffold(
      backgroundColor: CustomerPalette.background,
      appBar: AppBar(title: Text(privacy ? 'Privacy notice' : 'Booking terms')),
      body: ResponsiveContent(
        maxWidth: 840,
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const CustomerBrand(compact: true),
            const SizedBox(height: 24),
            Text(
              privacy ? 'Privacy notice' : 'Booking terms',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 16),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Review draft — operator approval pending. '
                  'This page explains the current app and the items still requiring business review. It is not a final legal policy.',
                ),
              ),
            ),
            for (final section in sections) ...[
              const SizedBox(height: 24),
              Text(section.$1, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(section.$2, style: const TextStyle(height: 1.7)),
            ],
            const SizedBox(height: 24),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () {
                    final router = GoRouter.maybeOf(context);
                    if (router != null) {
                      router.push('/support');
                    } else {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const SupportScreen(),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.help_outline),
                  label: const Text('Contact support'),
                ),
                if (GoRouter.maybeOf(context) != null)
                  TextButton(
                    onPressed: () => GoRouter.of(context).go('/'),
                    child: const Text('Browse shops'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
