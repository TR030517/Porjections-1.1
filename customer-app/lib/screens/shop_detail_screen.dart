import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../l10n/app_localizations.dart';
import '../models/review.dart';
import '../models/shop.dart';
import '../models/shop_booking_choices.dart';
import '../providers/favorites_provider.dart';
import '../providers/review_provider.dart';
import '../providers/shop_provider.dart';
import '../navigation/customer_routes.dart';
import '../navigation/customer_navigation.dart';
import '../widgets/customer_access.dart';
import '../theme/customer_theme.dart';
import '../widgets/responsive_content.dart';
import '../widgets/shop_price_menu.dart';
import '../widgets/shop_booking_status.dart';
import '../widgets/shop_directory_notice.dart';
import '../widgets/shop_closure_notice.dart';
import '../widgets/shop_contacts.dart';
import '../widgets/shop_opening_hours.dart';
import '../widgets/shop_location_map.dart';
import 'booking_screen.dart';
import 'gift_orders_screen.dart';

class ShopDetailScreen extends ConsumerStatefulWidget {
  final String shopId;
  final String shopName;
  final String? initialServiceId;
  final String? initialVariantId;
  final bool invalidBookingLink;
  const ShopDetailScreen({
    super.key,
    required this.shopId,
    required this.shopName,
    this.initialServiceId,
    this.initialVariantId,
    this.invalidBookingLink = false,
  });

  @override
  ConsumerState<ShopDetailScreen> createState() => _ShopDetailScreenState();
}

class _ShopDetailScreenState extends ConsumerState<ShopDetailScreen> {
  final _priceMenuKey = GlobalKey();
  final _bookableServicesKey = GlobalKey();
  bool _descExpanded = false;
  bool _showAllReviews = false;
  bool _showAllTherapists = false;
  bool _directBookingHandled = false;
  bool _openingBooking = false;
  int _bookingVersion = 0;

