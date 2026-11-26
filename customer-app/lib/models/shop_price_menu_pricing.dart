/// Optional display-menu metadata. These amounts never create a booking SKU or
/// supply a checkout amount; malformed metadata is ignored as one whole value.
class ShopPriceMenuPricing {
  final String kind;
  final String baseName;
  final int? durationMin;
  final int priceCents;
  final String titleMode;
  final ShopPriceMenuLegacySource? legacySource;

  const ShopPriceMenuPricing._({
    required this.kind,
    required this.baseName,
    required this.durationMin,
    required this.priceCents,
    required this.titleMode,
    this.legacySource,
  });

  static const _kinds = {'TIMED', 'PER_SESSION', 'VARIABLE', 'ADD_ON'};
  static const _keys = {
    'kind', 'baseName', 'durationMin', 'priceCents', 'titleMode', 'legacySource',
  };

  static ShopPriceMenuPricing? parse(dynamic value) {
    if (value is! Map ||
        value.keys.any((key) => key is! String || !_keys.contains(key)) ||
        !_kinds.contains(value['kind']) ||
        !{'AUTO', 'CUSTOM'}.contains(value['titleMode']) ||
        !value.containsKey('durationMin') ||
        !_plain(value['baseName'], 200, nonempty: true)) {
      return null;
    }
    final cents = _integer(value['priceCents'], 0, 99999999);
    if (cents == null) return null;
    final timed = value['kind'] == 'TIMED';
    final duration = _integer(value['durationMin'], 1, 1440);
    if (timed ? duration == null : value['durationMin'] != null) return null;
    ShopPriceMenuLegacySource? legacy;
    if (value.containsKey('legacySource')) {
      final source = value['legacySource'];
      if (source is! Map ||
          source.length != 2 ||
          source.keys.any((key) => key != 'name' && key != 'priceText') ||
          !_plain(source['name'], 300) ||
          !_plain(source['priceText'], 300)) {
        return null;
      }
      legacy = ShopPriceMenuLegacySource._(
        source['name'] as String,
        source['priceText'] as String,
      );
    }
    return ShopPriceMenuPricing._(
      kind: value['kind'] as String,
      baseName: (value['baseName'] as String).trim(),
      durationMin: timed ? duration : null,
      priceCents: cents,
      titleMode: value['titleMode'] as String,
      legacySource: legacy,
    );
  }

  static int? _integer(dynamic value, int min, int max) {
    if (value is! num ||
        !value.isFinite ||
        value < min ||
        value > max ||
        value.remainder(1) != 0) {
      return null;
    }
    return value.toInt();
  }

  static bool _plain(dynamic value, int max, {bool nonempty = false}) =>
      value is String &&
      value.length <= max &&
      (!nonempty || value.trim().isNotEmpty) &&
      !RegExp(r'[\u0000-\u001f\u007f]').hasMatch(value) &&
      !RegExp(r'</?[a-z][^>]*>', caseSensitive: false).hasMatch(value);

  String get _dollars {
    final fraction = priceCents % 100;
    final tail = fraction == 0
        ? ''
        : '.${fraction.toString().padLeft(2, '0').replaceFirst(RegExp(r'0$'), '')}';
    return '${priceCents ~/ 100}$tail';
  }

  String get automaticTitle {
    final money = '\$$_dollars';
    switch (kind) {
      case 'TIMED':
        return '$durationMin min $baseName $money';
      case 'PER_SESSION':
        return '$baseName $money / session';
      case 'VARIABLE':
        return '$baseName $money · Duration varies';
      default:
        return '$baseName +$money · Add-on';
    }
  }

  bool matchesAutomaticTitle(dynamic title) =>
      title == automaticTitle ||
      kind == 'TIMED' && title == '${durationMin}Mins $baseName \$$_dollars';

  String get kindLabel {
    switch (kind) {
      case 'TIMED':
        return 'Fixed duration';
      case 'PER_SESSION':
        return 'Per session';
      case 'VARIABLE':
        return 'Duration varies';
      default:
        return 'Add-on';
    }
  }

  String get badge {
    if (titleMode != 'CUSTOM') return kindLabel;
    final money = '${kind == 'ADD_ON' ? '+' : ''}\$$_dollars';
    return kind == 'TIMED'
        ? '$durationMin min · $money'
        : '$kindLabel · $money';
  }

  Map<String, Object?> toJson() => {
    'kind': kind,
    'baseName': baseName,
    'durationMin': durationMin,
    'priceCents': priceCents,
    'titleMode': titleMode,
    if (legacySource != null) 'legacySource': legacySource!.toJson(),
  };
}

class ShopPriceMenuLegacySource {
  final String name;
  final String priceText;
  const ShopPriceMenuLegacySource._(this.name, this.priceText);
  Map<String, String> toJson() => {'name': name, 'priceText': priceText};
}
