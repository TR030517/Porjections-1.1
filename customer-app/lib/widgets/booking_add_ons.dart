import 'package:flutter/material.dart';
import '../models/booking_add_on.dart';
import '../models/money.dart';
import '../models/service_duration.dart';
import '../theme/customer_theme.dart';

class BookingAddOnPicker extends StatelessWidget {
  final List<ShopServiceAddOn> available;
  final List<String> selected;
  final int guest, segment;
  final bool disabled;
  final void Function(String id, bool selected) onChanged;
  const BookingAddOnPicker({super.key, required this.available, required this.selected, required this.guest,
    required this.segment, required this.onChanged, this.disabled = false});
  @override
  Widget build(BuildContext context) {
    if (available.isEmpty) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(top: 16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Optional add-ons · Guest $guest · Service $segment', style: const TextStyle(fontWeight: FontWeight.w600, color: CustomerPalette.ink)),
      const SizedBox(height: 5),
      const Text('Applies only to this guest and this service. Adds no appointment time. Choose up to 10.', style: TextStyle(fontSize: 12, color: CustomerPalette.muted, height: 1.5)),
      for (final row in available) Material(type: MaterialType.transparency, child: CheckboxListTile(
        key: ValueKey('addon-$guest-$segment-${row.id}'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading,
        value: selected.contains(row.id), title: Text('${row.name} · +${formatCents(row.priceCents, 'usd')}'),
        subtitle: row.description.isEmpty ? null : Text(row.description),
        onChanged: disabled || selected.length >= 10 && !selected.contains(row.id) ? null : (value) => onChanged(row.id, value == true),
      )),
    ]));
  }
}

class BookingAddOnSummary extends StatelessWidget {
  final List<BookingAddOnLine> addOns;
  final bool saved;
  const BookingAddOnSummary({super.key, required this.addOns, this.saved = false});
  @override
  Widget build(BuildContext context) {
    if (addOns.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(saved ? 'Add-ons · saved snapshot' : 'Selected add-ons', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      const SizedBox(height: 6),
      const Text('Attached to the main service. Adds no appointment time.', style: TextStyle(fontSize: 12, color: CustomerPalette.muted, height: 1.5)),
      for (final row in addOns) Padding(padding: const EdgeInsets.only(top: 10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Guest ${row.participantIndex} · Service ${row.sequence}: ${row.name}'),
        Text('${formatCents(row.unitPriceCents, row.currency)} × ${row.quantity} = ${formatCents(row.lineTotalCents, row.currency)}', style: const TextStyle(color: CustomerPalette.muted)),
      ])),
    ]);
  }
}

class BookingPriceQuotePanel extends StatelessWidget {
  final BookingPriceQuote? quote;
  final bool loading;
  final VoidCallback onRefresh;
  final bool orderOnly;
  final String? reviewLabel;
  const BookingPriceQuotePanel({
    super.key,
    required this.quote,
    required this.loading,
    required this.onRefresh,
    this.orderOnly = false,
    this.reviewLabel,
  });
  Widget _amount(String title, int cents) => Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: OverflowBar(
    spacing: 12, overflowSpacing: 4, alignment: MainAxisAlignment.spaceBetween,
    overflowAlignment: OverflowBarAlignment.end,
    children: [Text(title), Text(formatCents(cents, 'usd'))],
  ));
  @override
  Widget build(BuildContext context) {
    final current = quote != null && !quote!.expired ? quote : null;
    return Container(width: double.infinity, margin: const EdgeInsets.only(top: 18), padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: CustomerPalette.tint, border: Border.all(color: CustomerPalette.border), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Current total review', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        if (loading) const LinearProgressIndicator()
        else if (current == null) Text(customerText(
          context,
          'Order total pending review. A current total is required before you can submit.',
          '订单总价待核对。提交前请核对当前总价。',
        ))
        else ...[
          Text(reservedDurationLabel(current.durationKind, current.reservedDurationMin, span: true)),
          for (final row in current.mainDurations) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Guest ${row.participantIndex} · Service ${row.sequence}: ${reservedDurationLabel(row.durationKind, row.reservedDurationMin)}', style: const TextStyle(fontSize: 12))),
          const SizedBox(height: 10), BookingAddOnSummary(addOns: current.addOns), const SizedBox(height: 10),
          _amount('Main services', current.mainSubtotalCents), _amount('Add-ons', current.addOnSubtotalCents),
          _amount('Coupon discount · main services only', -current.discountCents),
          if (!orderOnly) ...[_amount('Platform fee', current.platformFeeCents), _amount('Tip', current.tipCents)], const Divider(),
          _amount('Order total', current.totalCents),
          const Text('Valid for up to five minutes. Confirming accepts this quote; it does not mean payment succeeded.', style: TextStyle(fontSize: 12, color: CustomerPalette.muted, height: 1.5)),
        ],
        const SizedBox(height: 10),
        OutlinedButton(onPressed: loading ? null : onRefresh, child: Text(
          current == null
            ? reviewLabel ?? customerText(context, 'Review current total', '核对当前总价')
            : customerText(context, 'Refresh current total', '刷新当前总价'),
        )),
      ]));
  }
}

