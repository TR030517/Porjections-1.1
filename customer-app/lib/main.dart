import 'dart:developer' as developer;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'services/fcm_service.dart';
import 'services/browser_routing.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  configureBrowserRouting();

  // Attempt Firebase / FCM initialisation in the background.
  // In dev/mock mode without Firebase config, this silently degrades.
  if (const bool.fromEnvironment('FCM_ENABLED')) {
    FcmService.init()
        .then((_) {
          developer.log('FCM: Background init completed', name: 'main');
        })
        .catchError((Object _) {
          developer.log(
            'FCM: Background init failed — app continues without push.',
            name: 'main',
          );
        });
  }

  runApp(const ProviderScope(child: MassajoyApp()));
}
