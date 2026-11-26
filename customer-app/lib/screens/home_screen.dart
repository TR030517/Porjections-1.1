import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';
import '../providers/favorites_provider.dart';
import '../providers/shop_provider.dart';
import '../providers/view_mode_provider.dart';
import '../l10n/app_localizations.dart';
import '../models/shop.dart';
import '../theme/customer_theme.dart';
import '../widgets/map_view_content.dart';
import '../widgets/customer_access.dart';
import '../navigation/customer_navigation.dart';
import 'shop_list_screen.dart';
import 'booking_list_screen.dart';
import 'profile_screen.dart';

/// Customer website navigation, with desktop tabs and compact phone navigation.
class HomeScreen extends ConsumerStatefulWidget {
  final int initialTab;
  const HomeScreen({super.key, this.initialTab = 0});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late int _currentIndex;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialTab.clamp(0, 3).toInt();
  }

  @override
  void didUpdateWidget(covariant HomeScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialTab != widget.initialTab) {
      _currentIndex = widget.initialTab.clamp(0, 3).toInt();
    }
  }

  void _selectTab(int index) {
    final tab = index.clamp(0, 3).toInt();
    setState(() => _currentIndex = tab);
    // Keep the live tab and browser destination aligned. Otherwise returning
    // to the already-current URL can leave the local Profile tab selected.
    final router = GoRouter.maybeOf(context);
    if (router != null) router.go(tab == 0 ? '/' : '/?tab=$tab');
  }

  Future<void> _logout() async {
    try {
      await ref.read(authProvider.notifier).logout();
    } catch (_) {
      if (mounted && !ref.read(authProvider).isLoggedIn) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('You are signed out on this browser. Server sign-out could not be confirmed. Sign in again when you are ready.')));
      }
    }
    if (!mounted) return;
    _selectTab(0);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final desktop = MediaQuery.sizeOf(context).width >= 1024;
    final isMapView = ref.watch(viewModeProvider);
    final loggedIn = ref.watch(authProvider).isLoggedIn;
    final tabs = <_TabInfo>[
      _TabInfo(
        Icons.storefront_outlined,
        Icons.storefront,
        l10n.tabShops,
        const _ShopToggleView(),
      ),
      _TabInfo(
        Icons.calendar_today_outlined,
        Icons.calendar_today,
        l10n.tabBookings,
        loggedIn ? const BookingListScreen() : const CustomerSignInPanel(),
      ),
      _TabInfo(
        Icons.favorite_border,
        Icons.favorite,
        l10n.tabFavorites,
        loggedIn ? const _FavoritesPage() : const CustomerSignInPanel(),
      ),
      _TabInfo(
        Icons.person_outline,
        Icons.person,
        l10n.tabProfile,
        loggedIn ? const ProfileScreen() : const CustomerSignInPanel(),
      ),
    ];
    return Scaffold(
      body: Column(
        children: [
          Container(
            decoration: const BoxDecoration(
              color: CustomerPalette.surface,
              border: Border(bottom: BorderSide(color: CustomerPalette.border)),
            ),
            child: SafeArea(
              bottom: false,
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1280),
                  child: Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: desktop ? 32 : 16,
                      vertical: desktop ? 18 : 12,
                    ),
                    child: Row(
                      children: [
                        CustomerBrand(compact: !desktop),
                        const Spacer(),
                        if (desktop) ...[
                          for (var index = 0; index < tabs.length; index++)
                            Padding(
                              padding: const EdgeInsets.only(right: 4),
                              child: _desktopTab(tabs[index], index),
                            ),
                          const SizedBox(width: 20),
                        ],
                        if (!desktop && _currentIndex == 0) ...[
                          _viewButton(isMapView, l10n),
                          const SizedBox(width: 4),
                          _filterButton(l10n),
                          const SizedBox(width: 4),
                        ],
                        _headerButton(
                          icon: loggedIn
                              ? Icons.logout_outlined
                              : Icons.login_outlined,
                          label: loggedIn
                              ? l10n.logout
                              : customerText(context, 'Sign in', '登录'),
                          onPressed: loggedIn
                              ? _logout
                              : () => requireCustomerSignIn(context, ref),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (desktop && _currentIndex == 0)
            Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1280),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(32, 18, 32, 0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () =>
                            ref.read(viewModeProvider.notifier).state =
                                !isMapView,
                        icon: Icon(
                          isMapView
                              ? Icons.view_list_outlined
                              : Icons.map_outlined,
                          size: 18,
                        ),
                        label: Text(isMapView ? l10n.tabShops : l10n.mapView),
                      ),
                      const SizedBox(width: 10),
                      OutlinedButton.icon(
                        onPressed: () => _showFilterSheet(context),
                        icon: const Icon(Icons.tune, size: 18),
                        label: Text(l10n.filters),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          Expanded(
            child: IndexedStack(
              index: _currentIndex,
              children: tabs.map((tab) => tab.page).toList(),
            ),
          ),
        ],
      ),
      bottomNavigationBar: desktop
          ? null
          : DecoratedBox(
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: CustomerPalette.border)),
              ),
              child: NavigationBar(
                selectedIndex: _currentIndex,
                onDestinationSelected: _selectTab,
                destinations: tabs
                    .map(
                      (tab) => NavigationDestination(
                        icon: Icon(tab.icon),
                        selectedIcon: Icon(tab.selectedIcon),
                        label: tab.label,
                      ),
                    )
                    .toList(),
              ),
            ),
    );
  }

  Widget _desktopTab(_TabInfo tab, int index) {
    final selected = _currentIndex == index;
    return Semantics(
      selected: selected,
      child: TextButton.icon(
        onPressed: () => _selectTab(index),
        style: TextButton.styleFrom(
          foregroundColor: selected
              ? CustomerPalette.action
              : CustomerPalette.muted,
          backgroundColor: selected ? CustomerPalette.tint : Colors.transparent,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        ),
        icon: Icon(selected ? tab.selectedIcon : tab.icon, size: 18),
        label: Text(tab.label),
      ),
    );
  }

  Widget _headerButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
    bool active = false,
  }) => IconButton(
    tooltip: label,
    style: IconButton.styleFrom(
      backgroundColor: active ? CustomerPalette.tint : CustomerPalette.surface,
      foregroundColor: active ? CustomerPalette.action : CustomerPalette.muted,
      minimumSize: const Size(40, 40),
      padding: const EdgeInsets.all(9),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    icon: Icon(icon, size: 21),
    onPressed: onPressed,
  );

  Widget _viewButton(bool isMapView, AppLocalizations l10n) => _headerButton(
    icon: isMapView ? Icons.view_list_outlined : Icons.map_outlined,
    label: isMapView ? l10n.tabShops : l10n.mapView,
    active: isMapView,
    onPressed: () => ref.read(viewModeProvider.notifier).state = !isMapView,
  );

  Widget _filterButton(AppLocalizations l10n) => _headerButton(
    icon: Icons.tune,
    label: l10n.filters,
    active: ref.watch(shopListProvider).category != null,
    onPressed: () => _showFilterSheet(context),
  );

  void _showFilterSheet(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final categories = <({String label, String? value})>[
      (label: l10n.categoryAll, value: null),
      (label: l10n.categoryTuiNa, value: 'TUINA'),
      (label: l10n.categoryFootMassage, value: 'REFLEXOLOGY'),
      (label: l10n.categoryMixed, value: 'MIXED'),
      (label: l10n.categoryCupping, value: 'CUPPING'),
      (label: l10n.categoryScraping, value: 'SCRAPING'),
    ];
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      constraints: const BoxConstraints(maxWidth: 560),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 4, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.filters, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(
                customerText(
                  context,
                  'Choose a service category to refine the shop list.',
                  '选择服务类别，筛选门店列表。',
                ),
                style: const TextStyle(color: CustomerPalette.muted),
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: categories
                    .map(
                      (category) => ChoiceChip(
                        label: Text(category.label),
                        selected:
                            ref.read(shopListProvider).category ==
                            category.value,
                        onSelected: (_) {
                          ref
                              .read(shopListProvider.notifier)
                              .setCategory(category.value);
                          Navigator.pop(sheetContext);
                        },
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TabInfo {
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Widget page;
  const _TabInfo(this.icon, this.selectedIcon, this.label, this.page);
}

/// Animated wrapper that toggles between [ShopListScreen] and [MapViewContent].
///
/// Uses [AnimatedSwitcher] with a [CrossFadeTransition] for smooth visual
/// transitions when the user toggles the view mode via the AppBar button.
class _ShopToggleView extends ConsumerWidget {
  const _ShopToggleView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isMapView = ref.watch(viewModeProvider);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      switchInCurve: Curves.easeInOut,
      switchOutCurve: Curves.easeInOut,
      transitionBuilder: (Widget child, Animation<double> animation) {
        return FadeTransition(opacity: animation, child: child);
      },
      child: isMapView
          ? const MapViewContent(key: ValueKey('map_view'))
          : const ShopListScreen(key: ValueKey('list_view')),
    );
  }
}

/// Favorites page — shows shops the user has favorited
class _FavoritesPage extends ConsumerWidget {
  const _FavoritesPage();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final favoriteIds = ref.watch(favoritesProvider);
    final favoriteShopsAsync = ref.watch(favoriteShopsProvider);
    final theme = Theme.of(context);

    if (favoriteIds.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.favorite_outline,
                size: 48,
                color: CustomerPalette.brand,
              ),
              const SizedBox(height: 16),
              Text(
                AppLocalizations.of(context)!.noFavoritesYet,
                style: theme.textTheme.titleLarge?.copyWith(
                  color: CustomerPalette.ink,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                AppLocalizations.of(context)!.addFavoritesHint,
                style: const TextStyle(color: CustomerPalette.muted),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return favoriteShopsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.error_outline,
              size: 48,
              color: CustomerPalette.muted,
            ),
            const SizedBox(height: 16),
            Text(
              customerText(
                context,
                'Failed to load favorite shops',
                '无法加载收藏门店',
              ),
              style: theme.textTheme.titleMedium,
            ),
          ],
        ),
      ),
      data: (shops) {
        if (shops.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.favorite_outline,
                    size: 48,
                    color: CustomerPalette.brand,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    AppLocalizations.of(context)!.noFavoritesYet,
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: CustomerPalette.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    AppLocalizations.of(context)!.addFavoritesHint,
                    style: const TextStyle(color: CustomerPalette.muted),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          itemCount: shops.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (_, i) {
            final shop = shops[i];
            return _ShopListTile(
              shop: shop,
              onTap: () {
                openCustomerShop(
                  context,
                  shopId: shop.id,
                  shopName: shop.name,
                  canonicalPath: shop.canonicalPath,
                );
              },
            );
          },
        );
      },
    );
  }
}

