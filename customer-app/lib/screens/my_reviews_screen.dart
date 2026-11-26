import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/review_provider.dart';
import '../providers/shop_provider.dart';
import '../services/review_error.dart';
import '../l10n/app_localizations.dart';
import 'review_form_screen.dart';
import 'booking_list_screen.dart' show bookingPageProvider;

/// My Reviews Screen — shows current user's written reviews with edit/delete
class MyReviewsScreen extends ConsumerWidget {
  const MyReviewsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final reviewsAsync = ref.watch(myReviewsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(AppLocalizations.of(context)!.myReviews)),
      body: reviewsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
              const SizedBox(height: 16),
              Text(
                AppLocalizations.of(context)!.failedToLoadReviews,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              FilledButton.tonal(
                onPressed: () => ref.invalidate(myReviewsProvider),
                child: Text(AppLocalizations.of(context)!.retry),
              ),
            ],
          ),
        ),
        data: (reviews) {
          if (reviews.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.rate_review_outlined,
                    size: 80,
                    color: Colors.grey[300],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    AppLocalizations.of(context)!.noReviewsYet,
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: Colors.grey[600],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    AppLocalizations.of(context)!.noReviewsYetHint,
                    style: TextStyle(color: Colors.grey[500]),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              for (final review in reviews) {
                final shopId = review.shop?.id;
                if (shopId != null && shopId.isNotEmpty) {
                  ref.invalidate(shopDetailProvider(shopId));
                }
              }
              ref.invalidate(myReviewsProvider);
              await ref.read(myReviewsProvider.future);
            },
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: reviews.length,
              itemBuilder: (context, index) {
                final review = reviews[index];
                return _ReviewCard(review: review);
              },
            ),
          );
        },
      ),
    );
  }
}

class _ReviewCard extends ConsumerWidget {
  final dynamic review;
  const _ReviewCard({required this.review});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    final String shopId = review.shop?.id ?? '';
    final availability = shopId.isEmpty
        ? null
        : ref.watch(shopDetailProvider(shopId));
    final canEdit = canWriteShopReview(shopId, availability);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header: shop name + actions
            Row(
              children: [
                Icon(Icons.store, size: 18, color: Colors.grey[600]),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    review.shop?.name ?? 'Massage Shop',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                PopupMenuButton<String>(
                  key: ValueKey('review-actions:${review.id}'),
                  onSelected: (value) async {
                    if (value == 'edit') {
                      if (!canWriteShopReview(
                        shopId,
                        shopId.isEmpty
                            ? null
                            : ref.read(shopDetailProvider(shopId)),
                      )) {
                        return;
                      }
                      final result = await Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ReviewFormScreen(
                            bookingId: review.bookingId ?? '',
                            shopId: review.shop?.id ?? '',
                            editReviewId: review.id.toString(),
                            editRating: review.rating,
                            editContent: review.content,
                          ),
                        ),
                      );
                      if (result == true) {
                        ref.invalidate(myReviewsProvider);
                        ref.invalidate(bookingPageProvider);
                        ref.invalidate(shopListProvider);
                        if (review.shop?.id != null &&
                            review.shop!.id.isNotEmpty) {
                          ref.invalidate(shopDetailProvider(review.shop!.id));
                          ref.invalidate(shopReviewsProvider(review.shop!.id));
                        }
                      }
                    } else if (value == 'delete') {
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: Text(
                            AppLocalizations.of(context)!.deleteReview,
                          ),
                          content: Text(
                            AppLocalizations.of(context)!.deleteReviewConfirm,
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(ctx, false),
                              child: Text(AppLocalizations.of(context)!.cancel),
                            ),
                            TextButton(
                              onPressed: () => Navigator.pop(ctx, true),
                              style: TextButton.styleFrom(
                                foregroundColor: Colors.red,
                              ),
                              child: Text(AppLocalizations.of(context)!.delete),
                            ),
                          ],
                        ),
                      );
                      if (confirmed == true) {
                        try {
                          await ref
                              .read(reviewRepositoryProvider)
                              .deleteReview(review.id.toString());
                          ref.invalidate(myReviewsProvider);
                          ref.invalidate(bookingPageProvider);
                          ref.invalidate(shopListProvider);
                          if (review.shop?.id != null &&
                              review.shop!.id.isNotEmpty) {
                            ref.invalidate(shopDetailProvider(review.shop!.id));
                            ref.invalidate(
                              shopReviewsProvider(review.shop!.id),
                            );
                          }
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  AppLocalizations.of(context)!.reviewDeleted,
                                ),
                                backgroundColor: Colors.green,
                              ),
                            );
                          }
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(reviewDeleteError(e)),
                                backgroundColor: Colors.red,
                              ),
                            );
                          }
                        }
                      }
                    }
                  },
                  itemBuilder: (ctx) => [
                    PopupMenuItem(
                      value: 'edit',
                      enabled: canEdit,
                      child: ListTile(
                        leading: Icon(Icons.edit),
                        title: Text(AppLocalizations.of(context)!.edit),
                      ),
                    ),
                    PopupMenuItem(
                      value: 'delete',
                      child: ListTile(
                        leading: Icon(Icons.delete, color: Colors.red),
                        title: Text(
                          AppLocalizations.of(context)!.delete,
                          style: TextStyle(color: Colors.red),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Stars + date
            Row(
              children: [
                ...List.generate(
                  5,
                  (i) => Icon(
                    i < review.rating ? Icons.star : Icons.star_border,
                    size: 18,
                    color: Colors.amber,
                  ),
                ),
                const SizedBox(width: 8),
                if (review.createdAt != null)
                  Text(
                    review.formattedDate,
                    style: TextStyle(color: Colors.grey[500], fontSize: 12),
                  ),
              ],
            ),
            const SizedBox(height: 8),

            // Content
            if (review.content != null && review.content!.isNotEmpty)
              Text(
                review.content!,
                style: TextStyle(color: Colors.grey[700], height: 1.4),
              ),
          ],
        ),
      ),
    );
  }
}
