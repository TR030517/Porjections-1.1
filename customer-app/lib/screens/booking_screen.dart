import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/shop.dart';
import '../models/booking.dart';
import '../models/coupon.dart';
import '../models/money.dart';
import '../models/booking_add_on.dart';
import '../models/booking_order_policy.dart';
import '../providers/auth_provider.dart';
import '../providers/booking_provider.dart';
import '../providers/coupon_provider.dart';
import '../services/api_service.dart';
import '../l10n/app_localizations.dart';
import '../widgets/responsive_content.dart';
import '../widgets/customer_access.dart';
import '../widgets/booking_add_ons.dart';
import '../widgets/booking_order_notice.dart';
import '../widgets/booking_contact_fields.dart';
import '../widgets/booking_calendar_picker.dart';
import '../widgets/booking_compact_step_header.dart';
import '../theme/customer_theme.dart';
import 'payment_screen.dart';
import 'booking_detail_screen.dart';
import 'booking_plan_screen.dart';
import 'booking_list_screen.dart';

/// Booking Screen — step-by-step wizard with 4 steps:
/// Service → Therapist → DateTime → Confirm
class BookingScreen extends ConsumerStatefulWidget {
  final ShopDetail shop;
  final ShopService? initialService;
  final String? initialVariantId;

  const BookingScreen({super.key, required this.shop, this.initialService, this.initialVariantId});

