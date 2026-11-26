import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import 'auth_provider.dart';
import '../models/coupon.dart';

/// Provider for coupon API calls
final couponRepositoryProvider = Provider<CouponRepository>((ref) {
  return CouponRepository(ref.read(apiServiceProvider));
});

/// Coupon repository — claimable list, claim, wallet, validate
class CouponRepository {
  final ApiService _api;
  CouponRepository(this._api);

  /// List claimable coupons (optionally scoped to a shop)
  Future<List<Coupon>> listClaimable({String? shopId}) async {
    final response = await _api.dio.get(
      '/coupons',
      queryParameters: {'shopId': ?shopId},
    );
    final data = response.data;
    if (data is List) {
      return data
          .map((e) => Coupon.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    return [];
  }

  /// Claim a coupon by coupon id
  Future<void> claimCoupon(String couponId) async {
    await _api.dio.post('/coupons/$couponId/claim');
  }

  /// My coupon wallet, filtered by status
  Future<List<UserCoupon>> myCoupons({String? status}) async {
    final response = await _api.dio.get(
      '/users/me/coupons',
      queryParameters: {'status': ?status},
    );
    final data = response.data;
    if (data is List) {
      return data
          .map((e) => UserCoupon.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    return [];
  }

  /// Validate a user coupon against shop + price
  Future<Map<String, dynamic>> validateCoupon({
    required String userCouponId,
    required String shopId,
    required int priceCents,
  }) async {
    final response = await _api.dio.post(
      '/coupons/validate',
      data: {
        'couponId': userCouponId,
        'shopId': shopId,
        'priceCents': priceCents,
      },
    );
    return response.data as Map<String, dynamic>;
  }
}

/// FutureProvider for claimable coupons (auto-refresh via ref.invalidate)
final claimableCouponsProvider = FutureProvider.autoDispose<List<Coupon>>((
  ref,
) {
  return ref.read(couponRepositoryProvider).listClaimable();
});

/// FutureProvider for my coupon wallet, parameterized by status
final myCouponsProvider = FutureProvider.autoDispose
    .family<List<UserCoupon>, String?>((ref, status) {
      if (ref.watch(authProvider.select((state) => state.user?.id)) == null) {
        return Future.value([]);
      }
      return ref.read(couponRepositoryProvider).myCoupons(status: status);
    });
