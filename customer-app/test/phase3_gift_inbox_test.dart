import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/l10n/app_localizations.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/screens/gift_orders_screen.dart';
import 'package:mjapp_client/screens/notification_inbox_screen.dart';
import 'package:mjapp_client/services/api_service.dart';
import 'package:mjapp_client/services/gift_order_service.dart';
import 'package:mjapp_client/services/notification_inbox_service.dart';
import 'package:mjapp_client/theme/customer_theme.dart';

Map<String, dynamic> order({
  String user = '42',
  String status = 'PENDING',
  bool cancel = true,
}) => {
  'id': '9007199254740993',
  'orderNo': 'SYNTHETIC-GIFT',
  'userId': user,
  'shopId': '7',
  'productId': '8',
  'productTitleSnapshot': 'Synthetic gift',
  'useTimesSnapshot': 3,
  'expireDaysSnapshot': 30,
  'amountCents': 5735,
  'paidCents': 0,
  'refundedCents': 0,
  'currency': 'usd',
  'status': status,
  'paymentMethod': 'PAY_AT_STORE',
  'createdAt': '2031-01-01T00:00:00Z',
  'entitlementId': null,
  'allowedActions': {
    'cancel': cancel,
    'recordReceipt': false,
    'recordRefund': false,
  },
  'receipts': [],
  'refunds': [],
};
Map<String, dynamic> inboxRow({String? bookingId, String? readAt}) => {
  'id': '00000000-0000-4000-8000-000000000001',
  'topic': 'GIFT_PURCHASED',
  'title': 'Synthetic private message',
  'body': 'Recorded benefit update',
  'resourceType': 'GIFT_ORDER',
  'resourceId': '9',
  'bookingId': bookingId,
  'createdAt': '2031-01-01T00:00:00Z',
  'readAt': readAt,
};