  @override
  ConsumerState<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends ConsumerState<BookingScreen> {
  int _currentStep = 0;
  final _contactFields = GlobalKey<BookingContactFieldsState>();
  bool _confirming = false;
  bool _reviewing = false;
  ShopDetail get _shop {
    final shop = ref.read(bookingFlowProvider).shop;
    return shop?.id == widget.shop.id ? shop! : widget.shop;
  }

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      if (mounted && widget.shop.canBookOnline) {
        ref.read(bookingFlowProvider.notifier).initFlow(widget.shop);
        final service = widget.initialService;
        if (service != null) {
          ref.read(bookingFlowProvider.notifier).selectService(service);
          final variants = service.activeVariants.where((variant) => variant.id == widget.initialVariantId);
          if (variants.isNotEmpty) ref.read(bookingFlowProvider.notifier).selectVariant(variants.first);
        }
      }
    });
  }

  void _nextStep() {
    if (_currentStep < 3) {
      setState(() => _currentStep++);
    }
  }

  void _prevStep() {
    if (_currentStep > 0) {
      setState(() => _currentStep--);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final state = ref.watch(bookingFlowProvider);
    final completedBooking = ref.read(bookingFlowProvider.notifier).completedBooking;
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    ref.listen(bookingFlowProvider.select((value) => value.shop), (previous, next) {
      if (previous?.id == next?.id && previous != next && !ref.read(bookingFlowProvider).hasServiceSelection && _currentStep > 0) {
        setState(() => _currentStep = 0);
      }
    });
    if (completedBooking == null && !_shop.canBookOnline &&
        state.pendingAttempt == null && !state.recoveryReminder) {
      return Scaffold(
        appBar: AppBar(title: Text(_shop.name)),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(!_shop.onlineBookingEnabled
                ? l10n.bookingUnavailable
                : 'No online appointments are available at this time.'),
          ),
        ),
      );
    }
    return PopScope(canPop: !state.isCreating && state.pendingAttempt == null, child: Scaffold(
      backgroundColor: CustomerPalette.background,
      appBar: AppBar(
        backgroundColor: CustomerPalette.surface,
        foregroundColor: CustomerPalette.ink,
        surfaceTintColor: Colors.transparent,
        title: Text(_shop.name, overflow: TextOverflow.ellipsis),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: CustomerPalette.border),
        ),
        actions: [
          TextButton.icon(
            onPressed: state.isCreating || state.pendingAttempt != null || state.recoveryReminder
                ? null
                : () {
                    ref
                        .read(bookingFlowProvider.notifier)
                        .initFlow(_shop);
                    setState(() => _currentStep = 0);
                  },
            icon: const Icon(Icons.restart_alt, size: 18),
            label: Text(completedBooking == null
                ? l10n.reset
                : customerText(context, 'Start another booking', '重新开始预约')),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: ResponsiveContent(
        maxWidth: 1180,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 1000;
            final compact = constraints.maxWidth < 600;
            final stepTitle = completedBooking == null
                ? [
                    l10n.selectService,
                    l10n.therapistOptional,
                    l10n.chooseDateTime,
                    'Contact & confirm',
                  ][_currentStep]
                : customerText(context, 'Request submitted', '预约已提交');
            final stepDescription = completedBooking == null
                ? [
                    customerText(context, 'Choose the service that fits your visit.', '选择本次到店需要的服务。'),
                    customerText(context, 'Request a therapist, or leave automatic assignment selected.', '选择提供此服务的技师，也可以不指定。'),
                    customerText(context, 'Choose a date and one available start time.', '先选择日期，再选择一个可约的开始时间。'),
                    customerText(context, 'Check your contact details and review the total before submitting your request.', '提交预约申请前，请核对联系信息和订单总价。'),
                  ][_currentStep]
                : customerText(context, 'This request is saved. Open the order to review its current status.', '预约申请已保存，可打开订单查看当前状态。');
            final panel = Container(
              decoration: BoxDecoration(
                color: CustomerPalette.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: CustomerPalette.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (completedBooking != null)
                    Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            stepTitle,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w600,
                              color: CustomerPalette.ink,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            stepDescription,
                            style: const TextStyle(
                              fontSize: 13,
                              height: 1.5,
                              color: CustomerPalette.muted,
                            ),
                          ),
                        ],
                      ),
                    )
                  else if (compact && keyboardInset == 0) BookingCompactStepHeader(
                    currentStep: _currentStep,
                    totalSteps: 4,
                    title: stepTitle,
                    description: stepDescription,
                  ) else if (!compact) ...[
                  _StepIndicator(
                    currentStep: _currentStep,
                    totalSteps: 4,
                    labels: [
                      l10n.services,
                      l10n.therapists,
                      l10n.dateAndTime,
                      l10n.confirm,
                    ],
                  ),
                  const Divider(height: 1, color: CustomerPalette.border),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          stepTitle,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            color: CustomerPalette.ink,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          stepDescription,
                          style: const TextStyle(
                            fontSize: 13,
                            height: 1.5,
                            color: CustomerPalette.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  ],
                  if (compact) const Divider(height: 1, color: CustomerPalette.border),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 180),
                      transitionBuilder: (child, animation) =>
                          FadeTransition(opacity: animation, child: child),
                      child: KeyedSubtree(
                        key: ValueKey(_currentStep),
                        child: _buildStepContent(
                          _currentStep,
                          state,
                          compact: compact,
                          completedBooking: completedBooking,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
            return Padding(
              padding: EdgeInsets.all(wide ? 24 : 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: panel),
                  if (wide && completedBooking == null) ...[
                    const SizedBox(width: 24),
                    SizedBox(
                      width: 300,
                      child: SingleChildScrollView(
                        child: _BookingSummaryCard(
                          shop: _shop,
                          state: state,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: CustomerPalette.surface,
          border: Border(top: BorderSide(color: CustomerPalette.border)),
        ),
        child: ResponsiveContent(
          maxWidth: 1180,
          child: _buildBottomBar(state, l10n, completedBooking),
        ),
      ),
    ));
  }

  Future<void> _checkRecoveryBookings() async {
    if (await requireCustomerSignIn(context, ref) && mounted) await Navigator.push(context, MaterialPageRoute<void>(builder: (_) => BookingHistoryScreen(recoveryShopId: _shop.id)));
  }
  Future<void> _retryOriginalBooking() async {
    if (!await requireCustomerSignIn(context, ref) || !mounted) return;
    final shop = ref.read(bookingFlowProvider).shop;
    final booking = await ref.read(bookingFlowProvider.notifier).retryOriginalRequest();
    if (booking != null && mounted && shop != null) {
      ref.invalidate(bookingPageProvider);
      Navigator.push(context, MaterialPageRoute<void>(builder: (_) => booking.canOpenCheckout
        ? PaymentScreen(booking: booking, shop: shop) : BookingDetailScreen(bookingId: booking.id, initialBooking: booking)));
    }
  }
  void _openCompletedBooking(Booking booking) {
    ref.invalidate(bookingPageProvider);
    Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => booking.canOpenCheckout
            ? PaymentScreen(booking: booking, shop: _shop)
            : BookingDetailScreen(
                bookingId: booking.id,
                initialBooking: booking,
              ),
      ),
    );
  }

  Widget _recovery(BookingFlowState state, {bool subtleLink = false}) => BookingRecoveryPanel(attempt: state.pendingAttempt, reminder: state.recoveryReminder,
    busy: state.isCreating, error: state.pendingAttempt != null ? state.error : null,
    subtleLink: subtleLink,
    onCheck: () { _checkRecoveryBookings(); }, onRetry: () { _retryOriginalBooking(); },
    onAbandon: () => ref.read(bookingFlowProvider.notifier).abandonRecovery(acknowledged: true));

  Widget _buildStepContent(
    int step,
    BookingFlowState state, {
    required bool compact,
    Booking? completedBooking,
  }) {
    if (completedBooking != null) {
      final orderNumber = completedBooking.bookingNo.trim().isEmpty
          ? completedBooking.id
          : completedBooking.bookingNo;
      final appointmentDate = completedBooking.localDate ?? completedBooking.bookingDate;
      final appointmentTime = completedBooking.localStartTime ?? completedBooking.startTime;
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle_outline, size: 36),
              const SizedBox(height: 12),
              Text(
                "${customerText(context, 'Order', '订单')} $orderNumber",
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              if (appointmentDate.isNotEmpty || appointmentTime.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  [appointmentDate, appointmentTime]
                      .where((value) => value.isNotEmpty)
                      .join(' · '),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: CustomerPalette.muted),
                ),
              ],
            ],
          ),
        ),
      );
    }
    if (state.pendingAttempt != null || state.recoveryReminder) return SingleChildScrollView(padding: const EdgeInsets.all(16), child: _recovery(state));
    if (compact && step == 3) return _normalStepContent(step, state, showRecovery: false);
    if (step == 3) return _normalStepContent(step, state);
    return LayoutBuilder(builder: (context, constraints) => Column(children: [
      Expanded(child: _normalStepContent(step, state)),
      ConstrainedBox(
        constraints: BoxConstraints(maxHeight: constraints.maxHeight / 2),
        child: SingleChildScrollView(child: _recovery(state, subtleLink: true)),
      ),
    ]));
  }

  Widget _normalStepContent(int step, BookingFlowState state, {bool showRecovery = true}) {
    switch (step) {
      case 0:
        return _ServiceGrid(services: _shop.services);
      case 1:
        return _TherapistGrid(therapists: state.eligibleTherapists);
      case 2:
        return _DateTimeSection();
      case 3:
        return _ConfirmationSection(shop: _shop, onReview: _reviewTotal, reviewing: _reviewing, contactKey: _contactFields,
          recovery: showRecovery ? _recovery(state, subtleLink: true) : const SizedBox.shrink());
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildBottomBar(
    BookingFlowState state,
    AppLocalizations l10n,
    Booking? completedBooking,
  ) {
    final canProceed = _canProceed(state);
    final isLastStep = _currentStep == 3;
    final needsQuote = completedBooking == null && isLastStep &&
        state.requiresServerQuote && !state.hasValidPriceQuote;
    final reviewLabel = bookingTotalReviewLabel(context, ref.watch(authProvider));
    final reviewing = needsQuote && (_reviewing || state.isLoadingQuote);
    final canReview = needsQuote && state.hasSelection && state.pendingAttempt == null &&
        !state.recoveryReminder && !state.isCreating && !reviewing;

    final estimate = completedBooking?.formattedTotal ?? _formatSelectedPrice(state);
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    return SafeArea(
      top: false,
      minimum: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 20, vertical: keyboardOpen ? 6 : 14),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 600;
            final price = Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!compact || !keyboardOpen) Text(
                  completedBooking == null
                      ? _selectedPriceLabel(context, state, l10n)
                      : customerText(context, 'Submitted total', '已提交总价'),
                  style: const TextStyle(
                    fontSize: 12,
                    color: CustomerPalette.muted,
                  ),
                ),
                if (!compact || !keyboardOpen) const SizedBox(height: 2),
                Text(
                  estimate,
                  style: TextStyle(
                    fontSize: compact && keyboardOpen ? 14 : 20,
                    fontWeight: FontWeight.w700,
                    color: CustomerPalette.ink,
                  ),
                ),
              ],
            );
            final actions = Row(
              children: [
                if (_currentStep > 0 && completedBooking == null) ...[
                  OutlinedButton(
                    key: const ValueKey('booking-wizard-previous-action'),
                    onPressed: state.pendingAttempt != null || state.isCreating ? null : _prevStep,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(44, 46),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      foregroundColor: CustomerPalette.ink,
                      side: const BorderSide(color: CustomerPalette.border),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: Icon(
                      Icons.arrow_back,
                      size: 20,
                      semanticLabel: MaterialLocalizations.of(
                        context,
                      ).backButtonTooltip,
                    ),
                  ),
                  const SizedBox(width: 10),
                ],
                Expanded(
                  child: FilledButton(
                    key: const ValueKey('booking-wizard-primary-action'),
                    onPressed: (completedBooking == null && !canProceed && !canReview) || state.isCreating || reviewing
                        ? null
                        : () {
                            if (completedBooking != null) {
                              _openCompletedBooking(completedBooking);
                              return;
                            }
                            if (isLastStep) {
                              if (needsQuote) {
                                _reviewTotal();
                              } else {
                                _confirmBooking(state, l10n);
                              }
                            } else {
                              _nextStep();
                            }
                          },
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 46),
                      backgroundColor: CustomerPalette.action,
                      foregroundColor: CustomerPalette.surface,
                      disabledBackgroundColor: CustomerPalette.border,
                      disabledForegroundColor: CustomerPalette.muted,
                      padding: EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: compact && keyboardOpen ? 8 : 12,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: state.isCreating
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            completedBooking != null
                                ? customerText(context, 'View submitted booking', '查看已提交预约')
                                : isLastStep
                                    ? reviewing
                                    ? customerText(context, 'Checking current total…', '正在核对总价…')
                                    : needsQuote
                                    ? reviewLabel
                                    : _buildConfirmButtonLabel(state, l10n)
                                : _buildNextButtonLabel(
                                    _currentStep,
                                    l10n,
                                    canProceed,
                                  ),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                  ),
                ),
              ],
            );
            if (compact) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  price,
                  SizedBox(height: keyboardOpen ? 6 : 10),
                  actions,
                  if (completedBooking == null && isLastStep &&
                      state.pendingAttempt == null && !state.recoveryReminder)
                    Tooltip(
                      message: 'Previous submission unclear? Check my bookings',
                      child: TextButton(
                        key: const ValueKey('booking-wizard-recovery-action'),
                        onPressed: state.isCreating ? null : _checkRecoveryBookings,
                        style: TextButton.styleFrom(
                          foregroundColor: CustomerPalette.muted,
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(0, 44),
                          textStyle: const TextStyle(fontSize: 12),
                        ),
                        child: Text(keyboardOpen ? 'Check my bookings' : 'Previous submission unclear? Check my bookings'),
                      ),
                    ),
                ],
              );
            }
            return Row(
              children: [
                Expanded(child: price),
                SizedBox(width: 400, child: actions),
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _reviewTotal() async {
    final state = ref.read(bookingFlowProvider);
    if (_reviewing || state.isLoadingQuote || state.isCreating || !state.hasSelection ||
        state.pendingAttempt != null || state.recoveryReminder) {
      return;
    }
    setState(() => _reviewing = true);
    try {
      if (await requireCustomerSignIn(context, ref) && mounted) {
        await ref.read(bookingFlowProvider.notifier).refreshPriceQuote();
      }
    } finally {
      if (mounted) setState(() => _reviewing = false);
    }
  }

  bool _canProceed(BookingFlowState state) {
    if (state.pendingAttempt != null || state.recoveryReminder) return false;
    switch (_currentStep) {
      case 0:
        return state.hasServiceSelection;
      case 1:
        return true; // therapist is optional
      case 2:
        return state.hasSelection;
      case 3:
        return state.canConfirm;
      default:
        return false;
    }
  }

  String _buildNextButtonLabel(
    int step,
    AppLocalizations l10n,
    bool canProceed,
  ) {
    if (!canProceed) {
      switch (step) {
        case 0:
          return '${l10n.selectService} →';
        case 2:
          return '${l10n.chooseDateTime} →';
        default:
          return '${l10n.nextStep} →';
      }
    }
    switch (step) {
      case 0:
        return '${l10n.chooseTherapist} →';
      case 1:
        return '${l10n.chooseDateTime} →';
      case 2:
        return 'Contact & confirm →';
      default:
        return '${l10n.nextStep} →';
    }
  }

  String _buildConfirmButtonLabel(
    BookingFlowState state,
    AppLocalizations l10n,
  ) {
    return 'Submit booking request';
  }

  Future<void> _confirmBooking(
    BookingFlowState state,
    AppLocalizations l10n,
  ) async {
    if (_confirming || !state.canConfirm || state.shop?.id != widget.shop.id) return;
    final pageShop = widget.shop;
    final shop = state.shop!;
    final selection = bookingQuoteFingerprint(state.quoteRequest);
    final reviewedQuote = state.priceQuote;
    // Access checks may yield while the contact or verified account email changes.
    final reviewedContact = state.contact;
    final api = ref.read(apiServiceProvider);
    final openingAuth = ref.read(authProvider);
    final openingCustomer = openingAuth.isLoggedIn && openingAuth.user?.role == 'CUSTOMER'
        ? openingAuth.user?.id : null;
    final reviewedEmail = bookingAccountEmail(openingAuth.user);
    final openingSession = api.sessionGeneration;
    String? customerId;
    int? session;
    bool currentAccount() {
      if (!mounted || !identical(widget.shop, pageShop)) return false;
      final auth = ref.read(authProvider);
      return customerId != null && auth.isLoggedIn && !auth.isLoading &&
          auth.user?.role == 'CUSTOMER' && auth.user?.id == customerId &&
          api.sessionGeneration == session;
    }
    bool currentSelection() {
      if (!currentAccount() || _currentStep != 3 || ModalRoute.of(context)?.isCurrent != true) return false;
      final current = ref.read(bookingFlowProvider);
      return identical(current.shop, shop) && current.canConfirm &&
          identical(current.priceQuote, reviewedQuote) &&
          current.contact.name == reviewedContact.name &&
          current.contact.phone == reviewedContact.phone &&
          current.contact.email == reviewedContact.email &&
          bookingAccountEmail(ref.read(authProvider).user) == reviewedEmail &&
          bookingQuoteFingerprint(current.quoteRequest) == selection;
    }
    void reviewChangedSelection() {
      if (!mounted || !currentAccount() || ModalRoute.of(context)?.isCurrent != true) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Your booking details changed. Review the current service, time, contact details, and total before confirming again.'),
      ));
    }
    _confirming = true;
    try {
      if (!await requireCustomerSignIn(context, ref) || !mounted) return;
      customerId = ref.read(authProvider).user?.id;
      session = api.sessionGeneration;
      if (openingCustomer != null && (customerId != openingCustomer || session != openingSession)) return;
      if (!currentSelection()) { reviewChangedSelection(); return; }
      if (!await requireBookingOrderEmail(context, ref, orderOnly: true) || !mounted) return;
      if (!currentSelection()) { reviewChangedSelection(); return; }
      if (_contactFields.currentState?.validate() != true) return;
      final booking = await ref
          .read(bookingFlowProvider.notifier)
          .confirmBooking();
      if (!mounted || !currentAccount() || ModalRoute.of(context)?.isCurrent != true) return;
      if (booking != null) {
        ref.invalidate(bookingPageProvider);
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => booking.canOpenCheckout
                ? PaymentScreen(booking: booking, shop: shop)
                : BookingDetailScreen(
                    bookingId: booking.id,
                    initialBooking: booking,
                  ),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ref.read(bookingFlowProvider).error ?? l10n.bookingFailedRetry),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.red,
          ),
        );
      }
    } catch (_) {
      if (mounted && currentAccount() && ModalRoute.of(context)?.isCurrent == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Unable to verify the booking result. Check your bookings before making another request.',
            ),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      _confirming = false;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Step Indicator
// ═══════════════════════════════════════════════════════════

class _StepIndicator extends StatelessWidget {
  final int currentStep;
  final int totalSteps;
  final List<String> labels;
  const _StepIndicator({
    required this.currentStep,
    required this.totalSteps,
    required this.labels,
  });

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(totalSteps, (index) {
        final active = index == currentStep;
        final done = index < currentStep;
        return Expanded(
          child: Semantics(
            selected: active,
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: 1,
                        color: index == 0
                            ? Colors.transparent
                            : CustomerPalette.border,
                      ),
                    ),
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: active
                            ? CustomerPalette.action
                            : done
                            ? CustomerPalette.tint
                            : CustomerPalette.background,
                        borderRadius: BorderRadius.circular(9),
                        border: Border.all(
                          color: active || done
                              ? CustomerPalette.brand
                              : CustomerPalette.border,
                        ),
                      ),
                      child: Center(
                        child: done
                            ? const Icon(
                                Icons.check,
                                size: 16,
                                color: CustomerPalette.action,
                              )
                            : Text(
                                '${index + 1}',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                  color: active
                                      ? CustomerPalette.surface
                                      : CustomerPalette.muted,
                                ),
                              ),
                      ),
                    ),
                    Expanded(
                      child: Container(
                        height: 1,
                        color: index == totalSteps - 1
                            ? Colors.transparent
                            : CustomerPalette.border,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  labels[index],
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                    color: active
                        ? CustomerPalette.action
                        : CustomerPalette.muted,
                  ),
                ),
              ],
            ),
          ),
        );
      }),
    ),
  );
}

