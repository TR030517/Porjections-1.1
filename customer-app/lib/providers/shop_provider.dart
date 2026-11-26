import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../models/shop.dart';

/// Provider for shop-related API calls
final shopRepositoryProvider = Provider<ShopRepository>((ref) {
  return ShopRepository(ref.read(apiServiceProvider));
});

/// Shop repository handling all shop API calls
class ShopRepository {
  final ApiService _api;

  ShopRepository(this._api);

  /// List shops with optional GPS coordinates for distance sorting
  Future<ShopListResponse> listShops({
    double? lat,
    double? lng,
    double? radius,
    String? category,
    String? keyword,
    String? city,
    int page = 1,
    int limit = 20,
  }) async {
    final params = <String, dynamic>{'page': page, 'limit': limit};
    if (lat != null) params['lat'] = lat;
    if (lng != null) params['lng'] = lng;
    if (radius != null) params['radius'] = radius;
    if (category != null && category.isNotEmpty) params['category'] = category;
    if (keyword != null && keyword.isNotEmpty) params['keyword'] = keyword;
    if (city != null && city.isNotEmpty) params['city'] = city;

    final response = await _api.dio.get(
      '/shops',
      queryParameters: params,
      options: ApiService.publicReadOptions,
    );
    return ShopListResponse.fromJson(response.data);
  }

  /// Find nearby shops
  Future<Map<String, dynamic>> findNearby({
    required double lat,
    required double lng,
    double radius = 25,
    int limit = 20,
  }) async {
    final response = await _api.dio.get(
      '/shops/nearby',
      queryParameters: {
        'lat': lat,
        'lng': lng,
        'radius': radius,
        'limit': limit,
      },
      options: ApiService.publicReadOptions,
    );
    return response.data as Map<String, dynamic>;
  }

  /// Get shop detail
  Future<ShopDetail> getShopDetail(String shopId) async {
    final response = await _api.dio.get(
      '/shops/${Uri.encodeComponent(shopId)}',
      options: ApiService.publicReadOptions,
    );
    return ShopDetail.fromJson(response.data);
  }

  Future<ShopDetail> resolveShop({String? shortName, String? legacyId}) async {
    if ((shortName == null) == (legacyId == null)) {
      throw ArgumentError('Exactly one shop reference is required.');
    }
    final response = await _api.dio.get(
      '/shops/resolve',
      queryParameters: {'shortName': ?shortName, 'legacyId': ?legacyId},
      options: ApiService.publicReadOptions,
    );
    return ShopDetail.fromJson(Map<String, dynamic>.from(response.data as Map));
  }

  /// Get available slots for a shop on a date
  Future<Map<String, dynamic>> getSlots(String shopId, String date) async {
    final response = await _api.dio.get(
      '/shops/$shopId/slots',
      queryParameters: {'date': date},
    );
    return response.data as Map<String, dynamic>;
  }
}

/// Shop list state
class ShopListState {
  final bool isLoading;
  final bool isLoadingMore;
  final String? error;
  final ShopListResponse? data;
  final String? keyword;
  final String? category;
  final double? lat;
  final double? lng;
  final double? radius;
  final String? city;
  final int? failedPage;
  bool get hasMore {
    final response = data;
    if (response == null) return false;
    if (response.totalPages > 0) return response.page < response.totalPages;
    final limit = response.limit > 0 ? response.limit : 20;
    return response.page * limit < response.total;
  }

  const ShopListState({
    this.isLoading = false,
    this.isLoadingMore = false,
    this.error,
    this.data,
    this.keyword,
    this.category,
    this.lat,
    this.lng,
    this.radius,
    this.city,
    this.failedPage,
  });

  ShopListState copyWith({
    bool? isLoading,
    bool? isLoadingMore,
    String? error,
    ShopListResponse? data,
    String? keyword,
    String? category,
    double? lat,
    double? lng,
    double? radius,
    String? city,
    bool clearError = false,
    bool clearData = false,
    bool clearKeyword = false,
    bool clearCategory = false,
    bool clearLat = false,
    bool clearLng = false,
    bool clearRadius = false,
    bool clearCity = false,
    bool clearFailedPage = false,
    int? failedPage,
  }) {
    return ShopListState(
      isLoading: isLoading ?? this.isLoading,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      error: clearError ? null : (error ?? this.error),
      data: clearData ? null : (data ?? this.data),
      keyword: clearKeyword ? null : (keyword ?? this.keyword),
      category: clearCategory ? null : (category ?? this.category),
      lat: clearLat ? null : (lat ?? this.lat),
      lng: clearLng ? null : (lng ?? this.lng),
      radius: clearRadius ? null : (radius ?? this.radius),
      city: clearCity ? null : (city ?? this.city),
      failedPage: clearFailedPage ? null : (failedPage ?? this.failedPage),
    );
  }
}

/// Shop list notifier
class ShopListNotifier extends StateNotifier<ShopListState> {
  final ShopRepository _repo;
  static const _pageSize = 20;
  int _queryGeneration = 0;

