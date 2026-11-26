import 'package:flutter/material.dart';
import '../widgets/public_information_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../l10n/app_localizations.dart';
import '../models/shop.dart';
import '../providers/favorites_provider.dart';
import '../providers/shop_provider.dart';
import '../theme/customer_theme.dart';
import '../widgets/home_banner_carousel.dart';
import '../widgets/responsive_content.dart';
import '../navigation/customer_navigation.dart';
import '../widgets/customer_access.dart';

class ShopListScreen extends ConsumerStatefulWidget {
  const ShopListScreen({super.key});
  @override
  ConsumerState<ShopListScreen> createState() => _ShopListScreenState();
}

class _ShopListScreenState extends ConsumerState<ShopListScreen> {
  final _searchController = TextEditingController();
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(shopListProvider.notifier).loadShops());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _search() {
    final keyword = _searchController.text.trim();
    ref
        .read(shopListProvider.notifier)
        .setKeyword(keyword.isEmpty ? null : keyword);
  }

  void _reset() {
    _searchController.clear();
    ref
        .read(shopListProvider.notifier)
        .setFilters(keyword: null, category: null);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(shopListProvider);
    final l10n = AppLocalizations.of(context)!;
    return ResponsiveContent(
      maxWidth: 1200,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final narrow = constraints.maxWidth < 640;
          final inset = narrow ? 16.0 : 24.0;
          final columns = constraints.maxWidth >= 1024
              ? 3
              : constraints.maxWidth >= 680
              ? 2
              : 1;
          final items = state.data?.items ?? const <Shop>[];
          return RefreshIndicator(
            onRefresh: () => ref.read(shopListProvider.notifier).loadShops(),
            child: CustomScrollView(
              key: const PageStorageKey('customer-shop-results'),
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(
                    inset,
                    narrow ? 20 : 32,
                    inset,
                    24,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: _DiscoveryHeader(narrow: narrow),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.symmetric(horizontal: inset),
                  sliver: SliverToBoxAdapter(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: CustomerPalette.surface,
                        border: Border.all(color: CustomerPalette.border),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _searchController,
                                textInputAction: TextInputAction.search,
                                onSubmitted: (_) => _search(),
                                decoration: InputDecoration(
                                  hintText: l10n.searchShops,
                                  prefixIcon: const Icon(
                                    Icons.search_rounded,
                                    color: CustomerPalette.muted,
                                    size: 22,
                                  ),
                                  filled: false,
                                  border: InputBorder.none,
                                  enabledBorder: InputBorder.none,
                                  focusedBorder: InputBorder.none,
                                  contentPadding: const EdgeInsets.symmetric(
                                    vertical: 14,
                                  ),
                                  suffixIcon: state.keyword?.isNotEmpty == true
                                      ? IconButton(
                                          tooltip: l10n.clearSearch,
                                          onPressed: () {
                                            _searchController.clear();
                                            _search();
                                          },
                                          icon: const Icon(
                                            Icons.close_rounded,
                                            size: 18,
                                          ),
                                        )
                                      : null,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            FilledButton(
                              onPressed: _search,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size(72, 46),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 20,
                                ),
                              ),
                              child: Text(
                                customerText(context, 'Search', '搜索'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(inset, 16, inset, 24),
                  sliver: SliverToBoxAdapter(
                    child: _categories(state.category),
                  ),
                ),
                SliverToBoxAdapter(
                  child: HomeBannerCarousel(
                    onCategorySelected: (value) =>
                        ref.read(shopListProvider.notifier).setCategory(value),
                  ),
                ),
                if (state.isLoading && items.isNotEmpty)
                  const SliverToBoxAdapter(
                    child: LinearProgressIndicator(minHeight: 2),
                  ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(inset, 0, inset, 18),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            customerText(context, 'Explore studios', '探索门店'),
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              color: CustomerPalette.ink,
                            ),
                          ),
                        ),
                        if (state.data != null)
                          Text(
                            customerText(
                              context,
                              '${state.data!.total} results',
                              '${state.data!.total} 家门店',
                            ),
                            style: const TextStyle(
                              fontSize: 13,
                              color: CustomerPalette.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                if (state.isLoading && items.isEmpty)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.all(48),
                      child: Center(
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                else if (state.error != null && items.isEmpty)
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(inset, 0, inset, 32),
                    sliver: SliverToBoxAdapter(
                      child: _ResultsMessage(
                        icon: Icons.wifi_off_rounded,
                        title: l10n.failedToLoadShops,
                        message: customerText(
                          context,
                          'Please try again in a moment.',
                          '暂时无法获取门店，请稍后重试。',
                        ),
                        action: l10n.retry,
                        onAction: () =>
                            ref.read(shopListProvider.notifier).retry(),
                      ),
                    ),
                  )
                else if (items.isEmpty)
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(inset, 0, inset, 32),
                    sliver: SliverToBoxAdapter(
                      child: _ResultsMessage(
                        icon: Icons.travel_explore_rounded,
                        title: l10n.noShopsFound,
                        message: customerText(
                          context,
                          'Try another keyword or explore a different service.',
                          '换个关键词，或试试其他服务分类。',
                        ),
                        action: l10n.reset,
                        onAction: _reset,
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(inset, 0, inset, 32),
                    sliver: SliverList.builder(
                      itemCount: (items.length / columns).ceil(),
                      itemBuilder: (context, row) => Padding(
                        padding: const EdgeInsets.only(bottom: 20),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            for (
                              var column = 0;
                              column < columns;
                              column++
                            ) ...[
                              if (column > 0) const SizedBox(width: 20),
                              Expanded(
                                child: row * columns + column >= items.length
                                    ? const SizedBox.shrink()
                                    : _ShopCard(
                                        shop: items[row * columns + column],
                                        onTap: () {
                                          final shop =
                                              items[row * columns + column];
                                          openCustomerShop(
                                            context,
                                            shopId: shop.id,
                                            shopName: shop.name,
                                            canonicalPath: shop.canonicalPath,
                                          );
                                        },
                                      ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                if (state.error != null && items.isNotEmpty)
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(inset, 0, inset, 16),
                    sliver: SliverToBoxAdapter(
                      child: _SearchErrorNotice(
                        message: state.failedPage != null
                            ? customerText(
                                context,
                                'More studios could not be loaded. Your current results are still available.',
                                '暂时无法加载更多门店，当前结果仍可查看。',
                              )
                            : customerText(
                                context,
                                'This search could not be refreshed. Your current results are still available.',
                                '暂时无法刷新本次搜索，当前结果仍可查看。',
                              ),
                        action: state.failedPage == null ? l10n.retry : null,
                        onAction: state.failedPage == null
                            ? () => ref.read(shopListProvider.notifier).retry()
                            : null,
                      ),
                    ),
                  ),
                if (state.hasMore)
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(inset, 0, inset, 32),
                    sliver: SliverToBoxAdapter(
                      child: Center(
                        child: OutlinedButton.icon(
                          onPressed: state.isLoadingMore || state.isLoading
                              ? null
                              : () => ref
                                    .read(shopListProvider.notifier)
                                    .loadMoreShops(),
                          icon: state.isLoadingMore
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.expand_more_rounded),
                          label: Text(
                            state.isLoadingMore
                                ? customerText(context, 'Loading…', '正在加载…')
                                : state.failedPage != null
                                ? customerText(
                                    context,
                                    'Retry loading more',
                                    '重试加载更多',
                                  )
                                : customerText(
                                    context,
                                    'Load more studios',
                                    '加载更多门店',
                                  ),
                          ),
                        ),
                      ),
                    ),
                  ),
                const SliverPadding(
                  padding: EdgeInsets.fromLTRB(16, 0, 16, 24),
                  sliver: SliverToBoxAdapter(child: PublicInformationLinks()),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _categories(String? active) {
    final l10n = AppLocalizations.of(context)!;
    final categories = <(String, String?, IconData)>[
      (l10n.categoryAll, null, Icons.grid_view_rounded),
      (l10n.categoryTuiNa, 'TUINA', Icons.spa_outlined),
      (
        l10n.categoryFootMassage,
        'REFLEXOLOGY',
        Icons.airline_seat_legroom_extra_outlined,
      ),
      (l10n.categoryMixed, 'MIXED', Icons.self_improvement_outlined),
      (l10n.categoryCupping, 'CUPPING', Icons.local_cafe_outlined),
      (l10n.categoryScraping, 'SCRAPING', Icons.waves_outlined),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final item in categories)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Semantics(
                button: true,
                selected: active == item.$2,
                child: Material(
                  color: active == item.$2
                      ? CustomerPalette.tint
                      : CustomerPalette.surface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: BorderSide(
                      color: active == item.$2
                          ? CustomerPalette.brand
                          : CustomerPalette.border,
                    ),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () => ref
                        .read(shopListProvider.notifier)
                        .setCategory(item.$2),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 13,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            item.$3,
                            size: 16,
                            color: active == item.$2
                                ? CustomerPalette.action
                                : CustomerPalette.muted,
                          ),
                          const SizedBox(width: 7),
                          Text(
                            item.$1,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: active == item.$2
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                              color: active == item.$2
                                  ? CustomerPalette.action
                                  : CustomerPalette.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DiscoveryHeader extends StatelessWidget {
  final bool narrow;
  const _DiscoveryHeader({required this.narrow});
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.center,
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              customerText(context, 'YOUR WELLNESS, YOUR TIME', '让身心，慢下来'),
              style: const TextStyle(
                color: CustomerPalette.action,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.4,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              customerText(
                context,
                'A little time, just for you.',
                '留一点时间，给自己。',
              ),
              style: TextStyle(
                fontSize: narrow ? 26 : 34,
                height: 1.3,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.7,
                color: CustomerPalette.ink,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              customerText(
                context,
                'Discover local massage studios and find a session that fits your day.',
                '发现身边的按摩门店，预约适合你的放松时刻。',
              ),
              style: const TextStyle(
                fontSize: 14,
                height: 1.7,
                color: CustomerPalette.muted,
              ),
            ),
          ],
        ),
      ),
      if (!narrow) ...[
        const SizedBox(width: 32),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          decoration: BoxDecoration(
            color: CustomerPalette.tint,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.calendar_month_outlined,
                color: CustomerPalette.action,
                size: 28,
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    customerText(
                      context,
                      'Make space for yourself',
                      '轻松安排，安心放松',
                    ),
                    style: const TextStyle(
                      color: CustomerPalette.ink,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    customerText(
                      context,
                      'Studio · Service · Time',
                      '选门店 · 选项目 · 选时间',
                    ),
                    style: const TextStyle(
                      color: CustomerPalette.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    ],
  );
}

String _category(BuildContext context, String value) {
  final l10n = AppLocalizations.of(context)!;
  return switch (value) {
    'TUINA' => l10n.categoryTuiNa,
    'REFLEXOLOGY' => l10n.categoryFootMassage,
    'CUPPING' => l10n.categoryCupping,
    'SCRAPING' => l10n.categoryScraping,
    'MIXED' => l10n.categoryMixed,
    _ => customerText(context, 'Massage studio', '按摩门店'),
  };
}

class _ShopCard extends ConsumerWidget {
  final Shop shop;
  final VoidCallback onTap;
  const _ShopCard({required this.shop, required this.onTap});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context)!;
    final favorite = ref.watch(favoritesProvider).contains(shop.id);
    final address = shop.address.isNotEmpty
        ? shop.address
        : [shop.city, shop.state].where((s) => s.isNotEmpty).join(', ');
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: CustomerPalette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: CustomerPalette.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                AspectRatio(
                  aspectRatio: 16 / 9,
                  child: shop.thumbnail?.isNotEmpty == true
                      ? Image.network(
                          shop.thumbnail!,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) => _photoPlaceholder(context),
                        )
                      : _photoPlaceholder(context),
                ),
                Positioned(
                  top: 12,
                  right: 12,
                  child: IconButton(
                    style: IconButton.styleFrom(
                      backgroundColor: CustomerPalette.surface,
                      foregroundColor: CustomerPalette.ink,
                      minimumSize: const Size(42, 42),
                    ),
                    tooltip: favorite ? l10n.unfavoriteShop : l10n.favoriteShop,
                    onPressed: () async {
                      if (!await requireCustomerSignIn(context, ref)) return;
                      try {
                        await ref
                            .read(favoritesProvider.notifier)
                            .toggle(shop.id);
                      } catch (_) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                customerText(
                                  context,
                                  'Unable to update favorites. Try again.',
                                  '收藏更新失败，请重试。',
                                ),
                              ),
                            ),
                          );
                        }
                      }
                    },
                    icon: Icon(
                      favorite
                          ? Icons.favorite_rounded
                          : Icons.favorite_border_rounded,
                      size: 20,
                      semanticLabel: favorite
                          ? l10n.unfavoriteShop
                          : l10n.favoriteShop,
                      color: favorite
                          ? const Color(0xFFBE4A58)
                          : CustomerPalette.ink,
                    ),
                  ),
                ),
                if (shop.listingDetailsIncomplete)
                  Positioned(
                    left: 12,
                    right: 12,
                    bottom: 12,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: CustomerPalette.surface,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text(
                        'Details awaiting verification',
                        style: TextStyle(
                          fontSize: 12,
                          color: CustomerPalette.ink,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          _category(context, shop.category),
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: CustomerPalette.action,
                          ),
                        ),
                      ),
                      if (shop.reviewCount > 0) ...[
                        const Icon(
                          Icons.star_rounded,
                          color: Color(0xFFC58C36),
                          size: 16,
                        ),
                        const SizedBox(width: 3),
                        Text(
                          shop.avgRating.toStringAsFixed(1),
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: CustomerPalette.ink,
                          ),
                        ),
                        Text(
                          ' (${shop.reviewCount})',
                          style: const TextStyle(
                            fontSize: 12,
                            color: CustomerPalette.muted,
                          ),
                        ),
                      ] else
                        Text(
                          customerText(context, 'No reviews yet', '暂无评价'),
                          style: const TextStyle(
                            color: CustomerPalette.muted,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    shop.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 18,
                      height: 1.4,
                      fontWeight: FontWeight.w600,
                      color: CustomerPalette.ink,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 2),
                        child: Icon(
                          Icons.location_on_outlined,
                          size: 16,
                          color: CustomerPalette.muted,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          address.isEmpty
                              ? customerText(
                                  context,
                                  'Address not provided',
                                  '地址待完善',
                                )
                              : address,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            color: CustomerPalette.muted,
                            height: 1.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Divider(height: 1, color: CustomerPalette.border),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          shop.formattedDistance.isNotEmpty
                              ? shop.formattedDistance
                              : customerText(
                                  context,
                                  'Services & appointments',
                                  '服务与预约',
                                ),
                          style: const TextStyle(
                            fontSize: 12,
                            color: CustomerPalette.muted,
                          ),
                        ),
                      ),
                      Text(
                        customerText(context, 'View studio', '查看门店'),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: CustomerPalette.action,
                        ),
                      ),
                      const SizedBox(width: 5),
                      const Icon(
                        Icons.arrow_forward_rounded,
                        size: 17,
                        color: CustomerPalette.action,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _photoPlaceholder(BuildContext context) => ColoredBox(
    color: const Color(0xFFEEF4F5),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: CustomerPalette.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: CustomerPalette.border),
          ),
          child: const Icon(
            Icons.spa_outlined,
            size: 27,
            color: CustomerPalette.brand,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          customerText(context, 'Studio photos coming soon', '门店照片待补充'),
          style: const TextStyle(fontSize: 12, color: CustomerPalette.muted),
        ),
      ],
    ),
  );
}

class _SearchErrorNotice extends StatelessWidget {
  final String message;
  final String? action;
  final VoidCallback? onAction;

  const _SearchErrorNotice({
    required this.message,
    required this.action,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF5F2),
        border: Border.all(color: const Color(0xFFE8B6AA)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.wifi_off_rounded, color: Color(0xFF9B463A)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: CustomerPalette.ink, height: 1.4),
            ),
          ),
          if (action != null && onAction != null) ...[
            const SizedBox(width: 8),
            TextButton(onPressed: onAction, child: Text(action!)),
          ],
        ],
      ),
    ),
  );
}

class _ResultsMessage extends StatelessWidget {
  final IconData icon;
  final String title, message, action;
  final VoidCallback onAction;
  const _ResultsMessage({
    required this.icon,
    required this.title,
    required this.message,
    required this.action,
    required this.onAction,
  });
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
    decoration: BoxDecoration(
      color: CustomerPalette.surface,
      border: Border.all(color: CustomerPalette.border),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: CustomerPalette.tint,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Icon(icon, size: 30, color: CustomerPalette.action),
        ),
        const SizedBox(height: 20),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: CustomerPalette.ink,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: CustomerPalette.muted,
            fontSize: 14,
            height: 1.7,
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton(
          onPressed: onAction,
          style: OutlinedButton.styleFrom(minimumSize: const Size(120, 44)),
          child: Text(action),
        ),
      ],
    ),
  );
}
