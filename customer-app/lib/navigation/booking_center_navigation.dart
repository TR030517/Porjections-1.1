import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../screens/booking_list_screen.dart';
import 'customer_navigation.dart';

/// All customer booking shortcuts reuse the same home tab and query state.
void openBookingCenter(BuildContext context, WidgetRef ref, {bool history = false}) {
  final query = ref.read(bookingQueryProvider);
  ref.read(bookingQueryProvider.notifier).state = query.withView(history ? 'HISTORY' : 'ALL');
  openCustomerHome(context, initialTab: 1);
}
