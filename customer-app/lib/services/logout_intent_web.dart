import 'dart:math';
import 'package:web/web.dart' as web;

const _key = 'massajoy:customer:explicit-logout:v1';
const _cookie = 'massajoy_customer_signed_out';
String? _memory;
String? explicitLogoutIntent() {
  String? stored, cookieValue;
  var storageReadable = false, cookieReadable = false;
  try { stored = web.window.localStorage.getItem(_key); storageReadable = true; }
  catch (_) { /* Read cookie fallback. */ }
  try {
    final cookies = web.document.cookie.split(';').map((v) => v.trim());
    cookieValue = cookies.where((v) => v.startsWith('$_cookie=')).firstOrNull?.substring(_cookie.length + 1);
    cookieReadable = true;
  } catch (_) { /* Storage fallback. */ }
  return cookieValue ?? stored ?? _memory ?? (!storageReadable && !cookieReadable ? 'storage-unavailable' : null);
}
void markExplicitLogout() {
  // This is an opaque logout generation, not a credential. Keep the bound
  // within web's 32-bit integer range so it cannot compile to zero.
  final token = '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x3fffffff)}';
  _memory = token;
  try { web.window.localStorage.setItem(_key, token); } catch (_) { /* Cookie fallback. */ }
  try { web.document.cookie = '$_cookie=$token; Path=/; SameSite=Strict; Max-Age=31536000'; } catch (_) { /* Storage fallback. */ }
}
bool acceptExplicitLogin(String? expected) {
  if (explicitLogoutIntent() != expected) return false;
  try { web.window.localStorage.removeItem(_key); } catch (_) { /* Cookie fallback. */ }
  try { web.document.cookie = '$_cookie=; Path=/; SameSite=Strict; Max-Age=0'; } catch (_) { /* Storage fallback. */ }
  _memory = null;
  return true;
}
