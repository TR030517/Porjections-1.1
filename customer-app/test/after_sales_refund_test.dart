import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/after_sales_screen.dart';
import 'package:mjapp_client/services/business_workflow_service.dart';

import 'booking_detail_boundary_test.dart' show BoundaryCustomer, bookingJson;

class RefundCases extends BusinessWorkflowService {
  RefundCases(this.items) : super(Dio());

  final List<Map<String, dynamic>> items;

  @override
  Future<WorkflowPage> cases({
    int page = 1,
    String? status,
    CancelToken? cancelToken,
  }) async => WorkflowPage.fromJson({
    'items': items,
    'total': items.length,
    'page': page,
    'pageSize': 20,
  });

  @override
  Future<Map<String, dynamic>> caseDetail(
    String id, {
    CancelToken? cancelToken,
  }) async => items.singleWhere((item) => item['id'] == id);

  @override
  Future<WorkflowPage> caseEvents(
    String id,
    int page, {
    CancelToken? cancelToken,
  }) async => WorkflowPage.fromJson({
    'items': [],
    'total': 0,
    'page': page,
    'pageSize': 30,
  });
}

void main() {
  testWidgets(
    'request form describes refunds only for the selected payment mode',
    (tester) async {
      Future<void> openRequest(String paymentMode, String initialType) =>
          tester.pumpWidget(
            ProviderScope(
              key: ValueKey(paymentMode),
              overrides: [
                authProvider.overrideWith((ref) => BoundaryCustomer()),
              ],
              child: MaterialApp(
                locale: const Locale('en'),
                supportedLocales: AppLocalizations.supportedLocales,
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                home: CreateAfterSalesScreen(
                  booking: Booking.fromJson({
                    ...bookingJson(status: 'COMPLETED', due: 0),
                    'paymentMode': paymentMode,
                    'paymentStatus': 'PAID',
                    'paidCents': 8000,
                  }),
                  initialType: initialType,
                ),
              ),
            ),
          );
      final storeGuidance = find.text(
        'The shop handles approved refunds for payments made in store.',
      );
      final onlineGuidance = find.text(
        'Refunds are returned through the original payment method after review.',
      );

      await openRequest('PAY_AT_STORE', 'OTHER');
      await tester.pumpAndSettle();
      expect(storeGuidance, findsNothing);
      expect(onlineGuidance, findsNothing);

      await tester.tap(find.text('Other question'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Refund request').last);
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        storeGuidance,
        150,
        scrollable: find.byType(Scrollable).first,
      );
      expect(storeGuidance, findsOneWidget);
      expect(onlineGuidance, findsNothing);

      await openRequest('ONLINE', 'REFUND');
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        onlineGuidance,
        150,
        scrollable: find.byType(Scrollable).first,
      );
      expect(onlineGuidance, findsOneWidget);
      expect(storeGuidance, findsNothing);
    },
  );

  testWidgets('shows in-store refund evidence separately from the request', (
    tester,
  ) async {
    final request = <String, dynamic>{
      'type': 'REFUND',
      'reason': 'Synthetic reason',
      'booking': {'shopName': 'Synthetic shop', 'bookingNo': 'TEST-1'},
      'requestedAmountCents': 550,
      'currency': 'usd',
    };
    final service = RefundCases([
      {
        ...request,
        'id': '1',
        'status': 'OPEN',
        'refundMode': 'PAY_AT_STORE',
        'refundState': 'NONE',
        'offlineRefundRecordedCents': null,
      },
      {
        ...request,
        'id': '2',
        'status': 'IN_PROGRESS',
        'refundMode': 'PAY_AT_STORE',
        'refundState': 'SUCCEEDED',
        'offlineRefundRecordedCents': 1250,
      },
      {...request, 'id': '3', 'status': 'RESOLVED', 'refundState': 'SUCCEEDED'},
      {
        ...request,
        'id': '4',
        'status': 'WITHDRAWN',
        'refundMode': 'PAY_AT_STORE',
        'refundState': 'NONE',
        'offlineRefundRecordedCents': null,
        'booking': {
          'shopName': 'Synthetic shop',
          'bookingNo': 'TEST-2',
          'paymentStatus': 'REFUNDED',
          'refundedCents': 1250,
        },
      },
    ]);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authProvider.overrideWith((ref) => BoundaryCustomer()),
          businessWorkflowProvider.overrideWithValue(service),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: AfterSalesScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final unrecorded = find.text('In-store refund request · Open');
    expect(unrecorded, findsOneWidget);
    await tester.tap(unrecorded);
    await tester.pumpAndSettle();
    expect(find.text('Requested refund: USD 5.50'), findsOneWidget);
    expect(find.text('No in-store refund recorded yet'), findsOneWidget);
    expect(find.text('Not submitted to payment provider'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('In-store refund request · In progress'));
    await tester.pumpAndSettle();
    expect(find.text('Requested refund: USD 5.50'), findsOneWidget);
    expect(find.text('Refund recorded by the shop: USD 12.50'), findsOneWidget);
    expect(find.text('Refund succeeded'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Refund request · Resolved'));
    await tester.pumpAndSettle();
    expect(find.text('Refund succeeded'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();

    final withdrawn = find.text('In-store refund request · Withdrawn');
    await tester.scrollUntilVisible(
      withdrawn,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(withdrawn);
    await tester.pumpAndSettle();
    expect(
      find.text(
        'The booking shows a refund. Contact the shop to verify whether it covers this request.',
      ),
      findsOneWidget,
    );
    expect(find.text('No in-store refund recorded yet'), findsNothing);
  });
}
