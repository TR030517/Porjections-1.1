import 'user.dart';

bool bookingOnlinePaymentEnabled(Map<dynamic,dynamic> json) =>
    json['onlinePaymentEnabled'] == true && json['orderOnly'] != true;

String? bookingAccountEmail(User? user) {
  if (user?.role != 'CUSTOMER' || user?.emailVerified != true) return null;
  final email = user?.email?.trim();
  if (email == null || email.length > 254 ||
      !RegExp(r'^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$').hasMatch(email)) {
    return null;
  }
  return email;
}

const bookingOrderExplanation = 'Order updates use the verified email on your account. Check email status in the saved order; the shop confirms and handles the order offline. Submitting does not record a payment.';
