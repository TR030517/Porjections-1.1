import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mjapp_client/models/user.dart';
import 'package:mjapp_client/providers/auth_provider.dart';
import 'package:mjapp_client/providers/favorites_provider.dart';
import 'package:mjapp_client/services/api_service.dart';

void main() {
  for (final wrapped in [false, true]) {
    test(
      'nonempty ${wrapped ? 'wrapped' : 'list'} favorites response loads through the provider and shop model',
      () async {
        final api = ApiService();
        final originalInterceptors = api.dio.interceptors.toList();
        final calls = <String>[];
        api.dio.interceptors.clear();
        api.dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              calls.add(options.path);
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: wrapped
                      ? {
                          'items': [_favoriteShop],
                        }
                      : [_favoriteShop],
                ),
              );
            },
          ),
        );
        addTearDown(() {
          api.dio.interceptors.clear();
          api.dio.interceptors.addAll(originalInterceptors);
        });
        final container = ProviderContainer(
          overrides: [
            apiServiceProvider.overrideWithValue(api),
            authProvider.overrideWith((ref) => _Customer(api)),
            favoritesProvider.overrideWith((ref) => FavoritesNotifier(api)),
          ],
        );
        addTearDown(container.dispose);

        final shops = await container.read(favoriteShopsProvider.future);

        expect(calls, ['/favorites/shops']);
        expect(shops, hasLength(1));
        expect(shops.single.id, '7');
        expect(shops.single.latitude, 47.5997);
        expect(shops.single.longitude, -122.3168);
        expect(shops.single.city, 'Seattle');
        expect(shops.single.state, 'Washington');
        expect(shops.single.canonicalPath, '/s/seattle-wellness');
        expect(shops.single.bookingCount, 8);
      },
    );
  }
}

class _Customer extends AuthNotifier {
  _Customer(super.api) {
    state = AuthState(
      isLoggedIn: true,
      user: User(id: '21', role: 'CUSTOMER'),
    );
  }
}

const _favoriteShop = {
  'id': '7',
  'name': 'Seattle Wellness',
  'description': 'Local massage services',
  'phone': '206-555-0100',
  'address': '1207 S Jackson St #109B',
  'city': 'Seattle',
  'state': 'Washington',
  'zipCode': '98144',
  'latitude': 47.5997,
  'longitude': -122.3168,
  'timezone': 'America/Los_Angeles',
  'category': 'MASSAGE',
  'shopType': 'SPA',
  'avgRating': 4.5,
  'reviewCount': 3,
  'bookingCount': 8,
  'distanceKm': null,
  'canonicalShortName': 'seattle-wellness',
  'canonicalPath': '/s/seattle-wellness',
  'features': {'onlineBooking': false, 'reviews': true},
  'paymentPolicy': {'payAtStoreEnabled': true},
};
