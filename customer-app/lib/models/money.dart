/// Preserve integer minor units without floating point rounding or ambiguous symbols.
String formatCents(int cents, String currency) {
  final absolute = cents.abs();
  final amount =
      '${cents < 0 ? '-' : ''}${absolute ~/ 100}.${(absolute % 100).toString().padLeft(2, '0')}';
  return '${currency.toUpperCase()} $amount';
}
