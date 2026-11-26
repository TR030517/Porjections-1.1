import 'package:flutter/material.dart';

/// Shared customer website palette, matching the Massajoy 2.0 workspace.
abstract final class CustomerPalette {
  static const brand = Color(0xFF48A1A1);
  static const action = Color(0xFF287C7C);
  static const ink = Color(0xFF1E293B);
  static const muted = Color(0xFF64748B);
  static const background = Color(0xFFF5F7FA);
  static const border = Color(0xFFE5EAF0);
  static const tint = Color(0xFFF0F9F9);
  static const surface = Color(0xFFFFFFFF);

  static Color shopAccent(String? key) => switch (key) {
    'forest' => const Color(0xFF2D6A4F),
    'blue' => const Color(0xFF32648A),
    'rose' => const Color(0xFF8E4552),
    'slate' => const Color(0xFF45515C),
    _ => action,
  };

  static Color shopTint(String? key, {double opacity = 0.09}) =>
      Color.alphaBlend(shopAccent(key).withValues(alpha: opacity), surface);

  static Color shopPageBackground(String? key) =>
      Color.alphaBlend(shopAccent(key).withValues(alpha: 0.025), background);

  static Color shopBorder(String? key) =>
      Color.alphaBlend(shopAccent(key).withValues(alpha: 0.12), border);
}

/// Customer interface copy stays English even inside a locale override.
/// Keep the existing call signature; shop and customer content is not translated.
String customerText(BuildContext context, String en, String zh) => en;

/// A compact wordmark that works in both the website header and sign-in form.
class CustomerBrand extends StatelessWidget {
  final bool compact;
  const CustomerBrand({super.key, this.compact = false});

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: compact ? 32 : 38,
        height: compact ? 32 : 38,
        decoration: BoxDecoration(
          color: CustomerPalette.tint,
          border: Border.all(color: CustomerPalette.border),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Icon(
          Icons.spa_outlined,
          color: CustomerPalette.action,
          size: 21,
        ),
      ),
      const SizedBox(width: 10),
      Text(
        'Massajoy',
        style: TextStyle(
          fontSize: compact ? 19 : 22,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.6,
          color: CustomerPalette.ink,
        ),
      ),
    ],
  );
}