class _BookingSummaryCard extends StatelessWidget {
  final ShopDetail shop;
  final BookingFlowState state;
  const _BookingSummaryCard({required this.shop, required this.state});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final date = state.selectedDate;
    final service = state.selectedService;
    final empty = customerText(context, 'Not selected', '尚未选择');
    final price = _formatSelectedPrice(state);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: CustomerPalette.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: CustomerPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.bookingSummary,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: CustomerPalette.ink,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            shop.name,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              height: 1.5,
              color: CustomerPalette.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            shop.address,
            style: const TextStyle(
              fontSize: 12,
              height: 1.5,
              color: CustomerPalette.muted,
            ),
          ),
          const Divider(height: 32, color: CustomerPalette.border),
          _summaryLine(l10n.services, service?.name ?? empty),
          if (service != null) _summaryLine('Guests and therapists', _servicePeople(service)),
          _summaryLine(l10n.therapists, _therapistSummary(context, state)),
          _summaryLine(
            l10n.selectDate,
            date == null
                ? empty
                : '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}',
          ),
          _summaryLine(
            l10n.availableTime,
            state.selectedStartTime == null
                ? empty
                : state.selectedReservationWindow,
          ),
          if (state.selectedDuration > 0)
            _summaryLine(
              'Reserved appointment block',
              state.selectedDurationLabel,
            ),
          const Divider(height: 24, color: CustomerPalette.border),
          Text(
            _selectedPriceLabel(context, state, l10n),
            style: const TextStyle(fontSize: 12, color: CustomerPalette.muted),
          ),
          const SizedBox(height: 6),
          Text(
            price,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              color: CustomerPalette.ink,
            ),
          ),
          if (shop.orderOnly) ...[
            const SizedBox(height: 10),
            Text(
              l10n.reviewTotalBeforeConfirming,
              style: const TextStyle(
                fontSize: 12,
                height: 1.6,
                color: CustomerPalette.muted,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _summaryLine(String label, String value) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: CustomerPalette.muted),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: CustomerPalette.ink,
          ),
        ),
      ],
    ),
  );
}

