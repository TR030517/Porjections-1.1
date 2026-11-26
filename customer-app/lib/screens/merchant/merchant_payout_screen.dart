import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';

/// Merchant Payout Screen — withdraw funds to bank account
class MerchantPayoutScreen extends ConsumerStatefulWidget {
  final String shopId;

  const MerchantPayoutScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantPayoutScreen> createState() => _MerchantPayoutScreenState();
}

class _MerchantPayoutScreenState extends ConsumerState<MerchantPayoutScreen> {
  final _amountController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  static const int _minWithdrawalCents = 1000; // $10.00

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  void _showConfirmationDialog(int amountCents) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirm Withdrawal'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'You are about to withdraw \$${(amountCents / 100).toStringAsFixed(2)} to your bank account.',
              style: const TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.amber.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.amber.shade200),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.amber.shade700, size: 20),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'This action cannot be undone. Funds will be transferred to your linked bank account.',
                      style: TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              _processPayout(amountCents);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.indigo,
              foregroundColor: Colors.white,
            ),
            child: const Text('Confirm Withdrawal'),
          ),
        ],
      ),
    );
  }

  Future<void> _processPayout(int amountCents) async {
    final payoutNotifier = ref.read(payoutProvider.notifier);
    final success = await payoutNotifier.requestPayout(amountCents);

    if (!mounted) return;

    if (success) {
      // Invalidate dashboard to refresh balance
      ref.invalidate(merchantDashboardProvider(widget.shopId));

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const Icon(Icons.check_circle, color: Colors.white),
              const SizedBox(width: 8),
              Text('Withdrawal of \$${(amountCents / 100).toStringAsFixed(2)} submitted successfully'),
            ],
          ),
          backgroundColor: Colors.green.shade600,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
      Navigator.of(context).pop();
    } else {
      final state = ref.read(payoutProvider);
      final error = state.error?.toString() ?? 'Withdrawal failed. Please try again.';

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error),
          backgroundColor: Colors.red.shade600,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Watch dashboard for current balance
    final dashboardAsync = ref.watch(merchantDashboardProvider(widget.shopId));
    final payoutState = ref.watch(payoutProvider);

    final int balanceCents = dashboardAsync.when(
      data: (d) => d.balanceCents,
      loading: () => 0,
      error: (_, _) => 0,
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Withdraw Funds'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Current Balance Card
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
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Current Available Balance',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '\$${(balanceCents / 100).toStringAsFixed(2)}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Withdrawal Amount
              Text('Withdrawal Amount', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              TextFormField(
                controller: _amountController,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  prefixText: '\$ ',
                  prefixStyle: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.grey[600],
                  ),
                  hintText: '0.00',
                  hintStyle: TextStyle(color: Colors.grey[400]),
                  filled: true,
                  fillColor: Colors.grey[50],
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: Colors.grey.shade300),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: Colors.grey.shade300),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: Colors.indigo, width: 2),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                ),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter an amount';
                  }
                  final amount = double.tryParse(value);
                  if (amount == null || amount <= 0) {
                    return 'Please enter a valid amount';
                  }
                  final amountCents = (amount * 100).round();
                  if (amountCents < _minWithdrawalCents) {
                    return 'Minimum withdrawal is \$${(_minWithdrawalCents / 100).toStringAsFixed(2)}';
                  }
                  if (amountCents > balanceCents) {
                    return 'Insufficient balance. Available: \$${(balanceCents / 100).toStringAsFixed(2)}';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 8),
              Text(
                'Minimum withdrawal: \$${(_minWithdrawalCents / 100).toStringAsFixed(2)}',
                style: TextStyle(color: Colors.grey[500], fontSize: 12),
              ),
              if (balanceCents > 0)
                TextButton.icon(
                  onPressed: () {
                    _amountController.text = (balanceCents / 100).toStringAsFixed(2);
                  },
                  icon: Icon(Icons.auto_fix_high, size: 16, color: Colors.indigo.shade300),
                  label: Text(
                    'Withdraw full balance (\$${(balanceCents / 100).toStringAsFixed(2)})',
                    style: TextStyle(color: Colors.indigo.shade300, fontSize: 12),
                  ),
                ),
              const SizedBox(height: 32),

              // Withdraw Button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: payoutState.isLoading
                      ? null
                      : () {
                          if (_formKey.currentState?.validate() ?? false) {
                            final amount = double.parse(_amountController.text.trim());
                            final amountCents = (amount * 100).round();
                            _showConfirmationDialog(amountCents);
                          }
                        },
                  icon: payoutState.isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.download, size: 20),
                  label: Text(payoutState.isLoading ? 'Processing...' : 'Withdraw'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.indigo,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: Colors.indigo.shade200,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Info card
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.blue.shade200),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline, color: Colors.blue.shade700, size: 20),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Withdrawal Information',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: Colors.blue.shade800,
                              fontSize: 13,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Funds will be transferred to your linked bank account. '
                            'Processing may take 1-3 business days.',
                            style: TextStyle(color: Colors.blue.shade700, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