ThemeData buildCustomerTheme({String? shopBrandColor}) {
  final accent = shopBrandColor == null
      ? CustomerPalette.action
      : CustomerPalette.shopAccent(shopBrandColor);
  final accentTint = shopBrandColor == null
      ? CustomerPalette.tint
      : CustomerPalette.shopTint(shopBrandColor);
  final accentBorder = shopBrandColor == null
      ? CustomerPalette.border
      : CustomerPalette.shopBorder(shopBrandColor);
  final pageBackground = shopBrandColor == null
      ? CustomerPalette.background
      : CustomerPalette.shopPageBackground(shopBrandColor);
  final scheme = ColorScheme.fromSeed(
    seedColor: accent,
    brightness: Brightness.light,
    primary: accent,
    onPrimary: CustomerPalette.surface,
    primaryContainer: accentTint,
    onPrimaryContainer: accent,
    secondary: accent,
    onSecondary: CustomerPalette.surface,
    secondaryContainer: accentTint,
    onSecondaryContainer: accent,
    tertiary: accent,
    surface: CustomerPalette.surface,
    onSurface: CustomerPalette.ink,
    onSurfaceVariant: CustomerPalette.muted,
    surfaceContainerHighest: pageBackground,
    outline: accentBorder,
    outlineVariant: accentBorder,
  );
  final rounded = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(14),
  );
  final inputBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(10),
    borderSide: BorderSide(color: accentBorder),
  );
  final textTheme = ThemeData(useMaterial3: true).textTheme.copyWith(
    headlineLarge: const TextStyle(
      fontSize: 32,
      height: 1.25,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.8,
      color: CustomerPalette.ink,
    ),
    headlineMedium: const TextStyle(
      fontSize: 28,
      height: 1.3,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.6,
      color: CustomerPalette.ink,
    ),
    headlineSmall: const TextStyle(
      fontSize: 24,
      height: 1.35,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.4,
      color: CustomerPalette.ink,
    ),
    titleLarge: const TextStyle(
      fontSize: 20,
      height: 1.4,
      fontWeight: FontWeight.w600,
      color: CustomerPalette.ink,
    ),
    titleMedium: const TextStyle(
      fontSize: 16,
      height: 1.5,
      fontWeight: FontWeight.w600,
      color: CustomerPalette.ink,
    ),
    titleSmall: const TextStyle(
      fontSize: 14,
      height: 1.5,
      fontWeight: FontWeight.w600,
      color: CustomerPalette.ink,
    ),
    bodyLarge: const TextStyle(
      fontSize: 16,
      height: 1.6,
      color: CustomerPalette.ink,
    ),
    bodyMedium: const TextStyle(
      fontSize: 14,
      height: 1.6,
      color: CustomerPalette.ink,
    ),
    bodySmall: const TextStyle(
      fontSize: 12,
      height: 1.5,
      color: CustomerPalette.muted,
    ),
    labelLarge: const TextStyle(
      fontSize: 14,
      height: 1.4,
      fontWeight: FontWeight.w600,
    ),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: pageBackground,
    textTheme: textTheme,
    dividerColor: CustomerPalette.border,
    visualDensity: VisualDensity.standard,
    cardTheme: CardThemeData(
      color: CustomerPalette.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: accentBorder),
      ),
      clipBehavior: Clip.antiAlias,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: CustomerPalette.surface,
      foregroundColor: CustomerPalette.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: CustomerPalette.ink,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      elevation: 0,
      backgroundColor: CustomerPalette.surface,
      surfaceTintColor: Colors.transparent,
       indicatorColor: accentTint,
      indicatorShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
      ),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w600
              : FontWeight.w400,
          color: states.contains(WidgetState.selected)
              ? accent
              : CustomerPalette.muted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          size: 22,
          color: states.contains(WidgetState.selected)
              ? accent
              : CustomerPalette.muted,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 46),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
        backgroundColor: accent,
        foregroundColor: CustomerPalette.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 46),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
        foregroundColor: accent,
        side: BorderSide(color: accentBorder),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(0, 40),
        foregroundColor: accent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: const Size(0, 46),
        elevation: 0,
        backgroundColor: accent,
        foregroundColor: CustomerPalette.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: CustomerPalette.surface,
      border: inputBorder,
      enabledBorder: inputBorder,
      focusedBorder: inputBorder.copyWith(
        borderSide: BorderSide(color: accent, width: 1.5),
      ),
      errorBorder: inputBorder.copyWith(
        borderSide: BorderSide(color: scheme.error),
      ),
      focusedErrorBorder: inputBorder.copyWith(
        borderSide: BorderSide(color: scheme.error, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      labelStyle: const TextStyle(fontSize: 14, color: CustomerPalette.muted),
      hintStyle: const TextStyle(fontSize: 14, color: CustomerPalette.muted),
      prefixIconColor: CustomerPalette.muted,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: CustomerPalette.surface,
      selectedColor: accentTint,
      side: BorderSide(color: accentBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      labelStyle: const TextStyle(fontSize: 13, color: CustomerPalette.ink),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: CustomerPalette.surface,
      surfaceTintColor: Colors.transparent,
      shape: rounded,
      titleTextStyle: textTheme.titleLarge,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: CustomerPalette.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: CustomerPalette.ink,
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      contentTextStyle: const TextStyle(
        color: CustomerPalette.surface,
        fontSize: 14,
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: CustomerPalette.border,
      thickness: 1,
      space: 1,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: CustomerPalette.action,
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: CustomerPalette.action,
      foregroundColor: CustomerPalette.surface,
      elevation: 0,
    ),
  );
}
