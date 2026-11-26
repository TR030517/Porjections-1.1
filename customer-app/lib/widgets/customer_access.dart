import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../screens/login_screen.dart';
import '../services/api_service.dart';
import '../theme/customer_theme.dart';

final _customerSignInRoutes = Expando<Route<bool>>();

String bookingTotalReviewLabel(BuildContext context, AuthState auth) =>
    auth.isLoggedIn && auth.user?.role == 'CUSTOMER'
    ? customerText(context, 'Review current total', '核对当前总价')
    : customerText(context, 'Sign in to review total', '登录后核对总价');

/// A local navigation result resumes the caller's exact action. No return URL
/// is read from query parameters, storage, or an external origin.
Future<bool> requireCustomerSignIn(BuildContext context, WidgetRef ref) async {
  final auth = ref.read(authProvider);
  if (auth.sessionUnavailable || auth.isLoading) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.hideCurrentSnackBar();
    messenger?.showSnackBar(
      SnackBar(
        content: Text(
          customerText(
            context,
            auth.isLoading
                ? 'Your sign-in is being verified. Please wait and try again. Your action has not been performed.'
                : 'We cannot verify your sign-in right now. Retry verification at the top of the page, then try again. Your action has not been performed.',
            auth.isLoading
                ? '正在验证登录，请稍候重试。刚才的操作尚未执行。'
                : '暂时无法验证登录，请点击页面顶部重试后再操作。刚才的操作尚未执行。',
          ),
        ),
      ),
    );
    return false;
  }
  if (auth.isLoggedIn && auth.user?.role == 'CUSTOMER') return true;

  final navigator = Navigator.of(context);
  // Repeated taps must not open several sign-in layers or resume the same
  // action through several callers when the first login completes.
  if (_customerSignInRoutes[navigator]?.isActive == true) return false;
  final origin = ModalRoute.of(context);
  final notifier = ref.read(authProvider.notifier);
  String? signedInCustomer;
  int? signedInGeneration;
  final route = MaterialPageRoute<bool>(
    builder: (_) => LoginScreen(
      returnToPrevious: true,
      onAuthenticated: (customerId, generation) {
        signedInCustomer = customerId;
        signedInGeneration = generation;
      },
    ),
  );
  _customerSignInRoutes[navigator] = route;
  final bool? signedIn;
  try {
    signedIn = await navigator.push<bool>(route);
  } finally {
    if (identical(_customerSignInRoutes[navigator], route)) {
      _customerSignInRoutes[navigator] = null;
    }
  }
  if (!context.mounted) return false;
  final current = ref.read(authProvider);
  return signedIn == true &&
      (origin == null || origin.isCurrent) &&
      identical(ref.read(authProvider.notifier), notifier) &&
      signedInCustomer != null &&
      signedInGeneration == ApiService().sessionGeneration &&
      !current.sessionUnavailable &&
      !current.isLoading &&
      current.isLoggedIn &&
      current.user?.id == signedInCustomer &&
      current.user?.role == 'CUSTOMER';
}

class CustomerSignInPanel extends ConsumerWidget {
  const CustomerSignInPanel({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.lock_outline,
              size: 36,
              color: CustomerPalette.action,
            ),
            const SizedBox(height: 18),
            Text(
              customerText(context, 'Sign in to continue', '登录后继续'),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 10),
            Text(
              customerText(
                context,
                'Your bookings, favorites and account are private. You can browse shops without signing in.',
                '预约、收藏与账户资料仅本人可见。浏览门店无需登录。',
              ),
              textAlign: TextAlign.center,
              style: const TextStyle(color: CustomerPalette.muted, height: 1.6),
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: () => requireCustomerSignIn(context, ref),
              child: Text(customerText(context, 'Sign in', '登录')),
            ),
          ],
        ),
      ),
    ),
  );
}