/// Shop list tile for favorites
class _ShopListTile extends StatelessWidget {
  final Shop shop;
  final VoidCallback onTap;

  const _ShopListTile({required this.shop, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      leading: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: CustomerPalette.tint,
          borderRadius: BorderRadius.circular(12),
        ),
        child: shop.thumbnail != null
            ? ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  shop.thumbnail!,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const Icon(
                    Icons.storefront_outlined,
                    color: CustomerPalette.brand,
                  ),
                ),
              )
            : const Icon(
                Icons.storefront_outlined,
                color: CustomerPalette.brand,
              ),
      ),
      title: Text(
        shop.name,
        style: const TextStyle(fontWeight: FontWeight.bold),
      ),
      subtitle: Text(
        '${shop.city}, ${shop.state}  ${shop.categoryLabel}',
        style: const TextStyle(color: CustomerPalette.muted, fontSize: 13),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (shop.avgRating > 0) ...[
            const Icon(
              Icons.star_outline,
              size: 16,
              color: CustomerPalette.action,
            ),
            const SizedBox(width: 4),
            Text(
              shop.avgRating.toStringAsFixed(1),
              style: const TextStyle(color: CustomerPalette.muted),
            ),
          ],
          const SizedBox(width: 8),
          const Icon(Icons.chevron_right, color: CustomerPalette.muted),
        ],
      ),
      onTap: onTap,
    );
  }
}