// ═══════════════════════════════════════════════════════════
// Step 0: Service Selection — responsive grid
// ═══════════════════════════════════════════════════════════

class _ServiceGrid extends ConsumerStatefulWidget {
  final List<ShopService> services;
  const _ServiceGrid({required this.services});
  @override
  ConsumerState<_ServiceGrid> createState() => _ServiceGridState();
}

class _ServiceGridState extends ConsumerState<_ServiceGrid> {
  final GlobalKey _specifications = GlobalKey();
  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingFlowProvider);
    final l10n = AppLocalizations.of(context)!;
    final selected = state.selectedService;
    if (widget.services.isEmpty) {
      return Center(
        child: Text(
          l10n.noServices,
          style: const TextStyle(color: CustomerPalette.muted),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (state.shop != null && (selected == null || selected.requiredStaffCount == 1) &&
                  widget.services.any(
                    (service) =>
                        service.participantCount == 1 && service.requiredStaffCount == 1 && service.canBook,
                  ))
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: OutlinedButton.icon(
                    onPressed: state.isCreating
                        ? null
                        : () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  BookingPlanScreen(shop: state.shop!),
                            ),
                          ),
                    icon: const Icon(Icons.playlist_add),
                    label: Text(
                      customerText(
                        context,
                        'Multiple people or services',
                        '多人 / 连续项目预约',
                      ),
                    ),
                  ),
                ),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 20),
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: constraints.maxWidth >= 700 ? 3 : constraints.maxWidth >= 420 ? 2 : 1,
                  mainAxisExtent: 260 * (MediaQuery.textScalerOf(context).scale(14) / 14).clamp(1.0, 2.0),
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                ),
                itemCount: widget.services.length,
                itemBuilder: (context, index) {
                  final service = widget.services[index];
                  final picked = selected?.id == service.id;
                  return Semantics(
                    selected: picked,
                    enabled: service.canBook,
                    button: true,
                    child: Material(
                      color: picked
                          ? CustomerPalette.tint
                          : CustomerPalette.surface,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: BorderSide(
                          color: picked
                              ? CustomerPalette.brand
                              : CustomerPalette.border,
                        ),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: !service.canBook
                            ? null
                            : () {
                                if (!picked) {
                                  ref
                                      .read(bookingFlowProvider.notifier)
                                      .selectService(service);
                                }
                                if (service.hasVariants) {
                                  WidgetsBinding.instance.addPostFrameCallback((
                                    _,
                                  ) {
                                    final target =
                                        _specifications.currentContext;
                                    if (mounted && target != null) {
                                      Scrollable.ensureVisible(
                                        target,
                                        duration: const Duration(
                                          milliseconds: 200,
                                        ),
                                        alignment: 0,
                                      );
                                    }
                                  });
                                }
                              },
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Icon(
                                    Icons.spa_outlined,
                                    color: CustomerPalette.action,
                                    size: 24,
                                  ),
                                  const Spacer(),
                                  _SelectionMark(selected: picked),
                                ],
                              ),
                              const SizedBox(height: 10),
                              Text(
                                service.name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  height: 1.4,
                                  color: CustomerPalette.ink,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                service.canBook
                                    ? service.formattedDuration
                                    : customerText(
                                        context,
                                        'No active specification',
                                        '暂无可用规格',
                                      ),
                                maxLines: 2,
                                style: const TextStyle(
                                  fontSize: 12,
                                  height: 1.4,
                                  color: CustomerPalette.muted,
                                ),
                              ),
                              if (service.requiredStaffCount == 2)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Text(
                                    customerText(
                                      context,
                                      '${service.participantCount == 2 ? 'Couple' : 'Four hands'} · ${_servicePeople(service)}',
                                      service.participantCount == 2 ? '情侣按摩 · 两位技师' : '四手按摩 · 两位技师',
                                    ),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 12,
                                      height: 1.4,
                                      color: CustomerPalette.muted,
                                    ),
                                  ),
                                ),
                              const Spacer(),
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  service.formattedPrice,
                                  maxLines: 1,
                                  style: const TextStyle(
                                    fontSize: 18,
                                    height: 1.4,
                                    fontWeight: FontWeight.w700,
                                    color: CustomerPalette.action,
                                  ),
                                ),
                              ),
                              if (service.hasVariants && service.canBook)
                                Text(
                                  customerText(
                                    context,
                                    'Starting service price',
                                    '服务起价',
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    height: 1.4,
                                    color: CustomerPalette.muted,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
              if (selected?.hasVariants == true)
                Container(
                  key: _specifications,
                  margin: const EdgeInsets.only(bottom: 20),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: CustomerPalette.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: CustomerPalette.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        customerText(
                          context,
                          'Choose a specification',
                          '选择服务规格',
                        ),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: CustomerPalette.ink,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        selected!.name,
                        style: const TextStyle(
                          fontSize: 13,
                          color: CustomerPalette.muted,
                        ),
                      ),
                      const SizedBox(height: 14),
                      ...selected.activeVariants.map((variant) {
                        final picked = state.selectedVariant?.id == variant.id;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Semantics(
                            selected: picked,
                            button: true,
                            child: Material(
                              color: picked
                                  ? CustomerPalette.tint
                                  : CustomerPalette.background,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                                side: BorderSide(
                                  color: picked
                                      ? CustomerPalette.brand
                                      : CustomerPalette.border,
                                ),
                              ),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(10),
                                onTap: () => ref
                                    .read(bookingFlowProvider.notifier)
                                    .selectVariant(variant),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Icon(
                                        picked
                                            ? Icons.radio_button_checked
                                            : Icons.radio_button_off,
                                        size: 20,
                                        color: CustomerPalette.action,
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              variant.name,
                                              style: const TextStyle(
                                                fontSize: 14,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                            const SizedBox(height: 5),
                                            Text(
                                              '${selected.reservationLabel(variant.durationMin)} · ${variant.formattedPrice}${variant.priceBasis == 'PER_BOOKING' ? customerText(context, ' per booking', ' / 整单') : customerText(context, ' per person', ' / 位')}',
                                              style: const TextStyle(
                                                fontSize: 13,
                                                height: 1.5,
                                                color: CustomerPalette.muted,
                                              ),
                                            ),
                                            if (selected.requiredStaffCount == 2)
                                              Text(
                                                customerText(
                                                  context,
                                                  'Total visit price: ${formatCents(variant.priceCents * (variant.priceBasis == 'PER_BOOKING' ? 1 : selected.participantCount), variant.currency)}',
                                                  '整次服务价：${formatCents(variant.priceCents * (variant.priceBasis == 'PER_BOOKING' ? 1 : selected.participantCount), variant.currency)}',
                                                ),
                                                style: const TextStyle(
                                                  fontSize: 13,
                                                  height: 1.5,
                                                  color: CustomerPalette.action,
                                                ),
                                              ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
              if (state.hasServiceSelection && selected != null)
                for (var guest = 1; guest <= selected.participantCount; guest++)
                  BookingAddOnPicker(available: selected.addOns, selected: state.addOnIdsFor(guest), guest: guest, segment: 1,
                    disabled: state.isCreating, onChanged: (id, checked) => ref.read(bookingFlowProvider.notifier).toggleAddOn(guest, id, checked)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectionMark extends StatelessWidget {
  final bool selected;
  const _SelectionMark({required this.selected});
  @override
  Widget build(BuildContext context) => AnimatedContainer(
    duration: const Duration(milliseconds: 150),
    width: 20,
    height: 20,
    decoration: BoxDecoration(
      color: selected ? CustomerPalette.action : CustomerPalette.surface,
      borderRadius: BorderRadius.circular(6),
      border: Border.all(
        color: selected ? CustomerPalette.action : CustomerPalette.border,
      ),
    ),
    child: selected
        ? const Icon(Icons.check, size: 14, color: CustomerPalette.surface)
        : null,
  );
}

// ═══════════════════════════════════════════════════════════
// Step 1: Therapist Selection
// ═══════════════════════════════════════════════════════════

class _TherapistGrid extends ConsumerWidget {
  final List<Therapist> therapists;
  const _TherapistGrid({required this.therapists});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bookingFlowProvider);
    final l10n = AppLocalizations.of(context)!;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      children: [
        _buildTherapistCard(
          context,
          name: l10n.noTherapist,
          subtitle: state.selectedService?.requiredStaffCount == 2
              ? customerText(
                  context,
                  'Two qualified therapists will be assigned',
                  '将自动分配两位合资格技师',
                )
              : l10n.assignTherapist,
          icon: Icons.people_outline,
          isSelected: state.selectedTherapist == null,
          onTap: () =>
              ref.read(bookingFlowProvider.notifier).selectTherapist(null),
        ),
        if (therapists.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(
              l10n.noLinkedTherapists,
              style: const TextStyle(
                fontSize: 13,
                color: CustomerPalette.muted,
              ),
            ),
          ),
        if (state.selectedService?.requiredStaffCount == 2)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(
              customerText(
                context,
                'You may request one therapist. A second therapist is assigned automatically; both must be available for the same time.',
                '可选择一位偏好技师，另一位合资格技师自动分配；时段须同时满足两位技师。',
              ),
              style: const TextStyle(
                fontSize: 13,
                height: 1.6,
                color: CustomerPalette.muted,
              ),
            ),
          ),
        ...therapists.map(
          (therapist) => _buildTherapistCard(
            context,
            name: therapist.name,
            subtitle: l10n.yearsExperience(therapist.yearsExp),
            avatarUrl: therapist.avatarUrl,
            isSelected: state.selectedTherapist?.id == therapist.id,
            onTap: () => ref
                .read(bookingFlowProvider.notifier)
                .selectTherapist(therapist),
          ),
        ),
      ],
    );
  }

  Widget _buildTherapistCard(
    BuildContext context, {
    required String name,
    required String subtitle,
    IconData? icon,
    String? avatarUrl,
    required bool isSelected,
    required VoidCallback onTap,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Semantics(
      selected: isSelected,
      button: true,
      child: Material(
        color: isSelected ? CustomerPalette.tint : CustomerPalette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: isSelected ? CustomerPalette.brand : CustomerPalette.border,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 25,
                  backgroundColor: CustomerPalette.tint,
                  backgroundImage: avatarUrl != null
                      ? NetworkImage(avatarUrl)
                      : null,
                  child: avatarUrl == null
                      ? Icon(
                          icon ?? Icons.person_outline,
                          size: 26,
                          color: CustomerPalette.action,
                        )
                      : null,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: CustomerPalette.ink,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.5,
                          color: CustomerPalette.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                _SelectionMark(selected: isSelected),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════
// Step 2: Date & Time Selection
// ═══════════════════════════════════════════════════════════

class _DateTimeSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bookingFlowProvider);
    final l10n = AppLocalizations.of(context)!;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _section(
            l10n.selectDate,
            Icons.calendar_today_outlined,
            _DatePicker(),
          ),
          const SizedBox(height: 16),
          _section(
            l10n.availableTime,
            Icons.schedule_outlined,
            state.selectedDate != null
                ? _TimeSlotsGrouped()
                : Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Text(
                      l10n.selectDateFirst,
                      style: const TextStyle(
                        fontSize: 13,
                        color: CustomerPalette.muted,
                      ),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _section(String title, IconData icon, Widget child) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      border: Border.all(color: CustomerPalette.border),
      borderRadius: BorderRadius.circular(14),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 18, color: CustomerPalette.action),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: CustomerPalette.ink,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        child,
      ],
    ),
  );
}

// ─── Date Picker ─────────────────────────────────────────

class _DatePicker extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state=ref.watch(bookingFlowProvider),shop=ref.watch(bookingFlowProvider).shop;
    if(shop==null)return const SizedBox.shrink();
    return BookingCalendarPicker(shop:shop,selectedDate:state.selectedDate?.toIso8601String().substring(0,10),
      disabled:state.isCreating||state.pendingAttempt!=null,
      onSelected:ref.read(bookingFlowProvider.notifier).selectDate,
      onCalendar:ref.read(bookingFlowProvider.notifier).adoptCalendar,
      onShopRefreshed:ref.read(bookingFlowProvider.notifier).refreshShopDetails,
      onInvalidated:ref.read(bookingFlowProvider.notifier).invalidateCalendarSelection);
  }
}

// ─── Time Slots — Grouped by Period ──────────────────────

class _TimeSlotsGrouped extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bookingFlowProvider);
    final l10n = AppLocalizations.of(context)!;

    if (state.isLoadingSlots) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }

    final slots = state.availableSlots;
    if (slots == null || !slots.any((slot) => slot.available)) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Icon(Icons.info_outline, color: CustomerPalette.muted),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(l10n.noAvailableSlots, style: const TextStyle(fontSize: 13, color: CustomerPalette.muted)),
                  const SizedBox(height: 6),
                  const Text('Please choose another time or date.', style: TextStyle(fontSize: 12, height: 1.5, color: CustomerPalette.muted)),
                ]),
              ),
            ],
          ),
        ),
      );
    }

    // Group slots by period
    final morning = slots.where((s) {
      final h = int.parse(s.time.split(':')[0]);
      return h < 12;
    }).toList();
    final afternoon = slots.where((s) {
      final h = int.parse(s.time.split(':')[0]);
      return h >= 12 && h < 17;
    }).toList();
    final evening = slots.where((s) {
      final h = int.parse(s.time.split(':')[0]);
      return h >= 17;
    }).toList();

    final selectedCount = state.selectedSlots.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Selection summary
        if (selectedCount > 0)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(
              color: CustomerPalette.action.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: CustomerPalette.action.withValues(alpha: 0.2),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.access_time_filled,
                  size: 18,
                  color: CustomerPalette.action,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    state.selectedDurationLabel,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: CustomerPalette.action,
                    ),
                  ),
                ),
                Flexible(child: Text(
                  state.selectedReservationWindow,
                  textAlign: TextAlign.right,
                  style: TextStyle(fontSize: 13, color: CustomerPalette.action),
                )),
              ],
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              l10n.selectTimeBlocks,
              style: TextStyle(fontSize: 13, color: CustomerPalette.muted),
            ),
          ),

        // Period groups
        if (morning.isNotEmpty)
          _buildPeriodGroup(context, ref, 'Morning', morning, state),
        if (afternoon.isNotEmpty)
          _buildPeriodGroup(context, ref, 'Afternoon', afternoon, state),
        if (evening.isNotEmpty)
          _buildPeriodGroup(context, ref, 'Evening', evening, state),
      ],
    );
  }

  Widget _buildPeriodGroup(
    BuildContext context,
    WidgetRef ref,
    String periodLabel,
    List<TimeSlot> periodSlots,
    BookingFlowState state,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 8, left: 4),
            child: Row(
              children: [
                Container(
                  width: 3,
                  height: 14,
                  decoration: BoxDecoration(
                    color: _periodColor(periodLabel),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  switch (periodLabel) {
                    'Morning' => AppLocalizations.of(context)!.morning,
                    'Afternoon' => AppLocalizations.of(context)!.afternoon,
                    'Evening' => AppLocalizations.of(context)!.evening,
                    _ => periodLabel,
                  },
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: CustomerPalette.ink,
                  ),
                ),
              ],
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: periodSlots.map<Widget>((ts) {
              final isBooked = !ts.available;
              final isSelected = state.selectedSlots.contains(ts.time);

              return ChoiceChip(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                showCheckmark: false,
                label: Text(
                  ts.displayTime,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isSelected
                        ? FontWeight.bold
                        : FontWeight.normal,
                    color: isBooked
                        ? CustomerPalette.muted
                        : (isSelected ? Colors.white : null),
                  ),
                ),
                selected: isSelected,
                selectedColor: CustomerPalette.action,
                backgroundColor: CustomerPalette.surface,
                disabledColor: CustomerPalette.background,
                side: BorderSide(
                  color: isBooked
                      ? CustomerPalette.border
                      : (isSelected
                            ? CustomerPalette.action
                            : CustomerPalette.border),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                onSelected: isBooked
                    ? null
                    : (_) {
                        if (!identical(
                          ref.read(bookingFlowProvider).availability,
                          state.availability,
                        )) {
                          return;
                        }
                        ref
                            .read(bookingFlowProvider.notifier)
                            .toggleTimeSlot(ts.time);
                      },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Color _periodColor(String period) => CustomerPalette.brand;
}

// ═══════════════════════════════════════════════════════════
// Step 3: Confirmation Summary
// ═══════════════════════════════════════════════════════════

class _ConfirmationSection extends ConsumerWidget {
  final ShopDetail shop;
  final Future<void> Function() onReview;
  final bool reviewing;
  final GlobalKey<BookingContactFieldsState> contactKey;
  final Widget recovery;
  const _ConfirmationSection({required this.shop, required this.onReview, required this.reviewing, required this.contactKey, required this.recovery});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bookingFlowProvider);
    final l10n = AppLocalizations.of(context)!;
    final timeRange = state.selectedSlots.isNotEmpty
        ? state.selectedReservationWindow
        : '—';
    final totalPrice = _formatSelectedPrice(state);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          BookingContactFields(key: contactKey, contact: state.contact,
            locked: state.isCreating || state.pendingAttempt != null || state.recoveryReminder,
            onChanged: ref.read(bookingFlowProvider.notifier).updateContact),
          if (state.error != null) Padding(padding: const EdgeInsets.only(bottom: 14), child: Text(state.error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CustomerPalette.tint,
              border: Border.all(color: CustomerPalette.border),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.storefront_outlined,
                  size: 24,
                  color: CustomerPalette.action,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        shop.name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: CustomerPalette.ink,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        shop.address,
                        style: const TextStyle(
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
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border.all(color: CustomerPalette.border),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              children: [
                _ConfRow(
                  icon: Icons.spa_outlined,
                  iconColor: CustomerPalette.action,
                  label: l10n.services,
                  value: state.selectedService?.name ?? '—',
                ),
                if (state.selectedService != null) ...[
                  const Divider(height: 28, color: CustomerPalette.border),
                  _ConfRow(icon: Icons.people_outline, iconColor: CustomerPalette.action,
                    label: 'Guests and therapists', value: _servicePeople(state.selectedService!)),
                ],
                const Divider(height: 28, color: CustomerPalette.border),
                _ConfRow(
                  icon: Icons.person_outline,
                  iconColor: CustomerPalette.action,
                  label: l10n.therapistOptional,
                  value: _therapistSummary(context, state),
                ),
                const Divider(height: 28, color: CustomerPalette.border),
                _ConfRow(
                  icon: Icons.calendar_today_outlined,
                  iconColor: CustomerPalette.action,
                  label: l10n.selectDate,
                  value: state.selectedDate != null
                      ? '${state.selectedDate!.year}-${state.selectedDate!.month.toString().padLeft(2, '0')}-${state.selectedDate!.day.toString().padLeft(2, '0')}'
                      : '—',
                ),
                const Divider(height: 28, color: CustomerPalette.border),
                _ConfRow(
                  icon: Icons.schedule_outlined,
                  iconColor: CustomerPalette.action,
                  label: l10n.availableTime,
                  value: timeRange,
                ),
                if (state.selectedDuration > 0) ...[
                  const Divider(height: 28, color: CustomerPalette.border),
                  _ConfRow(
                    icon: Icons.timer_outlined,
                    iconColor: CustomerPalette.action,
                    label: 'Reserved appointment block',
                    value: state.selectedDurationLabel,
                  ),
                ],
                if (state.selectedVariant != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12, left: 48),
                    child: Text(
                      state.selectedVariant!.name,
                      style: const TextStyle(
                        fontSize: 13,
                        color: CustomerPalette.muted,
                      ),
                    ),
                  ),
                if (state.selectedService?.requiredStaffCount == 2)
                  Padding(
                    padding: const EdgeInsets.only(top: 12, left: 48),
                    child: Text(
                      customerText(
                        context,
                        state.selectedService?.participantCount == 1 ? 'Four hands · total visit price' : state.selectedPriceBasis == 'PER_BOOKING' ? 'Couple · total visit price' : 'Two participants · per-person price × 2',
                        state.selectedService?.participantCount == 1 ? '四手按摩 · 整次总价' : state.selectedPriceBasis == 'PER_BOOKING' ? '情侣按摩 · 整次总价' : '两位参与者 · 每位价格 × 2',
                      ),
                      style: const TextStyle(
                        fontSize: 13,
                        color: CustomerPalette.muted,
                      ),
                    ),
                  ),
                const Divider(height: 28, color: CustomerPalette.border),
                _CouponSelectionRow(shop: shop),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: CustomerPalette.background,
              border: Border.all(color: CustomerPalette.border),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _selectedPriceLabel(context, state, l10n),
                  style: const TextStyle(
                    fontSize: 13,
                    color: CustomerPalette.muted,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  totalPrice,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    color: CustomerPalette.ink,
                  ),
                ),
                if (shop.orderOnly) ...[
                  const SizedBox(height: 12),
                  Text(
                    l10n.reviewTotalBeforeConfirming,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.6,
                      color: CustomerPalette.muted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 18),
          _PaymentModeSelection(shop: shop),
          if (state.requiresServerQuote) BookingPriceQuotePanel(orderOnly: shop.orderOnly, quote: state.hasValidPriceQuote ? state.priceQuote : null, loading: reviewing || state.isLoadingQuote || state.isCreating,
            reviewLabel: bookingTotalReviewLabel(context, ref.watch(authProvider)),
            onRefresh: onReview),
          recovery,
        ],
      ),
    );
  }
}

class _PaymentModeSelection extends ConsumerWidget {
  final ShopDetail shop;
  const _PaymentModeSelection({required this.shop});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bookingFlowProvider);
    if (shop.orderOnly) return BookingOrderNotice(busy: state.isCreating);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: CustomerPalette.surface,
        border: Border.all(color: CustomerPalette.border),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            customerText(context, 'Payment arrangement', '付款安排'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          if (shop.payAtStoreEnabled)
            DropdownButtonFormField<String>(
              key: ValueKey(state.paymentMode),
              initialValue: state.paymentMode,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: customerText(
                  context,
                  'Choose an arrangement',
                  '选择付款方式',
                ),
              ),
              items: [
                DropdownMenuItem(
                  value: 'ONLINE',
                  child: Text(customerText(context, 'Online payment', '在线付款')),
                ),
                DropdownMenuItem(
                  value: 'PAY_AT_STORE',
                  child: Text(
                    customerText(context, 'Pay at the store', '到店付款'),
                  ),
                ),
              ],
              onChanged: state.isCreating
                  ? null
                  : (value) {
                      if (value != null) {
                        ref
                            .read(bookingFlowProvider.notifier)
                            .selectPaymentMode(value);
                      }
                    },
            )
          else
            Text(
              customerText(context, 'Online payment', '在线付款'),
              style: const TextStyle(color: CustomerPalette.ink),
            ),
          const SizedBox(height: 10),
          Text(
            customerText(
              context,
              state.paymentMode == 'PAY_AT_STORE'
                  ? 'The shop must accept your request. This is not a payment receipt; check your booking status before visiting.'
                  : 'Review the current total before confirming. Any enabled online checkout is separate from creating the order.',
              state.paymentMode == 'PAY_AT_STORE'
                  ? '提交后需等待门店接受预约。这不是收款凭证，请在到店前确认预约状态。'
                  : '确认预约前请核对当前总价。若开放在线付款，收银流程与创建订单分开进行。',
            ),
            style: const TextStyle(
              fontSize: 13,
              color: CustomerPalette.muted,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            customerText(
              context,
              'If the final amount is zero, the server confirms the booking without collecting money.',
              '若最终应付为零，服务器将直接确认预约，不收取款项。',
            ),
            style: const TextStyle(
              fontSize: 12,
              color: CustomerPalette.muted,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _ConfRow extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;

  const _ConfRow({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: CustomerPalette.tint,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, size: 18, color: iconColor),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: CustomerPalette.muted,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w500,
                fontSize: 14,
                height: 1.5,
                color: CustomerPalette.ink,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

// ═══════════════════════════════════════════════════════════
// Selected specification estimate; final fees and discounts come from the server.
// ═══════════════════════════════════════════════════════════

String _formatSelectedPrice(BookingFlowState state) {
  final quote = state.priceQuote;
  if (state.hasValidPriceQuote && quote != null) {
    return formatCents(quote.totalCents, quote.currency);
  }
  final cents = state.selectedPriceCents;
  final currency = state.selectedCurrency;
  return cents == null || currency == null ? '—' : formatCents(cents, currency);
}

String _selectedPriceLabel(
  BuildContext context,
  BookingFlowState state,
  AppLocalizations l10n,
) => state.hasValidPriceQuote
    ? customerText(context, 'Reviewed total', '已核对总价')
    : l10n.estimatedServicePrice;

String _servicePeople(ShopService service) => '${service.participantCount} ${service.participantCount == 1 ? 'guest' : 'guests'} · ${service.requiredStaffCount} ${service.requiredStaffCount == 1 ? 'therapist' : 'therapists'}';

String _therapistSummary(BuildContext context, BookingFlowState state) {
  if (state.selectedService?.requiredStaffCount != 2) {
    return state.selectedTherapist == null ? 'Automatic assignment' : 'Requested: ${state.selectedTherapist!.name}';
  }
  final preferred = state.selectedTherapist;
  return preferred == null
      ? customerText(
          context,
          'Automatically assign two qualified therapists',
          '自动分配两位合资格技师',
        )
      : customerText(
          context,
          'Requested: ${preferred.name}; second therapist assigned automatically',
          '偏好 ${preferred.name}；另一位技师自动分配',
        );
}

// ═══════════════════════════════════════════════════════════
// Coupon Selection Row + Picker (CPN-004)
// ═══════════════════════════════════════════════════════════

class _CouponSelectionRow extends ConsumerWidget {
  final ShopDetail shop;

  const _CouponSelectionRow({required this.shop});

  int _servicePrice(WidgetRef ref) =>
      ref.read(bookingFlowProvider).selectedPriceCents ?? 0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final flow = ref.watch(bookingFlowProvider);
    final coupon = flow.selectedCoupon;
    final l10n = AppLocalizations.of(context)!;

    return InkWell(
      onTap: () => _showCouponPicker(context, ref, _servicePrice(ref)),
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: CustomerPalette.action.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                Icons.local_activity,
                size: 18,
                color: CustomerPalette.action,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.coupon,
                    style: TextStyle(
                      fontSize: 14,
                      color: CustomerPalette.muted,
                    ),
                  ),
                  if (coupon != null)
                    Text(
                      coupon.coupon.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: CustomerPalette.muted,
                      ),
                    ),
                ],
              ),
            ),
            Text(
              coupon != null
                  ? '-${coupon.coupon.discountLabel(compact: true)}'
                  : l10n.select,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 15,
                color: coupon != null
                    ? CustomerPalette.action
                    : CustomerPalette.muted,
              ),
            ),
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, size: 18, color: CustomerPalette.muted),
          ],
        ),
      ),
    );
  }
}

