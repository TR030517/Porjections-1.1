import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider tracking the current display mode for shops.
/// `false` = list view, `true` = map view.
final viewModeProvider = StateProvider<bool>((ref) => false);
