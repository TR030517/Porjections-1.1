import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/home_banner.dart';
import '../providers/banner_provider.dart';
import '../navigation/customer_navigation.dart';
import 'customer_access.dart';
import '../screens/coupon_center_screen.dart';

/// Home banner carousel — auto-play PageView with dot indicator.
/// Renders SizedBox.shrink when there are no banners or on load failure.
class HomeBannerCarousel extends ConsumerStatefulWidget {
  final ValueChanged<String>? onCategorySelected;
  const HomeBannerCarousel({super.key, this.onCategorySelected});

  @override
  ConsumerState<HomeBannerCarousel> createState() => _HomeBannerCarouselState();
}

class _HomeBannerCarouselState extends ConsumerState<HomeBannerCarousel> {
  final PageController _controller = PageController();
  Timer? _timer;
  int _current = 0;

  @override
  void initState() {
    super.initState();
    _startAutoPlay();
  }

  void _startAutoPlay() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || !_controller.hasClients) return;
      final banners = ref.read(bannersProvider).valueOrNull;
      if (banners == null || banners.isEmpty) return;
      final next = (_current + 1) % banners.length;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 400),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _openBanner(HomeBanner banner) async {
    ref.read(bannerRepositoryProvider).recordBannerClick(banner.id);
    switch (banner.targetType) {
      case 'SHOP_DETAIL':
        if (banner.targetValue != null && banner.targetValue!.isNotEmpty) {
          openCustomerShop(context, shopId: banner.targetValue!);
        }
        break;
      case 'COUPON_CENTER':
        if (!await requireCustomerSignIn(context, ref) || !mounted) return;
        Navigator.of(
          context,
        ).push(MaterialPageRoute(builder: (_) => const CouponCenterScreen()));
        break;
      case 'CATEGORY':
        if (banner.targetValue != null && banner.targetValue!.isNotEmpty) {
          widget.onCategorySelected?.call(banner.targetValue!);
        }
        break;
      case 'EXTERNAL_URL':
        final uri = Uri.tryParse(banner.targetValue ?? '');
        var opened = false;
        if (uri != null &&
            uri.hasAuthority &&
            uri.scheme == 'https' &&
            uri.userInfo.isEmpty) {
          try {
            opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
          } catch (_) {
            opened = false;
          }
        }
        if (!opened && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Unable to open this link.')),
          );
        }
        break;
      default:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final bannersAsync = ref.watch(bannersProvider);
    final banners = bannersAsync.valueOrNull ?? const <HomeBanner>[];
    if (banners.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        SizedBox(
          height: 150,
          child: PageView.builder(
            controller: _controller,
            itemCount: banners.length,
            onPageChanged: (i) => setState(() => _current = i),
            itemBuilder: (context, i) {
              final b = banners[i];
              return GestureDetector(
                onTap: () => _openBanner(b),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Image.network(
                          b.imageUrl,
                          fit: BoxFit.cover,
                          loadingBuilder: (context, child, progress) {
                            if (progress == null) return child;
                            return Container(
                              color: Theme.of(
                                context,
                              ).colorScheme.surfaceContainerHighest,
                              child: const Center(
                                child: SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              ),
                            );
                          },
                          errorBuilder: (context, error, stack) => Container(
                            color: Theme.of(
                              context,
                            ).colorScheme.surfaceContainerHighest,
                            child: const Icon(Icons.broken_image_outlined),
                          ),
                        ),
                        // gradient overlay for title legibility
                        Positioned(
                          left: 0,
                          right: 0,
                          bottom: 0,
                          child: Container(
                            padding: const EdgeInsets.fromLTRB(12, 20, 12, 8),
                            decoration: const BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [Colors.transparent, Colors.black54],
                              ),
                            ),
                            child: Text(
                              b.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(banners.length, (i) {
            final active = i == _current;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: active ? 16 : 6,
              height: 6,
              decoration: BoxDecoration(
                color: active
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(3),
              ),
            );
          }),
        ),
      ],
    );
  }
}
