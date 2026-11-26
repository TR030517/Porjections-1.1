import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/shop_contacts.dart';

Map<String, dynamic> contactJson() => {
  'id': '7', 'name': 'Synthetic contact studio', 'latitude': 0, 'longitude': 0,
  'address': '12 Main Street', 'city': 'Test Harbor', 'state': 'NY',
  'zipCode': '10002', 'phone': '+19995550101',
};

void main() {
  test('public contacts keep distinct stored values and never use account or booking contacts', () {
    final json = contactJson()
      ..['phones'] = [' +1 (999) 555-0102 ', '+19995550102', '999.555.0103']
      ..['emails'] = [' front.desk+booking@example.test ', 'FRONT.DESK+BOOKING@EXAMPLE.TEST', 'hello@example.test']
      ..['owner'] = {'phone': '+19995550999', 'email': 'hidden-owner@example.test'}
      ..['user'] = {'name': 'Hidden customer', 'phone': '+19995550888'}
      ..['staff'] = [{'email': 'hidden-staff@example.test'}];
    final shop = ShopDetail.fromJson(json);
    expect(shop.phones, ['+1 (999) 555-0102', '999.555.0103']);
    expect(shop.phone, '+1 (999) 555-0102');
    expect(shop.emails, ['front.desk+booking@example.test', 'hello@example.test']);
    expect(shop.zipCode, '10002');
    expect(publicShopAddress(address: shop.address, city: shop.city,
        state: shop.state, zipCode: shop.zipCode),
        '12 Main Street, Test Harbor, NY, 10002');
    expect(shop.phones, isNot(contains('+19995550999')));
    expect(shop.emails.any((email) => email.contains('hidden')), isFalse);
    json.remove('emails');
    json['email'] = 'not-a-public-account-fallback@example.test';
    expect(ShopDetail.fromJson(json).emails, isEmpty);
  });

  test('public address avoids repeating city, state abbreviation and ZIP already in street text', () {
    expect(publicShopAddress(
      address: '258 SE 6th Ave #7, Delray Beach, FL 33483',
      city: 'Delray Beach',
      state: 'Florida',
      zipCode: '33483',
    ), '258 SE 6th Ave #7, Delray Beach, FL 33483');
    expect(publicShopAddress(
      address: '1207 S Jackson St #109B',
      city: 'Seattle',
      state: 'Washington',
      zipCode: '98144',
    ), '1207 S Jackson St #109B, Seattle, Washington, 98144');
  });

  test('authoritative clear or malformed contact arrays never resurrect legacy values', () {
    expect(ShopDetail.fromJson(contactJson()).phones, ['+19995550101']);
    for (final value in [[], null, 'invalid', [123], ['+19995550102', 123], ['']]) {
      final json = contactJson()
        ..['phones'] = value
        ..['emails'] = value;
      final shop = ShopDetail.fromJson(json);
      expect(shop.phones, isEmpty);
      expect(shop.phone, isNull);
      expect(shop.emails, isEmpty);
    }
    final json = contactJson()
      ..['phones'] = ['javascript:ignored', '+19995550104']
      ..['emails'] = ['bad@example.test?subject=ignored', 'valid@example.test'];
    expect(ShopDetail.fromJson(json).phones, ['+19995550104']);
    expect(ShopDetail.fromJson(json).emails, ['valid@example.test']);
    expect(publicShopPhones({'phones': [
      for (var n = 1; n <= 8; n++) '+1999555010$n',
    ]}), hasLength(5));
  });

  test('telephone targets contain only the stored number without guessed country code or injectable URI parts', () {
    expect(publicPhoneUri(' (999) 555-0102 ')?.toString(), 'tel:9995550102');
    expect(publicPhoneUri('+1 999 555 0102')?.toString(), 'tel:+19995550102');
    for (final value in [
      null, '', '123456', '+1234567890123456', 'tel:+19995550102',
      '+19995550102?body=hello', '+19995550102#ignored',
      '+19995550102%0d%0a', '+19995550102;ext=5', '+19995550102/5',
      '++19995550102', '1+9995550102', '+19995550102\n',
      'javascript:alert(1)', '+1999\u00005550102',
    ]) {
      expect(publicPhoneUri(value), isNull, reason: '$value');
    }
    final target = publicPhoneUri('999-555-0102')!;
    expect(target.hasQuery, isFalse);
    expect(target.hasFragment, isFalse);
    expect(target.hasAuthority, isFalse);
  });

  test('mail targets cannot add query, header, fragments or encoded controls', () {
    const email = 'front.desk+booking@example.test';
    final target = publicEmailUri(email)!;
    expect(target.scheme, 'mailto');
    expect(target.path, email);
    expect(target.hasQuery, isFalse);
    expect(target.hasFragment, isFalse);
    expect(target.hasAuthority, isFalse);
    for (final value in [
      null, '', 'mailto:hello@example.test', 'a@example.test?subject=hello',
      'a@example.test#fragment', 'a%0d%0abcc@example.test',
      'hello@example.test\r\nBcc:other@example.test', 'a b@example.test',
      'a..b@example.test', '.a@example.test', 'a.@example.test',
      'a@example', 'a@-example.test', 'a@example..test',
      'a@例子.test', 'a@@example.test',
    ]) {
      expect(publicEmailUri(value), isNull, reason: '$value');
    }
  });

  test('maps use fixed HTTPS search with encoded full address and need a concrete address', () {
    const address = '12 Main & Pine #5?next=https://example.test';
    final uri = publicShopMapUri(address: address, city: 'Test Harbor',
        state: 'NY', zipCode: '10002')!;
    expect(uri.scheme, 'https');
    expect(uri.host, 'www.google.com');
    expect(uri.path, '/maps/search/');
    expect(uri.queryParameters, {
      'api': '1', 'query': '$address, Test Harbor, NY, 10002',
    });
    expect(uri.hasFragment, isFalse);
    expect(uri.userInfo, isEmpty);
    for (final address in [null, '', '  ', '12 Main\nOther', 123]) {
      expect(publicShopMapUri(address: address, city: 'Test Harbor', state: 'NY'), isNull);
    }
    for (final city in [123, 'Test Harbor\n', 'x' * 501]) {
      expect(publicShopMapUri(address: '12 Main Street', city: city), isNull);
    }
    expect(publicShopMapUri(address: '12 Main Street', city: '', state: '  ')
        ?.queryParameters['query'], '12 Main Street');
    final shop = ShopDetail.fromJson(contactJson()
      ..['address'] = ''
      ..['mapShareUrl'] = 'javascript:ignored'
      ..['owner'] = {'address': 'Hidden address'});
    expect(publicShopMapUri(address: shop.address, city: shop.city, state: shop.state), isNull);
    expect(publicShopAddress(address: '', city: 'Test Harbor', state: 'NY'),
        'Test Harbor, NY');
  });
}
