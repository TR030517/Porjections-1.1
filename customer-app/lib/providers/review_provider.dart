import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/review.dart';
import '../services/api_service.dart';
import 'auth_provider.dart';

/// Provider for review API calls
final reviewRepositoryProvider = Provider<ReviewRepository>((ref) {
  return ReviewRepository(ref.read(apiServiceProvider));
});

class ReviewRepository {
  final ApiService _api;
  ReviewRepository(this._api);

  Future<Review> createReview({
    required String bookingId,
    required int rating,
    String? content,
  }) async {
    final data = await _api.createReview(
      bookingId: bookingId,
      rating: rating,
      content: content,
    );
    return Review.fromJson(data);
  }

  Future<ReviewListResponse> getShopReviews(
    String shopId, {
    int page = 1,
    int limit = 5,
  }) async {
    final data = await _api.getShopReviews(shopId, page: page, limit: limit);
    final items =
        (data['items'] as List<dynamic>?)
            ?.map((r) => Review.fromJson(r as Map<String, dynamic>))
            .toList() ??
        [];
    return ReviewListResponse(
      items: items,
      total: data['total'] ?? items.length,
      page: data['page'] ?? page,
      limit: data['limit'] ?? limit,
    );
  }

  Future<List<Review>> getMyReviews() async {
    final data = await _api.getMyReviews();
    return data.map((r) => Review.fromJson(r as Map<String, dynamic>)).toList();
  }

  Future<Review> updateReview({
    required String reviewId,
    int? rating,
    String? content,
  }) async {
    final data = await _api.updateReview(
      reviewId: reviewId,
      rating: rating,
      content: content,
    );
    return Review.fromJson(data);
  }

  Future<void> deleteReview(String reviewId) async {
    await _api.deleteReview(reviewId);
  }
}

class ReviewListResponse {
  final List<Review> items;
  final int total;
  final int page;
  final int limit;

  ReviewListResponse({
    required this.items,
    required this.total,
    required this.page,
    required this.limit,
  });
}

/// Shop reviews provider — keyed by shopId
final shopReviewsProvider = FutureProvider.family<List<Review>, String>((
  ref,
  shopId,
) async {
  final repo = ref.read(reviewRepositoryProvider);
  final response = await repo.getShopReviews(shopId);
  return response.items;
});

/// User's own reviews
final myReviewsProvider = FutureProvider<List<Review>>((ref) async {
  if (ref.watch(authProvider.select((state) => state.user?.id)) == null) {
    return [];
  }
  final repo = ref.read(reviewRepositoryProvider);
  return repo.getMyReviews();
});

/// Provider for creating a review (triggered by notifier)
final createReviewProvider = FutureProvider.family<Review, CreateReviewParams>((
  ref,
  params,
) async {
  final repo = ref.read(reviewRepositoryProvider);
  return repo.createReview(
    bookingId: params.bookingId,
    rating: params.rating,
    content: params.content,
  );
});

class CreateReviewParams {
  final String bookingId;
  final int rating;
  final String? content;

  CreateReviewParams({
    required this.bookingId,
    required this.rating,
    this.content,
  });
}
