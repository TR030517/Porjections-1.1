import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../models/shop.dart';
import '../theme/customer_theme.dart';

/// Published projects use explicit catalog links; legacy wording stays readable.
class ShopPriceMenu extends StatefulWidget {
  final List<ShopPriceMenuGroup> groups;
  final ValueChanged<ShopPriceMenuItem>? onBook;
  final Color? accentColor;
  const ShopPriceMenu({super.key, required this.groups, this.onBook, this.accentColor});

  @override
  State<ShopPriceMenu> createState() => _ShopPriceMenuState();
}

class _ShopPriceMenuState extends State<ShopPriceMenu> {
  static const _itemBatch = 6;
  final Map<int, int> _itemLimits = {};
  final Set<int> _expandedGroups = {};
  late String _contentVersion;
  int _bookingRevision = 0;
  Color get _accent => widget.accentColor ?? CustomerPalette.action;
  List<ShopPriceMenuGroup> get _groups => widget.groups
      .map((group) => ShopPriceMenuGroup(category: group.category,
          items: group.items.where((item) => item.isVisible).toList()))
      .where((group) => group.items.isNotEmpty).toList();

  // Value comparison also detects refreshed data that reuses a mutable list.
  // Equivalent new lists preserve the reader's current expansion choices.
  String _version(List<ShopPriceMenuGroup> groups) => jsonEncode([
    for (final group in groups)
      [
        group.category,
        [
          for (final item in group.items)
            [item.displayName, item.priceText, item.description, item.imageUrl,
              item.pricing?.toJson(), item.id, item.isVisible, item.bookingEnabled, item.bookingAvailable, item.bookingUnavailableReason,
              item.booking?.serviceId, item.booking?.variantId, item.booking?.addOnId],
        ],
      ],
  ]);

  @override
  void initState() {
    super.initState();
    _contentVersion = _version(widget.groups);
  }

  @override
  void didUpdateWidget(covariant ShopPriceMenu oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextVersion = _version(widget.groups);
    if (nextVersion != _contentVersion || oldWidget.onBook != widget.onBook) {
      _bookingRevision++;
    }
    if (nextVersion != _contentVersion) {
      _contentVersion = nextVersion;
      _itemLimits.clear();
      _expandedGroups.clear();
    }
  }

  int _itemCount(int index) => math.min(
    _groups[index].items.length,
    _itemLimits[index] ?? _itemBatch,
  );

