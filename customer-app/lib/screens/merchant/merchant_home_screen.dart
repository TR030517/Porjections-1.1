import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';
import 'merchant_apply_screen.dart';
import 'merchant_shop_edit_screen.dart';
import 'merchant_services_screen.dart';
import 'merchant_therapists_screen.dart';
import 'merchant_bookings_screen.dart';
import 'merchant_dashboard_screen.dart';
import 'merchant_coupons_screen.dart';

/// Merchant Portal — main navigation hub for merchants
class MerchantHomeScreen extends ConsumerWidget {
  const MerchantHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final appStatusAsync = ref.watch(merchantApplicationProvider);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(merchantApplicationProvider);
          ref.invalidate(merchantShopsProvider);
        },
        child: appStatusAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
                const SizedBox(height: 16),
                Text('Failed to load merchant data', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => ref.invalidate(merchantApplicationProvider),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          data: (application) {
            // No application yet — show apply screen
            if (application == null) {
              return const MerchantApplyScreen();
            }
            // Application pending/rejected
            if (application.status == 'PENDING' || application.status == 'REJECTED') {
              return _ApplicationStatusView(application: application);
            }
            // Approved — show merchant portal
            return _MerchantPortalView();
          },
        ),
      ),
    );
  }
}

/// View shown when the application is pending or rejected
class _ApplicationStatusView extends StatelessWidget {
  final dynamic application;

  const _ApplicationStatusView({required this.application});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isPending = application.status == 'PENDING';
    final isRejected = application.status == 'REJECTED';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isPending ? Icons.hourglass_empty : Icons.cancel_outlined,
              size: 80,
              color: isPending ? Colors.orange : Colors.red,
            ),
            const SizedBox(height: 24),
            Text(
              isPending ? 'Application Submitted' : 'Application Rejected',
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Text(
              isPending
                  ? 'Your merchant application is under review. We will notify you once it has been approved.'
                  : 'Your merchant application has been rejected. Please contact support for more information.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey[600], fontSize: 15),
            ),
            if (isRejected && application.rejectionReason != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'Reason: ${application.rejectionReason}',
                  style: TextStyle(color: Colors.red.shade700),
                ),
              ),
            ],
            const SizedBox(height: 32),
            if (isRejected)
              FilledButton.icon(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const MerchantApplyScreen()),
                ),
                icon: const Icon(Icons.refresh),
                label: const Text('Re-Apply'),
              ),
          ],
        ),
      ),
    );
  }
}

/// Main merchant portal with management cards
class _MerchantPortalView extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final shopsAsync = ref.watch(merchantShopsProvider);

    return shopsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text('Failed to load shops', style: theme.textTheme.titleMedium),
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
                  Icon(Icons.store_mall_directory_outlined, size: 80, color: Colors.grey[300]),
                  const SizedBox(height: 16),
                  Text('No shops yet', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text(
                    'Your application has been approved. You can now manage your shop.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey[600]),
                  ),
                ],
              ),
            ),
          );
        }

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Shop selector header
            Text(
              'Manage your shop',
              style: theme.textTheme.titleMedium?.copyWith(
                color: Colors.grey[600],
              ),
            ),
            const SizedBox(height: 4),
            Text(
              shops.first.name,
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),

            // Management cards grid
            _buildGrid(context, shops.first.id),
          ],
        );
      },
    );
  }

  Widget _buildGrid(BuildContext context, String shopId) {
    final cards = <_PortalCard>[
      _PortalCard(
        icon: Icons.store_outlined,
        title: 'Shop Info',
        subtitle: 'Edit business info & hours',
        color: Colors.blue,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => MerchantShopEditScreen(shopId: shopId)),
        ),
      ),
      _PortalCard(
        icon: Icons.miscellaneous_services_outlined,
        title: 'Services',
        subtitle: 'Manage service offerings',
        color: Colors.green,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => MerchantServicesScreen(shopId: shopId)),
        ),
      ),
      _PortalCard(
        icon: Icons.people_outline,
        title: 'Therapists',
        subtitle: 'Manage your therapists',
        color: Colors.purple,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => MerchantTherapistsScreen(shopId: shopId)),
        ),
      ),
      _PortalCard(
        icon: Icons.calendar_month_outlined,
        title: 'Bookings',
        subtitle: 'View & manage bookings',
        color: Colors.orange,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => MerchantBookingsScreen(shopId: shopId)),
        ),
      ),
      _PortalCard(
        icon: Icons.dashboard_outlined,
        title: 'Dashboard',
        subtitle: 'Sales & performance stats',
        color: Colors.teal,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => MerchantDashboardScreen(shopId: shopId)),
        ),
      ),
      _PortalCard(
        icon: Icons.local_offer_outlined,
        title: 'Coupons',
        subtitle: 'Create & manage shop coupons',
        color: Colors.red,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => MerchantCouponsScreen(shopId: shopId)),
        ),
      ),
    ];

    return Column(
      children: [
        // 2-column grid
        ...List.generate((cards.length / 2).ceil(), (rowIndex) {
          final start = rowIndex * 2;
          final rowCards = cards.sublist(start, (start + 2).clamp(0, cards.length));
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: rowCards.map((card) {
                return Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      left: rowCards.indexOf(card) == 0 ? 0 : 6,
                      right: rowCards.indexOf(card) == rowCards.length - 1 ? 0 : 6,
                    ),
                    child: _PortalCardWidget(card: card),
                  ),
                );
              }).toList(),
            ),
          );
        }),
      ],
    );
  }
}

class _PortalCard {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  _PortalCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });
}

class _PortalCardWidget extends StatelessWidget {
  final _PortalCard card;

  const _PortalCardWidget({required this.card});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: card.onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: card.color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(card.icon, color: card.color, size: 28),
              ),
              const SizedBox(height: 12),
              Text(
                card.title,
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                card.subtitle,
                style: TextStyle(color: Colors.grey[500], fontSize: 12),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
