import 'dart:typed_data';
import 'dart:math';
import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'api_service.dart';
import '../models/media_url.dart';

typedef AvatarPicker = Future<XFile?> Function();
final uploadServiceProvider = Provider<UploadService>(
  (ref) => UploadService(ref.watch(apiServiceProvider)),
);

class UploadService {
  static const maxAvatarBytes = 8 * 1024 * 1024;
  final ApiService _api;
  final AvatarPicker _pick;
  bool _busy = false;
  Uint8List? _pendingBytes;
  String? _pendingKey;
  String? _pendingId;
  int? _pendingGeneration;
  UploadService(this._api, {AvatarPicker? picker})
    : _pick =
          picker ??
          (() => ImagePicker().pickImage(
            source: ImageSource.gallery,
            maxWidth: 512,
            maxHeight: 512,
          ));

  Future<String?> uploadAvatar() async {
    if (_busy) throw StateError('An avatar upload is already in progress.');
    _busy = true;
    final generation = _api.sessionGeneration;
    bool current() => generation == _api.sessionGeneration;
    void ensureCurrent() {
      if (!current()) {
        throw StateError(
          'Your session changed. Reopen your profile before uploading.',
        );
      }
    }

    try {
      final image = await _pick();
      ensureCurrent();
      if (image == null) {
        return null;
      }
      final length = await image.length();
      ensureCurrent();
      if (length <= 0 || length > maxAvatarBytes) {
        throw const FormatException(
          'Choose a JPEG, PNG or WebP image of at most 8 MiB.',
        );
      }
      final bytes = await image.readAsBytes();
      ensureCurrent();
      if (bytes.isEmpty || bytes.length > maxAvatarBytes) {
        throw const FormatException('Choose an image of at most 8 MiB.');
      }
      final type = _imageType(bytes);
      if (type == null ||
          (image.mimeType != null &&
              image.mimeType!.toLowerCase() != type.mime)) {
        throw const FormatException('Choose a valid JPEG, PNG or WebP image.');
      }
      if (_pendingGeneration != generation ||
          !listEquals(_pendingBytes, bytes)) {
        if (_pendingGeneration == generation && _pendingId != null) {
          await _api.abandonManagedMedia(_pendingId!);
          ensureCurrent();
        }
        _pendingGeneration = generation;
        _pendingBytes = bytes;
        _pendingId = null;
        final random = Random.secure();
        _pendingKey = List.generate(
          16,
          (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
        ).join();
      }
      if (_pendingId == null) {
        final uploaded = await _api.uploadManagedAvatar(
          bytes,
          type.mime,
          type.extension,
          _pendingKey!,
        );
        ensureCurrent();
        final item = _avatarItem(uploaded['item']);
        _pendingId = item['id'] as String;
      }
      final id = _pendingId!;
      final confirmed = await _api.confirmManagedMedia(id);
      ensureCurrent();
      final ready = _avatarItem(confirmed['item']);
      if (ready['id'] != id) {
        throw StateError('Image confirmation did not match this upload.');
      }
      final committed = await _api.commitManagedAvatar(id);
      ensureCurrent();
      final bound = _avatarItem(committed['item'], bound: true);
      if (bound['id'] != id || committed['avatarUrl'] != bound['fileUrl']) {
        throw StateError('Avatar upload was not confirmed.');
      }
      _pendingBytes = null;
      _pendingId = null;
      _pendingKey = null;
      _pendingGeneration = null;
      final displayUrl = resolveCustomerMediaUrl(bound['fileUrl']);
      if (displayUrl == null) {
        throw const FormatException(
          'The saved avatar URL could not be resolved.',
        );
      }
      return displayUrl;
    } finally {
      _busy = false;
    }
  }

  static Map<String, dynamic> _avatarItem(dynamic value, {bool bound = false}) {
    if (value is! Map) {
      throw const FormatException('Image storage returned an invalid result.');
    }
    final item = Map<String, dynamic>.from(value), id = item['id'];
    final uuid = RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    );
    if (id is! String ||
        !uuid.hasMatch(id) ||
        item['fileUrl'] != '/api/v1/upload/media/$id/file' ||
        item['scope'] != 'AVATAR' ||
        item['shopId'] != null ||
        item['purpose'] != 'avatar' ||
        (bound
            ? item['status'] != 'BOUND'
            : !['STAGED', 'BOUND'].contains(item['status'])) ||
        item['mimeType'] != 'image/webp' ||
        item['sizeBytes'] is! int ||
        (item['sizeBytes'] as int) < 1 ||
        (item['sizeBytes'] as int) > maxAvatarBytes ||
        item['width'] is! int ||
        item['height'] is! int ||
        (item['width'] as int) < 1 ||
        (item['height'] as int) < 1 ||
        (item['width'] as int) > 8192 ||
        (item['height'] as int) > 8192 ||
        (item['width'] as int) * (item['height'] as int) > 25000000) {
      throw const FormatException('Image storage returned an invalid result.');
    }
    return item;
  }

  static ({String mime, String extension})? _imageType(Uint8List bytes) {
    if (bytes.length >= 3 &&
        bytes[0] == 0xff &&
        bytes[1] == 0xd8 &&
        bytes[2] == 0xff) {
      return (mime: 'image/jpeg', extension: 'jpg');
    }
    if (bytes.length >= 8 &&
        List.generate(8, (i) => bytes[i]).join(',') ==
            '137,80,78,71,13,10,26,10') {
      return (mime: 'image/png', extension: 'png');
    }
    if (bytes.length >= 12 &&
        String.fromCharCodes(bytes.sublist(0, 4)) == 'RIFF' &&
        String.fromCharCodes(bytes.sublist(8, 12)) == 'WEBP') {
      return (mime: 'image/webp', extension: 'webp');
    }
    return null;
  }
}
