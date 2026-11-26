import 'dart:convert';
import 'package:web/web.dart' as web;

const _storageKey = 'massajoy:booking-recovery:v1';
String? _memoryKey;
bool hasBookingRecoveryMarker() {
  try { return _memoryKey != null || web.window.sessionStorage.getItem(_storageKey) != null; }
  catch (_) { return _memoryKey != null; }
}
bool writeBookingRecoveryMarker(String key, String shopId) {
  _memoryKey = key;
  try {
    // Only opaque request/shop IDs. No payload, quote, name, contact or token.
    web.window.sessionStorage.setItem(_storageKey, jsonEncode({'key': key, 'shopId': shopId}));
    return true;
  } catch (_) { return false; }
}
void clearBookingRecoveryMarker([String? key]) {
  try {
    final raw = web.window.sessionStorage.getItem(_storageKey);
    if (key == null || raw != null && (jsonDecode(raw) as Map)['key'] == key) web.window.sessionStorage.removeItem(_storageKey);
  } catch (_) { /* Keep the reminder when another attempt cannot be identified. */ }
  if (key == null || key == _memoryKey) _memoryKey = null;
}
