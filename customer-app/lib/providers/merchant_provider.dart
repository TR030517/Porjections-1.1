import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth_provider.dart';
import '../services/api_service.dart';
import '../services/merchant_api_service.dart';
import '../models/merchant.dart';

/// Provider for MerchantApiService
final merchantApiProvider = Provider<MerchantApiService>((ref) {
  ref.watch(authProvider.select((state) => state.user?.id));
  return MerchantApiService(ref.read(apiServiceProvider));
});

/// Provider for merchant application status
final merchantApplicationProvider = FutureProvider<MerchantApplication?>((
  ref,
) async {
  final api = ref.watch(merchantApiProvider);
  return api.getApplicationStatus();
});

/// Provider for the list of shops owned by the current merchant
final merchantShopsProvider = FutureProvider<List<MerchantShop>>((ref) async {
  final api = ref.watch(merchantApiProvider);
  return api.getMyShops();
});

/// Provider for dashboard data
final merchantDashboardProvider =
    FutureProvider.family<MerchantDashboard, String>((ref, shopId) async {
      final api = ref.watch(merchantApiProvider);
      return api.getDashboard(shopId);
    });

/// Provider for Stripe onboarding status
final stripeOnboardingProvider = FutureProvider<Map<String, dynamic>>((
  ref,
) async {
  final api = ref.watch(merchantApiProvider);
  return api.getStripeOnboardingStatus();
});

/// Provider for transactions
final merchantTransactionsProvider =
    FutureProvider.family<PaginatedTransactions, Map<String, dynamic>>((
      ref,
      params,
    ) async {
      final api = ref.watch(merchantApiProvider);
      final result = await api.getTransactions(
        page: params['page'] ?? 1,
        pageSize: params['pageSize'] ?? 10,
        startDate: params['startDate'],
        endDate: params['endDate'],
      );
      return PaginatedTransactions.fromJson(result);
    });

/// Notifier for merchant shops — allows refresh
class MerchantShopListNotifier
    extends StateNotifier<AsyncValue<List<MerchantShop>>> {
  final MerchantApiService _api;

  MerchantShopListNotifier(this._api) : super(const AsyncValue.loading());

  Future<void> loadShops() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => _api.getMyShops());
  }

  Future<void> refresh() => loadShops();
}

final merchantShopListProvider =
    StateNotifierProvider<
      MerchantShopListNotifier,
      AsyncValue<List<MerchantShop>>
    >((ref) {
      final api = ref.watch(merchantApiProvider);
      return MerchantShopListNotifier(api);
    });

/// Notifier for payout — handles the withdrawal request
class PayoutNotifier extends StateNotifier<AsyncValue<Map<String, dynamic>?>> {
  final MerchantApiService _api;

  PayoutNotifier(this._api) : super(const AsyncValue.data(null));

  Future<bool> requestPayout(int amountCents) async {
    state = const AsyncValue.loading();
    final result = await AsyncValue.guard(
      () => _api.requestPayout(amountCents),
    );
    state = result;
    return result.hasValue;
  }

  void reset() {
    state = const AsyncValue.data(null);
  }
}

final payoutProvider =
    StateNotifierProvider<PayoutNotifier, AsyncValue<Map<String, dynamic>?>>((
      ref,
    ) {
      final api = ref.watch(merchantApiProvider);
      return PayoutNotifier(api);
    });

/// Provider for tax report
final taxReportProvider = FutureProvider.family<TaxReport, int>((
  ref,
  year,
) async {
  final api = ref.watch(merchantApiProvider);
  return api.getTaxReport(year: year);
});
