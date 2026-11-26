import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../l10n/app_localizations.dart';
import '../widgets/map_view_content.dart';

/// Map View Screen — full-screen OpenStreetMap with color-coded shop markers.
///
/// Wraps [MapViewContent] in a [Scaffold] for standalone navigation.
/// To embed the map inline (e.g. in a tab), use [MapViewContent] directly.
class MapViewScreen extends ConsumerWidget {
  const MapViewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.mapViewTitle)),
      body: const MapViewContent(),
    );
  }
}
