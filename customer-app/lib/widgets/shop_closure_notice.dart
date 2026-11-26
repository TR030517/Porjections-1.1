import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/shop.dart';
import '../models/shop_contacts.dart';
import '../theme/customer_theme.dart';
import 'shop_hours_clock.dart';

class ShopClosureNotice extends StatefulWidget {
  final ShopDetail shop;
  const ShopClosureNotice({super.key, required this.shop});

  @override
  State<ShopClosureNotice> createState() => _ShopClosureNoticeState();
}

class _ShopClosureNoticeState extends State<ShopClosureNotice> {
  Timer? _timer;

  DateTime? get _serverInstant {
    final calendar = widget.shop.bookingCalendar;
    if (calendar == null || calendar.timezone != widget.shop.timezone) {
      return null;
    }
    // Calendar expiry invalidates booking-date choices, not this UTC anchor.
    return calendar.validUntil.subtract(calendar.remaining);
  }

  DateTime? get _shopDate {
    final instant = _serverInstant, zone = widget.shop.timezone;
    if (instant == null || zone == null || zone.isEmpty) return null;
    final local = shopHoursLocalClock(instant, zone);
    if (local != null) return local.date;
    final calendar = widget.shop.bookingCalendar!;
    return calendar.isCurrent ? calendar.today : null;
  }

  void _scheduleTick() {
    _timer?.cancel();
    final instant = _serverInstant;
    if (instant == null || widget.shop.bookingSettings.closedPeriods.isEmpty) {
      return;
    }
    _timer = Timer(
      Duration(milliseconds: 60000 - instant.millisecondsSinceEpoch % 60000),
      () {
        if (!mounted) return;
        setState(() {});
        _scheduleTick();
      },
    );
  }

  @override
  void initState() {
    super.initState();
    _scheduleTick();
  }

  @override
  void didUpdateWidget(covariant ShopClosureNotice oldWidget) {
    super.didUpdateWidget(oldWidget);
    _scheduleTick();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String _range(CustomerClosedPeriod period) {
    final start = DateTime.parse('${period.startDate}T00:00:00Z');
    final end = DateTime.parse('${period.endDate}T00:00:00Z');
    if (period.startDate == period.endDate) {
      return DateFormat('MMM d, yyyy', 'en').format(start);
    }
    if (start.year == end.year) {
      final startText = DateFormat('MMM d', 'en').format(start);
      final endText = start.month == end.month
          ? '${end.day}'
          : DateFormat('MMM d', 'en').format(end);
      return '$startText–$endText, ${end.year}';
    }
    return '${DateFormat('MMM d, yyyy', 'en').format(start)}–${DateFormat('MMM d, yyyy', 'en').format(end)}';
  }

  @override
  Widget build(BuildContext context) {
    final shop = widget.shop, date = _shopDate;
    if (shop.bookingSettings.closedPeriods.isEmpty) {
      return const SizedBox.shrink();
    }
    final today = date == null ? null : DateFormat('yyyy-MM-dd').format(date);
    final periods =
        shop.bookingSettings.closedPeriods
            .where(
              (period) => today == null || period.endDate.compareTo(today) >= 0,
            )
            .toList()
          ..sort((left, right) => left.startDate.compareTo(right.startDate));
    if (periods.isEmpty) return const SizedBox.shrink();
    final title = today == null
        ? 'Scheduled closure'
        : periods.any((period) => period.startDate.compareTo(today) <= 0)
        ? 'Temporarily closed'
        : 'Upcoming closure';
    // Without a reliable shop date, show dated announcements without claiming
    // that a closure is current or future. Never use the visitor's device zone.
    final message = periods
        .map((period) {
          final range =
              '${period.startDate == period.endDate ? 'on' : 'from'} ${_range(period)}';
          if (today == null) return 'The shop is scheduled to be closed $range';
          return period.startDate.compareTo(today) <= 0
              ? 'This shop is temporarily closed $range'
              : 'This shop will be closed $range';
        })
        .join('. ');
    final phone = shop.phone?.trim();
    final uri = phone == null ? null : publicPhoneUri(phone);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF9E8),
        border: Border.all(color: const Color(0xFFEAD89B)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.campaign_outlined,
                size: 19,
                color: Color(0xFF806516),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 14,
                        height: 1.5,
                        fontWeight: FontWeight.w700,
                        color: CustomerPalette.ink,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '$message.',
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.5,
                        fontWeight: FontWeight.w600,
                        color: CustomerPalette.ink,
                      ),
                    ),
                    const SizedBox(height: 3),
                    const Text(
                      'Closure dates follow the shop’s local time. Both dates are included.',
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        color: CustomerPalette.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (phone != null && phone.isNotEmpty) ...[
            const SizedBox(height: 5),
            Padding(
              padding: const EdgeInsets.only(left: 28),
              child: Wrap(
                spacing: 4,
                children: [
                  const Text(
                    'For questions, contact the shop:',
                    style: TextStyle(
                      fontSize: 12,
                      color: CustomerPalette.muted,
                    ),
                  ),
                  if (uri != null)
                    TextButton(
                      style: TextButton.styleFrom(
                        minimumSize: const Size(48, 48),
                        foregroundColor: CustomerPalette.shopAccent(
                          shop.brandColor,
                        ),
                      ),
                      onPressed: () =>
                          launchUrl(uri, mode: LaunchMode.externalApplication),
                      child: Semantics(
                        label: 'Call the shop: $phone',
                        excludeSemantics: true,
                        child: Text(
                          phone,
                          style: const TextStyle(
                            fontSize: 12,
                            decoration: TextDecoration.underline,
                          ),
                        ),
                      ),
                    )
                  else
                    Text(
                      phone,
                      style: const TextStyle(
                        fontSize: 12,
                        color: CustomerPalette.muted,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
