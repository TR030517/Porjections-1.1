import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';

/// Merchant Coupons Screen — manage shop-scoped coupons (P3-T08 CPN-007)
class MerchantCouponsScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantCouponsScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantCouponsScreen> createState() => _MerchantCouponsScreenState();
}

class _MerchantCouponsScreenState extends ConsumerState<MerchantCouponsScreen> {
  List<Map<String, dynamic>> _coupons = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadCoupons();
  }

  Future<void> _loadCoupons() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final api = ref.read(merchantApiProvider);
      final data = await api.getShopCoupons(widget.shopId);
      if (mounted) setState(() => _coupons = data.cast<Map<String, dynamic>>());
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _showCouponForm({Map<String, dynamic>? existing}) async {
    final titleController = TextEditingController(text: existing?['title'] ?? '');
    final descController = TextEditingController(text: existing?['description'] ?? '');
    final valueController = TextEditingController(
      text: existing != null
          ? (existing['type'] == 'PERCENT'
              ? '${existing['value']}'
              : '${((existing['value'] as num?)?.toDouble() ?? 0) / 100}')
          : '',
    );
    final minSpendController = TextEditingController(
      text: existing != null && (existing['minSpendCents'] as num? ?? 0) > 0
          ? '${(existing['minSpendCents'] as num) / 100}'
          : '',
    );
    final qtyController = TextEditingController(
      text: existing != null && (existing['totalQuantity'] as num? ?? 0) > 0
          ? '${existing['totalQuantity']}'
          : '',
    );
    String type = existing?['type'] ?? 'FIXED_AMOUNT';

    final isEdit = existing != null;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 24, right: 24, top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEdit ? 'Edit Coupon' : 'Create Coupon',
                  style: Theme.of(ctx).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: titleController,
                  decoration: const InputDecoration(labelText: 'Coupon Title *', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: const InputDecoration(labelText: 'Type *', border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(value: 'FIXED_AMOUNT', child: Text('Fixed amount off')),
                    DropdownMenuItem(value: 'PERCENT', child: Text('Percentage off')),
                  ],
                  onChanged: (v) { if (v != null) setSheetState(() => type = v); },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: valueController,
                  decoration: InputDecoration(
                    labelText: type == 'PERCENT' ? 'Discount (%) *' : 'Discount Amount (\$) *',
                    prefixText: type == 'PERCENT' ? '' : '\$ ',
                    border: const OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: minSpendController,
                  decoration: const InputDecoration(
                    labelText: 'Min Spend (\$, 0 = none)',
                    prefixText: '\$ ',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: qtyController,
                  decoration: const InputDecoration(
                    labelText: 'Total Quantity (0 = unlimited)',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descController,
                  decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder()),
                  maxLines: 2,
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: Text(isEdit ? 'Save Changes' : 'Create Coupon'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (saved == true) {
      final valueInput = double.tryParse(valueController.text.trim()) ?? 0;
      final data = <String, dynamic>{
        'title': titleController.text.trim(),
        'type': type,
        // FIXED_AMOUNT: dollars -> cents; PERCENT: pass through
        'value': type == 'PERCENT'
            ? valueInput.toInt()
            : (valueInput * 100).round(),
        'minSpendCents': ((double.tryParse(minSpendController.text.trim()) ?? 0) * 100).round(),
        'totalQuantity': int.tryParse(qtyController.text.trim()) ?? 0,
        'description': descController.text.trim().isEmpty ? null : descController.text.trim(),
      };
      if (type == 'PERCENT' && (data['value'] as int) > 100) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Percent cannot exceed 100'), backgroundColor: Colors.red),
          );
        }
        return;
      }

      try {
        final api = ref.read(merchantApiProvider);
        if (isEdit) {
          await api.updateShopCoupon(widget.shopId, existing['id'].toString(), data);
        } else {
          await api.createShopCoupon(widget.shopId, data);
        }
        _loadCoupons();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(isEdit ? 'Coupon updated' : 'Coupon created'), backgroundColor: Colors.green),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }

    titleController.dispose();
    descController.dispose();
    valueController.dispose();
    minSpendController.dispose();
    qtyController.dispose();
  }

  Future<void> _toggleStatus(Map<String, dynamic> coupon) async {
    final next = coupon['status'] == 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      final api = ref.read(merchantApiProvider);
      await api.updateShopCouponStatus(widget.shopId, coupon['id'].toString(), next);
      _loadCoupons();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Future<void> _deleteCoupon(Map<String, dynamic> coupon) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Coupon'),
        content: const Text('Are you sure you want to delete this coupon? Users who claimed it will no longer be able to use it.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm == true) {
      try {
        final api = ref.read(merchantApiProvider);
        await api.deleteShopCoupon(widget.shopId, coupon['id'].toString());
        _loadCoupons();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to delete: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  String _formatValue(Map<String, dynamic> c) {
    final type = c['type'];
    // FIXED_AMOUNT is stored in cents; PERCENT is a percentage.
    if (type == 'PERCENT') {
      final value = (c['value'] as num?)?.toDouble() ?? 0;
      return '${value.toInt()}% off';
    }
    final cents = (c['value'] as num?)?.toDouble() ?? 0;
    final dollars = cents / 100;
    final text = dollars == dollars.roundToDouble()
        ? dollars.toStringAsFixed(0)
        : dollars.toStringAsFixed(2);
    return '\$$text off';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Coupons')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCouponForm(),
        child: const Icon(Icons.add),
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
                        Text('Failed to load coupons', style: theme.textTheme.titleMedium),
                        const SizedBox(height: 8),
                        Text(
                          _errorMessage!.length > 120 ? '${_errorMessage!.substring(0, 120)}...' : _errorMessage!,
                          style: TextStyle(color: Colors.grey[600], fontSize: 13),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 20),
                        FilledButton.tonalIcon(
                          onPressed: _loadCoupons,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : _coupons.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.local_offer_outlined, size: 64, color: Colors.grey[300]),
                            const SizedBox(height: 16),
                            Text('No coupons yet', style: theme.textTheme.titleMedium),
                            const SizedBox(height: 8),
                            Text('Tap + to create a coupon for your shop', style: TextStyle(color: Colors.grey[500])),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadCoupons,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _coupons.length,
                        separatorBuilder: (_, _) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final c = _coupons[i];
                          final status = c['status'] ?? 'ACTIVE';
                          final isActive = status == 'ACTIVE';
                          final claimed = (c['claimedCount'] as num?)?.toInt() ?? 0;
                          final used = (c['usedCount'] as num?)?.toInt() ?? 0;
                          return ListTile(
                            contentPadding: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
                            title: Row(
                              children: [
                                Expanded(
                                  child: Text(c['title'] ?? '', style: const TextStyle(fontWeight: FontWeight.bold)),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: isActive ? Colors.green.withValues(alpha: 0.1) : Colors.orange.withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(
                                    status,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                      color: isActive ? Colors.green : Colors.orange,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            subtitle: Text(
                              '${_formatValue(c)}'
                              '${(c['minSpendCents'] as num? ?? 0) > 0 ? '  \u00B7  min \$${((c['minSpendCents'] as num) / 100).toStringAsFixed(0)}' : ''}'
                              '\nclaimed $claimed  \u00B7  used $used',
                              style: TextStyle(color: Colors.grey[600]),
                            ),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  icon: Icon(
                                    isActive ? Icons.pause_circle_outline : Icons.play_circle_outline,
                                    size: 22,
                                    color: isActive ? Colors.orange : Colors.green,
                                  ),
                                  tooltip: isActive ? 'Pause' : 'Activate',
                                  onPressed: () => _toggleStatus(c),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.edit_outlined, size: 20),
                                  onPressed: () => _showCouponForm(existing: c),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                                  onPressed: () => _deleteCoupon(c),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
