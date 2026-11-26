import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/profile_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/merchant_portal_service.dart';

class CustomerAuth extends AuthNotifier {
  CustomerAuth() : super(ApiService()) {
    state = AuthState(
      user: User(id: '42', role: 'CUSTOMER', name: 'Test'),
      isLoggedIn: true,
    );
  }
}

void main() {
  test(
    'merchant website link uses the deployed origin and /merchant/ path',
    () {
      expect(
        merchantPortalUri(
          Uri.parse('https://massajoy.example/customer/#/profile'),
        ).toString(),
        'https://massajoy.example/merchant/',
      );
      expect(
        merchantPortalUri(Uri.parse('http://127.0.0.1:8088/')).toString(),
        'http://127.0.0.1:8088/merchant/',
      );
      expect(
        () => merchantPortalUri(Uri.parse('file:///customer')),
        throwsUnsupportedError,
      );
    },
  );

  testWidgets(
    'customer profile opens the dedicated merchant portal without a legacy application or empty metrics',
    (tester) async {
      var opened = 0;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authProvider.overrideWith((ref) => CustomerAuth()),
            merchantPortalLauncherProvider.overrideWithValue(() async {
              opened++;
              return true;
            }),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: ProfileScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Become a Merchant'), findsNothing);
      expect(find.text('—'), findsNothing);
      final portal = find.text('Merchant Portal');
      final profileScroll = find
          .descendant(
            of: find.byType(ProfileScreen),
            matching: find.byType(Scrollable),
          )
          .first;
      await tester.scrollUntilVisible(portal, 250, scrollable: profileScroll);
      await tester.tap(portal);
      await tester.pumpAndSettle();
      expect(opened, 1);
      expect(find.byType(ProfileScreen), findsOneWidget);
    },
  );
}
