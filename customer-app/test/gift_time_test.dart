import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/gift_time.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/gift_orders_screen.dart';
import 'package:mjapp_client/screens/gift_wallet_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/business_workflow_service.dart';
import 'package:mjapp_client/services/gift_order_service.dart';
import 'package:mjapp_client/theme/customer_theme.dart';

Map<String, dynamic> orderJson() => {
  'id': '9', 'orderNo': 'SYNTHETIC', 'userId': '3', 'shopId': '7', 'productId': '8',
  'productTitleSnapshot': 'Synthetic benefit', 'amountCents': 2000,
  'paidCents': 2000, 'refundedCents': 0, 'currency': 'usd', 'status': 'PAID',
  'paymentMethod': 'PAY_AT_STORE', 'entitlementId': 'right',
  'createdAt': '2026-11-01T05:30:00Z', 'timezone': 'America/New_York',
  'createdAtLocal': '2026-11-01 01:30 GMT-4',
  'allowedActions': {'cancel': false},
  'receipts': [{
    'amountCents': 2000, 'method': 'CASH', 'reason': 'Recorded at store',
    'createdAt': '2026-11-01T06:30:00Z',
    'createdAtLocal': '2026-11-01 01:30 GMT-5',
  }], 'refunds': [],
};

class _Account extends AuthNotifier {
  _Account() : super(ApiService()) {
    state = AuthState(isLoggedIn: true, user: User(id: '3', role: 'CUSTOMER'));
  }
}
class _Orders extends GiftOrderService {
  _Orders() : super(Dio());
  @override
  Future<GiftPurchaseOrder> order(String id, {CancelToken? cancelToken}) async =>
      GiftPurchaseOrder.fromJson(orderJson());
}
class _Benefits extends BusinessWorkflowService {
  _Benefits() : super(Dio());
  @override
  Future<WorkflowPage> giftRights({int page = 1, CancelToken? cancelToken}) async =>
      WorkflowPage.fromJson({'items': [{
        'id': 'right', 'productTitleSnapshot': 'Synthetic benefit',
        'shop': {'id': '7', 'name': 'Synthetic store', 'timezone': 'America/New_York'},
        'timezone': 'America/New_York', 'status': 'ACTIVE', 'source': 'PURCHASE',
        'remainingUses': 2, 'totalUses': 2, 'expiresAt': '2031-01-01T02:30:00Z',
        'expiresAtLocal': '2030-12-31 21:30 GMT-5',
      }], 'page': 1, 'pageSize': 20, 'total': 1});
  @override
  Future<WorkflowPage> giftHistory(String id, int page, {CancelToken? cancelToken}) async =>
      WorkflowPage.fromJson({'items': [{
        'id': 'usage', 'usedUses': 1, 'createdAt': '2026-11-01T06:30:00Z',
        'timezone': 'America/New_York', 'createdAtLocal': '2026-11-01 01:30 GMT-5',
      }], 'page': 1, 'pageSize': 20, 'total': 1});
}
Widget app(Widget child) => ProviderScope(
  overrides: [
    authProvider.overrideWith((ref) => _Account()),
    giftOrderServiceProvider.overrideWithValue(_Orders()),
    businessWorkflowProvider.overrideWithValue(_Benefits()),
  ],
  child: MaterialApp(locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: buildCustomerTheme(), home: child),
);

void main() {
  test('gift model keeps server store-local projection and never guesses a device zone', () {
    final row = GiftPurchaseOrder.fromJson(orderJson());
    expect(row.createdAt, '2026-11-01T05:30:00Z');
    expect(row.createdAtLabel, '2026-11-01 01:30 GMT-4 (America/New_York)');
    expect(giftShopTimestamp('2026-11-01 01:30 GMT-5', row.timezone),
        '2026-11-01 01:30 GMT-5 (America/New_York)');
    expect(giftShopTimestamp(null, null), 'Shop timezone is not configured.');
    expect(giftShopTimestamp(null, row.timezone), 'Store-local time is unavailable.');
    expect(giftShopTimestamp(row.createdAt, row.timezone), 'Store-local time is unavailable.');
    expect(GiftPurchaseOrder.fromJson({...orderJson(), 'timezone': null}).createdAtLabel,
        'Shop timezone is not configured.');
  });

  testWidgets('gift detail renders creation and receipt with distinct DST offsets', (tester) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(app(const GiftPurchaseDetailScreen(orderId: '9', openingAccount: '3')));
    await tester.pumpAndSettle();
    expect(find.text('Created: 2026-11-01 01:30 GMT-4 (America/New_York)'), findsOneWidget);
    expect(find.text('2026-11-01 01:30 GMT-5 (America/New_York)'), findsOneWidget);
    expect(find.textContaining('05:30 UTC'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('benefit expiry and usage history render store time rather than local device time', (tester) async {
    await tester.pumpWidget(app(const GiftWalletScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Expires · 2030-12-31 21:30 GMT-5 (America/New_York)'), findsOneWidget);
    await tester.pumpWidget(app(const GiftHistoryScreen(id: 'right', openingAccount: '3')));
    await tester.pumpAndSettle();
    expect(find.text('2026-11-01 01:30 GMT-5 (America/New_York)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
