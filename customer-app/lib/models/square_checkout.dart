/// A server-created Square checkout. This never represents a settled payment.
class SquareCheckout {
  final Uri url;
  final String orderId;
  final String recordId;
  const SquareCheckout(this.url, this.orderId, this.recordId);

  factory SquareCheckout.fromJson(
    Map<String, dynamic> json,
    String environment,
  ) {
    final url = Uri.tryParse(json['checkoutUrl'] as String? ?? '');
    final orderId = json['providerOrderId'];
    final recordId = json['paymentRecordId'];
    final validEnvironment =
        environment == 'sandbox' || environment == 'production';
    final allowedHost =
        url != null &&
        (url.host == 'square.link' ||
            url.host == 'sandbox.square.link' ||
            url.host == 'checkout.square.site' ||
            url.host.endsWith('.square.site') ||
            environment == 'sandbox' &&
                url.host.endsWith('.squareupsandbox.com'));
    if (!validEnvironment ||
        json['provider'] != 'square' ||
        json['mock'] != false ||
        url == null ||
        url.scheme != 'https' ||
        !allowedHost ||
        url.userInfo.isNotEmpty ||
        url.hasFragment ||
        url.port != 443 ||
        environment == 'production' && url.host == 'sandbox.square.link' ||
        orderId is! String ||
        orderId.isEmpty ||
        recordId is! String ||
        recordId.isEmpty) {
      throw const FormatException(
        'A valid server-created Square checkout is required.',
      );
    }
    return SquareCheckout(url, orderId, recordId);
  }
}
