import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'l10n/app_localizations.dart';
import 'navigation/customer_routes.dart';
import 'navigation/public_information_routes.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/shop_link_screen.dart';
import 'providers/auth_provider.dart';
import 'providers/locale_provider.dart';
import 'theme/customer_theme.dart';

/// MJAPP Main App Widget
class MassajoyApp extends ConsumerStatefulWidget {
  const MassajoyApp({super.key});

  @override
  ConsumerState<MassajoyApp> createState() => _MassajoyAppState();
}

class _MassajoyAppState extends ConsumerState<MassajoyApp> {
  late final GoRouter _router;
  @override
  void initState() {
    super.initState();
    _router = GoRouter(
      initialLocation: kIsWeb ? initialCustomerLocation(Uri.base) : '/',
      overridePlatformDefaultLocation: true,
      routes: [
        GoRoute(
          path: '/',
          builder: (_, state) => HomeScreen(
            initialTab:
                int.tryParse(
                  state.uri.queryParameters['tab'] ?? '',
                )?.clamp(0, 3).toInt() ??
                0,
          ),
        ),
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        ...publicInformationRoutes(),
        GoRoute(
          path: '/s/:shortName',
          builder: (_, state) => ShopLinkScreen(uri: state.uri),
        ),
        GoRoute(
          path: '/shops/:shopId',
          builder: (_, state) => ShopLinkScreen(uri: state.uri),
        ),
        GoRoute(
          path: '/:rootName',
          builder: (_, state) => ShopLinkScreen(uri: state.uri),
        ),
      ],
      // Only the strict parser can resolve nested old H5 routes.
      errorBuilder: (_, state) => ShopLinkScreen(uri: state.uri),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(authProvider.notifier).checkSession();
    });
  }

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Massajoy',
      debugShowCheckedModeBanner: false,
      locale: customerLocale,
      supportedLocales: supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: buildCustomerTheme(),
      routerConfig: _router,
      builder: (context, child) => Consumer(
        builder: (context, ref, _) {
          final auth = ref.watch(authProvider);
          return Column(
            children: [
              if (auth.sessionUnavailable)
                Material(
                  color: Theme.of(context).colorScheme.secondaryContainer,
                  child: SafeArea(
                    bottom: false,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                      child: Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: 12,
                        children: [
                          Text(
                            auth.isLoading
                                ? 'Verifying your session…'
                                : 'Your sign-in is saved. Retry verification before making account changes.',
                          ),
                          TextButton(
                            onPressed: auth.isLoading
                                ? null
                                : () => ref
                                      .read(authProvider.notifier)
                                      .checkSession(),
                            child: const Text('Retry verification'),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              else
                const SizedBox.shrink(),
              Expanded(
                key: const ValueKey('customer-router-content'),
                child: child ?? const SizedBox.shrink(),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Existing callers can still enter here; browsing no longer requires login.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) => const HomeScreen();
}
