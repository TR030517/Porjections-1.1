import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _storage = FlutterSecureStorage();
Future<String?> readRescheduleMarker(String key) => _storage.read(key: key);
Future<void> writeRescheduleMarker(String key, String value) =>
    _storage.write(key: key, value: value);
Future<void> removeRescheduleMarker(String key) => _storage.delete(key: key);