  @override
  void didUpdateWidget(covariant ShopDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shopId != widget.shopId || oldWidget.initialServiceId != widget.initialServiceId
        || oldWidget.initialVariantId != widget.initialVariantId || oldWidget.invalidBookingLink != widget.invalidBookingLink) {
      _directBookingHandled = false;
      _bookingVersion++;
      _openingBooking = false;
    }
  }

  void _resolveDirectBooking(ShopDetail shop) {
    if (_directBookingHandled || widget.initialServiceId == null && !widget.invalidBookingLink) return;
    final targetShopId = widget.shopId, targetServiceId = widget.initialServiceId;
    final targetVariantId = widget.initialVariantId, invalidLink = widget.invalidBookingLink;
    _directBookingHandled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || widget.shopId != targetShopId || widget.initialServiceId != targetServiceId
          || widget.initialVariantId != targetVariantId || widget.invalidBookingLink != invalidLink) {
        return;
      }
      if (invalidLink) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This booking link is invalid. Please choose a service from this shop.')));
        return;
      }
      if (shop.id != targetShopId) return;
      final matchingServices = shop.services.where((row) => row.id == targetServiceId && row.canBook);
      final service = matchingServices.isEmpty ? null : matchingServices.first;
      final variantId = targetVariantId;
      final variantValid = service != null && (variantId == null
          ? !service.hasVariants
          : service.activeVariants.any((variant) => variant.id == variantId));
      if (!shop.canBookOnline || service == null || !variantValid) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This booking link is no longer available. Please choose a current service from this shop.')));
        return;
      }
      _book(
        shop,
        service: service,
        variantId: variantId,
        isRequestCurrent: () => mounted && widget.shopId == targetShopId
            && widget.initialServiceId == targetServiceId
            && widget.initialVariantId == targetVariantId
            && widget.invalidBookingLink == invalidLink,
      );
    });
  }

  Future<void> _book(ShopDetail shop, {ShopService? service, String? variantId, ShopPriceMenuItem? menuItem, bool Function()? isRequestCurrent}) async {
    if (!mounted || _openingBooking || !shop.canBookOnline || widget.shopId != shop.id || ModalRoute.of(context)?.isCurrent != true) return;
    _openingBooking = true;
    final version = ++_bookingVersion;
    bool currentRequest() => mounted && version == _bookingVersion && widget.shopId == shop.id
        && ModalRoute.of(context)?.isCurrent == true && (isRequestCurrent?.call() ?? true);
    void optionChanged() {
      ref.invalidate(shopDetailProvider(shop.id));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(customerText(context,
        'This service option changed. Please choose it again from the updated price list.',
        '此项目选项已变更，请从更新后的价目表重新选择。'))));
    }
    try {
      ShopDetail current;
      try {
        current = await ref.read(shopRepositoryProvider).getShopDetail(shop.id);
      } catch (_) {
        if (mounted && currentRequest()) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(customerText(context,
              'This shop is currently unavailable. Please reload its details.',
              '门店当前不可用，请重新加载门店资料。'))),
          );
        }
        return;
      }
      if (!mounted || !currentRequest()) return;
      if (current.id != shop.id || !current.canBookOnline) {
        ref.invalidate(shopDetailProvider(shop.id));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context)!.bookingUnavailableHint)),
        );
        return;
      }
      ShopPriceMenuItem? selectedMenu;
      if (menuItem != null) {
        final matches = current.priceMenu.expand((group) => group.items)
            .where((item) => item.id != null && item.id == menuItem.id && item.canStartBooking).toList();
        if (matches.length != 1) {
          optionChanged();
          return;
        }
        selectedMenu = matches.single;
        if (selectedMenu.booking?.serviceId != menuItem.booking?.serviceId || selectedMenu.booking?.variantId != menuItem.booking?.variantId) {
          optionChanged();
          return;
        }
      }
      final selectedId = selectedMenu?.booking?.serviceId ?? service?.id;
      final matches = current.services.where((item) => item.id == selectedId && item.canBook);
      final selectedVariantId = selectedMenu?.booking?.variantId ?? variantId;
      if ((service != null || menuItem != null) && matches.isEmpty ||
          selectedVariantId != null && (matches.isEmpty || !matches.first.activeVariants.any((option) => option.id == selectedVariantId))) {
        optionChanged();
        return;
      }
      if (!mounted || !currentRequest()) return;
      await Navigator.push<void>(context, MaterialPageRoute<void>(
        builder: (_) => BookingScreen(shop: current,
          initialService: matches.isEmpty ? null : matches.first, initialVariantId: selectedVariantId),
      ));
    } finally {
      if (mounted && version == _bookingVersion) _openingBooking = false;
    }
  }

  void _copyShopInfo(ShopDetail shop) {
    final link = publicShopShareUri(shop.canonicalPath);
    if (link == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            customerText(
              context,
              'A public share link is not available for this shop.',
              '该门店暂未提供公开分享链接。',
            ),
          ),
        ),
      );
      return;
    }
    Clipboard.setData(ClipboardData(text: link.toString()));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(AppLocalizations.of(context)!.shopInfoCopied),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final detailAsync = ref.watch(shopDetailProvider(widget.shopId));
    final isFavorite = ref.watch(favoritesProvider).contains(widget.shopId);
    final l10n = AppLocalizations.of(context)!;
    final desktop = MediaQuery.sizeOf(context).width >= 1100;
    final shop = detailAsync.valueOrNull;
    final accent = shop == null
        ? CustomerPalette.action
        : CustomerPalette.shopAccent(shop.brandColor);
    final accentBorder = shop == null
        ? CustomerPalette.border
        : CustomerPalette.shopBorder(shop.brandColor);
    if (shop != null) _resolveDirectBooking(shop);
    final actionStyle = IconButton.styleFrom(
      backgroundColor: CustomerPalette.surface,
      foregroundColor: CustomerPalette.ink,
      side: BorderSide(color: accentBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    );
    return Theme(
      data: buildCustomerTheme(shopBrandColor: shop?.brandColor),
      child: Scaffold(
      backgroundColor: CustomerPalette.shopPageBackground(shop?.brandColor),
      appBar: AppBar(
        backgroundColor: CustomerPalette.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        toolbarHeight: 68,
        iconTheme: const IconThemeData(color: CustomerPalette.ink),
        shape: Border(bottom: BorderSide(color: accentBorder)),
        leading: Navigator.of(context).canPop()
            ? BackButton(color: CustomerPalette.ink)
            : IconButton(
                onPressed: () => openCustomerHome(context),
                tooltip: customerText(context, 'Browse shops', '浏览门店'),
                icon: const Icon(Icons.storefront_outlined),
              ),
        titleSpacing: Navigator.of(context).canPop() ? 4 : 20,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.spa_outlined,
              size: 25,
              color: accent,
            ),
            const SizedBox(width: 9),
            const Flexible(
              child: Text(
                'Massajoy',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: CustomerPalette.ink,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.6,
                ),
              ),
            ),
            if (MediaQuery.sizeOf(context).width > 600) ...[
              const SizedBox(width: 18),
              Container(width: 1, height: 20, color: accentBorder),
              const SizedBox(width: 18),
              Text(
                customerText(context, 'Shop details', '门店详情'),
                style: const TextStyle(
                  fontSize: 14,
                  color: CustomerPalette.muted,
                ),
              ),
            ],
          ],
        ),
        actions: [
          IconButton(
            style: actionStyle,
            tooltip: isFavorite ? l10n.unfavoriteShop : l10n.favoriteShop,
            icon: Icon(
              isFavorite ? Icons.favorite : Icons.favorite_border,
              semanticLabel: isFavorite
                  ? l10n.unfavoriteShop
                  : l10n.favoriteShop,
              color: isFavorite ? accent : CustomerPalette.ink,
              size: 20,
            ),
            onPressed: shop == null
                ? null
                : () async {
                    if (!await requireCustomerSignIn(context, ref) ||
                        !context.mounted) {
                      return;
                    }
                    try {
                      await ref
                          .read(favoritesProvider.notifier)
                          .toggle(widget.shopId);
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
          ),
          const SizedBox(width: 8),
          IconButton(
            style: actionStyle,
            tooltip: l10n.copyShopInfo,
            icon: Icon(
              Icons.ios_share_outlined,
              semanticLabel: l10n.copyShopInfo,
              color: CustomerPalette.ink,
              size: 20,
            ),
            onPressed:
                shop == null || publicShopShareUri(shop.canonicalPath) == null
                ? null
                : () => _copyShopInfo(shop),
          ),
          SizedBox(width: desktop ? 28 : 14),
        ],
      ),
      body: detailAsync.when(
        loading: () => Center(
          child: CircularProgressIndicator(color: accent),
        ),
        error: (_, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: _DetailPanel(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.storefront_outlined,
                      size: 40,
                      color: CustomerPalette.muted,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      l10n.unableToLoadShop,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 18,
                        color: CustomerPalette.ink,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      customerText(
                        context,
                        'Please try again in a moment.',
                        '请稍后重新加载门店信息。',
                      ),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: CustomerPalette.muted),
                    ),
                    const SizedBox(height: 20),
                    OutlinedButton.icon(
                      onPressed: () =>
                          ref.invalidate(shopDetailProvider(widget.shopId)),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: Text(l10n.retry),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        data: (shop) => SingleChildScrollView(
          child: ResponsiveContent(
            maxWidth: 1600,
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                desktop ? 28 : 16,
                desktop ? 28 : 16,
                desktop ? 28 : 16,
                32,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _ShopGallery(
                    images: shop.images
                        .map((i) => i.imageUrl)
                        .where((url) => url.trim().isNotEmpty)
                        .toList(),
                    desktop: desktop,
                  ),
                  const SizedBox(height: 20),
                  _ShopHeading(
                    shop: shop,
                    desktop: desktop,
                    details: _shopOverview(shop),
                  ),
                  const SizedBox(height: 24),
                  if (desktop && shop.hasBookableOptions)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: _mainContent(shop)),
                        const SizedBox(width: 24),
                        SizedBox(
                          width: 320,
                          child: _BookingSummary(
                            shop: shop,
                            onBook: () => _book(shop),
                            onViewServices: _viewServices,
                          ),
                        ),
                      ],
                    )
                  else
                    _mainContent(shop),
                  const SizedBox(height: 24),
                  ShopLocationMap(
                    key: ValueKey('shop-location:${shop.id}'),
                    shop: shop,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      bottomNavigationBar: !desktop && shop != null && shop.hasBookableOptions
          ? _MobileBookingBar(shop: shop, onBook: () => _book(shop))
          : null,
    ));
  }

  void _viewServices() {
    final target = _bookableServicesKey.currentContext ?? _priceMenuKey.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 350),
      curve: Curves.easeOut,
      alignment: 0.04,
    );
  }

  Widget _shopOverview(ShopDetail shop) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'About the store',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600,
              color: CustomerPalette.ink),
        ),
        const SizedBox(height: 12),
        _ExpandableText(
          text: (shop.description?.trim().isNotEmpty ?? false)
              ? shop.description!
              : 'The shop has not added an introduction yet.',
          expanded: _descExpanded,
          onToggle: () => setState(() => _descExpanded = !_descExpanded),
        ),
        const SizedBox(height: 22),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            FilledButton.icon(
              onPressed: _viewServices,
              icon: const Icon(Icons.spa_outlined, size: 18),
              label: const Text('View services & prices'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            TextButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => GiftProductsScreen(shopId: shop.id, shopName: shop.name),
                ),
              ),
              icon: const Icon(Icons.card_giftcard_outlined, size: 18),
              label: const Text('Gift products'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _mainContent(ShopDetail shop) {
    final l10n = AppLocalizations.of(context)!;
    final appointmentServices = uncoveredShopBookingChoices(shop);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ShopClosureNotice(shop: shop),
        ShopDirectoryNotice(shop: shop),
        _DetailPanel(child: ShopBookingStatus(shop: shop)),
        const SizedBox(height: 20),
        if (shop.priceMenu.isNotEmpty) ...[
          _DetailPanel(key: _priceMenuKey, child: ShopPriceMenu(groups: shop.priceMenu, accentColor: CustomerPalette.shopAccent(shop.brandColor),
            onBook: shop.canBookOnline ? (item) => _book(shop, menuItem: item) : null)),
          const SizedBox(height: 20),
        ],
        if (appointmentServices.isNotEmpty || shop.priceMenu.isEmpty) ...[
        _DetailPanel(
          key: _bookableServicesKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SectionHeading(
                title: customerText(context, 'Appointment services', '预约服务'),
                trailing: customerText(
                  context,
                  shop.canBookOnline
                      ? '${appointmentServices.length} available'
                      : '${appointmentServices.length} listed',
                  '${appointmentServices.length} 项服务',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                customerText(
                  context,
                  shop.canBookOnline
                      ? 'Choose a service, then find a time that works for you.'
                      : 'Browse the appointment services listed by the shop.',
                  shop.canBookOnline
                      ? '选择适合的服务，再查看可预约的时间。'
                      : '浏览门店已发布的预约服务。',
                ),
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.6,
                  color: CustomerPalette.muted,
                ),
              ),
              const SizedBox(height: 20),
              if (appointmentServices.isEmpty)
                _QuietNotice(
                  icon: Icons.spa_outlined,
                  text: customerText(
                    context,
                    'No services have been listed yet.',
                    '门店暂未发布服务。',
                  ),
                )
              else
                ...appointmentServices.asMap().entries.map(
                  (entry) => Padding(
                    padding: EdgeInsets.only(top: entry.key == 0 ? 0 : 16),
                    child: _ServiceCard(
                      key: ValueKey('booking-choice:${entry.value.service.id}:${entry.value.variant?.id??'base'}'),
                      choice: entry.value,
                      onBook: shop.canBookOnline
                          ? () => _book(shop, service: entry.value.service, variantId:entry.value.variant?.id)
                          : null,
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        ],
        if (shop.therapists.isNotEmpty) ...[
          const SizedBox(height: 20),
          _DetailPanel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SectionHeading(title: l10n.therapists),
                if (shop.canBookOnline) ...[
                  const SizedBox(height: 8),
                  Text(
                    l10n.chooseTherapistWhenBooking,
                    style: const TextStyle(
                      color: CustomerPalette.muted,
                      fontSize: 14,
                      height: 1.6,
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final twoColumns = constraints.maxWidth >= 560;
                    final width = twoColumns
                        ? (constraints.maxWidth - 14) / 2
                        : constraints.maxWidth;
                    final therapists = _showAllTherapists
                        ? shop.therapists
                        : shop.therapists.take(4);
                    return Wrap(
                      spacing: 14,
                      runSpacing: 14,
                      children: [
                        for (final therapist in therapists)
                          SizedBox(
                            width: width,
                            child: _TherapistTile(therapist: therapist),
                          ),
                      ],
                    );
                  },
                ),
                if (shop.therapists.length > 4) ...[
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => setState(
                      () => _showAllTherapists = !_showAllTherapists,
                    ),
                    child: Text(
                      _showAllTherapists
                          ? l10n.showLess
                          : customerText(
                              context,
                              'View all therapists',
                              '查看全部技师',
                            ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
        const SizedBox(height: 20),
        _DetailPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!shop.reviewsEnabled) ...[
                _QuietNotice(
                  icon: Icons.chat_bubble_outline,
                  text: l10n.reviewsUnavailableHint,
                ),
                const SizedBox(height: 20),
              ],
              _ReviewsSection(
                shopId: shop.id,
                showAll: _showAllReviews,
                onToggle: () =>
                    setState(() => _showAllReviews = !_showAllReviews),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

String _categoryLabel(BuildContext context, String category) {
  switch (category.toUpperCase()) {
    case 'TUINA':
      return customerText(context, 'Tui na', '推拿');
    case 'MASSAGE':
      return customerText(context, 'Massage', '按摩');
    case 'REFLEXOLOGY':
      return customerText(context, 'Reflexology', '足部护理');
    case 'CUPPING':
      return customerText(context, 'Cupping', '拔罐');
    case 'SCRAPING':
      return customerText(context, 'Gua sha', '刮痧');
    case 'HEAD_THERAPY':
      return customerText(context, 'Head therapy', '头部护理');
    case 'MIXED':
      return customerText(context, 'Massage & wellness', '综合按摩护理');
    case 'OTHER':
      return customerText(context, 'Wellness services', '其他护理');
    default:
      return category.trim().isEmpty
          ? customerText(context, 'Wellness studio', '健康护理门店')
          : category;
  }
}

class _DetailPanel extends StatelessWidget {
  final Widget child;
  const _DetailPanel({super.key, required this.child});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: BoxDecoration(
      color: CustomerPalette.surface,
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(20),
      boxShadow: const [BoxShadow(color: Color(0x041E293B), blurRadius: 20, offset: Offset(0, 6))],
    ),
    padding: EdgeInsets.all(MediaQuery.sizeOf(context).width < 600 ? 20 : 26),
    child: child,
  );
}

class _ShopHeading extends StatelessWidget {
  final ShopDetail shop;
  final bool desktop;
  final Widget details;
  const _ShopHeading({required this.shop, required this.desktop, required this.details});

  Widget _logo(BuildContext context, double size) => Container(
    width: size,
    height: size,
    padding: const EdgeInsets.all(5),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      boxShadow: const [BoxShadow(color: Color(0x071E293B), blurRadius: 16, offset: Offset(0, 4))],
    ),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(15),
      child: shop.media?.logoUrl?.trim().isNotEmpty == true
          ? Image.network(
              shop.media!.logoUrl!,
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) => _logoFallback(context),
            )
          : _logoFallback(context),
    ),
  );

  Widget _logoFallback(BuildContext context) => ColoredBox(
    color: Theme.of(context).colorScheme.primaryContainer,
    child: Icon(Icons.spa_outlined, size: 30, color: Theme.of(context).colorScheme.primary),
  );

  Widget _identity(BuildContext context) {
    final accent = Theme.of(context).colorScheme.primary;
    final compact = MediaQuery.sizeOf(context).width < 480;
    final location = [shop.city, shop.state]
        .where((part) => part.trim().isNotEmpty).join(', ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _logo(context, compact ? 60 : 84),
            SizedBox(width: compact ? 16 : 22),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _categoryLabel(context, shop.category),
                    style: TextStyle(color: accent, fontSize: 12,
                        fontWeight: FontWeight.w600, letterSpacing: 0.3),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    shop.name,
                    style: TextStyle(fontSize: desktop ? 32 : 25, height: 1.2,
                        fontWeight: FontWeight.w700, color: CustomerPalette.ink,
                        letterSpacing: -0.8),
                  ),
                  if (shop.nameEn?.trim().isNotEmpty == true && shop.nameEn != shop.name) ...[
                    const SizedBox(height: 6),
                    Text(shop.nameEn!, style: const TextStyle(
                        fontSize: 14, height: 1.5, color: CustomerPalette.muted)),
                  ],
                ],
              ),
            ),
          ],
        ),
        if (shop.subtitle?.trim().isNotEmpty == true) ...[
          const SizedBox(height: 16),
          Text(shop.subtitle!, style: const TextStyle(
              color: CustomerPalette.muted, fontSize: 14, height: 1.6)),
        ],
        const SizedBox(height: 20),
        Wrap(
          spacing: 18,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.star_rounded, size: 18,
                    color: shop.reviewCount > 0 ? accent : CustomerPalette.muted),
                const SizedBox(width: 5),
                if (shop.reviewCount > 0) ...[
                  Text(shop.avgRating.toStringAsFixed(1), style: const TextStyle(
                      fontWeight: FontWeight.w600, color: CustomerPalette.ink)),
                  const SizedBox(width: 5),
                ],
                Text(shop.reviewCount > 0 ? '${shop.reviewCount} reviews' : 'No reviews yet',
                    style: const TextStyle(fontSize: 13, color: CustomerPalette.muted)),
              ],
            ),
            if (location.isNotEmpty)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.location_on_outlined, size: 17, color: CustomerPalette.muted),
                  const SizedBox(width: 5),
                  Flexible(child: Text(location, style: const TextStyle(
                      fontSize: 13, color: CustomerPalette.muted))),
                ],
              ),
          ],
        ),
        if (shop.tags.isNotEmpty) ...[
          const SizedBox(height: 16),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: shop.tags.map((tag) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
              decoration: BoxDecoration(
                color: CustomerPalette.shopTint(shop.brandColor),
                borderRadius: BorderRadius.circular(30),
              ),
              child: Text(tag, style: TextStyle(fontSize: 12, color: accent, height: 1.3)),
            )).toList(),
          ),
        ],
      ],
    );
  }

  Widget _visitDetails(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('Visit & contact', style: TextStyle(fontSize: 17,
          fontWeight: FontWeight.w600, color: CustomerPalette.ink)),
      const SizedBox(height: 18),
      ShopOpeningHours(shop: shop),
      const SizedBox(height: 20),
      Divider(height: 1, color: CustomerPalette.shopBorder(shop.brandColor)),
      const SizedBox(height: 20),
      ShopContacts(shop: shop),
    ],
  );

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(
      color: CustomerPalette.surface,
      border: Border.all(color: CustomerPalette.shopBorder(shop.brandColor)),
      borderRadius: BorderRadius.circular(22),
      boxShadow: const [BoxShadow(color: Color(0x061E293B), blurRadius: 24, offset: Offset(0, 8))],
    ),
    child: LayoutBuilder(builder: (context, constraints) {
      final wide = constraints.maxWidth >= 860;
      final visitWidth = constraints.maxWidth >= 1200 ? 400.0 : 368.0;
      final overview = Padding(
        padding: EdgeInsets.all(wide ? 30 : 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _identity(context),
            const SizedBox(height: 24),
            Divider(height: 1, color: CustomerPalette.shopBorder(shop.brandColor)),
            const SizedBox(height: 24),
            details,
          ],
        ),
      );
      final visit = Container(
        width: wide ? visitWidth : double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: wide ? null : BoxDecoration(
          color: CustomerPalette.shopTint(shop.brandColor, opacity: 0.035),
          border: Border(top: BorderSide(color: CustomerPalette.shopBorder(shop.brandColor))),
        ),
        child: _visitDetails(context),
      );
      return wide
          ? Stack(children: [
              Positioned(top: 0, bottom: 0, right: 0, width: visitWidth,
                child: DecoratedBox(decoration: BoxDecoration(
                  color: CustomerPalette.shopTint(shop.brandColor, opacity: 0.035),
                  border: Border(left: BorderSide(color: CustomerPalette.shopBorder(shop.brandColor))),
                )),
              ),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: overview), visit,
              ]),
            ])
          : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [overview, visit]);
    }),
  );
}