  Widget _menuItem(ShopPriceMenuItem item, int groupIndex, int itemIndex) =>
      Padding(
        key: ValueKey('price-menu-item-$groupIndex-$itemIndex'),
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: LayoutBuilder(builder: (context, constraints) {
            final onBook = widget.onBook;
            final bookingRevision = _bookingRevision;
            final narrow = constraints.maxWidth < 420;
            final pricing = item.displayPricing;
            final bookingDescription = switch (item.bookingMode) {
              'COUPLE' => 'Couple massage · 2 guests, 2 therapists',
              'FOUR_HANDS' => 'Four hands · 1 guest, 2 therapists',
              _ => null,
            };
            final details = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.displayName,
                  style: const TextStyle(
                    fontSize: 15,
                    color: CustomerPalette.ink,
                    fontWeight: FontWeight.w500,
                    height: 1.5,
                  ),
                ),
                if (pricing != null) ...[
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(pricing.badge,
                      style: TextStyle(fontSize: 11, height: 1.5,
                        color: _accent)),
                  ),
                  if (pricing.kind == 'ADD_ON') ...[
                    const SizedBox(height: 5),
                    const Text('Requires a main service · Adds no appointment time',
                      style: TextStyle(fontSize: 12, color: CustomerPalette.muted,
                        height: 1.6)),
                  ],
                ],
                if (item.description.trim().isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Text(
                    item.description,
                    style: const TextStyle(
                      fontSize: 13,
                      color: CustomerPalette.muted,
                      height: 1.6,
                    ),
                  ),
                ],
                if (item.bookingEnabled && item.bookingAvailable == false && item.booking != null && item.booking!.addOnId == null) ...[
                  const SizedBox(height: 7),
                  Text(item.bookingUnavailableReason == 'NO_SCHEDULE'
                      ? customerText(context, 'No appointment times are currently available', '当前暂无可预约时段')
                      : 'Online booking is currently unavailable',
                    style: const TextStyle(fontSize: 12, color: CustomerPalette.muted)),
                ],
                if (item.booking == null && pricing?.kind != 'ADD_ON') ...[
                  const SizedBox(height: 7),
                  Text(customerText(context, 'For display only · No online booking', '仅展示 · 暂不可在线预约'),
                    style: const TextStyle(fontSize: 12, color: CustomerPalette.muted)),
                ],
                if (bookingDescription != null) ...[
                  const SizedBox(height: 5),
                  Text(bookingDescription, style: const TextStyle(fontSize: 12, color: CustomerPalette.muted)),
                ],
              ],
            );
            final price = Text(
              item.priceText,
              textAlign: narrow ? TextAlign.left : TextAlign.right,
              style: const TextStyle(
                color: CustomerPalette.ink,
                fontSize: 15,
                fontWeight: FontWeight.w600,
                height: 1.5,
              ),
            );
            return ShopServiceSelectionCard(
              key: ValueKey('price-menu-book-$groupIndex-$itemIndex'),
              // The card excludes descendant semantics to expose one action.
              // Include the visible badge and staffing details in that action.
              semanticLabel: [
                item.displayName,
                if (item.priceText.trim().isNotEmpty) item.priceText,
                if (pricing != null) pricing.badge,
                if (pricing?.kind == 'ADD_ON') 'Requires a main service. Adds no appointment time',
                ?bookingDescription,
                if (item.description.trim().isNotEmpty) item.description,
              ].join('. '),
              onSelected: item.canStartBooking && onBook != null
                  ? () {
                      // A queued accessibility/tap action belongs to the menu
                      // and shop handler that rendered it, before any refresh.
                      if (!mounted || bookingRevision != _bookingRevision) return;
                      onBook(item);
                    }
                  : null,
              accentColor: _accent,
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (item.imageUrl != null) ...[
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(item.imageUrl!, width: 56, height: 56, fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => const SizedBox.shrink()),
                        ),
                        const SizedBox(width: 12),
                      ],
                      Expanded(child: details),
                      if (pricing == null && !narrow && item.priceText.trim().isNotEmpty) ...[
                        const SizedBox(width: 16),
                        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 140), child: price),
                      ],
                    ],
                  ),
                  if (pricing == null && narrow && item.priceText.trim().isNotEmpty)
                    Padding(padding: EdgeInsets.only(top: 6, left: item.imageUrl == null ? 0 : 68), child: price),
                ],
              ),
            );
          },
        ),
      );

  Widget _group(int index) {
    final group = _groups[index], count = _itemCount(index);
    final expanded = _expandedGroups.contains(index);
    final colors = Theme.of(context).colorScheme;
    final title = group.category.trim().isEmpty
        ? customerText(context, 'Services', '服务项目')
        : group.category;
    return Padding(
      key: ValueKey('price-menu-group-$index'),
      padding: const EdgeInsets.only(top: 12),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          key: ValueKey('price-menu-group-toggle-$index'),
          initiallyExpanded: expanded,
          tilePadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
          clipBehavior: Clip.antiAlias,
          backgroundColor: Color.alphaBlend(_accent.withValues(alpha: 0.018), colors.surface),
          collapsedBackgroundColor: Color.alphaBlend(_accent.withValues(alpha: 0.045), colors.surface),
          iconColor: _accent,
          collapsedIconColor: CustomerPalette.muted,
          collapsedShape: RoundedRectangleBorder(
            side: BorderSide(color: Color.alphaBlend(_accent.withValues(alpha: 0.06), colors.outlineVariant)),
            borderRadius: BorderRadius.circular(16),
          ),
          shape: RoundedRectangleBorder(
            side: BorderSide(color: _accent.withValues(alpha: 0.3)),
            borderRadius: BorderRadius.circular(16),
          ),
          title: Text(title, key: ValueKey('price-menu-group-title-$index'),
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700,
              color: CustomerPalette.ink, height: 1.45, letterSpacing: 0.1)),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 7),
            child: Row(children: [
              Container(
                width: 3,
                height: 10,
                decoration: BoxDecoration(
                  color: _accent.withValues(alpha: expanded ? 0.8 : 0.4),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(child: Text(
                customerText(context,
                  '${group.items.length} ${group.items.length == 1 ? 'service' : 'services'}',
                  '${group.items.length} 项服务'),
                style: TextStyle(fontSize: 12, height: 1.4,
                  color: expanded ? _accent : CustomerPalette.muted),
              )),
            ]),
          ),
          onExpansionChanged: (expanded) => setState(() {
            if (expanded) {
              _expandedGroups.add(index);
            } else {
              _expandedGroups.remove(index);
            }
          }),
          children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Divider(height: 1, thickness: 1, color: _accent.withValues(alpha: 0.1)),
          ),
          // Hidden items never create widgets or Image.network requests.
          for (var itemIndex = 0; itemIndex < count; itemIndex++)
            _menuItem(group.items[itemIndex], index, itemIndex),
          if (group.items.length > _itemBatch) ...[
            Text(
              'Showing $count of ${group.items.length} services',
              style: const TextStyle(
                fontSize: 12,
                color: CustomerPalette.muted,
              ),
            ),
            Wrap(
              spacing: 8,
              children: [
                if (count < group.items.length)
                  TextButton.icon(
                    onPressed: () => setState(() {
                      _itemLimits[index] = count + _itemBatch;
                    }),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Show more services'),
                    style: TextButton.styleFrom(
                      foregroundColor: _accent,
                    ),
                  ),
                if (count > _itemBatch)
                  TextButton.icon(
                    onPressed: () => setState(() {
                      _itemLimits.remove(index);
                    }),
                    icon: const Icon(Icons.remove, size: 18),
                    label: const Text('Show fewer services'),
                    style: TextButton.styleFrom(
                      foregroundColor: _accent,
                    ),
                  ),
              ],
            ),
          ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final totalItems = _groups.fold<int>(
      0,
      (total, group) => total + group.items.length,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Container(
            width: 3,
            height: 24,
            margin: const EdgeInsets.only(right: 10),
            decoration: BoxDecoration(color: _accent, borderRadius: BorderRadius.circular(2)),
          ),
          const Expanded(child: Text(
            'Services & prices',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.4,
              height: 1.35,
              color: CustomerPalette.ink,
            ),
          )),
        ]),
        const SizedBox(height: 10),
        Text(
          widget.onBook == null
              ? customerText(context, 'Open a category to explore services and prices.', '展开分类，查看服务项目与价格。')
              : customerText(context, 'Open a category to explore the menu. Select an available service to start booking.', '展开分类查看价目，选择可预约项目开始预约。'),
          style: const TextStyle(fontSize: 13, color: CustomerPalette.muted, height: 1.65),
        ),
        const SizedBox(height: 12),
        Semantics(
          liveRegion: true,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
            decoration: BoxDecoration(
              color: _accent.withValues(alpha: 0.055),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              customerText(context,
                '${_groups.length} ${_groups.length == 1 ? 'service group' : 'service groups'} · $totalItems ${totalItems == 1 ? 'service' : 'services'}',
                '${_groups.length} 个服务分类 · 共 $totalItems 项',
              ),
              style: TextStyle(fontSize: 12, height: 1.4, fontWeight: FontWeight.w500, color: _accent),
            ),
          ),
        ),
        KeyedSubtree(
          key: ValueKey(_contentVersion.hashCode),
          child: Column(
            children: [
              for (var index = 0; index < _groups.length; index++)
                _group(index),
            ],
          ),
        ),
      ],
    );
  }
}

