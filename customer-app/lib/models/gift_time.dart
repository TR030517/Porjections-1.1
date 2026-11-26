/// The API resolves store wall time with its IANA database. Never parse this
/// projection in the device zone, including on native platforms without Intl.
String giftShopTimestamp(String? localValue, String? timezone) {
  if (timezone == null ||
      timezone.isEmpty ||
      timezone != timezone.trim() ||
      !RegExp(r'^[A-Za-z][A-Za-z0-9_+./-]*$').hasMatch(timezone)) {
    return 'Shop timezone is not configured.';
  }
  if (localValue == null ||
      !RegExp(
        r'^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d GMT(?:[+-]\d{1,2}(?::\d{2})?)?$',
      ).hasMatch(localValue)) {
    return 'Store-local time is unavailable.';
  }
  return '$localValue ($timezone)';
}
