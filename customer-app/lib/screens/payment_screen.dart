import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/booking.dart';
import '../models/shop.dart';
import '../models/payment_quote.dart';
import '../widgets/booking_add_ons.dart';
import '../models/square_checkout.dart';
import '../models/booking_order_policy.dart';
import 'booking_detail_screen.dart';
import 'booking_list_screen.dart';
import '../services/payment_checkout_service.dart';
import 'home_screen.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/booking_reschedule_journal.dart';

/// Displays a server quote. Card details and simulated success are never collected.
class PaymentScreen extends ConsumerStatefulWidget {
  final Booking booking;
  final ShopDetail shop;
  const PaymentScreen({super.key, required this.booking, required this.shop});
  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen>
    with WidgetsBindingObserver {
  PaymentQuote? _quote;
  Booking? _bookingSnapshot;
  Map<String, dynamic>? _config;
  String? _error;
  String? _paymentStatus;
  String? _bookingStatus;
  String? _checkoutError;
  SquareCheckout? _checkout;
  Timer? _pollTimer;
  bool _creating = false;
  bool _checking = false;
  bool _opened = false;
  bool _foreground = true;
  int _pollCount = 0;
  bool _loading = true;
  bool _orderOnly = false;
  late final String? _openingAccount;
  late final int _openingEpoch;
  bool get _checkoutAllowed {
    final auth = ref.read(authProvider);
    return mounted && _openingAccount != null && auth.isLoggedIn &&
        auth.user?.role == 'CUSTOMER' && auth.user?.id == _openingAccount &&
        ref.read(apiServiceProvider).sessionGeneration == _openingEpoch &&
        !ref.read(bookingRescheduleJournalProvider).status(_openingAccount, widget.booking.id).blocked;
  }
  @override
  void initState() {
    super.initState();
    final auth = ref.read(authProvider);
    _openingAccount = auth.isLoggedIn && auth.user?.role == 'CUSTOMER' ? auth.user?.id : null;
    _openingEpoch = ref.read(apiServiceProvider).sessionGeneration;
    _orderOnly = !widget.booking.onlinePaymentEnabled || widget.booking.orderOnly || !widget.shop.onlinePaymentEnabled || widget.shop.orderOnly;
    WidgetsBinding.instance.addObserver(this);
    if (_orderOnly) { _loading = false; } else { _load(); }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground && _opened) unawaited(_checkPayment());
  }

  bool get _unpaid =>
      (_paymentStatus ?? widget.booking.paymentStatus) == 'UNPAID' &&
      (_bookingStatus ?? widget.booking.status) == 'PENDING';
  bool get _squareEnabled =>
      !_orderOnly &&
      _config?['enabled'] == true &&
      _config?['provider'] == 'square' &&
      ['sandbox', 'production'].contains(_config?['environment']) &&
      _quote?.paymentEnabled == true &&
      (_config?['currency'] as String?)?.toLowerCase() ==
          _quote?.currency.toLowerCase();

