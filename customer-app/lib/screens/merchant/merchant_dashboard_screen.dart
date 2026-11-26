import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';
import '../../models/merchant.dart';
import 'merchant_payout_screen.dart';
import 'merchant_transactions_screen.dart';

/// Merchant Dashboard Screen — sales & performance statistics
class MerchantDashboardScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantDashboardScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantDashboardScreen> createState() => _MerchantDashboardScreenState();
}

class _MerchantDashboardScreenState extends ConsumerState<MerchantDashboardScreen> {
  DateTime? _startDate;
  DateTime? _endDate;

  Future<void> _pickDateRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now,
      initialDateRange: _startDate != null && _endDate != null
          ? DateTimeRange(start: _startDate!, end: _endDate!)
          : DateTimeRange(
              start: now.subtract(const Duration(days: 30)),
              end: now,
            ),
    );
    if (picked != null) {
      setState(() {
        _startDate = picked.start;
        _endDate = picked.end;
      });
    }
  }

  void _showOnboardingDialog(BuildContext context, String url) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Link Stripe Account'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Complete the onboarding process in Stripe to start receiving payments.'),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                url,
                style: const TextStyle(fontSize: 11),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Copy the URL above and open it in your browser to complete Stripe setup.',
              style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
            },
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Use the family provider with optional date filters
    final dashboardAsync = ref.watch(
      merchantDashboardProvider(widget.shopId),
    );

    // Watch Stripe onboarding status
    final stripeAsync = ref.watch(stripeOnboardingProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.date_range),
            onPressed: _pickDateRange,
            tooltip: 'Select date range',
          ),
        ],
      ),
      body: dashboardAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
              const SizedBox(height: 16),
              Text('Failed to load dashboard', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => ref.invalidate(merchantDashboardProvider(widget.shopId)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (dashboard) => _buildDashboard(context, dashboard, stripeAsync),
      ),
    );
  }

  Widget _buildDashboard(BuildContext context, MerchantDashboard dashboard, AsyncValue<Map<String, dynamic>> stripeAsync) {
    final theme = Theme.of(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Stripe Connect Onboarding Banner ──
          stripeAsync.when(
            loading: () => const SizedBox(height: 0),
            error: (_, _) => const SizedBox(height: 0),
            data: (stripe) {
              final isCompleted = stripe['isCompleted'] == true;
              final shopId = stripe['shopId'] as String?;

              if (isCompleted) {
                return Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.green.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.green.shade200),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle, color: Colors.green.shade600, size: 24),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Stripe Connected',
                              style: TextStyle(fontWeight: FontWeight.bold, color: Colors.green.shade800)),
                            const SizedBox(height: 2),
                            Text('Payments are active', style: TextStyle(color: Colors.green.shade600, fontSize: 12)),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }

              if (shopId != null) {
                return Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.amber.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.amber.shade200),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.link_off, color: Colors.amber.shade700, size: 20),
                          const SizedBox(width: 8),
                          Text('Stripe Not Connected',
                            style: TextStyle(fontWeight: FontWeight.bold, color: Colors.amber.shade800)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: () async {
                            try {
                              final api = ref.read(merchantApiProvider);
                              final result = await api.createStripeOnboarding(shopId);
                              final url = result['url'] as String?;
                              if (url != null && url.isNotEmpty) {
                                // Open URL in browser — use url_launcher or show dialog
                                if (result['alreadyComplete'] == true) {
                                  ref.invalidate(stripeOnboardingProvider);
                                } else {
                                  if (context.mounted) {
                                    _showOnboardingDialog(context, url);
                                  }
                                }
                              }
                            } catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Failed to create link: $e')),
                                );
                              }
                            }
                          },
                          icon: const Icon(Icons.link, size: 18),
                          label: const Text('Link Stripe Account'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.amber.shade600,
                            foregroundColor: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }
              return const SizedBox(height: 0);
            },
          ),

          // Date range indicator
          if (_startDate != null && _endDate != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                '${_startDate!.toIso8601String().split('T')[0]} ~ ${_endDate!.toIso8601String().split('T')[0]}',
                style: TextStyle(color: Colors.grey[500], fontSize: 13),
              ),
            ),

          // ── Balance Card ──
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.indigo.shade600, Colors.indigo.shade400],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: Colors.indigo.withValues(alpha: 0.3),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.account_balance_wallet, color: Colors.white.withValues(alpha: 0.9), size: 28),
                    const SizedBox(width: 8),
                    Text(
                      'Available Balance',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  dashboard.formattedBalance,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 36,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _BalanceInfoChip(
                        label: 'Pending',
                        value: dashboard.formattedPending,
                        color: Colors.amber.shade200,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _BalanceInfoChip(
                        label: 'Total Earned',
                        value: dashboard.formattedTotalEarned,
                        color: Colors.green.shade200,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => MerchantPayoutScreen(shopId: widget.shopId),
                        ),
                      );
                    },
                    icon: const Icon(Icons.download, size: 20),
                    label: const Text('Withdraw Funds'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: Colors.indigo.shade700,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Revenue cards
          Row(
            children: [
              Expanded(
                child: _MetricCard(
                  title: 'Total Revenue',
                  value: dashboard.formattedTotalRevenue,
                  icon: Icons.trending_up,
                  color: Colors.green,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _MetricCard(
                  title: 'Net Revenue',
                  value: dashboard.formattedNetRevenue,
                  icon: Icons.account_balance_wallet,
                  color: Colors.blue,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          Row(
            children: [
              Expanded(
                child: _MetricCard(
                  title: 'Platform Fee',
                  value: dashboard.formattedPlatformFee,
                  icon: Icons.receipt_long,
                  color: Colors.orange,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _MetricCard(
                  title: 'Avg Rating',
                  value: dashboard.avgRating > 0
                      ? '${dashboard.avgRating.toStringAsFixed(1)} \u2605'
                      : '--',
                  icon: Icons.star_half,
                  color: Colors.amber,
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Booking stats
          Text('Booking Statistics', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          _BookingStatRow(
            label: 'Total Bookings',
            value: dashboard.totalBookings.toString(),
            color: Colors.blueGrey,
          ),
          _BookingStatRow(
            label: 'Pending',
            value: dashboard.pendingBookings.toString(),
            color: Colors.orange,
          ),
          _BookingStatRow(
            label: 'Confirmed',
            value: dashboard.confirmedBookings.toString(),
            color: Colors.blue,
          ),
          _BookingStatRow(
            label: 'Completed',
            value: dashboard.completedBookings.toString(),
            color: Colors.green,
          ),
          _BookingStatRow(
            label: 'Cancelled',
            value: dashboard.cancelledBookings.toString(),
            color: Colors.grey,
          ),

          const SizedBox(height: 24),

          // Daily revenue chart
          Text('Daily Revenue', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          if (dashboard.dailyRevenue != null && dashboard.dailyRevenue!.isNotEmpty)
            SizedBox(
              height: 200,
              child: _RevenueChart(dailyRevenue: dashboard.dailyRevenue!),
            )
          else
            Container(
              height: 120,
              decoration: BoxDecoration(
                color: Colors.grey[100],
                borderRadius: BorderRadius.circular(12),
              ),
              child: Center(
                child: Text(
                  'No revenue data for this period',
                  style: TextStyle(color: Colors.grey[500]),
                ),
              ),
            ),
          const SizedBox(height: 32),

          // Recent Transactions
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Recent Transactions', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 12),
          if (dashboard.recentTransactions.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.grey[50],
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.grey.shade200),
              ),
              child: Center(
                child: Text(
                  'No transactions yet',
                  style: TextStyle(color: Colors.grey[500], fontSize: 14),
                ),
              ),
            )
          else
            ...dashboard.recentTransactions.map((tx) => _TransactionRow(transaction: tx)),
          const SizedBox(height: 8),
          Center(
            child: TextButton.icon(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => MerchantTransactionsScreen(shopId: widget.shopId),
                  ),
                );
              },
              icon: const Icon(Icons.receipt_long, size: 18),
              label: const Text('View All Transactions'),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _BalanceInfoChip extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _BalanceInfoChip({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.8),
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

class _TransactionRow extends StatelessWidget {
  final MerchantTransaction transaction;

  const _TransactionRow({required this.transaction});

  @override
  Widget build(BuildContext context) {
    final iconData = transaction.isPayment
        ? Icons.payment
        : transaction.isPayout
            ? Icons.download
            : Icons.refresh;

    final iconColor = transaction.isPayout
        ? Colors.orange
        : transaction.isRefund
            ? Colors.red
            : Colors.green;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(iconData, size: 20, color: iconColor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  transaction.description,
                  style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  transaction.formattedDate,
                  style: TextStyle(color: Colors.grey[500], fontSize: 11),
                ),
              ],
            ),
          ),
          Text(
            transaction.formattedAmount,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 14,
              color: transaction.isCredit ? Colors.green.shade700 : Colors.red.shade700,
            ),
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const _MetricCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 20, color: color),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 4),
            Text(
              title,
              style: TextStyle(color: Colors.grey[500], fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _BookingStatRow extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _BookingStatRow({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Container(
            width: 12, height: 12,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 14))),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        ],
      ),
    );
  }
}

/// Simple bar chart for daily revenue
class _RevenueChart extends StatelessWidget {
  final List<DailyRevenue> dailyRevenue;

  const _RevenueChart({required this.dailyRevenue});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final maxRevenue = dailyRevenue
        .fold<double>(0, (max, d) => d.revenueCents > max ? d.revenueCents : max);

    if (maxRevenue == 0) {
      return Center(
        child: Text('No revenue data', style: TextStyle(color: Colors.grey[500])),
      );
    }

    // Show up to 14 bars
    final data = dailyRevenue.length > 14
        ? dailyRevenue.sublist(dailyRevenue.length - 14)
        : dailyRevenue;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: data.map((d) {
              final ratio = d.revenueCents / maxRevenue;
              final dateStr = d.date;
              final shortDate = dateStr.length >= 10 ? dateStr.substring(5) : dateStr;

              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 1),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      // Revenue label on top
                      if (d.revenueCents > 0)
                        Text(
                          d.formattedRevenue,
                          style: TextStyle(fontSize: 8, color: Colors.grey[600]),
                        ),
                      const SizedBox(height: 2),
                      // Bar
                      Container(
                        height: ratio * 130,
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primary.withValues(alpha: 0.7),
                          borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                        ),
                      ),
                      const SizedBox(height: 4),
                      // Date label
                      Text(
                        shortDate,
                        style: TextStyle(fontSize: 8, color: Colors.grey[500]),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}
