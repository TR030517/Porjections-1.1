import 'media_url.dart';

/// User model
class User {
  final String id;
  final String? phone;
  final String? email;
  final bool emailVerified;
  final String? name;
  final String? avatarUrl;
  final String role;
  final String? status;

  User({
    required this.id,
    this.phone,
    this.email,
    this.emailVerified = false,
    this.name,
    this.avatarUrl,
    required this.role,
    this.status,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id']?.toString() ?? '',
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      emailVerified: json['emailVerified'] == true,
      name: json['name'] as String?,
      avatarUrl: resolveCustomerMediaUrl(json['avatarUrl']),
      role: json['role'] as String? ?? 'CUSTOMER',
      status: json['status'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'phone': phone,
    'email': email,
    'emailVerified': emailVerified,
    'name': name,
    'avatarUrl': avatarUrl,
    'role': role,
  };
}
