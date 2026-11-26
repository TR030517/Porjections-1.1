import 'package:go_router/go_router.dart';
import '../screens/public_information_screen.dart';
import '../screens/support_screen.dart';

/// Register ahead of the one-segment shop route; these are public app pages.
List<GoRoute> publicInformationRoutes() => [
  GoRoute(
    path: '/privacy',
    builder: (_, _) =>
        const PublicInformationScreen(page: PublicInformationPage.privacy),
  ),
  GoRoute(
    path: '/terms',
    builder: (_, _) =>
        const PublicInformationScreen(page: PublicInformationPage.terms),
  ),
  for (final path in ['/support', '/feedback'])
    GoRoute(
      path: path,
      builder: (_, state) => SupportScreen(
        shopContext: ShopSupportContext.fromQuery(state.uri.queryParameters),
      ),
    ),
];
