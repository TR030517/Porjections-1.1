import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/file_download.dart';
import '../../providers/merchant_provider.dart';
import '../../models/merchant.dart';
import '../../l10n/app_localizations.dart';

/// Merchant Transactions & Tax Report Screen
/// P2-T04-US-006: Paginated transaction list, date filter, tax report, CSV export
class MerchantTransactionsScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantTransactionsScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantTransactionsScreen> createState() =>
      _MerchantTransactionsScreenState();
}

class _MerchantTransactionsScreenState
    extends ConsumerState<MerchantTransactionsScreen> {
  int _page = 1;
  final int _pageSize = 10;
  DateTime? _startDate;
  DateTime? _endDate;
  int _selectedYear = DateTime.now().year;
  bool _showTaxReport = false;

  Map<String, dynamic> get _queryParams => {
    'page': _page,
    'pageSize': _pageSize,
    if (_startDate != null)
      'startDate':
          '${_startDate!.year}-${_startDate!.month.toString().padLeft(2, '0')}-${_startDate!.day.toString().padLeft(2, '0')}',
    if (_endDate != null)
      'endDate':
          '${_endDate!.year}-${_endDate!.month.toString().padLeft(2, '0')}-${_endDate!.day.toString().padLeft(2, '0')}',
  };

  Future<void> _pickStartDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _startDate ?? now.subtract(const Duration(days: 30)),
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now,
    );
    if (picked != null) {
      setState(() {
        _startDate = picked;
        _page = 1;
      });
    }
  }

  Future<void> _pickEndDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _endDate ?? now,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now,
    );
    if (picked != null) {
      setState(() {
        _endDate = picked;
        _page = 1;
      });
    }
  }

  void _clearDateFilter() {
    setState(() {
      _startDate = null;
      _endDate = null;
      _page = 1;
    });
  }

  void _goToPage(int page) {
    setState(() => _page = page);
  }

  Future<void> _exportCsv() async {
    final api = ref.read(merchantApiProvider);
    try {
      final csv = await api.exportTaxReportCsv(year: _selectedYear);
      downloadCsv('tax-report-$_selectedYear.csv', csv);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to export CSV: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);

    // Watch transactions
    final transactionsAsync = ref.watch(
      merchantTransactionsProvider(_queryParams),
    );

    // Watch tax report when toggled
    final taxReportAsync = _showTaxReport
        ? ref.watch(taxReportProvider(_selectedYear))
        : null;

    return Scaffold(
      appBar: AppBar(
        title: Text(_showTaxReport ? l10n.taxReport : l10n.transactionList),
        actions: [
          IconButton(
            icon: Icon(_showTaxReport ? Icons.receipt_long : Icons.assessment),
            onPressed: () => setState(() => _showTaxReport = !_showTaxReport),
            tooltip: _showTaxReport ? l10n.transactionList : l10n.taxReport,
          ),
        ],
      ),
      body: _showTaxReport
          ? _buildTaxReport(l10n, theme, taxReportAsync)
          : _buildTransactionList(l10n, theme, transactionsAsync),
    );
  }

  /// ── Transaction List View ──
  Widget _buildTransactionList(
    AppLocalizations l10n,
    ThemeData theme,
    AsyncValue<PaginatedTransactions> transactionsAsync,
  ) {
    return Column(
      children: [
        // Date filter bar
        _buildDateFilterBar(l10n, theme),
        // Transaction list
        Expanded(
          child: transactionsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.error_outline, size: 48, color: Colors.grey[400]),
                  const SizedBox(height: 12),
                  Text(l10n.noTransactions),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => ref.invalidate(
                      merchantTransactionsProvider(_queryParams),
                    ),
                    child: Text(l10n.retry),
                  ),
                ],
              ),
            ),
            data: (data) {
              if (data.items.isEmpty) {
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.receipt_long,
                        size: 64,
                        color: Colors.grey[300],
                      ),
                      const SizedBox(height: 16),
                      Text(
                        l10n.noTransactions,
                        style: theme.textTheme.titleMedium,
                      ),
                    ],
                  ),
                );
              }
              return Column(
                children: [
                  Expanded(
                    child: ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      itemCount: data.items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final tx = data.items[index];
                        return _buildTransactionRow(tx, l10n, theme);
                      },
                    ),
                  ),
                  // Pagination
                  if (data.totalPages > 1) _buildPagination(data, l10n),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildDateFilterBar(AppLocalizations l10n, ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(bottom: BorderSide(color: Colors.grey.shade200)),
      ),
      child: Row(
        children: [
          // Start date
          Expanded(
            child: InkWell(
              onTap: _pickStartDate,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.calendar_today,
                      size: 16,
                      color: Colors.grey[600],
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _startDate != null
                          ? '${_startDate!.month}/${_startDate!.day}/${_startDate!.year}'
                          : l10n.startDate,
                      style: TextStyle(
                        fontSize: 13,
                        color: _startDate != null ? null : Colors.grey[500],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text('—', style: TextStyle(color: Colors.grey[500])),
          ),
          // End date
          Expanded(
            child: InkWell(
              onTap: _pickEndDate,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.calendar_today,
                      size: 16,
                      color: Colors.grey[600],
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _endDate != null
                          ? '${_endDate!.month}/${_endDate!.day}/${_endDate!.year}'
                          : l10n.endDate,
                      style: TextStyle(
                        fontSize: 13,
                        color: _endDate != null ? null : Colors.grey[500],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          if (_startDate != null || _endDate != null)
            IconButton(
              icon: const Icon(Icons.clear, size: 18),
              onPressed: _clearDateFilter,
              tooltip: l10n.filterByDate,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            ),
        ],
      ),
    );
  }

  Widget _buildTransactionRow(
    MerchantTransaction tx,
    AppLocalizations l10n,
    ThemeData theme,
  ) {
    final Color typeColor;
    final String typeLabel;
    final IconData typeIcon;

    switch (tx.type) {
      case 'PAYMENT':
        typeColor = Colors.green;
        typeLabel = l10n.transactionPayment;
        typeIcon = Icons.arrow_upward;
        break;
      case 'PAYOUT':
        typeColor = Colors.orange;
        typeLabel = l10n.transactionPayout;
        typeIcon = Icons.arrow_downward;
        break;
      case 'REFUND':
        typeColor = Colors.red;
        typeLabel = l10n.transactionRefund;
        typeIcon = Icons.replay;
        break;
      default:
        typeColor = Colors.grey;
        typeLabel = tx.type;
        typeIcon = Icons.circle;
    }

    final statusColor = tx.status == 'COMPLETED'
        ? Colors.green
        : tx.status == 'PENDING'
        ? Colors.orange
        : Colors.red;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      child: Row(
        children: [
          // Type icon
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: typeColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(typeIcon, color: typeColor, size: 18),
          ),
          const SizedBox(width: 12),
          // Info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  typeLabel,
                  style: const TextStyle(
                    fontWeight: FontWeight.w500,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  tx.formattedDate,
                  style: TextStyle(fontSize: 12, color: Colors.grey[500]),
                ),
                if (tx.description.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      tx.description,
                      style: TextStyle(fontSize: 11, color: Colors.grey[400]),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
          // Amount & status
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                tx.formattedAmount,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                  color: tx.type == 'REFUND'
                      ? Colors.red
                      : Colors.green.shade700,
                ),
              ),
              const SizedBox(height: 2),
              if (tx.fee > 0)
                Text(
                  'Fee: \$${(tx.fee / 100).toStringAsFixed(2)}',
                  style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  tx.status,
                  style: TextStyle(
                    fontSize: 10,
                    color: statusColor,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPagination(PaginatedTransactions data, AppLocalizations l10n) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: Colors.grey.shade200)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: _page > 1 ? () => _goToPage(_page - 1) : null,
          ),
          Text(
            'Page ${data.page} of ${data.totalPages}',
            style: const TextStyle(fontSize: 13),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: _page < data.totalPages
                ? () => _goToPage(_page + 1)
                : null,
          ),
        ],
      ),
    );
  }

  /// ── Tax Report View ──
  Widget _buildTaxReport(
    AppLocalizations l10n,
    ThemeData theme,
    AsyncValue<TaxReport>? taxReportAsync,
  ) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Year selector & export button
          Row(
            children: [
              // Year selector
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<int>(
                    value: _selectedYear,
                    items: List.generate(5, (i) => DateTime.now().year - 4 + i)
                        .map(
                          (y) => DropdownMenuItem(
                            value: y,
                            child: Text(y.toString()),
                          ),
                        )
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _selectedYear = v);
                    },
                    isDense: true,
                  ),
                ),
              ),
              const Spacer(),
              // Export CSV button
              ElevatedButton.icon(
                icon: const Icon(Icons.download, size: 18),
                label: Text(l10n.exportCsv),
                onPressed: _exportCsv,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          // Tax report data
          if (taxReportAsync == null)
            const SizedBox()
          else
            taxReportAsync.when(
              loading: () => const Center(
                child: Padding(
                  padding: EdgeInsets.all(40),
                  child: CircularProgressIndicator(),
                ),
              ),
              error: (err, _) => Center(
                child: Column(
                  children: [
                    Icon(
                      Icons.error_outline,
                      size: 48,
                      color: Colors.grey[400],
                    ),
                    const SizedBox(height: 12),
                    Text('Failed to load tax report'),
                  ],
                ),
              ),
              data: (report) => _buildTaxReportSummary(l10n, theme, report),
            ),
        ],
      ),
    );
  }

  Widget _buildTaxReportSummary(
    AppLocalizations l10n,
    ThemeData theme,
    TaxReport report,
  ) {
    return Column(
      children: [
        _buildSummaryCard(
          icon: Icons.trending_up,
          label: l10n.totalGross,
          value: report.formattedGross,
          color: Colors.blue,
          theme: theme,
        ),
        const SizedBox(height: 10),
        _buildSummaryCard(
          icon: Icons.money_off,
          label: l10n.totalFees,
          value: report.formattedFees,
          color: Colors.orange,
          theme: theme,
        ),
        const SizedBox(height: 10),
        _buildSummaryCard(
          icon: Icons.account_balance_wallet,
          label: l10n.totalNet,
          value: report.formattedNet,
          color: Colors.teal,
          theme: theme,
        ),
        const SizedBox(height: 10),
        _buildSummaryCard(
          icon: Icons.replay,
          label: l10n.totalRefunds,
          value: report.formattedRefunds,
          color: Colors.red,
          theme: theme,
        ),
        const SizedBox(height: 10),
        _buildSummaryCard(
          icon: Icons.arrow_downward,
          label: l10n.totalPayouts,
          value: report.formattedPayouts,
          color: Colors.purple,
          theme: theme,
        ),
        const SizedBox(height: 10),
        _buildSummaryCard(
          icon: Icons.savings,
          label: l10n.netEarnings,
          value: report.formattedEarnings,
          color: Colors.green.shade700,
          theme: theme,
          isHighlight: true,
        ),
      ],
    );
  }

  Widget _buildSummaryCard({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
    required ThemeData theme,
    bool isHighlight = false,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isHighlight ? color.withValues(alpha: 0.08) : theme.cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isHighlight
              ? color.withValues(alpha: 0.3)
              : Colors.grey.shade200,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 14, color: Colors.grey[600]),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: isHighlight ? 22 : 18,
              fontWeight: FontWeight.bold,
              color: isHighlight ? color : null,
            ),
          ),
        ],
      ),
    );
  }
}
