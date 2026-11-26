import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/widgets/shop_price_menu.dart';

ShopPriceMenuItem project({bool enabled = true, bool addOn = false, bool? available}) {
  final pricing = ShopPriceMenuPricing.parse({
    'kind': addOn ? 'ADD_ON' : 'TIMED', 'baseName': addOn ? 'Hot stones' : 'Body massage',
    'durationMin': addOn ? null : 60, 'priceCents': addOn ? 1000 : 8000, 'titleMode': 'AUTO',
  })!;
  return ShopPriceMenuItem.parse({
    'id': addOn ? 'extra' : 'main', 'name': pricing.automaticTitle, 'priceText': '',
    'pricing': pricing.toJson(), 'bookingEnabled': enabled,
    'bookingAvailable': ?available,
    'booking': {'serviceId': '20', if (addOn) 'addOnId': '40' else 'variantId': '30'},
  })!;
}

void main() {
  test('only an explicit enabled primary link starts booking; legacy wording never does', () {
    expect(ShopPriceMenuItem.parse({'name': '60 minutes massage', 'priceText': r'$80'})!.canStartBooking, isFalse);
    expect(project().canStartBooking, isTrue);
    expect(project(enabled: false).canStartBooking, isFalse);
    expect(project().bookingAvailable, isNull);
    expect(project(available: true).canStartBooking, isTrue);
    expect(project(available: false).bookingEnabled, isTrue);
    expect(project(available: false).canStartBooking, isFalse);
    expect(project(enabled: false, available: true).canStartBooking, isFalse);
    for (final malformed in [null, 'true', 1]) {
      expect(ShopPriceMenuItem.parse({'name': 'Linked item', 'priceText': '', 'bookingEnabled': true,
        'bookingAvailable': malformed, 'booking': {'serviceId': '20'}})!.canStartBooking, isFalse);
    }
    expect(project(addOn: true).canStartBooking, isFalse);
    expect(ShopPriceMenuBooking.parse({'serviceId': '20', 'variantId': '30', 'addOnId': '40'}), isNull);
  });
  testWidgets('effective unavailability blocks a configured option and a refresh restores its booking action', (tester) async {
    ShopPriceMenuItem? selected;
    Widget app(ShopPriceMenuItem item) => MaterialApp(home: Scaffold(body: SingleChildScrollView(child: ShopPriceMenu(
      groups: [ShopPriceMenuGroup(category: 'Massage', items: [item])], onBook: (row) => selected = row,
    ))));
    final paused = project(available: false);
    await tester.pumpWidget(app(paused));
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(paused.name)); await tester.pump();
    expect(selected, isNull);
    expect(find.text('Book this service'), findsNothing);
    expect(find.text('Online booking is currently unavailable'), findsOneWidget);
    final available = project(available: true);
    await tester.pumpWidget(app(available));
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(available.name)); await tester.pump();
    expect(selected?.booking?.variantId, '30');
    expect(tester.widget<ShopServiceSelectionCard>(find.byKey(const ValueKey('price-menu-book-0-0'))).onSelected, isNotNull);
  });
  testWidgets('clicking a primary menu row carries its exact service and variant; extras require a main service', (tester) async {
    ShopPriceMenuItem? selected;
    final main = project(), extra = project(addOn: true);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: ShopPriceMenu(
      groups: [ShopPriceMenuGroup(category: 'Massage', items: [main, extra])],
      onBook: (item) => selected = item,
    )))));
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(main.name)); await tester.pump();
    expect(selected?.booking?.serviceId, '20'); expect(selected?.booking?.variantId, '30');
    selected = null;
    await tester.tap(find.text(extra.name)); await tester.pump();
    expect(selected, isNull);
    expect(find.text('Requires a main service · Adds no appointment time'), findsOneWidget);
  });
  testWidgets('the explicit booking button carries the exact option callback', (tester) async {
    ShopPriceMenuItem? selected;
    final main = project();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: ShopPriceMenu(
      groups: [ShopPriceMenuGroup(category: 'Massage', items: [main])],
      onBook: (item) => selected = item,
    )))));
    await tester.tap(find.byKey(const ValueKey('price-menu-group-toggle-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('price-menu-book-0-0')));
    await tester.pump();
    expect(selected?.booking?.serviceId, '20');
    expect(selected?.booking?.variantId, '30');
  });
  test('four hands use one guest and one visit price; assigned therapist IDs survive the saved snapshot', () {
    final service = ShopService.fromJson({'id': '20', 'name': 'Four hands', 'durationMin': 60, 'priceCents': 12000,
      'participantCount': 1, 'requiredStaffCount': 2, 'priceBasis': 'PER_BOOKING'});
    expect(service.canBook, isTrue); expect(service.startingPriceCents, 12000);
    final saved = BookingItem.fromJson({'id': '1', 'serviceId': '20', 'serviceNameSnapshot': 'Four hands', 'durationMin': 60,
      'participantCountSnapshot': 1, 'requiredStaffCountSnapshot': 2, 'assignedTherapistIds': ['11', '12']});
    expect(saved.assignedTherapistIds, ['11', '12']); expect(saved.requiredStaffCount, 2);
    expect(saved.durationMin, 60);
  });
}
