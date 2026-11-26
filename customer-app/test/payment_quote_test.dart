import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/payment_quote.dart';

void main() {
  test(
    'server total is authoritative and payment is disabled unless explicit',
    () {
      final quote = PaymentQuote.fromJson({
        'subtotalCents': 10000,
        'discountCents': 1000,
        'platformFeeCents': 720,
        'totalCents': 9000,
        'currency': 'usd',
        'reason': 'Provider not configured',
      });
      expect(quote.totalCents, 9000);
      expect(quote.platformFeeCents, 720);
      expect(quote.paymentEnabled, isFalse);
      expect(quote.reason, 'Provider not configured');
    },
  );
}