/// One focus and activation target for a listed service, including its price.
class ShopServiceSelectionCard extends StatefulWidget {
  final Widget child;
  final String semanticLabel;
  final VoidCallback? onSelected;
  final Color accentColor;
  final EdgeInsetsGeometry padding;
  const ShopServiceSelectionCard({super.key, required this.child,
    required this.semanticLabel, required this.onSelected, required this.accentColor,
    this.padding = const EdgeInsets.all(12)});

  @override
  State<ShopServiceSelectionCard> createState() => _ShopServiceSelectionCardState();
}

class _ShopServiceSelectionCardState extends State<ShopServiceSelectionCard> {
  bool _hovered = false, _focused = false, _pressed = false;

  @override
  void didUpdateWidget(covariant ShopServiceSelectionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.onSelected == null) {
      _focused = false; _pressed = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onSelected != null;
    final highlighted = enabled && (_hovered || _focused || _pressed);
    final accent = widget.accentColor;
    final colors = Theme.of(context).colorScheme;
    final duration = MediaQuery.maybeOf(context)?.disableAnimations == true
        ? Duration.zero : const Duration(milliseconds: 170);
    final radius = BorderRadius.circular(12);
    return MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: Semantics(
      container: true,
      button: true,
      enabled: enabled,
      focusable: enabled,
      focused: enabled && _focused,
      label: widget.semanticLabel,
      hint: enabled ? 'Select this service to continue booking.'
          : 'This item is not available for online booking.',
      onTap: widget.onSelected,
      excludeSemantics: true,
      child: AnimatedContainer(
        duration: duration,
        curve: Curves.easeOutCubic,
        decoration: BoxDecoration(
          color: Color.alphaBlend(accent.withValues(alpha: highlighted ? (_pressed ? 0.09 : 0.045) : _hovered ? 0.018 : 0), colors.surface),
          borderRadius: radius,
          border: Border.all(color: highlighted ? accent.withValues(alpha: _focused ? 0.85 : 0.4) : _hovered ? Color.alphaBlend(accent.withValues(alpha: 0.18), colors.outlineVariant) : colors.outlineVariant),
          boxShadow: [BoxShadow(color: accent.withValues(alpha: highlighted && !_pressed ? 0.09 : 0),
            blurRadius: highlighted ? 14 : 0, offset: const Offset(0, 3))],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: radius,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onSelected,
            canRequestFocus: enabled,
            excludeFromSemantics: true,
            mouseCursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
            onFocusChange: enabled ? (value) => setState(() => _focused = value) : null,
            onHighlightChanged: enabled ? (value) => setState(() => _pressed = value) : null,
            hoverColor: Colors.transparent,
            focusColor: Colors.transparent,
            highlightColor: accent.withValues(alpha: 0.04),
            splashColor: accent.withValues(alpha: 0.1),
            borderRadius: radius,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 72),
              child: Padding(
                padding: widget.padding,
                child: Row(children: [
                  Expanded(child: widget.child),
                  const SizedBox(width: 12),
                  AnimatedSlide(
                    duration: duration,
                    curve: Curves.easeOutCubic,
                    offset: Offset(highlighted && !_pressed ? 0.12 : 0, 0),
                    child: Icon(Icons.chevron_right, color: enabled ? accent : CustomerPalette.muted, size: 26),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
      ),
    );
  }
}
