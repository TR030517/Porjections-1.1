import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/review_provider.dart';
import '../providers/shop_provider.dart';
import '../services/review_error.dart';
import '../l10n/app_localizations.dart';

/// Review Form Screen — star rating, optional content, submit/edit
class ReviewFormScreen extends ConsumerStatefulWidget {
  final String bookingId;
  final String shopId;
  final String? editReviewId;
  final int? editRating;
  final String? editContent;

  const ReviewFormScreen({
    super.key,
    required this.bookingId,
    required this.shopId,
    this.editReviewId,
    this.editRating,
    this.editContent,
  });

  @override
  ConsumerState<ReviewFormScreen> createState() => _ReviewFormScreenState();
}

class _ReviewFormScreenState extends ConsumerState<ReviewFormScreen> {
  late int _rating;
  late TextEditingController _contentController;
  bool _isSubmitting = false;

  bool get _isEditing => widget.editReviewId != null;

  @override
  void initState() {
    super.initState();
    _rating = widget.editRating ?? 0;
    _contentController = TextEditingController(text: widget.editContent ?? '');
  }

  @override
  void dispose() {
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_isSubmitting ||
        !canWriteShopReview(
          widget.shopId,
          widget.shopId.isEmpty
              ? null
              : ref.read(shopDetailProvider(widget.shopId)),
        )) {
      return;
    }
    if (_rating == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.pleaseSelectRating),
        ),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      if (_isEditing) {
        await ref
            .read(reviewRepositoryProvider)
            .updateReview(
              reviewId: widget.editReviewId!,
              rating: _rating,
              content: _contentController.text.trim().isEmpty
                  ? null
                  : _contentController.text.trim(),
            );
      } else {
        await ref
            .read(reviewRepositoryProvider)
            .createReview(
              bookingId: widget.bookingId,
              rating: _rating,
              content: _contentController.text.trim().isEmpty
                  ? null
                  : _contentController.text.trim(),
            );
      }

      ref.invalidate(myReviewsProvider);
      ref.invalidate(shopReviewsProvider(widget.shopId));
      ref.invalidate(shopListProvider);
      ref.invalidate(shopDetailProvider(widget.shopId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _isEditing
                  ? AppLocalizations.of(context)!.reviewUpdated
                  : AppLocalizations.of(context)!.reviewSubmitted,
            ),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(reviewWriteError(e)),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final availability = widget.shopId.isEmpty
        ? null
        : ref.watch(shopDetailProvider(widget.shopId));
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _isEditing
              ? AppLocalizations.of(context)!.editReview
              : AppLocalizations.of(context)!.writeAReview,
        ),
      ),
      body: availability == null
          ? const Center(
              child: Text(
                'Review availability cannot be verified for this shop.',
              ),
            )
          : availability.when(
              skipLoadingOnRefresh: false,
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Unable to check whether this shop is accepting reviews.',
                      ),
                      TextButton(
                        onPressed: () =>
                            ref.invalidate(shopDetailProvider(widget.shopId)),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
              data: (shop) => shop.id != widget.shopId
                  ? const Center(
                      child: Text(
                        'Review availability cannot be verified for this shop.',
                      ),
                    )
                  : shop.reviewsEnabled
                  ? _buildForm(context)
                  : const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'This shop is not accepting new or updated reviews.',
                        ),
                      ),
                    ),
            ),
    );
  }

  Widget _buildForm(BuildContext context) {
    final theme = Theme.of(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const SizedBox(height: 16),
          Text(
            _isEditing
                ? AppLocalizations.of(context)!.updateYourRating
                : AppLocalizations.of(context)!.rateYourExperience,
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            AppLocalizations.of(context)!.tapStarToRate,
            style: TextStyle(color: Colors.grey[600]),
          ),
          const SizedBox(height: 24),

          // Star rating
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(5, (index) {
              final starNum = index + 1;
              return IconButton(
                iconSize: 48,
                icon: Icon(
                  starNum <= _rating ? Icons.star : Icons.star_border,
                  color: starNum <= _rating ? Colors.amber : Colors.grey[400],
                ),
                onPressed: () => setState(() => _rating = starNum),
              );
            }),
          ),

          if (_rating > 0) ...[
            const SizedBox(height: 8),
            Text(
              _ratingLabel(_rating),
              style: TextStyle(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],

          const SizedBox(height: 32),

          // Content textarea
          TextField(
            controller: _contentController,
            maxLines: 5,
            maxLength: 500,
            decoration: InputDecoration(
              hintText: AppLocalizations.of(context)!.shareExperienceOptional,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              filled: true,
              fillColor: Colors.grey[50],
            ),
          ),

          const SizedBox(height: 32),

          // Submit button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton(
              onPressed: _isSubmitting || _rating == 0 ? null : _submit,
              child: _isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      _isEditing
                          ? AppLocalizations.of(context)!.updateReviewBtn
                          : AppLocalizations.of(context)!.submitReview,
                      style: const TextStyle(fontSize: 16),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  String _ratingLabel(int rating) {
    switch (rating) {
      case 1:
        return AppLocalizations.of(context)!.ratingPoor;
      case 2:
        return AppLocalizations.of(context)!.ratingFair;
      case 3:
        return AppLocalizations.of(context)!.ratingGood;
      case 4:
        return AppLocalizations.of(context)!.ratingVeryGood;
      case 5:
        return AppLocalizations.of(context)!.ratingExcellent;
      default:
        return '';
    }
  }
}
