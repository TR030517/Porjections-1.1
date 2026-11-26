import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api_service.dart';

final supportServiceProvider = Provider<SupportService>(
  (ref) => SupportService(ref.watch(apiServiceProvider).dio),
);

class PublicSupport {
  final String siteName;
  final String? email;
  final String? phone;
  const PublicSupport({required this.siteName, this.email, this.phone});

  factory PublicSupport.fromJson(Map<String, dynamic> json) {
    final name = json['siteName'];
    final email = json['email'];
    final phone = json['phone'];
    if (name is! String ||
        name.isEmpty ||
        name.length > 200 ||
        email != null &&
            (email is! String ||
                email.length > 255 ||
                !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) ||
        phone != null &&
            (phone is! String ||
                !RegExp(r'^[+\d() .-]+$').hasMatch(phone) ||
                phone.replaceAll(RegExp(r'\D'), '').length < 7 ||
                phone.replaceAll(RegExp(r'\D'), '').length > 15)) {
      throw const FormatException('Invalid support contact response');
    }
    return PublicSupport(
      siteName: name,
      email: email as String?,
      phone: phone as String?,
    );
  }
}

class SupportService {
  final Dio dio;
  SupportService(this.dio);
  Future<PublicSupport> load() async {
    final response = await dio.get(
      '/public/support',
      options: Options(extra: {'publicRead': true}),
    );
    if (response.data is! Map<String, dynamic>) {
      throw const FormatException('Invalid support response');
    }
    return PublicSupport.fromJson(response.data as Map<String, dynamic>);
  }
}
