import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';
import '../models/shop.dart';
import 'auth_provider.dart';

/// Favorites notifier — persisted via backend API
class FavoritesNotifier extends StateNotifier<Set<String>> {
  final ApiService _api;
  bool _loaded = false;
  Future<void>? _loading;

  FavoritesNotifier(this._api) : super({});

  /// Load favorites from backend
  Future<void> load() {
    if (_loaded) return Future.value();
    return _loading ??= _load().whenComplete(() => _loading = null);
  }

  Future<void> _load() async {
    try {
      final response = await _api.dio.get('/favorites');
      if (!mounted) return;
      final ids = (response.data['ids'] as List).map((id) => id.toString());
      state = Set.from(ids);
      _loaded = true;
    } catch (_) {
      // Silently fail; user can retry
    }
  }

  /// Toggle a shop favorite status
  Future<bool> toggle(String shopId) async {
    await load();
    if (!mounted) throw StateError('This account session has changed.');
    try {
      final response = await _api.dio.post('/favorites/$shopId/toggle');
      if (!mounted) throw StateError('This account session has changed.');
      final favorited = response.data['favorited'] as bool;
      if (favorited) {
        state = Set.from(state)..add(shopId);
      } else {
        state = Set.from(state)..remove(shopId);
      }
      return favorited;
    } catch (_) {
      rethrow;
    }
  }

  bool isFavorite(String shopId) => state.contains(shopId);

  void add(String shopId) => state = Set.from(state)..add(shopId);
  void remove(String shopId) => state = Set.from(state)..remove(shopId);
  void clear() {
    _loaded = false;
    state = {};
  }
}

final favoritesProvider = StateNotifierProvider<FavoritesNotifier, Set<String>>(
  (ref) {
    final notifier = FavoritesNotifier(ref.read(apiServiceProvider));
    final userId = ref.watch(authProvider.select((state) => state.user?.id));
    // Defer loading to microtask to avoid provider cycle
    if (userId != null) Future.microtask(() => notifier.load());
    return notifier;
  },
);

/// Fetch the server's batch projection instead of one detail request per shop.
final favoriteShopsProvider = FutureProvider<List<Shop>>((ref) async {
  ref.watch(favoritesProvider);
  if (ref.watch(authProvider).user == null) return [];
  final api = ref.read(apiServiceProvider);
  final response = await api.dio.get('/favorites/shops');
  final data = response.data;
  final items = data is List ? data : (data['items'] as List);
  return items
      .map((item) => Shop.fromJson(Map<String, dynamic>.from(item as Map)))
      .toList();
});