class _ShopGallery extends StatefulWidget {
  final List<String> images;
  final bool desktop;
  const _ShopGallery({required this.images, required this.desktop});
  @override
  State<_ShopGallery> createState() => _ShopGalleryState();
}

class _ShopGalleryState extends State<_ShopGallery> {
  final _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _select(int page) => _controller.animateToPage(
    page,
    duration: const Duration(milliseconds: 250),
    curve: Curves.easeOut,
  );

  @override
  Widget build(BuildContext context) {
    if (widget.images.isEmpty) {
      return ConstrainedBox(
        constraints: BoxConstraints(minHeight: widget.desktop ? 104 : 96),
        child: const _PhotoPlaceholder(compact: true),
      );
    }
    final hero = ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: Stack(
        fit: StackFit.expand,
        children: [
          PageView.builder(
            controller: _controller,
            itemCount: widget.images.length,
            onPageChanged: (page) => setState(() => _page = page),
            itemBuilder: (_, index) => _ShopPhoto(url: widget.images[index]),
          ),
          Positioned(
            bottom: 14,
            right: 14,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: CustomerPalette.surface,
                border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.photo_library_outlined,
                    size: 16,
                    color: CustomerPalette.ink,
                  ),
                  const SizedBox(width: 7),
                  Text(
                    '${_page + 1} / ${widget.images.length}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: CustomerPalette.ink,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (widget.images.length > 1) ...[
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.only(left: 12),
                child: _GalleryArrow(
                  icon: Icons.chevron_left,
                  label: customerText(
                    context,
                    'Previous shop photo',
                    '上一张门店照片',
                  ),
                  onPressed: _page == 0 ? null : () => _select(_page - 1),
                ),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.only(right: 12),
                child: _GalleryArrow(
                  icon: Icons.chevron_right,
                  label: customerText(context, 'Next shop photo', '下一张门店照片'),
                  onPressed: _page == widget.images.length - 1
                      ? null
                      : () => _select(_page + 1),
                ),
              ),
            ),
          ],
        ],
      ),
    );
    return SizedBox(
      height: widget.desktop
          ? (MediaQuery.sizeOf(context).width >= 1440 ? 420 : 360)
          : 224,
      child: widget.desktop && widget.images.length >= 3
          ? Row(
              children: [
                Expanded(flex: 2, child: hero),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    children: [
                      for (var index = 1; index <= 2; index++) ...[
                        if (index == 2) const SizedBox(height: 12),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(18),
                            child: Material(
                              color: Theme.of(context).colorScheme.primaryContainer,
                              child: InkWell(
                                onTap: () => _select(index),
                                child: SizedBox.expand(
                                  child: _ShopPhoto(url: widget.images[index]),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            )
          : hero,
    );
  }
}

class _GalleryArrow extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  const _GalleryArrow({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: label,
    onPressed: onPressed,
    icon: Icon(icon, color: CustomerPalette.ink),
    style: IconButton.styleFrom(
      backgroundColor: CustomerPalette.surface,
      disabledBackgroundColor: CustomerPalette.surface,
      foregroundColor: CustomerPalette.ink,
      disabledForegroundColor: CustomerPalette.muted,
      side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
    ),
  );
}

class _ShopPhoto extends StatelessWidget {
  final String url;
  const _ShopPhoto({required this.url});

  @override
  Widget build(BuildContext context) => Image.network(
    url,
    fit: BoxFit.cover,
    width: double.infinity,
    height: double.infinity,
    errorBuilder: (_, _, _) => const _PhotoPlaceholder(loadFailed: true),
    loadingBuilder: (_, child, loading) => loading == null
        ? child
        : ColoredBox(
            color: Theme.of(context).colorScheme.primaryContainer,
            child: Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
            ),
          ),
  );
}

class _PhotoPlaceholder extends StatelessWidget {
  final bool loadFailed;
  final bool compact;
  const _PhotoPlaceholder({this.loadFailed = false, this.compact = false});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.primaryContainer,
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(14),
    ),
    child: compact
        ? Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Icon(
                  Icons.storefront_outlined,
                  size: 28,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        customerText(
                          context,
                          'Shop photos coming soon',
                          '门店照片待补充',
                        ),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: CustomerPalette.ink,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        customerText(
                          context,
                          'Browse services and shop details below',
                          '可先了解下方的服务与门店信息',
                        ),
                        style: const TextStyle(
                          fontSize: 12,
                          color: CustomerPalette.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          )
        : Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 66,
                  height: 66,
                  decoration: BoxDecoration(
                    color: CustomerPalette.surface,
                    border: Border.all(
                      color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.22),
                    ),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Icon(
                    loadFailed
                        ? Icons.image_not_supported_outlined
                        : Icons.storefront_outlined,
                    size: 31,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  loadFailed
                      ? customerText(
                          context,
                          'Shop photo is unavailable',
                          '门店照片暂时无法显示',
                        )
                      : customerText(
                          context,
                          'Shop photos coming soon',
                          '门店照片待补充',
                        ),
                  style: const TextStyle(
                    color: CustomerPalette.ink,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  customerText(
                    context,
                    'Browse services and shop details below',
                    '可先了解下方的服务与门店信息',
                  ),
                  style: const TextStyle(
                    fontSize: 13,
                    color: CustomerPalette.muted,
                  ),
                ),
              ],
            ),
          ),
  );
}

