import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/coupon_provider.dart';
import '../widgets/coupon_card.dart';

/// Coupon Center — claimable coupons + my coupon wallet
class CouponCenterScreen extends ConsumerStatefulWidget {
  const CouponCenterScreen({super.key});

  @override
  ConsumerState<CouponCenterScreen> createState() => _CouponCenterScreenState();
}

class _CouponCenterScreenState extends ConsumerState<CouponCenterScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Coupons'),
          bottom: TabBar(
            controller: _tabController,
            tabs: const [
              Tab(text: 'Claim'),
              Tab(text: 'My Coupons'),
            ],
          ),
        ),
        body: TabBarView(
          controller: _tabController,
          children: const [
            _ClaimableTab(),
            _MyCouponsTab(),
          ],
        ),
      ),
    );
  }
}

class _ClaimableTab extends ConsumerWidget {
  const _ClaimableTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(claimableCouponsProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Failed to load coupons: $e')),
      data: (coupons) {
        if (coupons.isEmpty) {
          return const Center(child: Text('No coupons available right now'));
        }
        return ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: coupons.length,
          itemBuilder: (context, i) {
            final coupon = coupons[i];
            return CouponCard(
              coupon: coupon,
              onClaim: coupon.claimedByMe
                  ? null
                  : () async {
                      try {
                        await ref.read(couponRepositoryProvider).claimCoupon(coupon.id);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Coupon claimed!')),
                          );
                          ref.invalidate(claimableCouponsProvider);
                          ref.invalidate(myCouponsProvider);
                        }
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Claim failed: $e')),
                          );
                        }
                      }
                    },
            );
          },
        );
      },
    );
  }
}

class _MyCouponsTab extends ConsumerStatefulWidget {
  const _MyCouponsTab();

  @override
  ConsumerState<_MyCouponsTab> createState() => _MyCouponsTabState();
}

class _MyCouponsTabState extends ConsumerState<_MyCouponsTab>
    with SingleTickerProviderStateMixin {
  late final TabController _walletTabs;

  @override
  void initState() {
    super.initState();
    _walletTabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _walletTabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TabBar(
          controller: _walletTabs,
          labelColor: Theme.of(context).colorScheme.primary,
          unselectedLabelColor: Colors.grey,
          tabs: const [
            Tab(text: 'Unused'),
            Tab(text: 'Used'),
            Tab(text: 'Expired'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _walletTabs,
            children: [
              _WalletList(status: 'UNUSED'),
              _WalletList(status: 'USED'),
              _WalletList(status: 'EXPIRED'),
            ],
          ),
        ),
      ],
    );
  }
}

class _WalletList extends ConsumerWidget {
  final String status;
  const _WalletList({required this.status});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myCouponsProvider(status));
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('Failed to load: $e')),
      data: (coupons) {
        if (coupons.isEmpty) {
          return const Center(child: Text('No coupons in this tab'));
        }
        return ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: coupons.length,
          itemBuilder: (context, i) {
            final uc = coupons[i];
            return CouponCard(coupon: uc.coupon, userStatus: uc.status);
          },
        );
      },
    );
  }
}
