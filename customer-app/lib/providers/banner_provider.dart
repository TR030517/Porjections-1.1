import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../models/home_banner.dart';

/// Provider for home banner API calls
final bannerRepositoryProvider = Provider<BannerRepository>((ref) {
  return BannerRepository(ref.read(apiServiceProvider));
});

/// Home banner repository
class BannerRepository {
  final ApiService _api;
  BannerRepository(this._api);

  /// Fetch active home banners
  Future<List<HomeBanner>> getActiveBanners() async {
    final response = await _api.dio.get('/banners');
    final data = response.data;
    if (data is List) {
      return data.map((e) => HomeBanner.fromJson(e as Map<String, dynamic>)).toList();
    }
    return [];
  }

  /// Record a banner click
  Future<void> recordBannerClick(String bannerId) async {
    try {
      await _api.dio.post('/banners/$bannerId/click');
    } catch (_) {
      // analytics only — never block the UI
    }
  }
}

/// Async state for banners with simple caching
final bannersProvider = FutureProvider<List<HomeBanner>>((ref) async {
  return ref.read(bannerRepositoryProvider).getActiveBanners();
});