class _SectionHeading extends StatelessWidget {
  final String title;
  final String? trailing;
  const _SectionHeading({required this.title, this.trailing});

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          title,
          style: const TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.3,
            color: CustomerPalette.ink,
          ),
        ),
      ),
      if (trailing != null)
        Text(
          trailing!,
          style: const TextStyle(fontSize: 12, color: CustomerPalette.muted),
        ),
    ],
  );
}

class _ServiceCard extends StatelessWidget {
  final ShopBookingChoice choice;
  final VoidCallback? onBook;
  const _ServiceCard({super.key, required this.choice, required this.onBook});

  @override
  Widget build(BuildContext context) {
    final service=choice.service;
    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          choice.label,
          style: const TextStyle(
            color: CustomerPalette.ink,
            fontSize: 16,
            height: 1.45,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 7),
        Row(
          children: [
            const Icon(
              Icons.schedule_outlined,
              size: 15,
              color: CustomerPalette.muted,
            ),
            const SizedBox(width: 5),
            Text(
              choice.duration,
              style: const TextStyle(
                color: CustomerPalette.muted,
                fontSize: 13,
              ),
            ),
          ],
        ),
        if (service.description?.trim().isNotEmpty == true) ...[
          const SizedBox(height: 9),
          Text(
            service.description!,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 13,
              height: 1.6,
              color: CustomerPalette.muted,
            ),
          ),
        ],
      ],
    );
    final price = Text(
      choice.price,
      style: const TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: CustomerPalette.ink,
      ),
    );
    return ShopServiceSelectionCard(
      semanticLabel: '${choice.label}, ${choice.duration}, ${choice.price}',
      onSelected: service.canBook ? onBook : null,
      accentColor: Theme.of(context).colorScheme.primary,
      padding: const EdgeInsets.all(18),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 470) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                details,
                const SizedBox(height: 18),
                price,
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: details),
              const SizedBox(width: 20),
              price,
            ],
          );
        },
      ),
    );
  }
}

