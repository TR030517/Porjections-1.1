import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api_service.dart';

abstract interface class PaymentCheckoutApi {
  Future<Map<String, dynamic>> config();
  Future<Map<String, dynamic>> quote(String bookingId);
  Future<Map<String, dynamic>> booking(String bookingId);
  Future<Map<String, dynamic>> create(String bookingId);
}

class _PaymentCheckoutApi implements PaymentCheckoutApi {
  final ApiService api;
  _PaymentCheckoutApi(this.api);
  @override
  Future<Map<String, dynamic>> config() => api.getPaymentConfig();
  @override
  Future<Map<String, dynamic>> quote(String bookingId) =>
      api.getPaymentQuote(bookingId);
  @override
  Future<Map<String, dynamic>> booking(String bookingId) =>
      api.getBooking(bookingId);
  @override
  Future<Map<String, dynamic>> create(String bookingId) =>
      api.createPaymentIntent(bookingId);
}

final paymentCheckoutApiProvider = Provider<PaymentCheckoutApi>(
  (ref) => _PaymentCheckoutApi(ref.watch(apiServiceProvider)),
);
typedef CheckoutLauncher = Future<bool> Function(Uri url);
final checkoutLauncherProvider = Provider<CheckoutLauncher>(
  (ref) =>
      (url) => launchUrl(
        url,
        mode: LaunchMode.externalApplication,
        webOnlyWindowName: '_blank',
      ),
);