  ShopListNotifier(this._repo) : super(const ShopListState());

  Future<void> loadShops({
    double? lat,
    double? lng,
    double? radius,
    String? keyword,
    String? category,
    String? city,
    bool replaceQuery = false,
  }) async {
    final query = (
      lat: lat ?? state.lat,
      lng: lng ?? state.lng,
      radius: radius ?? state.radius,
      keyword: replaceQuery ? keyword : keyword ?? state.keyword,
      category: replaceQuery ? category : category ?? state.category,
      city: replaceQuery ? city : city ?? state.city,
    );
    final unchangedQuery =
        query.lat == state.lat &&
        query.lng == state.lng &&
        query.radius == state.radius &&
        query.keyword == state.keyword &&
        query.category == state.category &&
        query.city == state.city;
    final generation = ++_queryGeneration;
    state = state.copyWith(
      isLoading: true,
      isLoadingMore: false,
      clearError: true,
      clearFailedPage: true,
      clearData: !unchangedQuery,
      clearKeyword: query.keyword == null,
      clearCategory: query.category == null,
      clearCity: query.city == null,
      clearLat: query.lat == null,
      clearLng: query.lng == null,
      clearRadius: query.radius == null,
      lat: query.lat,
      lng: query.lng,
      radius: query.radius,
      keyword: query.keyword,
      category: query.category,
      city: query.city,
    );

    try {
      final data = await _repo.listShops(
        lat: query.lat,
        lng: query.lng,
        radius: query.radius,
        keyword: query.keyword,
        category: query.category,
        city: query.city,
        page: 1,
        limit: _pageSize,
      );
      if (!mounted || generation != _queryGeneration) return;
      state = state.copyWith(isLoading: false, data: data);
    } catch (e) {
      if (!mounted || generation != _queryGeneration) return;
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<void> loadMoreShops() async {
    final current = state.data;
    if (!mounted || current == null || state.isLoading || state.isLoadingMore) {
      return;
    }
    final pageCount = current.totalPages > 0
        ? current.totalPages
        : (current.total / (current.limit > 0 ? current.limit : _pageSize))
              .ceil();
    final nextPage = current.page + 1;
    if (nextPage > pageCount) return;

    final generation = _queryGeneration;
    state = state.copyWith(
      isLoadingMore: true,
      clearError: true,
      clearFailedPage: true,
    );
    try {
      final response = await _repo.listShops(
        lat: state.lat,
        lng: state.lng,
        radius: state.radius,
        keyword: state.keyword,
        category: state.category,
        city: state.city,
        page: nextPage,
        limit: current.limit > 0 ? current.limit : _pageSize,
      );
      if (!mounted || generation != _queryGeneration) return;
      final shopsById = <String, Shop>{
        for (final shop in current.items) shop.id: shop,
      };
      for (final shop in response.items) {
        shopsById.putIfAbsent(shop.id, () => shop);
      }
      final merged = ShopListResponse(
        items: shopsById.values.toList(growable: false),
        total: response.total,
        page: response.page,
        limit: response.limit,
        totalPages: response.totalPages,
      );
      state = state.copyWith(isLoadingMore: false, data: merged);
    } catch (e) {
      if (!mounted || generation != _queryGeneration) return;
      state = state.copyWith(
        isLoadingMore: false,
        error: e.toString(),
        failedPage: nextPage,
      );
    }
  }

  Future<void> retry() {
    if (state.failedPage != null && state.data != null) {
      return loadMoreShops();
    }
    return loadShops();
  }

  void setKeyword(String? keyword) {
    setFilters(keyword: keyword, category: state.category);
  }

  void setCategory(String? category) {
    setFilters(keyword: state.keyword, category: category);
  }

  void setFilters({required String? keyword, required String? category}) {
    loadShops(
      lat: state.lat,
      lng: state.lng,
      radius: state.radius,
      keyword: keyword,
      category: category,
      city: state.city,
      replaceQuery: true,
    );
  }
}

final shopListProvider = StateNotifierProvider<ShopListNotifier, ShopListState>(
  (ref) {
    return ShopListNotifier(ref.read(shopRepositoryProvider));
  },
);

/// Shop detail provider
final shopDetailProvider = FutureProvider.family<ShopDetail, String>((
  ref,
  shopId,
) async {
  final repo = ref.read(shopRepositoryProvider);
  return repo.getShopDetail(shopId);
});

/// A cached result must not authorize a write while it is refreshing or failed.
bool canWriteShopReview(String shopId, AsyncValue<ShopDetail>? availability) =>
    shopId.isNotEmpty &&
    availability != null &&
    !availability.isLoading &&
    !availability.hasError &&
    availability.valueOrNull?.id == shopId &&
    availability.valueOrNull?.reviewsEnabled == true;

/// User location (mock for web)
class UserLocation {
  final double lat;
  final double lng;
  UserLocation({required this.lat, required this.lng});
}

final userLocationProvider = Provider<UserLocation?>((ref) => null);
