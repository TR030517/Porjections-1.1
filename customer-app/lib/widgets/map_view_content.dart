import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_marker_cluster/flutter_map_marker_cluster.dart';
import 'package:latlong2/latlong.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../l10n/app_localizations.dart';
import '../models/shop.dart';
import '../providers/shop_provider.dart';
import '../navigation/customer_navigation.dart';

/// Map body content — full-screen OpenStreetMap with color-coded shop markers.
///
/// Designed to be used either inline (e.g. inside [AnimatedSwitcher]) or
/// wrapped in a [Scaffold] by [MapViewScreen].
class MapViewContent extends ConsumerStatefulWidget {
  const MapViewContent({super.key});

  @override
  ConsumerState<MapViewContent> createState() => _MapViewContentState();
}

class _MapViewContentState extends ConsumerState<MapViewContent> {
  final MapController _mapController = MapController();
  LatLng _center = const LatLng(40.7128, -74.0060);
  bool _locationLoading = true;
  bool _locationFailed = false;

  @override
  void initState() {
    super.initState();
    _getCurrentLocation();
  }

  Future<void> _getCurrentLocation() async {
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
        ),
      );
      if (!mounted) return;
      setState(() {
        _center = LatLng(position.latitude, position.longitude);
        _locationLoading = false;
        _locationFailed = false;
      });
      _mapController.move(_center, 14.0);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locationLoading = false;
        _locationFailed = true;
      });
    }
  }

  /// Recenters the map on the user's current location.
  ///
  /// If the location has not been resolved yet (still loading or failed),
  /// shows a friendly SnackBar hint instead of moving the map.
  void _onRecenterPressed() {
    final l10n = AppLocalizations.of(context)!;
    if (_locationLoading || _locationFailed) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(l10n.locationUnavailable),
            behavior: SnackBarBehavior.floating,
          ),
        );
      return;
    }
    _mapController.move(_center, 14.0);
  }

  Color _colorForCategory(String category) {
    switch (category) {
      case 'TUINA':
        return const Color(0xFFE53935);
      case 'REFLEXOLOGY':
        return const Color(0xFF1E88E5);
      case 'CUPPING':
        return const Color(0xFF43A047);
      case 'SCRAPING':
        return const Color(0xFF8E24AA);
      case 'MIXED':
        return const Color(0xFFFB8C00);
      default:
        return const Color(0xFF0D6B5E);
    }
  }

  IconData _iconForCategory(String category) {
    switch (category) {
      case 'TUINA':
        return Icons.self_improvement;
      case 'REFLEXOLOGY':
        return Icons.directions_walk;
      case 'CUPPING':
        return Icons.radio_button_checked;
      case 'SCRAPING':
        return Icons.swipe;
      case 'MIXED':
        return Icons.spa;
      default:
        return Icons.spa;
    }
  }

  void _onMarkerTap(Shop shop) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => MapShopInfoSheet(shop: shop),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final state = ref.watch(shopListProvider);
    final shops = state.data?.items ?? [];
    final theme = Theme.of(context);

    return Stack(
      children: [
        // --- Map layer ---
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(initialCenter: _center, initialZoom: 14.0),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.massajoy.app',
            ),
            if (!_locationLoading)
              MarkerLayer(
                markers: [
                  Marker(
                    point: _center,
                    width: 36,
                    height: 36,
                    child: const _UserPulseMarker(),
                  ),
                ],
              ),
            MarkerClusterLayerWidget(
              options: MarkerClusterLayerOptions(
                // Clustering stops at zoom > 15 so markers spread out as
                // individual category-colored pins when zoomed in.
                disableClusteringAtZoom: 15,
                maxClusterRadius: 80,
                size: const Size(48, 48),
                alignment: Alignment.center,
                padding: const EdgeInsets.all(50),
                // Markers already provide their own tap handling
                // (see _onMarkerTap below), so let the child own gestures.
                markerChildBehavior: true,
                markers: shops.map((shop) {
                  final catColor = _colorForCategory(shop.category);
                  return Marker(
                    point: LatLng(shop.latitude, shop.longitude),
                    width: 48,
                    height: 48,
                    child: GestureDetector(
                      onTap: () => _onMarkerTap(shop),
                      child: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: catColor,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: [
                            BoxShadow(
                              color: catColor.withValues(alpha: 0.4),
                              blurRadius: 8,
                              spreadRadius: 1,
                            ),
                          ],
                        ),
                        child: Icon(
                          _iconForCategory(shop.category),
                          color: Colors.white,
                          size: 22,
                        ),
                      ),
                    ),
                  );
                }).toList(),
                builder: (context, markers) {
                  return Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: const Color(0xFF0D6B5E),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.25),
                          blurRadius: 8,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        '${markers.length}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),

        // --- Recenter FAB: bottom-right, tap to return to user location ---
        Positioned(
          right: 16,
          bottom: 16,
          child: Material(
            color: Colors.white,
            elevation: 4,
            shape: const CircleBorder(),
            child: IconButton(
              tooltip: l10n.recenter,
              onPressed: _onRecenterPressed,
              icon: const Icon(Icons.my_location),
              color: _locationLoading || _locationFailed
                  ? Colors.grey
                  : const Color(0xFF0D6B5E),
              iconSize: 24,
              padding: const EdgeInsets.all(12),
            ),
          ),
        ),

        if (_locationLoading)
          Positioned(
            top: 16,
            left: 0,
            right: 0,
            child: Center(
              child: Card(
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 10),
                      Text(l10n.gettingLocation),
                    ],
                  ),
                ),
              ),
            ),
          ),

        if (!_locationLoading)
          Positioned(
            top: 8,
            left: 0,
            right: 0,
            child: Material(
              color: Colors.transparent,
              child: _buildCategoryChips(theme),
            ),
          ),

        if (shops.isNotEmpty)
          Positioned(
            bottom: 16,
            left: 16,
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.92),
                borderRadius: BorderRadius.circular(12),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 8,
                  ),
                ],
              ),
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    l10n.mapLegend,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: Colors.grey[700],
                    ),
                  ),
                  const Divider(height: 8),
                  ..._buildLegend(theme),
                ],
              ),
            ),
          ),

        if (shops.isEmpty && !_locationLoading)
          Positioned(
            top: 60,
            left: 0,
            right: 0,
            child: Center(
              child: Card(
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  child: Text(l10n.noShopsOnMap),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildCategoryChips(ThemeData theme) {
    final activeCategory = ref.watch(shopListProvider).category;
    final chips = [
      _MapCatChip(
        label: AppLocalizations.of(context)!.categoryAll,
        category: null,
        isSelected: activeCategory == null,
      ),
      _MapCatChip(
        label: AppLocalizations.of(context)!.categoryTuiNa,
        category: 'TUINA',
        isSelected: activeCategory == 'TUINA',
      ),
      _MapCatChip(
        label: AppLocalizations.of(context)!.categoryFootMassage,
        category: 'REFLEXOLOGY',
        isSelected: activeCategory == 'REFLEXOLOGY',
      ),
      _MapCatChip(
        label: AppLocalizations.of(context)!.categoryMixed,
        category: 'MIXED',
        isSelected: activeCategory == 'MIXED',
      ),
      _MapCatChip(
        label: AppLocalizations.of(context)!.categoryCupping,
        category: 'CUPPING',
        isSelected: activeCategory == 'CUPPING',
      ),
      _MapCatChip(
        label: AppLocalizations.of(context)!.categoryScraping,
        category: 'SCRAPING',
        isSelected: activeCategory == 'SCRAPING',
      ),
    ];

    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: chips.map((chip) {
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: ChoiceChip(
              label: Text(chip.label),
              selected: chip.isSelected,
              onSelected: (_) {
                ref.read(shopListProvider.notifier).setCategory(chip.category);
              },
            ),
          );
        }).toList(),
      ),
    );
  }

  List<Widget> _buildLegend(ThemeData theme) {
    final entries = [
      _LegendEntry('TUINA', 'Tui Na', const Color(0xFFE53935)),
      _LegendEntry('REFLEXOLOGY', 'Foot Massage', const Color(0xFF1E88E5)),
      _LegendEntry('CUPPING', 'Cupping', const Color(0xFF43A047)),
      _LegendEntry('SCRAPING', 'Scraping', const Color(0xFF8E24AA)),
      _LegendEntry('MIXED', 'Mixed', const Color(0xFFFB8C00)),
    ];

    return entries.map((e) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(color: e.color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Text(e.label, style: const TextStyle(fontSize: 11)),
          ],
        ),
      );
    }).toList();
  }
}

