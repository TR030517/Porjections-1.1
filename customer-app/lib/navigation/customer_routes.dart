/// Public links distinguish current IDs from explicitly mapped legacy IDs.
/// Never accept an external return URL or silently select a different shop.
class CustomerShopEntry {
  final String? shortName;
  final String? legacyId;
  final String? currentId;
  const CustomerShopEntry._({this.shortName, this.legacyId, this.currentId});

  static final _slug = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');
  static final _id = RegExp(r'^[1-9][0-9]*$');
  static const _reserved = {
    'admin',
    'merchant',
    'api',
    'auth',
    'login',
    'signin',
    'signup',
    'register',
    'logout',
    'shop',
    'static',
    'health',
    'favicon',
    'robots',
    'sitemap',
    'payments',
    'bookings',
    'account',
    'profile',
    'home',
    'search',
    'about',
    'support',
    'feedback',
    'terms',
    'privacy',
    's',
    'store',
    'shops',
    'assets',
    'icons',
    'canvaskit',
    'h5',
    'pages',
  };

  static CustomerShopEntry? fromUri(Uri uri) {
    if (uri.hasScheme || uri.hasAuthority) return null;
    final parts = uri.pathSegments.where((part) => part.isNotEmpty).toList();
    if (parts.length == 2 && parts.first == 'shops' && _id.hasMatch(parts[1])) {
      return CustomerShopEntry._(currentId: parts[1]);
    }
    if (parts.length == 1 && parts.first.startsWith('store-')) {
      final id = parts.first.substring(6);
      return _id.hasMatch(id) ? CustomerShopEntry._(legacyId: id) : null;
    }
    if (parts.isNotEmpty &&
        const {
          'storedetails',
          'storedetails.html',
          'shopdetails',
          'shopdetails.html',
        }.contains(parts.last.toLowerCase())) {
      final ids = uri.queryParametersAll['id'];
      return ids?.length == 1 && _id.hasMatch(ids!.single)
          ? CustomerShopEntry._(legacyId: ids.single)
          : null;
    }
    final candidate = parts.length == 2 && parts.first == 's'
        ? parts[1]
        : parts.length == 1
        ? parts.first
        : null;
    if (candidate == null) return null;
    final slug = candidate.trim().toLowerCase();
    if (slug.length < 3 ||
        slug.length > 100 ||
        !_slug.hasMatch(slug) ||
        _reserved.contains(slug) ||
        RegExp(r'^store-[0-9]+$').hasMatch(slug)) {
      return null;
    }
    return CustomerShopEntry._(shortName: slug);
  }
}

String initialCustomerLocation(Uri location) {
  // Old H5 used hash routes. Only a relative application fragment is parsed.
  final fragment = location.fragment;
  if (fragment.startsWith('/') && !fragment.startsWith('//')) {
    final route = Uri.tryParse(fragment);
    if (route != null && !route.hasScheme && !route.hasAuthority) {
      return route.toString();
    }
  }
  return Uri(
    path: location.path.isEmpty ? '/' : location.path,
    query: location.hasQuery ? location.query : null,
  ).toString();
}

String? safeCanonicalShopPath(String? value) {
  final uri = Uri.tryParse(value ?? '');
  if (uri == null ||
      uri.hasScheme ||
      uri.hasAuthority ||
      uri.hasQuery ||
      uri.hasFragment ||
      !uri.path.startsWith('/s/')) {
    return null;
  }
  final entry = CustomerShopEntry.fromUri(uri);
  return entry?.shortName == null ? null : '/s/${entry!.shortName}';
}

Uri? publicShopShareUri(String? canonicalPath, {Uri? origin}) {
  final path = safeCanonicalShopPath(canonicalPath);
  final base = origin ?? Uri.base;
  if (path == null ||
      !const {'http', 'https'}.contains(base.scheme) ||
      base.host.isEmpty ||
      base.userInfo.isNotEmpty) {
    return null;
  }
  return Uri.parse(base.origin).resolve(path);
}
