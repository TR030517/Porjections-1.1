import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'package:web/web.dart' as web;

const socialWebSupported = true;
@JS('google.accounts.id.initialize')
external void _googleInitialize(JSObject options);
@JS('google.accounts.id.renderButton')
external void _googleRenderButton(web.HTMLElement target, JSObject options);
@JS('AppleID.auth.init')
external void _appleInitialize(JSObject options);
@JS('AppleID.auth.signIn')
external JSPromise<JSObject> _appleSignIn();
final _scripts = <String, Future<void>>{};
Future<void> _load(String source) => _scripts.putIfAbsent(source, () async {
  final completer = Completer<void>();
  final script = web.HTMLScriptElement()
    ..src = source
    ..async = true;
  script.addEventListener(
    'load',
    ((web.Event event) {
      if (!completer.isCompleted) completer.complete();
    }).toJS,
  );
  script.addEventListener(
    'error',
    ((web.Event event) {
      if (!completer.isCompleted) {
        completer.completeError(StateError('Identity SDK unavailable'));
      }
    }).toJS,
  );
  web.document.head!.append(script);
  try {
    await completer.future.timeout(const Duration(seconds: 20));
  } catch (_) {
    script.remove();
    _scripts.remove(source);
    rethrow;
  }
});
Future<String?> obtainIdentityToken({
  required String provider,
  required String clientId,
  required String nonce,
  String? redirectUri,
}) async {
  if (provider == 'APPLE') {
    await _load(
      'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
    );
    _appleInitialize(
      {
            'clientId': clientId,
            'scope': 'name email',
            'redirectURI': redirectUri,
            'state': nonce,
            'nonce': nonce,
            'usePopup': true,
          }.jsify()
          as JSObject,
    );
    final result = await _appleSignIn().toDart.timeout(
      const Duration(minutes: 3),
    );
    final authorization = result.getProperty<JSObject>('authorization'.toJS);
    if (authorization.getProperty<JSString>('state'.toJS).toDart != nonce) {
      throw StateError('Identity state mismatch');
    }
    return authorization.getProperty<JSString>('id_token'.toJS).toDart;
  }
  if (provider != 'GOOGLE') {
    throw ArgumentError('Unsupported identity provider');
  }
  await _load('https://accounts.google.com/gsi/client?hl=en');
  final result = Completer<String?>();
  final overlay = web.HTMLDivElement()
    ..setAttribute('role', 'dialog')
    ..setAttribute('aria-label', 'Google sign in');
  overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;';
  final panel = web.HTMLDivElement();
  panel.style.cssText =
      'background:white;border-radius:14px;padding:28px;max-width:90vw;';
  final buttonHost = web.HTMLDivElement();
  final close = web.HTMLButtonElement()..textContent = 'Cancel';
  close.style.cssText =
      'display:block;margin:20px auto 0;padding:10px 20px;cursor:pointer;';
  close.addEventListener(
    'click',
    ((web.Event event) {
      if (!result.isCompleted) result.complete(null);
    }).toJS,
  );
  panel.append(buttonHost);
  panel.append(close);
  overlay.append(panel);
  web.document.body!.append(overlay);
  try {
    _googleInitialize(
      {
            'client_id': clientId,
            'nonce': nonce,
            'auto_select': false,
            'callback': ((JSObject response) {
              if (!result.isCompleted) {
                result.complete(
                  response.getProperty<JSString>('credential'.toJS).toDart,
                );
              }
            }).toJS,
          }.jsify()
          as JSObject,
    );
    _googleRenderButton(
      buttonHost,
      {
            'type': 'standard',
            'theme': 'outline',
            'size': 'large',
            'text': 'continue_with',
            'locale': 'en',
          }.jsify()
          as JSObject,
    );
    return await result.future.timeout(const Duration(minutes: 3));
  } finally {
    overlay.remove();
  }
}