/// Pulse-animated user location marker.
class _UserPulseMarker extends StatefulWidget {
  const _UserPulseMarker();

  @override
  State<_UserPulseMarker> createState() => _UserPulseMarkerState();
}

class _UserPulseMarkerState extends State<_UserPulseMarker>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _pulseAnim;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);
    _pulseAnim = Tween<double>(begin: 0.6, end: 1.0).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseAnim,
      builder: (context, _) {
        final scale = 0.8 + (_pulseAnim.value * 0.2);
        return Container(
          width: 24 * scale,
          height: 24 * scale,
          decoration: BoxDecoration(
            color: Colors.blue.withValues(
              alpha: 0.15 + (_pulseAnim.value * 0.15),
            ),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.blue, width: 3),
          ),
          child: Center(
            child: Icon(Icons.my_location, color: Colors.blue, size: 14),
          ),
        );
      },
    );
  }
}

/// Helper class to hold category chip data for the map view.
class _MapCatChip {
  final String label;
  final String? category;
  final bool isSelected;

  const _MapCatChip({
    required this.label,
    this.category,
    required this.isSelected,
  });
}

/// Legend entry for the map legend.
class _LegendEntry {
  final String key;
  final String label;
  final Color color;
  const _LegendEntry(this.key, this.label, this.color);
}

