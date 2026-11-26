import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Customer pages use English regardless of the browser or device language.
const customerLocale = Locale('en');
const List<Locale> supportedLocales = [customerLocale];

final localeProvider = StateNotifierProvider<LocaleNotifier, Locale>((ref) {
  return LocaleNotifier();
});

class LocaleNotifier extends StateNotifier<Locale> {
  LocaleNotifier() : super(customerLocale);

  /// Preserve the existing interface while enforcing the customer language.
  void setLocale(Locale locale) {
    state = customerLocale;
  }

  Locale detectLocale(Locale? deviceLocale) {
    state = customerLocale;
    return customerLocale;
  }
}