ShopService? _startingService(ShopDetail shop) {
  final candidates = shop.services.where((service) => service.canBook).toList();
  if (candidates.isEmpty) return null;
  final currency = candidates.first.currency;
  if (candidates.any((service) => service.currency != currency)) return null;
  return candidates.reduce(
    (first, next) =>
        next.startingPriceCents! < first.startingPriceCents! ? next : first,
  );
}

class _BookingSummary extends StatelessWidget {
  final ShopDetail shop;
  final VoidCallback onBook;
  final VoidCallback onViewServices;
  const _BookingSummary({
    required this.shop,
    required this.onBook,
    required this.onViewServices,
  });

  @override
  Widget build(BuildContext context) {
    final starting = _startingService(shop);
    return _DetailPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(
              Icons.calendar_month_outlined,
              size: 22,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
          const SizedBox(height: 20),
          Text(
            customerText(context, 'Plan your visit', '预约到店服务'),
            style: const TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w600,
              color: CustomerPalette.ink,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            customerText(
              context,
              shop.canBookOnline
                  ? 'Choose your service, therapist and available time in the next steps.'
                  : 'Browse services and prices for this shop.',
              shop.canBookOnline
                  ? '选择服务后，可查看技师及可预约的日期和时间。'
                  : '可浏览本店的服务与价格。',
            ),
            style: const TextStyle(
              color: CustomerPalette.muted,
              fontSize: 14,
              height: 1.7,
            ),
          ),
          const SizedBox(height: 24),
          Text(
            starting == null
                ? customerText(context, 'See service prices', '价格详见服务')
                : starting.formattedPrice,
            style: const TextStyle(
              fontSize: 24,
              color: CustomerPalette.ink,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.6,
            ),
          ),
          if (starting != null) ...[
            const SizedBox(height: 4),
            Text(
              customerText(context, 'Starting price', '服务起价'),
              style: const TextStyle(
                color: CustomerPalette.muted,
                fontSize: 12,
              ),
            ),
          ],
          const SizedBox(height: 22),
          _BookingButton(shop: shop, onBook: onBook),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: TextButton(
              onPressed: onViewServices,
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.primary,
              ),
              child: Text(customerText(context, 'View services', '查看服务')),
            ),
          ),
        ],
      ),
    );
  }
}

