import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/media_url.dart';
import 'package:mjapp_client/models/home_banner.dart';
import 'package:mjapp_client/models/shop.dart';
import 'package:mjapp_client/models/user.dart';

const path = '/api/v1/upload/media/00000000-0000-4000-8000-000000000001/file';
void main() {
  test('menu gallery uses the API gateway origin rather than the current shop route', () {
    const gallery = '/service-gallery/v1/body-massage.webp';
    expect(resolveCustomerMediaUrl(gallery), isNull);
    expect(
      resolveCustomerMediaUrl(
        gallery,
        allowServiceGallery: true,
        apiBaseUrl: 'https://www.example.invalid/api/v1',
      ),
      'https://www.example.invalid$gallery',
    );
    expect(
      resolveCustomerMediaUrl(
        gallery,
        allowServiceGallery: true,
        apiBaseUrl: '/api/v1',
        pageUri: Uri.parse('https://www.example.invalid/s/studio/menu'),
      ),
      'https://www.example.invalid$gallery',
    );
    expect(
      resolveCustomerMediaUrl(
        gallery,
        allowServiceGallery: true,
        apiBaseUrl: 'http://127.0.0.1:8090/api/v1',
      ),
      'http://127.0.0.1:8090$gallery',
    );
    for (final base in ['file:///tmp/app', '//evil.invalid/api/v1', 'https://user:password@api.example.invalid/api/v1']) {
      expect(resolveCustomerMediaUrl(gallery, allowServiceGallery: true, apiBaseUrl: base), isNull);
    }
  });

  test('menu gallery keys are bounded and reject encoded paths, traversal, suffixes and alternate namespaces', () {
    for (final key in ['a', 'body-massage', 'a1--z', List.filled(80, 'a').join()]) {
      final gallery = '/service-gallery/v1/$key.webp';
      expect(
        resolveCustomerMediaUrl(gallery, allowServiceGallery: true, apiBaseUrl: 'https://www.example.invalid/api/v1'),
        'https://www.example.invalid$gallery',
      );
      expect(resolveCustomerMediaUrl(gallery), isNull);
    }
    for (final value in <dynamic>[
      null, 12, {}, '/service-gallery/v1/.webp', '/service-gallery/v1/${List.filled(81, 'a').join()}.webp',
      '/service-gallery/v1/1body.webp', '/service-gallery/v1/Body.webp', '/service-gallery/v1/body_massage.webp',
      '/service-gallery/v2/body.webp', '/service-gallery/V1/body.webp', '/Service-gallery/v1/body.webp',
      '/service-gallery/v1/body.WEBP', '/service-gallery/v1/body.jpg', '/service-gallery/v1/body.webp?x=1',
      '/service-gallery/v1/body.webp#x', '/service-gallery/v1/body.webp?', '/service-gallery/v1/body.webp#',
      '/service-gallery/v1/%62ody.webp', '/service-gallery/v1/body%2fother.webp',
      '/service-gallery/v1/../body.webp', '/service-gallery/v1/body/../other.webp',
      '/service-gallery/v1/body.webp/other.webp', '/service-gallery/v1/body\\other.webp',
      '//evil.invalid/service-gallery/v1/body.webp', 'service-gallery/v1/body.webp', '/other/body.webp',
      '/service-gallery/v1/body\nother.webp',
    ]) {
      expect(resolveCustomerMediaUrl(value, allowServiceGallery: true), isNull, reason: value.toString());
    }
  });

  test('only display-menu items opt into subject gallery while logos, avatars and banners keep the old contract', () {
    const gallery = '/service-gallery/v1/body-massage.webp';
    final menuItem = ShopPriceMenuItem.parse({'name': 'Custom name', 'priceText': 'Call for price', 'imageUrl': gallery});
    expect(menuItem?.imageUrl, resolveCustomerMediaUrl(gallery, allowServiceGallery: true));
    expect(menuItem?.name, 'Custom name');
    expect(menuItem?.priceText, 'Call for price');
    final shopMedia = ShopMedia.fromJson({'logoUrl': gallery, 'coverUrl': gallery, 'galleryUrls': [gallery]});
    expect(shopMedia.logoUrl, isNull);
    expect(shopMedia.coverUrl, isNull);
    expect(shopMedia.galleryUrls, isEmpty);
    expect(User.fromJson({'id': '42', 'role': 'CUSTOMER', 'avatarUrl': gallery}).avatarUrl, isNull);
    expect(HomeBanner.fromJson({'imageUrl': gallery}).imageUrl, isEmpty);
  });

  test('home banners resolve safe media without changing navigation metadata', () {
    final json = <String, dynamic>{
      'id': '17',
      'title': 'Relax today',
      'targetType': 'SHOP_DETAIL',
      'targetValue': '42',
      'sortOrder': 3,
      'clickCount': 9,
    };
    final nativeBanner = HomeBanner.fromJson({
      ...json,
      'imageUrl': path,
    }, apiBaseUrl: 'https://api.example.invalid/api/v1');
    expect(nativeBanner.imageUrl, 'https://api.example.invalid$path');
    expect(nativeBanner.id, '17');
    expect(nativeBanner.title, 'Relax today');
    expect(nativeBanner.targetType, 'SHOP_DETAIL');
    expect(nativeBanner.targetValue, '42');
    expect(nativeBanner.sortOrder, 3);
    expect(nativeBanner.clickCount, 9);
    expect(
      HomeBanner.fromJson({
        ...json,
        'imageUrl': 'https://cdn.example.invalid/banner.png',
      }, apiBaseUrl: 'https://api.example.invalid/api/v1').imageUrl,
      'https://cdn.example.invalid/banner.png',
    );
    expect(
      HomeBanner.fromJson(
        {...json, 'imageUrl': path},
        apiBaseUrl: '/api/v1',
        pageUri: Uri.parse('https://www.example.invalid/s/spa-one'),
      ).imageUrl,
      'https://www.example.invalid$path',
    );
    for (final invalid in <dynamic>[
      null,
      17,
      'http://cdn.example.invalid/banner.png',
      '//cdn.example.invalid/banner.png',
      'https://user:password@cdn.example.invalid/banner.png',
      'javascript:alert(1)',
      '/arbitrary/banner.png',
      '$path?token=x',
    ]) {
      expect(
        HomeBanner.fromJson({
          ...json,
          'imageUrl': invalid,
        }, apiBaseUrl: 'https://api.example.invalid/api/v1').imageUrl,
        isEmpty,
        reason: invalid?.toString() ?? 'null',
      );
    }
  });
  test(
    'managed media resolves from the API origin for native and relative web API bases',
    () {
      expect(
        resolveCustomerMediaUrl(
          path,
          apiBaseUrl: 'https://api.example.invalid/api/v1',
        ),
        'https://api.example.invalid$path',
      );
      expect(
        resolveCustomerMediaUrl(
          path,
          apiBaseUrl: '/api/v1',
          pageUri: Uri.parse('https://www.example.invalid/s/spa-one'),
        ),
        'https://www.example.invalid$path',
      );
      expect(
        resolveCustomerMediaUrl(
          path,
          apiBaseUrl: 'http://localhost:8000/api/v1',
        ),
        'http://localhost:8000$path',
      );
      expect(
        resolveCustomerMediaUrl(
          path,
          apiBaseUrl: '/api/v1',
          pageUri: Uri.parse('file:///tmp/app'),
        ),
        isNull,
      );
    },
  );
  test(
    'only exact managed paths or credential-free HTTPS URLs can be rendered',
    () {
      for (final value in [
        '/uploads/image.png',
        '//evil.invalid/image.png',
        'https://user:password@example.invalid/image.png',
        'http://example.invalid/image.png',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        '$path?token=x',
        '$path#fragment',
        path.replaceFirst('4000', '0000'),
        '/api/v1/upload/media/../file',
        'https://example.invalid/a b.png',
      ]) {
        expect(resolveCustomerMediaUrl(value), isNull, reason: value);
      }
      expect(
        resolveCustomerMediaUrl('https://example.invalid/image.png'),
        'https://example.invalid/image.png',
      );
    },
  );
  test(
    'user avatars and all shop media use the same resolved contract without losing explicit clearing',
    () {
      final resolved = resolveCustomerMediaUrl(path);
      expect(
        User.fromJson({
          'id': '42',
          'role': 'CUSTOMER',
          'avatarUrl': path,
        }).avatarUrl,
        resolved,
      );
      final media = ShopMedia.fromJson({
        'logoUrl': path,
        'coverUrl': path,
        'galleryUrls': [path, path],
        'posterUrl': null,
      });
      expect(media.logoUrl, resolved);
      expect(media.coverUrl, resolved);
      expect(media.galleryUrls, [resolved]);
      expect(ShopMedia.fromJson({'galleryUrls': []}).galleryUrls, isEmpty);
      expect(
        User.fromJson({
          'id': '42',
          'role': 'CUSTOMER',
          'avatarUrl': '/arbitrary.png',
        }).avatarUrl,
        isNull,
      );
    },
  );
}
