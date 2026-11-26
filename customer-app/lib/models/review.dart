/// MJAPP — Review model
class Review {
  final String id;
  final String? bookingId;
  final int rating;
  final String? content;
  final DateTime? createdAt;
  final ReviewUser? user;
  final ReviewShop? shop;

  Review({
    required this.id,
    required this.rating,
    this.bookingId,
    this.content,
    this.createdAt,
    this.user,
    this.shop,
  });

  factory Review.fromJson(Map<String, dynamic> json) {
    DateTime? parsedDate;
    if (json['createdAt'] != null) {
      parsedDate = DateTime.tryParse(json['createdAt'] as String);
    }
    return Review(
      id: json['id']?.toString() ?? '',
      bookingId: json['bookingId']?.toString(),
      rating: json['rating'] ?? 5,
      content: json['content'],
      createdAt: parsedDate,
      user: json['user'] != null ? ReviewUser.fromJson(json['user']) : null,
      shop: json['shop'] != null ? ReviewShop.fromJson(json['shop']) : null,
    );
  }

  String get formattedDate {
    if (createdAt == null) return '';
    return '${createdAt!.year}-${createdAt!.month.toString().padLeft(2, '0')}-${createdAt!.day.toString().padLeft(2, '0')}';
  }
}

class ReviewUser {
  final String? name;
  final String? avatarUrl;

  ReviewUser({this.name, this.avatarUrl});

  factory ReviewUser.fromJson(Map<String, dynamic> json) => ReviewUser(
    name: json['name'],
    avatarUrl: json['avatarUrl'],
  );
}

class ReviewShop {
  final String id;
  final String name;

  ReviewShop({required this.id, required this.name});

  factory ReviewShop.fromJson(Map<String, dynamic> json) => ReviewShop(
    id: json['id']?.toString() ?? '',
    name: json['name'] ?? '',
  );
}
