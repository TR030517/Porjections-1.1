import 'package:flutter/material.dart';

/// Keeps reading and selection surfaces comfortable on wide screens without
/// changing their height, scrolling, or the available width on phones.
class ResponsiveContent extends StatelessWidget {
  final double maxWidth;
  final Widget child;

  const ResponsiveContent({
    super.key,
    required this.maxWidth,
    required this.child,
  });

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topCenter,
    heightFactor: 1,
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: SizedBox(width: double.infinity, child: child),
    ),
  );
}
