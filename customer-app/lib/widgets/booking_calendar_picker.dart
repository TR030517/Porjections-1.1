import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking_calendar.dart';
import '../models/shop.dart';
import '../providers/shop_provider.dart';
import 'shop_closure_notice.dart';
import 'shop_opening_hours.dart';

const _datePickerRange = Duration(days: 365);

bool _isClosed(
  DateTime date,
  CustomerBookingSettings settings,
  Set<int> closedWeekdays,
) {
  if (closedWeekdays.contains(date.weekday)) return true;
  final stamp = date.toIso8601String().substring(0, 10);
  return settings.closedPeriods.any(
    (period) =>
        stamp.compareTo(period.startDate) >= 0 &&
        stamp.compareTo(period.endDate) <= 0,
  );
}

class BookingCalendarPicker extends ConsumerStatefulWidget {
  final ShopDetail shop;
  final String? selectedDate;
  final bool compact, disabled;
  final ValueChanged<DateTime> onSelected;
  final VoidCallback onInvalidated;
  final ValueChanged<BookingCalendar>? onCalendar;
  final ValueChanged<ShopDetail>? onShopRefreshed;
  const BookingCalendarPicker({
    super.key,
    required this.shop,
    required this.selectedDate,
    required this.onSelected,
    required this.onInvalidated,
    this.onCalendar,
    this.onShopRefreshed,
    this.compact = false,
    this.disabled = false,
  });
  @override
  ConsumerState<BookingCalendarPicker> createState() =>
      _BookingCalendarPickerState();
}

class _BookingCalendarPickerState extends ConsumerState<BookingCalendarPicker> {
  BookingCalendar? _calendar;
  Timer? _expiry;
  int _version = 0;
  int _dateVersion = 0;
  bool _loading = false;
  String? _error;
  late CustomerBookingSettings _settings;
  late Set<int> _closedWeekdays;
  late ShopDetail _displayShop;
  @override
  void initState() {
    super.initState();
    _displayShop = widget.shop;
    _settings = widget.shop.bookingSettings;
    _closedWeekdays = explicitlyClosedShopWeekdays(widget.shop.businessHours);
    _adopt(widget.shop.bookingCalendar);
  }

  @override
  void didUpdateWidget(BookingCalendarPicker old) {
    super.didUpdateWidget(old);
    if (old.shop.id != widget.shop.id ||
        old.shop.timezone != widget.shop.timezone) {
      _version++;
      _dateVersion++;
      _loading = false;
      _error = null;
      _displayShop = widget.shop;
      _settings = widget.shop.bookingSettings;
      _closedWeekdays = explicitlyClosedShopWeekdays(widget.shop.businessHours);
      _adopt(widget.shop.bookingCalendar);
    } else if (old.shop != widget.shop) {
      final closedWeekdays = explicitlyClosedShopWeekdays(
        widget.shop.businessHours,
      );
      if (old.shop.bookingCalendar != widget.shop.bookingCalendar ||
          !setEquals(_closedWeekdays, closedWeekdays) ||
          !_sameDateRules(
            old.shop.bookingSettings,
            widget.shop.bookingSettings,
          )) {
        _dateVersion++;
      }
      _displayShop = widget.shop;
      _settings = widget.shop.bookingSettings;
      _closedWeekdays = closedWeekdays;
      if (old.shop.bookingCalendar != widget.shop.bookingCalendar) {
        _adopt(widget.shop.bookingCalendar);
      }
    }
  }

  bool _sameDateRules(
    CustomerBookingSettings first,
    CustomerBookingSettings next,
  ) {
    if (first.minimumNoticeMinutes != next.minimumNoticeMinutes ||
        first.closedPeriods.length != next.closedPeriods.length) {
      return false;
    }
    for (var index = 0; index < first.closedPeriods.length; index++) {
      final before = first.closedPeriods[index],
          after = next.closedPeriods[index];
      if (before.startDate != after.startDate ||
          before.endDate != after.endDate) {
        return false;
      }
    }
    return true;
  }

  DateTime? _firstOpenDate(BookingCalendar calendar) {
    final lastDate = calendar.today.add(_datePickerRange);
    for (
      var date = calendar.today;
      !date.isAfter(lastDate);
      date = date.add(const Duration(days: 1))
    ) {
      if (!_isClosed(date, _settings, _closedWeekdays)) return date;
    }
    return null;
  }

  void _selectDate(BookingCalendar calendar, DateTime date, int version) {
    if (!mounted ||
        widget.disabled ||
        version != _dateVersion ||
        !identical(calendar, _calendar)) {
      return;
    }
    if (!calendar.isCurrent) {
      widget.onInvalidated();
      return;
    }
    final day = DateTime.utc(date.year, date.month, date.day);
    if (day.isBefore(calendar.today) ||
        day.isAfter(calendar.today.add(_datePickerRange)) ||
        _isClosed(day, _settings, _closedWeekdays)) {
      return;
    }
    widget.onSelected(day);
  }

  void _adopt(BookingCalendar? calendar) {
    _expiry?.cancel();
    _calendar = calendar;
    if (calendar?.isCurrent == true) {
      _expiry = Timer(calendar!.remaining, () {
        if (!mounted) return;
        setState(() => _calendar = null);
        widget.onInvalidated();
      });
    }
  }