Future<void> _showCouponPicker(
  BuildContext context,
  WidgetRef ref,
  int priceCents,
) async {
  final flow = ref.read(bookingFlowProvider);
  if (!flow.hasSelection || flow.isCreating || flow.pendingAttempt != null ||
      flow.selectedPriceCents != priceCents) {
    return;
  }
  final selection = bookingQuoteFingerprint(flow.quoteRequest);
  if (!await requireCustomerSignIn(context, ref) || !context.mounted) return;
  final customerId = ref.read(authProvider).user?.id;
  final api = ref.read(apiServiceProvider);
  final session = api.sessionGeneration;
  bool currentSelection() {
    if (!context.mounted) return false;
    final auth = ref.read(authProvider);
    final current = ref.read(bookingFlowProvider);
    return customerId != null && auth.isLoggedIn &&
        auth.user?.role == 'CUSTOMER' && auth.user?.id == customerId &&
        api.sessionGeneration == session && identical(current.shop, flow.shop) &&
        current.hasSelection && !current.isCreating && current.pendingAttempt == null &&
        current.selectedPriceCents == priceCents &&
        bookingQuoteFingerprint(current.quoteRequest) == selection;
  }
  if (!context.mounted || !currentSelection()) return;
  final couponRepository = ref.read(couponRepositoryProvider);
  // Load my unused coupons for this shop
  final wallet = await couponRepository.myCoupons(status: 'UNUSED');
  if (!context.mounted || !currentSelection()) return;

  final applicable = <UserCoupon>[];
  for (final uc in wallet) {
    // only platform coupons or this shop's coupons
    final c = uc.coupon;
    if (c.shopId != null && c.shopId != flow.shop?.id) continue;
    final result = await couponRepository.validateCoupon(
      userCouponId: uc.id,
      shopId: flow.shop!.id,
      priceCents: priceCents,
    );
    if (!context.mounted || !currentSelection()) return;
    if (result['valid'] == true) applicable.add(uc);
  }

  if (!context.mounted || !currentSelection()) return;

  final selected = await showModalBottomSheet<UserCoupon?>(
    context: context,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
    ),
    builder: (sheetContext) {
      final l10n = AppLocalizations.of(sheetContext)!;
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                l10n.selectCoupon,
                style: Theme.of(
                  sheetContext,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
            ),
            if (applicable.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Text(l10n.noApplicableCoupons),
              )
            else
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: applicable.length,
                  itemBuilder: (context, i) {
                    final uc = applicable[i];
                    return ListTile(
                      leading: Icon(
                        Icons.local_activity,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                      title: Text(uc.coupon.title),
                      subtitle: Text(
                        '${uc.coupon.discountLabel(compact: false)} · ${uc.coupon.minSpendLabel(compact: false)}',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.of(sheetContext).pop(uc),
                    );
                  },
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: TextButton(
                onPressed: () => Navigator.of(sheetContext).pop(null),
                child: Text(l10n.cancel),
              ),
            ),
          ],
        ),
      );
    },
  );

  if (selected == null || !currentSelection()) return;
  final notifier = ref.read(bookingFlowProvider.notifier);
  if (selected.id == flow.selectedCoupon?.id) {
    notifier.selectCoupon(null);
  } else {
    notifier.selectCoupon(selected);
  }
}
