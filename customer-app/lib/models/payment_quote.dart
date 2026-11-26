import 'booking_add_on.dart';

class PaymentQuote {
  final int subtotalCents;
  final int discountCents;
  final int platformFeeCents;
  final int totalCents;
  final String currency;
  final bool paymentEnabled;
  final String? reason;
  final int? mainSubtotalCents;
  final int addOnSubtotalCents;
  final int tipCents;
  final List<BookingAddOnLine> addOns;
  const PaymentQuote({
    required this.subtotalCents,
    required this.discountCents,
    required this.platformFeeCents,
    required this.totalCents,
    required this.currency,
    required this.paymentEnabled,
    this.reason,
    this.mainSubtotalCents,
    this.addOnSubtotalCents = 0,
    this.tipCents = 0,
    this.addOns = const [],
  });
  factory PaymentQuote.fromJson(Map<String, dynamic> json) {
    final subtotal = addOnInteger(json['subtotalCents'], 'payment subtotal');
    final main = json['mainSubtotalCents'] == null ? subtotal : addOnInteger(json['mainSubtotalCents'], 'main subtotal');
    final extra = json['addOnSubtotalCents'] == null ? 0 : addOnInteger(json['addOnSubtotalCents'], 'add-on subtotal');
    final lines = BookingAddOnLine.parseList(json['addOns']);
    final discount = addOnInteger(json['discountCents'], 'payment discount'), fee = addOnInteger(json['platformFeeCents'], 'payment fee'),
      tip = json['tipCents'] == null ? 0 : addOnInteger(json['tipCents'], 'tip'), total = addOnInteger(json['totalCents'], 'payment total');
    if (main + extra != subtotal || lines.fold<int>(0, (sum,row) => sum + row.lineTotalCents) != extra) throw const FormatException('Invalid saved payment breakdown');
    if (lines.isNotEmpty && (json['currency'] != 'usd' || discount > main || subtotal - discount + fee + tip != total)) throw const FormatException('Invalid add-on payment total');
    return PaymentQuote(
    subtotalCents: subtotal,
    discountCents: discount,
    platformFeeCents: fee,
    totalCents: total,
    currency: json['currency'] as String,
    paymentEnabled: json['paymentEnabled'] == true,
    reason: json['reason'] as String?,
    mainSubtotalCents: main,
    addOnSubtotalCents: extra,
    tipCents: tip,
    addOns: lines,
  );
  }
}