  @override
  void dispose() {
    _version++;
    _expiry?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_loading || widget.disabled) return;
    _dateVersion++;
    final version = ++_version,
        shopId = widget.shop.id,
        zone = widget.shop.timezone;
    widget.onInvalidated();
    setState(() {
      _loading = true;
      _error = null;
      _adopt(null);
    });
    try {
      final shop = await ref.read(shopRepositoryProvider).getShopDetail(shopId);
      if (!mounted || version != _version || widget.shop.id != shopId) return;
      if (shop.id != shopId ||
          shop.timezone != zone ||
          shop.bookingCalendar?.isCurrent != true) {
        throw const FormatException('Calendar unavailable');
      }
      setState(() {
        _displayShop = shop;
        _settings = shop.bookingSettings;
        _closedWeekdays = explicitlyClosedShopWeekdays(shop.businessHours);
        _adopt(shop.bookingCalendar);
      });
      widget.onShopRefreshed?.call(shop);
      widget.onCalendar?.call(shop.bookingCalendar!);
    } catch (_) {
      if (mounted && version == _version) {
        setState(
          () => _error =
              'The shop calendar is unavailable. Refresh it or contact the shop.',
        );
      }
    } finally {
      if (mounted && version == _version) setState(() => _loading = false);
    }
  }

  Future<void> _choose() async {
    final calendar = _calendar;
    if (calendar?.isCurrent != true || widget.disabled) return;
    final version = _dateVersion,
        day = calendar!.today,
        selected = DateTime.tryParse('${widget.selectedDate ?? ''}T00:00:00Z');
    final lastDate = day.add(_datePickerRange);
    final firstOpen = _firstOpenDate(calendar);
    if (firstOpen == null) return;
    // Keep the dialog's displayed rules stable until it closes. Selection is
    // checked against the current rules and version when the dialog returns.
    final settings = _settings, closedWeekdays = _closedWeekdays;
    bool selectable(DateTime date) =>
        !_isClosed(date, settings, closedWeekdays);
    final initial =
        selected != null &&
            !selected.isBefore(day) &&
            !selected.isAfter(lastDate) &&
            selectable(selected)
        ? selected
        : firstOpen;
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      currentDate: day,
      firstDate: day,
      lastDate: lastDate,
      selectableDayPredicate: selectable,
      helpText: 'Choose a date · ${calendar.timezone}',
    );
    if (date != null) _selectDate(calendar, date, version);
  }

  List<Widget> _scheduleNotices() => [
    ShopClosureNotice(shop: _displayShop),
    if (_settings.minimumNoticeMinutes > 0)
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(
          'Book at least ${_noticeDuration(_settings.minimumNoticeMinutes)} in advance. Available times follow the shop’s time zone.',
          style: const TextStyle(fontSize: 13, height: 1.5),
        ),
      ),
  ];

  String _noticeDuration(int totalMinutes) {
    final hours = totalMinutes ~/ 60, minutes = totalMinutes % 60;
    return [
      if (hours > 0) '$hours ${hours == 1 ? 'hour' : 'hours'}',
      if (minutes > 0) '$minutes ${minutes == 1 ? 'minute' : 'minutes'}',
    ].join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final calendar = _calendar;
    if (calendar?.isCurrent != true) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ..._scheduleNotices(),
          Text(
            _error ??
                'Shop-local dates are unavailable. Refresh the shop calendar before choosing a date.',
          ),
          TextButton(
            onPressed: _loading || widget.disabled ? null : _refresh,
            child: Text(
              _loading ? 'Loading shop calendar…' : 'Refresh shop calendar',
            ),
          ),
        ],
      );
    }
    final current = calendar!;
    final dateVersion = _dateVersion;
    final hasOpenDates = _firstOpenDate(current) != null;
    final selected = DateTime.tryParse(
      '${widget.selectedDate ?? ''}T00:00:00Z',
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ..._scheduleNotices(),
        Text('Shop-local date · ${current.timezone}'),
        const SizedBox(height: 8),
        if (!hasOpenDates)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text(
              'The shop is closed on every date shown, based on its weekly schedule and temporary closure dates. Refresh the shop calendar to check for changes.',
            ),
          ),
        if (widget.compact)
          OutlinedButton.icon(
            onPressed: widget.disabled || !hasOpenDates ? null : _choose,
            icon: const Icon(Icons.calendar_today_outlined),
            label: Text(
              selected == null ||
                      _isClosed(selected, _settings, _closedWeekdays)
                  ? 'Choose date'
                  : widget.selectedDate!,
            ),
          )
        else
          SizedBox(
            // Date and Today/Closed are two lines; retain room for both at the
            // user's text size instead of clipping the second line.
            height:
                100 *
                (MediaQuery.textScalerOf(context).scale(14) / 14).clamp(
                  1.0,
                  double.infinity,
                ),
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: 14,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final date = current.today.add(Duration(days: index)),
                    stamp = date.toIso8601String().substring(0, 10);
                final closed = _isClosed(date, _settings, _closedWeekdays);
                return Semantics(
                  label: closed ? '$stamp · Closed' : stamp,
                  selected: widget.selectedDate == stamp,
                  enabled: !widget.disabled && !closed,
                  child: OutlinedButton(
                    onPressed: widget.disabled || closed
                        ? null
                        : () => _selectDate(current, date, dateVersion),
                    style: OutlinedButton.styleFrom(
                      backgroundColor: widget.selectedDate == stamp
                          ? Theme.of(context).colorScheme.primaryContainer
                          : null,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('${date.month}/${date.day}'),
                        if (closed)
                          const Text('Closed')
                        else if (index == 0)
                          const Text('Today'),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        if (!widget.compact)
          OutlinedButton.icon(
            onPressed: widget.disabled || !hasOpenDates ? null : _choose,
            icon: const Icon(Icons.calendar_month_outlined),
            label: const Text('Choose another date'),
          ),
        TextButton(
          onPressed: _loading || widget.disabled ? null : _refresh,
          child: const Text('Refresh shop calendar'),
        ),
      ],
    );
  }
}
