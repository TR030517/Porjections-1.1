import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';
import '../../models/booking.dart';

/// Merchant Bookings Screen — view and manage shop bookings
class MerchantBookingsScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantBookingsScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantBookingsScreen> createState() => _MerchantBookingsScreenState();
}

class _MerchantBookingsScreenState extends ConsumerState<MerchantBookingsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  Map<String, List<Booking>> _bookingsByStatus = {};
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadBookings();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadBookings() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final api = ref.read(merchantApiProvider);
      final statuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];
      final results = <String, List<Booking>>{};

      for (final status in statuses) {
        final rawList = await api.getShopBookings(widget.shopId, status: status);
        results[status] = rawList
            .map((e) => Booking.fromJson(e as Map<String, dynamic>))
            .toList();
      }

      if (mounted) setState(() => _bookingsByStatus = results);
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = e.toString());
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _confirmBooking(String bookingId) async {
    try {
      final api = ref.read(merchantApiProvider);
      await api.confirmBooking(bookingId);
      _loadBookings();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Booking confirmed'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to confirm: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _completeBooking(String bookingId) async {
    try {
      final api = ref.read(merchantApiProvider);
      await api.completeBooking(bookingId);
      _loadBookings();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Booking completed'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to complete: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bookings'),
        bottom: TabBar(
          controller: _tabController,
          labelColor: theme.colorScheme.primary,
          unselectedLabelColor: Colors.grey,
          indicatorColor: theme.colorScheme.primary,
          tabs: const [
            Tab(text: 'Pending'),
            Tab(text: 'Confirmed'),
            Tab(text: 'Completed'),
            Tab(text: 'Cancelled'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
                        const SizedBox(height: 16),
                        Text('Failed to load bookings', style: theme.textTheme.titleMedium),
                        const SizedBox(height: 8),
                        Text(
                          _errorMessage!.length > 120 ? '${_errorMessage!.substring(0, 120)}...' : _errorMessage!,
                          style: TextStyle(color: Colors.grey[600], fontSize: 13),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 20),
                        FilledButton.tonalIcon(
                          onPressed: _loadBookings,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : TabBarView(
              controller: _tabController,
              children: [
                _buildBookingList(context, _bookingsByStatus['PENDING'] ?? [], canConfirm: true),
                _buildBookingList(context, _bookingsByStatus['CONFIRMED'] ?? [], canComplete: true),
                _buildBookingList(context, _bookingsByStatus['COMPLETED'] ?? []),
                _buildBookingList(context, _bookingsByStatus['CANCELLED'] ?? []),
              ],
            ),
    );
  }

  Widget _buildBookingList(
    BuildContext context,
    List<Booking> bookings, {
    bool canConfirm = false,
    bool canComplete = false,
  }) {
    if (bookings.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.event_busy, size: 64, color: Colors.grey[300]),
              const SizedBox(height: 16),
              Text('No bookings', style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadBookings,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: bookings.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          final booking = bookings[i];
          return _BookingCard(
            booking: booking,
            canConfirm: canConfirm,
            canComplete: canComplete,
            onConfirm: () => _confirmBooking(booking.id),
            onComplete: () => _completeBooking(booking.id),
          );
        },
      ),
    );
  }
}

class _BookingCard extends StatelessWidget {
  final Booking booking;
  final bool canConfirm;
  final bool canComplete;
  final VoidCallback onConfirm;
  final VoidCallback onComplete;

  const _BookingCard({
    required this.booking,
    required this.canConfirm,
    required this.canComplete,
    required this.onConfirm,
    required this.onComplete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final statusColors = {
      'PENDING': Colors.orange,
      'CONFIRMED': Colors.blue,
      'COMPLETED': Colors.green,
      'CANCELLED': Colors.grey,
    };

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
            // Header row: booking no + status badge
            Row(
              children: [
                Expanded(
                  child: Text(
                    booking.bookingNo,
                    style: theme.textTheme.labelMedium?.copyWith(color: Colors.grey[500]),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: (statusColors[booking.status] ?? Colors.grey).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    booking.statusLabel,
                    style: TextStyle(
                      color: statusColors[booking.status] ?? Colors.grey,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Customer info
            Row(
              children: [
                const Icon(Icons.person_outline, size: 18, color: Colors.black54),
                const SizedBox(width: 8),
                Text(
                  booking.service?.name ?? 'Unknown Service',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Details
            _infoRow(Icons.calendar_today, '${booking.formattedDate}  ${booking.formattedTimeRange}'),
            if (booking.therapist != null)
              _infoRow(Icons.person, 'Therapist: ${booking.therapist!.name}'),
            _infoRow(Icons.attach_money, booking.formattedPrice),
            if (booking.notes != null && booking.notes!.isNotEmpty)
              _infoRow(Icons.notes, '${booking.notes}'),

            // Action buttons
            if (canConfirm || canComplete) ...[
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (canConfirm)
                    FilledButton.icon(
                      onPressed: onConfirm,
                      icon: const Icon(Icons.check, size: 18),
                      label: const Text('Confirm'),
                    ),
                  if (canComplete)
                    FilledButton.icon(
                      onPressed: onComplete,
                      icon: const Icon(Icons.done_all, size: 18),
                      label: const Text('Complete'),
                      style: FilledButton.styleFrom(backgroundColor: Colors.green),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _infoRow(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 16, color: Colors.grey[500]),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: TextStyle(color: Colors.grey[700], fontSize: 14)),
          ),
        ],
      ),
    );
  }
}
