import 'package:web/web.dart' as web;

Future<String?> readRescheduleMarker(String key) async =>
    web.window.sessionStorage.getItem(key);
Future<void> writeRescheduleMarker(String key, String value) async =>
    web.window.sessionStorage.setItem(key, value);
Future<void> removeRescheduleMarker(String key) async =>
    web.window.sessionStorage.removeItem(key);