  Future<void> _checkPayment() async {
    if (_orderOnly || _checking || !mounted) return;
    setState(() => _checking = true);
    try {
      final booking = await ref
          .read(paymentCheckoutApiProvider)
          .booking(widget.booking.id);
      if (!mounted) return;
      setState(() {
        _paymentStatus = booking['paymentStatus'] as String?;
        _bookingStatus = booking['status'] as String?;
        _checkoutError = null;
      });
      ref.invalidate(bookingListProvider);
      if (!_unpaid) _pollTimer?.cancel();
    } catch (_) {
      if (mounted) {
        setState(
          () => _checkoutError =
              'Payment status could not be verified. Refresh the appointment to confirm its current status before trying again.',
        );
      }
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _prepareCheckout() async {
    if (!_checkoutAllowed || !_squareEnabled || !_unpaid || _creating) return;
    setState(() {
      _creating = true;
      _checkoutError = null;
    });
    try {
      final data = await ref
          .read(paymentCheckoutApiProvider)
          .create(widget.booking.id);
      final checkout = SquareCheckout.fromJson(
        data,
        _config!['environment'] as String,
      );
      if (!mounted || !_checkoutAllowed) return;
      setState(() => _checkout = checkout);
    } catch (_) {
      if (mounted) {
        setState(
          () => _checkoutError =
              'Unable to prepare secure checkout. Refresh the appointment to confirm its current status before retrying.',
        );
      }
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _openCheckout() async {
    final checkout = _checkout;
    if (!_checkoutAllowed || checkout == null || !_squareEnabled || !_unpaid) return;
    try {
      // A separate user click opens the already prepared URL, avoiding blocked asynchronous popups.
      final opened = await ref.read(checkoutLauncherProvider)(checkout.url);
      if (!mounted) return;
      if (!opened) throw StateError('Checkout did not open');
      setState(() {
        _opened = true;
        _checkoutError = null;
      });
      _pollCount = 0;
      _pollTimer?.cancel();
      _pollTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
        if (_pollCount >= 30 || !_unpaid) {
          timer.cancel();
          return;
        }
        if (_foreground) {
          _pollCount++;
          unawaited(_checkPayment());
        }
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _checkoutError =
              'Square checkout could not be opened. Allow the checkout window, then try again.',
        );
      }
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(paymentCheckoutApiProvider);
      final config = await api.config();
      if (!mounted) return;
      if (!bookingOnlinePaymentEnabled(config)) {
        setState(() { _orderOnly = true; _config = config; });
        return;
      }
      final result = await Future.wait([
        api.quote(widget.booking.id),
        api.booking(widget.booking.id),
      ]);
      if (!mounted) return;
      final quote = PaymentQuote.fromJson(result[0]);
      final rawBooking = result[1];
      final snapshot = rawBooking.containsKey('id') ? Booking.fromJson(rawBooking) : widget.booking;
      if (snapshot.id != widget.booking.id || widget.booking.shopId.isNotEmpty && snapshot.shopId != widget.booking.shopId) throw const FormatException('Booking does not match payment');
      if (widget.booking.addOns.isNotEmpty &&
          (quote.subtotalCents != widget.booking.priceCents || quote.addOns.length != widget.booking.addOns.length ||
            !quote.addOns.every((row) => widget.booking.addOns.any(row.sameAttachment)))) {
        throw const FormatException('Payment add-on snapshot does not match the booking');
      }
      setState(() {
        _config = config;
        _quote = quote;
        _bookingSnapshot = snapshot;
        _orderOnly = !snapshot.onlinePaymentEnabled || snapshot.orderOnly;
        _paymentStatus = rawBooking['paymentStatus'] as String?;
        _bookingStatus = rawBooking['status'] as String?;
      });
      ref.invalidate(bookingListProvider);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Unable to load the payment quote. Refresh the appointment to confirm its current status.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _money(int cents) =>
      '${_quote!.currency.toUpperCase()} ${(cents / 100).toStringAsFixed(2)}';
  Widget _row(String label, String value, {bool bold = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        Flexible(child: Text(
          value,
          textAlign: TextAlign.right,
          style: TextStyle(
            fontWeight: bold ? FontWeight.bold : FontWeight.normal,
          ),
        )),
      ],
    ),
  );
  void _bookings() => Navigator.pushAndRemoveUntil(
    context,
    MaterialPageRoute(builder: (_) => const HomeScreen(initialTab: 1)),
    (_) => false,
  );
  @override
  Widget build(BuildContext context) {
    ref.watch(bookingRescheduleChangesProvider);
    ref.watch(authProvider);
    final checkoutAllowed = _checkoutAllowed;
    if (_orderOnly) {
      return Scaffold(appBar: AppBar(title: const Text('Booking order')), body: Center(child: Padding(
      padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('Online payment is unavailable. The shop handles booking orders offline. Your saved amounts and payment history remain unchanged.', textAlign: TextAlign.center),
        const SizedBox(height: 16),
        FilledButton(onPressed: () => Navigator.pushReplacement(context, MaterialPageRoute<void>(builder: (_) => BookingDetailScreen(bookingId: widget.booking.id, initialBooking: widget.booking))), child: const Text('View booking order')),
      ]),
      )));
    }
    final quote = _quote;
    final snapshot = _bookingSnapshot ?? widget.booking;
    final disabledReason = quote?.reason ?? _config?['reason'] as String?;
    final verifiedPaid = _paymentStatus == 'PAID';
    return Scaffold(
      appBar: AppBar(title: const Text('Appointment payment')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text(
                widget.shop.name,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              const Text(
                'Your appointment has been created. Payment status is confirmed by the server.',
              ),
              const SizedBox(height: 20),
              if (_loading) const Center(child: CircularProgressIndicator()),
              if (_error != null) ...[
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                TextButton(onPressed: _load, child: const Text('Retry')),
              ],
              if (!_loading && quote != null && _error == null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        if (snapshot.durationMin > 0) ...[
                          _row('Reserved appointment block', snapshot.reservationLabel),
                          Text('Reservation window: ${snapshot.formattedTimeRange}'),
                          for (final row in snapshot.items) if (row.durationMin != null) Text('Guest ${row.participantIndex} · Service ${row.sequence}: ${row.reservationLabel}'),
                          const Divider(),
                        ],
                        _row('Main services', _money(quote.mainSubtotalCents ?? quote.subtotalCents)),
                        if (quote.addOns.isNotEmpty) ...[
                          BookingAddOnSummary(addOns: quote.addOns, saved: true),
                          _row('Add-ons', _money(quote.addOnSubtotalCents)),
                        ],
                        _row(
                          'Coupon discount',
                          '-${_money(quote.discountCents)}',
                        ),
                        _row('Platform fee', _money(quote.platformFeeCents)),
                        if (quote.tipCents > 0) _row('Tip', _money(quote.tipCents)),
                        const Divider(),
                        _row(
                          'Amount due',
                          _money(quote.totalCents),
                          bold: true,
                        ),
                        _row(
                          'Payment status',
                          _paymentStatus ?? widget.booking.paymentStatus,
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 20),
              if (!_loading && _error == null)
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Theme.of(
                      context,
                    ).colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    verifiedPaid
                        ? 'Payment verified by the server.'
                        : !_unpaid
                        ? 'This appointment is not available for payment. Its current status is shown above.'
                        : _squareEnabled
                        ? (_opened
                              ? 'After paying in Square, return here. We check the server for confirmation; opening checkout does not mark the appointment as paid.'
                              : 'Prepare checkout, then continue to Square to pay securely. Your card details are entered only on Square.')
                        : disabledReason ??
                              'Online checkout is not available in this application. Your appointment remains pending payment.',
                  ),
                ),
              if (_checkoutError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(
                    _checkoutError!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (_squareEnabled && _config?['environment'] == 'sandbox')
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text('Square sandbox — test payments only.'),
                ),
              const SizedBox(height: 20),
              if (!checkoutAllowed) const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Text('Checkout is paused. Open Booking details to resolve the original time change, or reopen this order with its customer account.')),
              FilledButton(
                onPressed:
                    checkoutAllowed && !_loading &&
                        _error == null &&
                        _squareEnabled &&
                        _unpaid &&
                        !_creating &&
                        !_checking
                    ? (_checkout == null ? _prepareCheckout : _openCheckout)
                    : null,
                child: Text(
                  _creating
                      ? 'Preparing checkout…'
                      : verifiedPaid
                      ? 'Payment verified'
                      : _squareEnabled && _unpaid
                      ? (_checkout == null
                            ? 'Prepare Square checkout'
                            : 'Continue to Square')
                      : 'Online payment unavailable',
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _loading || _creating || _checking
                    ? null
                    : _checkPayment,
                child: Text(
                  _checking
                      ? 'Checking payment status…'
                      : 'Refresh payment status',
                ),
              ),
              TextButton(
                onPressed: _bookings,
                child: const Text('View my appointments'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
