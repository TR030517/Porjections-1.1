import 'package:flutter/material.dart';
import '../models/coupon.dart';

/// Coupon card — used in coupon center (claim) and wallet (userStatus)
class CouponCard extends StatelessWidget {
  final Coupon coupon;
  final String? userStatus; // UNUSED | USED | EXPIRED (wallet view)
  final VoidCallback? onClaim;
  final bool selected;
  final VoidCallback? onTap;

  const CouponCard({
    super.key,
    required this.coupon,
    this.userStatus,
    this.onClaim,
    this.selected = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disabled = userStatus == 'USED' ||
        userStatus == 'EXPIRED' ||
        coupon.isExpired ||
        (userStatus == null && !coupon.claimedByMe && coupon.isExhausted);

    final Color accent = disabled ? Colors.grey : theme.colorScheme.primary;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: selected ? accent.withValues(alpha: 0.08) : theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: selected ? accent : theme.colorScheme.outlineVariant,
          width: selected ? 1.6 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              // Value block
              Container(
                width: 92,
                padding: const EdgeInsets.symmetric(vertical: 14),
                decoration: BoxDecoration(
                  color: accent,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  children: [
                    Text(
                      coupon.discountLabel(compact: true),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if (coupon.minSpendLabel(compact: true).isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        'min ${coupon.minSpendLabel(compact: true)}',
                        style: const TextStyle(color: Colors.white70, fontSize: 10),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              // Info block
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      coupon.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                    if (coupon.shop != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        '${coupon.shop!['name'] ?? ''}',
                        style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 12),
                      ),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      coupon.description ?? '',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 12),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        if (coupon.validUntil != null)
                          Text(
                            'Valid until ${coupon.validUntil!.month}/${coupon.validUntil!.day}',
                            style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 11),
                          )
                        else
                          Text(
                            'No expiry',
                            style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 11),
                          ),
                        if (userStatus == null && coupon.totalQuantity > 0) ...[
                          const SizedBox(width: 8),
                          Text(
                            '${coupon.totalQuantity - coupon.claimedCount} left',
                            style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 11),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              // Action
              const SizedBox(width: 8),
              if (onClaim != null)
                OutlinedButton(
                  onPressed: disabled || coupon.claimedByMe ? null : onClaim,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: accent,
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  ),
                  child: Text(coupon.claimedByMe ? 'Claimed' : 'Claim'),
                )
              else if (userStatus != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    userStatus!,
                    style: TextStyle(color: accent, fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