class _MobileBookingBar extends StatelessWidget {
  final ShopDetail shop;
  final VoidCallback onBook;
  const _MobileBookingBar({required this.shop, required this.onBook});

  @override
  Widget build(BuildContext context) {
    final starting = _startingService(shop);
    return Container(
      decoration: BoxDecoration(
        color: CustomerPalette.surface,
        border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: ResponsiveContent(
            maxWidth: 720,
            child: Row(
              children: [
                if (starting != null &&
                    shop.canBookOnline &&
                    MediaQuery.sizeOf(context).width >= 350) ...[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          customerText(context, 'From', '服务起价'),
                          style: const TextStyle(
                            color: CustomerPalette.muted,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          starting.formattedPrice,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: CustomerPalette.ink,
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                ],
                Expanded(
                  child: _BookingButton(shop: shop, onBook: onBook),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BookingButton extends StatelessWidget {
  final ShopDetail shop;
  final VoidCallback onBook;
  const _BookingButton({required this.shop, required this.onBook});

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 50,
    child: FilledButton(
      onPressed: shop.canBookOnline ? onBook : null,
      style: FilledButton.styleFrom(
        backgroundColor: CustomerPalette.shopAccent(shop.brandColor),
        foregroundColor: CustomerPalette.surface,
        disabledBackgroundColor: Theme.of(context).colorScheme.outlineVariant,
        disabledForegroundColor: CustomerPalette.muted,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        elevation: 0,
      ),
      child: Text(
        shop.canBookOnline
            ? AppLocalizations.of(context)!.bookNow
            : AppLocalizations.of(context)!.onlineBookingUnavailable,
        textAlign: TextAlign.center,
        maxLines: 2,
      ),
    ),
  );
}

class _QuietNotice extends StatelessWidget {
  final IconData icon;
  final String text;
  const _QuietNotice({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 19, color: CustomerPalette.muted),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              color: CustomerPalette.muted,
              fontSize: 13,
              height: 1.65,
            ),
          ),
        ),
      ],
    ),
  );
}

class _ExpandableText extends StatelessWidget {
  final String text;
  final bool expanded;
  final VoidCallback onToggle;
  const _ExpandableText({
    required this.text,
    required this.expanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        text,
        maxLines: expanded ? null : 3,
        overflow: expanded ? null : TextOverflow.ellipsis,
        style: const TextStyle(
          color: CustomerPalette.muted,
          fontSize: 14,
          height: 1.75,
        ),
      ),
      if (text.length > 120)
        TextButton(
          onPressed: onToggle,
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(context).colorScheme.primary,
            padding: EdgeInsets.zero,
          ),
          child: Text(
            expanded
                ? AppLocalizations.of(context)!.showLess
                : AppLocalizations.of(context)!.readMore,
          ),
        ),
    ],
  );
}

class _TherapistTile extends StatelessWidget {
  final Therapist therapist;
  const _TherapistTile({required this.therapist});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 24,
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
            foregroundColor: Theme.of(context).colorScheme.primary,
          backgroundImage: therapist.avatarUrl?.trim().isNotEmpty == true
              ? NetworkImage(therapist.avatarUrl!)
              : null,
          child: therapist.avatarUrl?.trim().isNotEmpty != true
              ? const Icon(Icons.person_outline, size: 25)
              : null,
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                therapist.name,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: CustomerPalette.ink,
                ),
              ),
              if (therapist.publicTitle?.trim().isNotEmpty == true) ...[
                const SizedBox(height: 4),
                Text(
                  therapist.publicTitle!,
                  style: const TextStyle(
                    color: CustomerPalette.muted,
                    fontSize: 12,
                    height: 1.5,
                  ),
                ),
              ],
              if (therapist.yearsExp > 0) ...[
                const SizedBox(height: 5),
                Text(
                  AppLocalizations.of(
                    context,
                  )!.yearsExperience(therapist.yearsExp),
                  style: const TextStyle(
                    color: CustomerPalette.muted,
                    fontSize: 12,
                  ),
                ),
              ],
              if (therapist.bio?.trim().isNotEmpty == true) ...[
                const SizedBox(height: 7),
                Text(
                  therapist.bio!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: CustomerPalette.muted,
                    fontSize: 13,
                    height: 1.6,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

class _ReviewsSection extends ConsumerWidget {
  final String shopId;
  final bool showAll;
  final VoidCallback onToggle;
  const _ReviewsSection({
    required this.shopId,
    required this.showAll,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviewsAsync = ref.watch(shopReviewsProvider(shopId));
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeading(title: customerText(context, 'Latest reviews', '最新评价')),
        const SizedBox(height: 20),
        reviewsAsync.when(
          loading: () => Center(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: CircularProgressIndicator(
                color: Theme.of(context).colorScheme.primary,
                strokeWidth: 2,
              ),
            ),
          ),
          error: (_, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.failedToLoadReviews,
                style: const TextStyle(
                  color: CustomerPalette.muted,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () => ref.invalidate(shopReviewsProvider(shopId)),
                icon: const Icon(Icons.refresh, size: 17),
                label: Text(l10n.retry),
              ),
            ],
          ),
          data: (reviews) {
            if (reviews.isEmpty) {
              return _QuietNotice(
                icon: Icons.rate_review_outlined,
                text: l10n.noReviewsYet,
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final review in reviews.take(showAll ? reviews.length : 3))
                  _ReviewCard(review: review),
                if (reviews.length > 3)
                  TextButton(
                    onPressed: onToggle,
                    style: TextButton.styleFrom(
                      foregroundColor: Theme.of(context).colorScheme.primary,
                    ),
                    child: Text(
                      showAll
                          ? l10n.showLess
                          : customerText(
                              context,
                              'Show more loaded reviews',
                              '展开本页评价',
                            ),
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _ReviewCard extends StatelessWidget {
  final Review review;
  const _ReviewCard({required this.review});

  @override
  Widget build(BuildContext context) {
    final name = review.user?.name?.trim().isNotEmpty == true
        ? review.user!.name!
        : customerText(context, 'Customer', '顾客');
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                backgroundImage:
                    review.user?.avatarUrl?.trim().isNotEmpty == true
                    ? NetworkImage(review.user!.avatarUrl!)
                    : null,
                child: review.user?.avatarUrl?.trim().isNotEmpty != true
                    ? Text(
                        name.characters.first,
                        style: TextStyle(
                          fontSize: 13,
                          color: Theme.of(context).colorScheme.primary,
                          fontWeight: FontWeight.w600,
                        ),
                      )
                    : null,
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                        color: CustomerPalette.ink,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (review.formattedDate.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        review.formattedDate,
                        style: const TextStyle(
                          color: CustomerPalette.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.star_rounded,
                    size: 17,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(width: 3),
                  Text(
                    review.rating.toString(),
                    style: const TextStyle(
                      color: CustomerPalette.ink,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (review.content?.trim().isNotEmpty == true) ...[
            const SizedBox(height: 14),
            Text(
              review.content!,
              style: const TextStyle(
                color: CustomerPalette.muted,
                fontSize: 14,
                height: 1.75,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