/// Bottom sheet shown when tapping a shop marker on the map.
class MapShopInfoSheet extends StatelessWidget {
  final Shop shop;
  const MapShopInfoSheet({super.key, required this.shop});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 20,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              shop.name,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(Icons.star, size: 18, color: Colors.amber[700]),
                const SizedBox(width: 4),
                Text(
                  shop.avgRating.toStringAsFixed(1),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(width: 4),
                Text(
                  '(${shop.reviewCount})',
                  style: TextStyle(fontSize: 12, color: Colors.grey[500]),
                ),
                const SizedBox(width: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    shop.categoryLabel,
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
                if (shop.formattedDistance.isNotEmpty) ...[
                  const SizedBox(width: 12),
                  Icon(Icons.pin_drop, size: 16, color: Colors.grey[600]),
                  const SizedBox(width: 4),
                  Text(
                    shop.formattedDistance,
                    style: TextStyle(color: Colors.grey[600], fontSize: 13),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.location_on_outlined,
                  size: 16,
                  color: Colors.grey[500],
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    shop.address,
                    style: TextStyle(color: Colors.grey[600], fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () {
                  Navigator.pop(context);
                  openCustomerShop(
                    context,
                    shopId: shop.id,
                    shopName: shop.name,
                    canonicalPath: shop.canonicalPath,
                  );
                },
                icon: const Icon(Icons.store_outlined),
                label: Text(l10n.viewShop),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _openDirections(shop.latitude, shop.longitude),
                icon: const Icon(Icons.directions_outlined),
                label: Text(l10n.getDirections),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openDirections(double lat, double lng) async {
    final uri = Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng',
    );
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Fall back to in-app browser if external launch fails.
      await launchUrl(uri);
    }
  }
}
