import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/square_checkout.dart';

void main() {
  final response = <String, dynamic>{
    'provider': 'square',
    'mock': false,
    'checkoutUrl': 'https://sandbox.square.link/u/test',
    'providerOrderId': 'order_test',
    'paymentRecordId': 'record_test',
    'paymentIntentId': null,
  };
  test(
    'Square checkout keeps order and record identifiers separate from payment ID',
    () {
      final checkout = SquareCheckout.fromJson(response, 'sandbox');
      expect(checkout.orderId, 'order_test');
      expect(checkout.recordId, 'record_test');
      expect(checkout.url.scheme, 'https');
    },
  );
  test(
    'rejects unsafe, wrong-provider, missing and mock checkout responses',
    () {
      for (final change in [
        {'checkoutUrl': 'http://sandbox.square.link/u/test'},
        {'checkoutUrl': 'https://square.link.attacker.test/u/test'},
        {'checkoutUrl': 'https://user:password@square.link/u/test'},
        {'checkoutUrl': 'https://square.link:8443/u/test'},
        {'checkoutUrl': 'https://square.link/u/test#result=success'},
        {'provider': 'stripe'},
        {'mock': true},
        {'providerOrderId': null},
        {'paymentRecordId': ''},
      ]) {
        expect(
          () => SquareCheckout.fromJson({...response, ...change}, 'sandbox'),
          throwsFormatException,
        );
      }
      expect(
        () => SquareCheckout.fromJson(response, 'production'),
        throwsFormatException,
      );
      expect(
        () => SquareCheckout.fromJson(response, 'unknown'),
        throwsFormatException,
      );
    },
  );
}
