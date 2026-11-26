import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show PlatformViewHitTestBehavior;
import 'package:web/web.dart' as web;

const supportsShopMapEmbed = true;

class ShopMapFrame extends StatefulWidget {
  final Uri uri;
  final String title;
  final bool interactive;
  const ShopMapFrame({
    super.key,
    required this.uri,
    required this.title,
    required this.interactive,
  });

  @override
  State<ShopMapFrame> createState() => _ShopMapFrameState();
}

class _ShopMapFrameState extends State<ShopMapFrame> {
  web.HTMLIFrameElement? _frame;

  void _configure(web.HTMLIFrameElement frame) {
    frame
      ..title = widget.title
      ..loading = 'lazy'
      ..referrerPolicy = 'strict-origin-when-cross-origin'
      ..allowFullscreen = true;
    if (frame.getAttribute('src') != widget.uri.toString()) {
      frame.src = widget.uri.toString();
    }
    frame.style
      ..border = '0'
      ..width = '100%'
      ..height = '100%'
      ..display = 'block'
      // Leave normal page scrolling with Flutter until the customer explicitly
      // chooses Explore map; the iframe only handles events within its bounds.
      ..pointerEvents = widget.interactive ? 'auto' : 'none';
    frame.tabIndex = widget.interactive ? 0 : -1;
  }

  @override
  void didUpdateWidget(covariant ShopMapFrame oldWidget) {
    super.didUpdateWidget(oldWidget);
    final frame = _frame;
    if (frame != null) _configure(frame);
  }

  @override
  void dispose() {
    final frame = _frame;
    _frame = null;
    if (frame != null) {
      frame.src = 'about:blank';
      frame.remove();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView.fromTagName(
    tagName: 'iframe',
    hitTestBehavior: widget.interactive
        ? PlatformViewHitTestBehavior.opaque
        : PlatformViewHitTestBehavior.transparent,
    onElementCreated: (element) {
      final frame = element as web.HTMLIFrameElement;
      if (!mounted) {
        frame.remove();
        return;
      }
      _frame = frame;
      _configure(frame);
    },
  );
}