class WireAdapter implements HttpClientAdapter {
  final calls = <RequestOptions>[];
  final bodies = <dynamic>[];
  dynamic response;
  WireAdapter(this.response);
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    final bytes =
        await requestStream?.expand((chunk) => chunk).toList() ?? <int>[];
    bodies.add(bytes.isEmpty ? null : jsonDecode(utf8.decode(bytes)));
    return ResponseBody.fromString(
      jsonEncode(response),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class Customer extends AuthNotifier {
  Customer() : super(ApiService()) {
    state = AuthState(
      isLoggedIn: true,
      user: User(id: '42', role: 'CUSTOMER'),
    );
  }
  void switchAccount() => state = AuthState(
    isLoggedIn: true,
    user: User(id: '43', role: 'CUSTOMER'),
  );
}

class FakeGifts extends GiftOrderService {
  FakeGifts() : super(Dio());
  bool enabled = false;
  bool failFirst = false;
  final keys = <String>[];
  Completer<GiftOrderPage>? pending;
  @override
  Future<Map<String, dynamic>> config({CancelToken? cancelToken}) async => {
    'salesEnabled': true,
    'onlinePaymentEnabled': false,
  };
  @override
  Future<GiftProductPage> products(
    String shopId,
    int page, {
    CancelToken? cancelToken,
  }) async => GiftProductPage.fromJson({
    'items': [
      {
        'id': '8',
        'shopId': shopId,
        'title': 'Synthetic gift',
        'description': 'Three uses',
        'priceCents': 5735,
        'currency': 'usd',
        'useTimes': 3,
        'expireDays': 30,
        'salesEnabled': enabled,
        'paymentMethods': enabled ? ['PAY_AT_STORE'] : [],
      },
    ],
    'total': 1,
    'totalPages': 1,
  });
  @override
  Future<GiftPurchaseOrder> create(
    String productId,
    String requestKey, {
    CancelToken? cancelToken,
  }) async {
    keys.add(requestKey);
    if (failFirst) {
      failFirst = false;
      throw StateError('Synthetic timeout');
    }
    return GiftPurchaseOrder.fromJson(_fixtureOrder());
  }

  @override
  Future<GiftOrderPage> orders(
    int page, {
    String? status,
    CancelToken? cancelToken,
  }) =>
      pending?.future ??
      Future.value(
        GiftOrderPage.fromJson({
          'items': [_fixtureOrder()],
          'total': 1,
          'page': page,
          'totalPages': 1,
        }),
      );
  @override
  Future<GiftPurchaseOrder> order(
    String id, {
    CancelToken? cancelToken,
  }) async => GiftPurchaseOrder.fromJson({..._fixtureOrder(), 'id': id});
  Map<String, dynamic> _fixtureOrder() => {
    'id': '9007199254740993',
    'orderNo': 'SYNTHETIC-GIFT',
    'userId': '42',
    'shopId': '7',
    'productId': '8',
    'productTitleSnapshot': 'Synthetic gift',
    'amountCents': 5735,
    'paidCents': 0,
    'refundedCents': 0,
    'currency': 'usd',
    'status': 'PENDING',
    'paymentMethod': 'PAY_AT_STORE',
    'allowedActions': {'cancel': true},
    'receipts': [],
    'refunds': [],
  };
}

class FakeInbox extends NotificationInboxService {
  FakeInbox() : super(Dio());
  int reads = 0;
  bool seen = false;
  @override
  Future<InboxPage> inbox(
    int page, {
    bool unreadOnly = false,
    CancelToken? cancelToken,
  }) async => InboxPage.fromJson({
    'items': [
      inboxRow(
        bookingId: 'https://example.invalid',
        readAt: seen ? '2031-01-01T01:00:00Z' : null,
      ),
    ],
    'total': 1,
    'page': page,
    'totalPages': 1,
    'unreadCount': seen ? 0 : 1,
  });
  @override
  Future<InboxMessage> read(String id, {CancelToken? cancelToken}) async {
    reads++;
    seen = true;
    return InboxMessage.fromJson(
      inboxRow(
        bookingId: 'https://example.invalid',
        readAt: '2031-01-01T01:00:00Z',
      ),
    );
  }
}

Widget app(
  Widget child, {
  FakeGifts? gifts,
  FakeInbox? inbox,
  Customer? account,
}) => ProviderScope(
  overrides: [
    authProvider.overrideWith((ref) => account ?? Customer()),
    if (gifts != null) giftOrderServiceProvider.overrideWithValue(gifts),
    if (inbox != null) notificationInboxProvider.overrideWithValue(inbox),
  ],
  child: MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: buildCustomerTheme(),
    home: child,
  ),
);

void main() {
  test(
    'gift parsing preserves exact IDs and rejects fabricated accounting amounts',
    () {
      final item = GiftPurchaseOrder.fromJson(order());
      expect(item.id, '9007199254740993');
      expect(item.amountCents, 5735);
      expect(item.canCancel, true);
      expect(
        GiftPurchaseOrder.fromJson({
          ...order(),
          'allowedActions': {},
        }).canCancel,
        false,
      );
      for (final changed in [
        {'amountCents': 57.35},
        {'paidCents': 5736},
        {'refundedCents': 1},
      ]) {
        expect(
          () => GiftPurchaseOrder.fromJson({...order(), ...changed}),
          throwsFormatException,
        );
      }
    },
  );
  test(
    'public catalog reads omit private authentication while order writes use fixed PAY_AT_STORE and stable caller key',
    () async {
      final wire = WireAdapter({'items': [], 'total': 0, 'totalPages': 0});
      final dio = Dio()..httpClientAdapter = wire;
      final service = GiftOrderService(dio);
      final cancel = CancelToken();
      await service.products('7', 2, cancelToken: cancel);
      expect(wire.calls.single.extra['publicRead'], true);
      expect(wire.calls.single.queryParameters, {
        'shopId': '7',
        'page': 2,
        'pageSize': 20,
      });
      wire.response = {'item': order()};
      await service.create('8', 'same-key', cancelToken: cancel);
      await service.create('8', 'same-key', cancelToken: cancel);
      expect(
        wire.bodies.skip(1),
        everyElement({
          'productId': '8',
          'requestKey': 'same-key',
          'paymentMethod': 'PAY_AT_STORE',
        }),
      );
      expect(wire.calls.last.extra['publicRead'], isNot(true));
    },
  );
  test(
    'foreign-shop public products and unacknowledged cancellation are rejected',
    () async {
      final wire = WireAdapter({
        'items': [
          {'id': '8', 'shopId': 'other'},
        ],
        'total': 1,
        'totalPages': 1,
      });
      final dio = Dio()..httpClientAdapter = wire;
      final service = GiftOrderService(dio);
      await expectLater(service.products('7', 1), throwsFormatException);
      wire.response = {'item': order()};
      await expectLater(
        service.cancel('9007199254740993'),
        throwsFormatException,
      );
    },
  );
  test(
    'inbox uses bounded server pagination and acknowledged own-message read operations',
    () async {
      final wire = WireAdapter({
        'items': [],
        'total': 0,
        'page': 3,
        'totalPages': 0,
        'unreadCount': 0,
      });
      final dio = Dio()..httpClientAdapter = wire;
      final service = NotificationInboxService(dio);
      await service.inbox(3, unreadOnly: true);
      expect(wire.calls.last.queryParameters, {
        'page': 3,
        'pageSize': 25,
        'unreadOnly': 'true',
      });
      wire.response = {'item': inboxRow(readAt: '2031-01-01T01:00:00Z')};
      await service.read('00000000-0000-4000-8000-000000000001');
      expect(
        wire.calls.last.path,
        '/notifications/inbox/00000000-0000-4000-8000-000000000001/read',
      );
      wire.response = {'updatedCount': 2};
      expect(await service.readAll(), 2);
      expect(wire.calls.last.path, '/notifications/inbox/read-all');
    },
  );
  test(
    'message bodies and external resource identifiers cannot become arbitrary navigation',
    () {
      for (final id in [
        null,
        'https://example.invalid',
        '//example.invalid',
        '0',
        '-1',
        '1/other',
      ]) {
        expect(
          InboxMessage.fromJson(inboxRow(bookingId: id)).canOpenBooking,
          false,
        );
      }
      expect(
        InboxMessage.fromJson(
          inboxRow(bookingId: '9007199254740993'),
        ).canOpenBooking,
        true,
      );
    },
  );
  testWidgets(
    'closed shop sales display real products with a disabled purchase action',
    (tester) async {
      final gifts = FakeGifts();
      await tester.pumpWidget(
        app(
          const GiftProductsScreen(shopId: '7', shopName: 'Synthetic shop'),
          gifts: gifts,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Synthetic gift'), findsOneWidget);
      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Store sales not enabled'),
      );
      expect(button.onPressed, isNull);
      expect(gifts.keys, isEmpty);
    },
  );
  testWidgets(
    'an uncertain order creation retry retains the same request key and opens an unpaid detail',
    (tester) async {
      final gifts = FakeGifts()
        ..enabled = true
        ..failFirst = true;
      await tester.pumpWidget(
        app(
          const GiftProductsScreen(shopId: '7', shopName: 'Synthetic shop'),
          gifts: gifts,
        ),
      );
      await tester.pumpAndSettle();
      for (var attempt = 0; attempt < 2; attempt++) {
        final button = find.widgetWithText(
          FilledButton,
          'Order · pay at store',
        );
        await tester.ensureVisible(button);
        await tester.pumpAndSettle();
        await tester.tap(button);
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, 'Create order'));
        await tester.pumpAndSettle();
      }
      expect(gifts.keys.length, 2);
      expect(gifts.keys.first, gifts.keys.last);
      expect(find.text('Gift order details'), findsOneWidget);
      expect(find.text('Awaiting store payment'), findsOneWidget);
      expect(find.text('USD 57.35'), findsOneWidget);
    },
  );
  testWidgets(
    'account switch clears private gift rows and ignores a late previous-account response',
    (tester) async {
      final gifts = FakeGifts()..pending = Completer<GiftOrderPage>();
      final account = Customer();
      await tester.pumpWidget(
        app(const GiftOrdersScreen(), gifts: gifts, account: account),
      );
      await tester.pump();
      account.switchAccount();
      await tester.pump();
      gifts.pending!.complete(
        GiftOrderPage.fromJson({
          'items': [order()],
          'total': 1,
          'page': 1,
          'totalPages': 1,
        }),
      );
      await tester.pumpAndSettle();
      expect(find.text('Synthetic gift'), findsNothing);
      expect(find.textContaining('account or session changed'), findsOneWidget);
    },
  );
  testWidgets(
    'opening a message records read state but never offers an external URL as a booking',
    (tester) async {
      final inbox = FakeInbox();
      await tester.pumpWidget(
        app(const NotificationInboxScreen(), inbox: inbox),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Synthetic private message'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(inbox.reads, 1);
      expect(find.text('View booking'), findsNothing);
      expect(find.text('0 unread'), findsOneWidget);
    },
  );
}
