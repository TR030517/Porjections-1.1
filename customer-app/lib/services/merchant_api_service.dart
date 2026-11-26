import 'package:dio/dio.dart';
import 'api_service.dart';
import '../models/merchant.dart';

/// Merchant API Service — wraps all /merchant/* endpoints
class MerchantApiService {
  final ApiService _api;

  MerchantApiService(this._api);

  Dio get _dio => _api.dio;

  // ── Application ──

  /// Apply to become a merchant
  Future<MerchantApplication> applyMerchant(Map<String, dynamic> data) async {
    final response = await _dio.post('/merchant/apply', data: data);
    return MerchantApplication.fromJson(response.data as Map<String, dynamic>);
  }

  /// Get current application status
  Future<MerchantApplication?> getApplicationStatus() async {
    try {
      final response = await _dio.get('/merchant/application-status');
      final data = response.data;
      if (data == null) return null;
      return MerchantApplication.fromJson(data as Map<String, dynamic>);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }

  // ── Shops ──

  /// Get all shops owned by the current merchant
  Future<List<MerchantShop>> getMyShops() async {
    final response = await _dio.get('/merchant/shops');
    final list = response.data as List<dynamic>;
    return list
        .map((e) => MerchantShop.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Update shop info
  Future<MerchantShop> updateShop(String shopId, Map<String, dynamic> data) async {
    final response = await _dio.patch('/merchant/shops/$shopId', data: data);
    return MerchantShop.fromJson(response.data as Map<String, dynamic>);
  }

  /// Set business hours for a shop
  Future<void> setBusinessHours(String shopId, List<Map<String, dynamic>> hours) async {
    await _dio.post('/merchant/shops/$shopId/business-hours', data: {'hours': hours});
  }

  /// Add an image to a shop
  Future<ShopImage> addShopImage(String shopId, Map<String, dynamic> data) async {
    final response = await _dio.post('/merchant/shops/$shopId/images', data: data);
    return ShopImage.fromJson(response.data as Map<String, dynamic>);
  }

  /// Delete a shop image
  Future<void> deleteShopImage(String imageId) async {
    await _dio.delete('/merchant/images/$imageId');
  }

  // ── Services ──

  /// Get services for a shop
  Future<List<dynamic>> getShopServices(String shopId) async {
    final response = await _dio.get('/merchant/shops/$shopId/services');
    return response.data as List<dynamic>;
  }

  /// Create a new service
  Future<Map<String, dynamic>> createShopService(String shopId, Map<String, dynamic> data) async {
    final response = await _dio.post('/merchant/shops/$shopId/services', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Update a service
  Future<Map<String, dynamic>> updateShopService(String serviceId, Map<String, dynamic> data) async {
    final response = await _dio.patch('/merchant/services/$serviceId', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Delete a service
  Future<void> deleteShopService(String serviceId) async {
    await _dio.delete('/merchant/services/$serviceId');
  }

  // ── Therapists ──

  /// Get therapists for a shop
  Future<List<dynamic>> getTherapists(String shopId) async {
    final response = await _dio.get('/merchant/shops/$shopId/therapists');
    return response.data as List<dynamic>;
  }

  /// Create a new therapist
  Future<Map<String, dynamic>> createTherapist(String shopId, Map<String, dynamic> data) async {
    final response = await _dio.post('/merchant/shops/$shopId/therapists', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Update a therapist
  Future<Map<String, dynamic>> updateTherapist(String therapistId, Map<String, dynamic> data) async {
    final response = await _dio.patch('/merchant/therapists/$therapistId', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Delete a therapist
  Future<void> deleteTherapist(String therapistId) async {
    await _dio.delete('/merchant/therapists/$therapistId');
  }

  // ── Bookings ──

  /// Get bookings for a shop, optionally filtered by status
  Future<List<dynamic>> getShopBookings(String shopId, {String? status}) async {
    final params = <String, dynamic>{};
    if (status != null) params['status'] = status;
    final response = await _dio.get('/merchant/shops/$shopId/bookings', queryParameters: params);
    return response.data as List<dynamic>;
  }

  /// Confirm a booking
  Future<void> confirmBooking(String bookingId) async {
    await _dio.post('/merchant/bookings/$bookingId/confirm');
  }

  /// Complete a booking
  Future<void> completeBooking(String bookingId) async {
    await _dio.post('/merchant/bookings/$bookingId/complete');
  }

  // ── Dashboard ──

  /// Get dashboard statistics for a shop
  Future<MerchantDashboard> getDashboard(String shopId, {String? startDate, String? endDate}) async {
    final params = <String, dynamic>{};
    if (startDate != null) params['startDate'] = startDate;
    if (endDate != null) params['endDate'] = endDate;
    final response = await _dio.get('/merchant/shops/$shopId/dashboard', queryParameters: params);
    return MerchantDashboard.fromJson(response.data as Map<String, dynamic>);
  }

  // ── Coupons (P3-T08 CPN-007) ──

  /// List coupons for my shop
  Future<List<dynamic>> getShopCoupons(String shopId) async {
    final response = await _dio.get('/merchant/shops/$shopId/coupons');
    return response.data as List<dynamic>;
  }

  /// Create a shop-scoped coupon
  Future<Map<String, dynamic>> createShopCoupon(String shopId, Map<String, dynamic> data) async {
    final response = await _dio.post('/merchant/shops/$shopId/coupons', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Update a shop coupon
  Future<Map<String, dynamic>> updateShopCoupon(String shopId, String couponId, Map<String, dynamic> data) async {
    final response = await _dio.patch('/merchant/shops/$shopId/coupons/$couponId', data: data);
    return response.data as Map<String, dynamic>;
  }

  /// Update coupon status (ACTIVE/PAUSED/DRAFT)
  Future<Map<String, dynamic>> updateShopCouponStatus(String shopId, String couponId, String status) async {
    final response = await _dio.patch('/merchant/shops/$shopId/coupons/$couponId/status', data: {'status': status});
    return response.data as Map<String, dynamic>;
  }

  /// Soft delete a shop coupon
  Future<void> deleteShopCoupon(String shopId, String couponId) async {
    await _dio.delete('/merchant/shops/$shopId/coupons/$couponId');
  }

  // ── Stripe Connect Onboarding ──

  /// Create Stripe Connect onboarding URL
  Future<Map<String, dynamic>> createStripeOnboarding(String shopId) async {
    final response = await _dio.post('/merchant/stripe/onboarding', data: {'shopId': shopId});
    return response.data as Map<String, dynamic>;
  }

  /// Get Stripe Connect onboarding status
  Future<Map<String, dynamic>> getStripeOnboardingStatus() async {
    final response = await _dio.get('/merchant/stripe/onboarding-status');
    return response.data as Map<String, dynamic>;
  }

  // ── Payout / Withdrawal ──

  /// Request a payout (withdrawal)
  Future<Map<String, dynamic>> requestPayout(int amountCents) async {
    final response = await _dio.post('/merchant/payout', data: {
      'amountCents': amountCents,
    });
    return response.data as Map<String, dynamic>;
  }

  // ── Transactions ──

  /// Get paginated transaction list
  Future<Map<String, dynamic>> getTransactions({
    int page = 1,
    int pageSize = 10,
    String? startDate,
    String? endDate,
  }) async {
    final params = <String, dynamic>{
      'page': page,
      'pageSize': pageSize,
    };
    if (startDate != null) params['startDate'] = startDate;
    if (endDate != null) params['endDate'] = endDate;
    final response = await _dio.get('/merchant/transactions', queryParameters: params);
    return response.data as Map<String, dynamic>;
  }

  // ── Tax Report ──

  /// Get annual tax summary report
  Future<TaxReport> getTaxReport({int? year}) async {
    final params = <String, dynamic>{};
    if (year != null) params['year'] = year;
    final response = await _dio.get('/merchant/tax-report', queryParameters: params);
    return TaxReport.fromJson(response.data as Map<String, dynamic>);
  }

  /// Export annual tax report CSV — returns raw CSV string
  Future<String> exportTaxReportCsv({int? year}) async {
    final params = <String, dynamic>{};
    if (year != null) params['year'] = year;
    final response = await _dio.get(
      '/merchant/tax-report/export',
      queryParameters: params,
      options: Options(
        responseType: ResponseType.plain,
      ),
    );
    return response.data as String;
  }

}
