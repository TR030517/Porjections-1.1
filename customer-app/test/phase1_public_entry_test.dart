import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/booking.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/navigation/customer_routes.dart';

void main() {
  test('short-name routes normalize without using return URL parameters', () {
    for (final route in [
      '/s/Spa-one',
      '/Spa-one?returnUrl=https://example.invalid',
    ]) {
      final entry = CustomerShopEntry.fromUri(Uri.parse(route));
      expect(entry?.shortName, 'spa-one');
      expect(entry?.currentId, isNull);
      expect(entry?.legacyId, isNull);
    }
  });
  test('store and old H5 IDs remain explicit legacy string references', () {
    const id = '9223372036854775807';
    for (final route in [
      '/store-$id',
      '/pages/shop/storedetails?id=$id',
      '/shopdetails/shopdetails?id=$id',
    ]) {
      final entry = CustomerShopEntry.fromUri(Uri.parse(route));
      expect(entry?.legacyId, id);
      expect(entry?.currentId, isNull);
    }
    expect(CustomerShopEntry.fromUri(Uri.parse('/shops/$id'))?.currentId, id);
  });
  test('old H5 fragment is resolved only as a relative application path', () {
    expect(
      initialCustomerLocation(
        Uri.parse(
          'https://example.invalid/h5/#/pages/shop/storedetails?id=3763',
        ),
      ),
      '/pages/shop/storedetails?id=3763',
    );
    expect(
      initialCustomerLocation(
        Uri.parse('https://example.invalid/#//evil.invalid/path'),
      ),
      '/',
    );
    expect(
      initialCustomerLocation(
        Uri.parse('https://example.invalid/#https://evil.invalid/path'),
      ),
      '/',
    );
  });
  test('reserved invalid external and ambiguous references are rejected', () {
    for (final route in [
      '/admin',
      '/s/merchant',
      '/s/api',
      '/s/login',
      '/s/auth',
      '/s/signin',
      '/s/register',
      '/s/logout',
      '/s/shop',
      '/s/static',
      '/s/health',
      '/s/favicon',
      '/s/robots',
      '/s/sitemap',
      '/s/payments',
      '/s/bookings',
      '/s/account',
      '/s/profile',
      '/s/home',
      '/s/search',
      '/s/about',
      '/s/support',
      '/s/feedback',
      '/s/terms',
      '/s/privacy',
      '/s/store-3763',
      '/s/a',
      '/s/a--b',
      '/s/spa%2Fevil',
      '/store-0',
      '/store--1',
      '/storedetails?id=1&id=2',
      '/shopdetails/shopdetails?id=abc',
      'https://evil.invalid/s/spa-one',
      '//evil.invalid/s/spa-one',
    ]) {
      expect(
        CustomerShopEntry.fromUri(Uri.parse(route)),
        isNull,
        reason: route,
      );
    }
  });
  test('share URL uses a safe canonical path and current origin only', () {
    expect(
      publicShopShareUri(
        '/s/spa-one',
        origin: Uri.parse('http://127.0.0.1:8088/shops/9'),
      )?.toString(),
      'http://127.0.0.1:8088/s/spa-one',
    );
    for (final value in [
      null,
      '/store-3763',
      '//evil.invalid/s/spa-one',
      'https://evil.invalid/s/spa-one',
      '/s/spa-one?returnUrl=/admin',
      '/s/admin',
    ]) {
      expect(
        publicShopShareUri(value, origin: Uri.parse('https://example.invalid')),
        isNull,
      );
    }
  });
  test('authoritative empty media does not revive legacy shop images', () {
    final json = _shopJson();
    json['images'] = [
      {'id': '1', 'imageUrl': 'https://example.invalid/old.jpg'},
    ];
    json['thumbnail'] = 'https://example.invalid/old.jpg';
    json['media'] = {
      'logoUrl': null,
      'coverUrl': null,
      'posterUrl': null,
      'galleryUrls': [],
    };
    expect(ShopDetail.fromJson(json).images, isEmpty);
    expect(Shop.fromJson(json).thumbnail, isNull);
    json.remove('media');
    expect(
      ShopDetail.fromJson(json).images.single.imageUrl,
      'https://example.invalid/old.jpg',
    );
  });
  test(
    'media blocks executable URLs credentials and external protocol-relative values',
    () {
      for (final url in [
        'javascript:alert(1)',
        'data:image/png;base64,ignored',
        'https://user:password@example.invalid/photo.jpg',
        '//example.invalid/photo.jpg',
      ]) {
        expect(safeShopMediaUrl(url), isNull);
      }
      expect(
        safeShopMediaUrl('https://example.invalid/photo.jpg'),
        'https://example.invalid/photo.jpg',
      );
      // Only the exact server-managed UUID path is accepted as relative media.
      expect(safeShopMediaUrl('/uploads/photo.jpg'), isNull);
    },
  );
  test('pay-at-store is opt in and not inferred from other flags', () {
    final json = _shopJson();
    expect(ShopDetail.fromJson(json).payAtStoreEnabled, isFalse);
    json['paymentPolicy'] = {'payAtStoreEnabled': true};
    expect(ShopDetail.fromJson(json).payAtStoreEnabled, isTrue);
  });
  test(
    'authoritative phones clear stale legacy contact and invalid types safely',
    () {
      final json = _shopJson()..['phone'] = '+12025550101';
      expect(Shop.fromJson(json).phone, '+12025550101');
      expect(ShopDetail.fromJson(json).phone, '+12025550101');
      json['phones'] = [' +12025550102 '];
      expect(Shop.fromJson(json).phone, '+12025550102');
      expect(ShopDetail.fromJson(json).phone, '+12025550102');
      for (final value in [
        [],
        null,
        'invalid',
        [123],
        ['+12025550102', 123],
        [''],
      ]) {
        json['phones'] = value;
        expect(Shop.fromJson(json).phone, isNull);
        expect(ShopDetail.fromJson(json).phone, isNull);
      }
    },
  );
  test(
    'confirmed unpaid store bookings may reschedule without online checkout',
    () {
      final booking = Booking.fromJson(
        _bookingJson('PAY_AT_STORE', 'UNPAID', paid: 0),
      );
      expect(booking.canReschedule, isTrue);
      expect(booking.canOpenCheckout, isFalse);
      expect(booking.hasRefundableBalance, isFalse);
      expect(booking.amountDueCents, 12000);
      expect(booking.items.single.priceCents, 6000);
    },
  );
  test('zero settlement has no online checkout or refundable money', () {
    final json = _bookingJson('ZERO', 'PAID', paid: 0);
    json['totalCents'] = 0;
    json['amountDueCents'] = 0;
    final booking = Booking.fromJson(json);
    expect(booking.canOpenCheckout, isFalse);
    expect(booking.hasRefundableBalance, isFalse);
    expect(booking.canReschedule, isTrue);
  });
  test(
    'cancelled expired or refunded records cannot open checkout or reschedule',
    () {
      final cancelled = _bookingJson('ONLINE', 'UNPAID', paid: 0)
        ..['status'] = 'CANCELLED';
      final expired = _bookingJson('ONLINE', 'UNPAID', paid: 0)
        ..['status'] = 'PENDING'
        ..['holdExpiresAt'] = '2000-01-01T00:00:00.000Z';
      final refunded = _bookingJson(
        'PAY_AT_STORE',
        'PARTIALLY_REFUNDED',
        paid: 12000,
      )..['refundedCents'] = 100;
      for (final json in [cancelled, expired, refunded]) {
        final booking = Booking.fromJson(json);
        expect(booking.canOpenCheckout, isFalse);
        expect(booking.canReschedule, isFalse);
      }
    },
  );
}

Map<String, dynamic> _shopJson() => {
  'id': '9',
  'name': 'Synthetic shop',
  'latitude': 0,
  'longitude': 0,
};
Map<String, dynamic> _bookingJson(
  String mode,
  String paymentStatus, {
  required int paid,
}) => {
  'id': '42',
  'shopId': '9',
  'status': 'CONFIRMED',
  'paymentStatus': paymentStatus,
  'paymentMode': mode,
  'totalCents': 12000,
  'paidCents': paid,
  'refundedCents': 0,
  'amountDueCents': 12000 - paid,
  'currency': 'usd',
  'startTime': '2099-10-30T17:00:00.000Z',
  'endTime': '2099-10-30T18:00:00.000Z',
  'items': [
    {
      'id': '1',
      'participantIndex': 1,
      'serviceNameSnapshot': 'Synthetic service',
      'durationMin': 60,
      'priceCentsSnapshot': 6000,
    },
  ],
};
