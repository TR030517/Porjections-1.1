import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/shop.dart';
import '../theme/customer_theme.dart';
import 'shop_hours_clock.dart';

const _days = [
  ('monday', 'Monday'),
  ('tuesday', 'Tuesday'),
  ('wednesday', 'Wednesday'),
  ('thursday', 'Thursday'),
  ('friday', 'Friday'),
  ('saturday', 'Saturday'),
  ('sunday', 'Sunday'),
];
typedef _HoursPeriod = ({int open, int close});

class _HoursDay {
  final bool known;
  final List<_HoursPeriod> periods;
  const _HoursDay(this.known, this.periods);
  String get label => !known ? 'Hours not provided' : periods.isEmpty
      ? 'Closed' : periods.map((period) => '${_clock(period.open)} – ${_clock(period.close)}').join('\n');
}

int? _minutes(dynamic value) {
  if (value is! String || !RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$').hasMatch(value)) return null;
  return int.parse(value.substring(0, 2)) * 60 + int.parse(value.substring(3));
}

_HoursDay _readDay(dynamic value) {
  if (value == null) return const _HoursDay(false, []);
  final entries = value is List ? value : [value];
  // An explicitly saved empty list means no opening intervals that day.
  // Only a missing day or malformed interval means the hours are unknown.
  if (entries.isEmpty) return const _HoursDay(true, []);
  final periods = <_HoursPeriod>[];
  for (final entry in entries) {
    if (entry is! Map || entry['closed'] != null && entry['closed'] is! bool) return const _HoursDay(false, []);
    if (entry['closed'] == true) continue;
    final start = _minutes(entry['open']), end = _minutes(entry['close']);
    // Stored shop hours do not support overnight or zero-length intervals.
    if (start == null || end == null || start >= end) return const _HoursDay(false, []);
    periods.add((open: start, close: end));
  }
  periods.sort((left, right) => left.open.compareTo(right.open));
  final merged = <_HoursPeriod>[];
  for (final period in periods) {
    if (merged.isNotEmpty && period.open < merged.last.close) return const _HoursDay(false, []);
    if (merged.isNotEmpty && period.open == merged.last.close) {
      final previous = merged.removeLast();
      merged.add((open: previous.open, close: period.close));
    } else {
      merged.add(period);
    }
  }
  return _HoursDay(true, merged);
}

/// ISO weekdays with explicit closure entries in the public weekly schedule.
Set<int> explicitlyClosedShopWeekdays(Map<String, dynamic> businessHours) {
  final closed = <int>{};
  for (var index = 0; index < _days.length; index++) {
    final value = businessHours[_days[index].$1];
    // The reservation API accepts at most four periods for one weekday.
    if (value is List && value.length > 4) continue;
    final day = _readDay(value);
    if (day.known && day.periods.isEmpty) closed.add(index + 1);
  }
  return closed;
}

String _clock(int minute) {
  final hour = minute ~/ 60;
  final remainder = minute % 60;
  final display = hour % 12 == 0 ? 12 : hour % 12;
  return '$display${remainder == 0 ? '' : ':${remainder.toString().padLeft(2, '0')}'} ${hour < 12 ? 'AM' : 'PM'}';
}

String _dateKey(DateTime date) => '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

bool _temporarilyClosed(ShopDetail shop, DateTime date) {
  final key = _dateKey(date);
  return shop.bookingSettings.closedPeriods.any((period) => period.startDate.compareTo(key) <= 0 && period.endDate.compareTo(key) >= 0);
}

({bool? open, String detail}) _status(ShopDetail shop, List<_HoursDay> days, DateTime? today, int? minute) {
  if (today == null || minute == null) return (open: null, detail: 'Opening hours');
  final closedToday = _temporarilyClosed(shop, today);
  final current = days[today.weekday - 1];
  if (!closedToday && !current.known) return (open: null, detail: 'Opening hours');
  if (!closedToday) {
    for (final period in current.periods) {
      if (minute >= period.open && minute < period.close) return (open: true, detail: 'Closes at ${_clock(period.close)}');
    }
  }
  // Dates below are UTC containers for shop wall dates, never device instants.
  // Stop at missing hours: a later known day cannot prove the next opening.
  for (var offset = 0; offset <= 370; offset++) {
    final date = today.add(Duration(days: offset));
    if (_temporarilyClosed(shop, date)) continue;
    final day = days[date.weekday - 1];
    if (!day.known) break;
    for (final period in day.periods) {
      if (offset == 0 && period.open <= minute) continue;
      final when = offset == 0 ? 'at' : offset == 1 ? 'tomorrow at'
          : offset < 7 ? '${_days[date.weekday - 1].$2} at'
          : '${DateFormat(date.year == today.year ? 'MMM d' : 'MMM d, yyyy', 'en').format(date)} at';
      return (open: false, detail: 'Opens $when ${_clock(period.open)}');
    }
  }
  return (open: false, detail: closedToday ? 'Temporarily closed' : '');
}

String _zoneLabel(String? timezone, String? formatted) {
  if (formatted != null && formatted.isNotEmpty) return formatted;
  return switch (timezone) {
    'America/Los_Angeles' || 'America/Vancouver' => 'Pacific Time',
    'America/Denver' || 'America/Edmonton' => 'Mountain Time',
    'America/Phoenix' => 'Arizona Time',
    'America/Chicago' || 'America/Winnipeg' => 'Central Time',
    'America/New_York' || 'America/Toronto' => 'Eastern Time',
    'America/Anchorage' => 'Alaska Time',
    'Pacific/Honolulu' => 'Hawaii Time',
    'UTC' || 'Etc/UTC' || 'Etc/GMT' => 'Coordinated Universal Time',
    null || '' => 'Shop time zone not provided',
    _ => timezone.replaceAll('_', ' '),
  };
}

/// Collapsed by default. Booking availability is separate from physical hours.
class ShopOpeningHours extends StatefulWidget {
  final ShopDetail shop;
  const ShopOpeningHours({super.key, required this.shop});
  @override
  State<ShopOpeningHours> createState() => _ShopOpeningHoursState();
}

class _ShopOpeningHoursState extends State<ShopOpeningHours> {
  bool _expanded = false;
  Timer? _timer;

  DateTime? get _serverInstant {
    final calendar = widget.shop.bookingCalendar;
    if (calendar == null || calendar.timezone != widget.shop.timezone) return null;
    // remaining already subtracts a monotonic Stopwatch. Its UTC clock anchor
    // remains usable after the booking calendar's local-date cache expires.
    return calendar.validUntil.subtract(calendar.remaining);
  }

  void _scheduleTick() {
    _timer?.cancel();
    final instant = _serverInstant;
    if (instant == null) return;
    final delay = 60000 - instant.millisecondsSinceEpoch % 60000;
    _timer = Timer(Duration(milliseconds: delay), () {
      if (!mounted) return;
      setState(() {});
      _scheduleTick();
    });
  }

  @override
  void initState() {
    super.initState();
    _scheduleTick();
  }

  @override
  void didUpdateWidget(covariant ShopOpeningHours oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shop.id != widget.shop.id) _expanded = false;
    _scheduleTick();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shop = widget.shop, instant = _serverInstant, zone = widget.shop.timezone;
    final local = instant == null || zone == null || zone.isEmpty ? null : shopHoursLocalClock(instant, zone);
    final days = _days.map((day) => _readDay(shop.businessHours[day.$1])).toList();
    final status = _status(shop, days, local?.date, local?.minute);
    final accent = CustomerPalette.shopAccent(shop.brandColor);
    final title = status.open == null ? status.detail : status.open! ? 'Open' : 'Closed';
    final detail = status.open == null || status.detail.isEmpty ? '' : ' · ${status.detail}';
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Semantics(
        button: true,
        expanded: _expanded,
        label: '${_expanded ? 'Hide' : 'Show'} weekly opening hours',
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(children: [
              Icon(Icons.access_time_outlined, size: 19, color: accent),
              const SizedBox(width: 9),
              Expanded(child: Text.rich(TextSpan(children: [
                TextSpan(text: title, style: TextStyle(fontWeight: FontWeight.w700, color: status.open == true ? accent : CustomerPalette.ink)),
                TextSpan(text: detail),
              ]), style: const TextStyle(fontSize: 14, height: 1.4, color: CustomerPalette.ink))),
              Icon(_expanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down, size: 21, color: CustomerPalette.muted),
            ]),
          ),
        ),
      ),
      if (_expanded) ...[
        const SizedBox(height: 7),
        for (var index = 0; index < _days.length; index++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: DefaultTextStyle(
              style: TextStyle(fontSize: 13, height: 1.55, color: CustomerPalette.ink,
                fontWeight: local?.date.weekday == index + 1 ? FontWeight.w700 : FontWeight.w400),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(flex: 2, child: Text(_days[index].$2)),
                const SizedBox(width: 12),
                Expanded(flex: 3, child: Text(days[index].label, textAlign: TextAlign.right)),
              ]),
            ),
          ),
        const SizedBox(height: 9),
        Text('Time zone · ${_zoneLabel(zone, local?.zoneName)}', style: const TextStyle(fontSize: 12, height: 1.4, color: CustomerPalette.muted)),
        if (shop.bookingSettings.closedPeriods.isNotEmpty)
          const Padding(padding: EdgeInsets.only(top: 5), child: Text('Temporary closure dates override these regular hours.',
            style: TextStyle(fontSize: 12, height: 1.4, color: CustomerPalette.muted))),
      ],
    ]);
  }
}
