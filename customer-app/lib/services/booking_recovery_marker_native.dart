// Native builds retain a reminder for this process only. No automatic recovery
// or durable native booking-draft capability is claimed.
String? _key;
bool hasBookingRecoveryMarker() => _key != null;
bool writeBookingRecoveryMarker(String key, String shopId) { _key = key; return true; }
void clearBookingRecoveryMarker([String? key]) { if (key == null || key == _key) _key = null; }
