import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../screens/public_information_screen.dart';
import '../screens/support_screen.dart';

class PublicInformationLinks extends StatelessWidget {
  final bool enabled;
  const PublicInformationLinks({super.key, this.enabled = true});

  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.center,
    spacing: 4,
    children: [
      for (final item in const [
        ('/privacy', 'Privacy'),
        ('/terms', 'Terms'),
        ('/support', 'Contact support'),
      ])
        TextButton(
          onPressed: !enabled
              ? null
              : () {
                  final router = GoRouter.maybeOf(context);
                  if (router != null) {
                    router.push(item.$1);
                    return;
                  }
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => switch (item.$1) {
                        '/privacy' => const PublicInformationScreen(
                          page: PublicInformationPage.privacy,
                        ),
                        '/terms' => const PublicInformationScreen(
                          page: PublicInformationPage.terms,
                        ),
                        _ => const SupportScreen(),
                      },
                    ),
                  );
                },
          child: Text(item.$2),
        ),
    ],
  );
}