class BookingRecoveryPanel extends StatelessWidget {
  final BookingRecoveryAttempt? attempt;
  final bool reminder, busy, subtleLink;
  final String? error;
  final VoidCallback onCheck, onRetry, onAbandon;
  const BookingRecoveryPanel({super.key, required this.attempt, required this.reminder, required this.busy,
    required this.onCheck, required this.onRetry, required this.onAbandon, this.error, this.subtleLink = false});
  @override
  Widget build(BuildContext context) {
    if (attempt == null && !reminder) {
      return Align(alignment: Alignment.centerLeft,
        child: TextButton(onPressed: busy ? null : onCheck,
          style: subtleLink ? TextButton.styleFrom(
            foregroundColor: CustomerPalette.muted,
            textStyle: const TextStyle(fontSize: 12),
          ) : null,
          child: const Text('Previous submission unclear? Check my bookings')));
    }
    return Container(width: double.infinity, padding: const EdgeInsets.all(16), margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(color: CustomerPalette.tint, border: Border.all(color: CustomerPalette.border), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Check the original booking request', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        const SizedBox(height: 10),
        Text(attempt == null
          ? 'A previous submission may already have created an appointment. After a refresh or account change, the original request cannot be retried from this page. Check your bookings using the account that submitted it before starting again.'
          : attempt!.quote != null
          ? 'The result was not confirmed. Your original selection is locked. Retry sends exactly the request and price you already approved. It may finish that original reservation if it is still valid; it does not start a different request or accept a new price.'
          : 'The result was not confirmed. Your original selection is locked. Retry sends the original booking request, not a different appointment. Check the saved booking and its final amount before paying.'),
        if (attempt != null) ...[
          const SizedBox(height: 10),
          if (attempt!.quote != null) Text('Original accepted total: ${formatCents(attempt!.quote!.totalCents, attempt!.quote!.currency)}')
          else Text('Original visit: ${attempt!.originalDate} at ${attempt!.originalStartTime}'),
          Text(reservedDurationLabel(attempt!.durationKind, attempt!.reservedDurationMin, span: true)),
          const SizedBox(height: 6),
          Text(attempt!.quote != null
            ? 'If no booking exists and the original quote has expired, retry stops. It will not obtain a new quote or submit again automatically. Full recovery details stay only while this page remains open.'
            : 'The final amount is the amount saved on the booking. Retry may finish the original request if no appointment exists yet. Full recovery details stay only while this page remains open.',
            style: const TextStyle(fontSize: 12, height: 1.5, color: CustomerPalette.muted)),
        ],
        if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: busy ? null : onCheck, child: const Text('Check my bookings')),
        if (attempt != null) FilledButton(onPressed: busy ? null : onRetry, child: Text(busy ? 'Checking original request…' : 'Retry original request')),
        TextButton(onPressed: busy ? null : () async {
          final stop = await showDialog<bool>(context: context, builder: (dialog) => AlertDialog(
            title: const Text('Stop recovering this request?'),
            content: const Text('This does not cancel an appointment. The original request may already exist or still finish. Check your bookings with the account used to submit it before starting another request. Stopping recovery discards this page’s original request details.'),
            actions: [TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Keep recovery')),
              TextButton(onPressed: () => Navigator.pop(dialog, true), child: const Text('I checked; stop recovery'))]));
          if (stop == true && context.mounted) onAbandon();
        }, child: const Text('Stop recovery after checking')),
      ]));
  }
}
