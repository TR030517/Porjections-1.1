/// Public shop values only. No owner, account, staff or booking contact fallback.
String? publicContactText(Object? value, int maxLength) {
  if (value is! String ||
      value.length > maxLength ||
      RegExp(r'[\x00-\x1f\x7f]').hasMatch(value)) {
    return null;
  }
  final text = value.trim();
  return text.isEmpty ? null : text;
}

Uri? publicPhoneUri(Object? value) {
  final phone = publicContactText(value, 40);
  if (phone == null || !RegExp(r'^\+?[0-9(). -]+$').hasMatch(phone)) {
    return null;
  }
  final number = phone.replaceAll(RegExp(r'[(). -]'), '');
  final digits = number.startsWith('+') ? number.substring(1) : number;
  if (!RegExp(r'^[0-9]{7,15}$').hasMatch(digits)) return null;
  return Uri(scheme: 'tel', path: number);
}

Uri? publicEmailUri(Object? value) {
  final email = publicContactText(value, 255);
  if (email == null || !RegExp(r'^[\x21-\x7e]+$').hasMatch(email)) return null;
  final parts = email.split('@');
  if (parts.length != 2 ||
      parts.first.length > 64 ||
      !RegExp(r'^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$')
          .hasMatch(parts.first)) {
    return null;
  }
  final labels = parts.last.split('.');
  if (labels.length < 2 ||
      labels.any((label) =>
          label.length > 63 ||
          !RegExp(r'^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$')
              .hasMatch(label))) {
    return null;
  }
  return Uri(scheme: 'mailto', path: email);
}

List<String> _contacts(Object? raw, Uri? Function(Object?) target) {
  // A malformed authoritative array must not resurrect a legacy contact.
  if (raw is! List || raw.any((value) => value is! String)) return const [];
  final values = <String>[], seen = <String>{};
  for (final value in raw) {
    final uri = target(value);
    if (uri == null || !seen.add(uri.path.toLowerCase())) continue;
    values.add((value as String).trim());
    if (values.length == 5) break;
  }
  return List.unmodifiable(values);
}

List<String> publicShopPhones(Map<String, dynamic> json) =>
    _contacts(json.containsKey('phones') ? json['phones'] : [json['phone']],
        publicPhoneUri);

List<String> publicShopEmails(Map<String, dynamic> json) =>
    _contacts(json['emails'], publicEmailUri);

Map<String, String> publicShopExternalLinks(Object? value) {
  if (value is! Map) return const {};
  const domains = <String, List<String>>{
    'website': [],
    'instagram': ['instagram.com'],
    'facebook': ['facebook.com', 'fb.com'],
  };
  final output = <String, String>{};
  for (final entry in domains.entries) {
    final text = publicContactText(value[entry.key], 500);
    final uri = text == null ? null : Uri.tryParse(text);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        entry.value.isNotEmpty && !entry.value.any((domain) =>
            uri.host.toLowerCase() == domain ||
            uri.host.toLowerCase().endsWith('.$domain'))) {
      continue;
    }
    output[entry.key] = uri.toString();
  }
  return Map.unmodifiable(output);
}

String publicShopAddress({
  required Object? address,
  Object? city,
  Object? state,
  Object? zipCode,
}) {
  final street = publicContactText(address, 500);
  final candidates = [
    publicContactText(city, 500),
    publicContactText(state, 500),
    publicContactText(zipCode, 500),
  ];
  const stateCodes = <String, String>{
    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
    'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
    'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
    'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
    'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
    'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
    'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
    'district of columbia':'DC',
  };
  var streetText = street ?? '';
  String comparable(String value) => value.toLowerCase().replaceAll(RegExp(r'[\s,.\-#]+'), ' ').trim();
  final streetKey = comparable(streetText);
  bool containsPhrase(String haystack, String phrase) =>
      RegExp(r'(^| )' + RegExp.escape(phrase) + r'( |$)').hasMatch(haystack);
  final seen = <String>{if (streetText.isNotEmpty) streetKey};
  final remaining = <String>[];
  for (var i = 0; i < candidates.length; i++) {
    final value = candidates[i];
    if (value == null || value.isEmpty) continue;
    final key = comparable(value);
    if (!seen.add(key)) continue;
    var embedded = streetKey.isNotEmpty && containsPhrase(streetKey, key);
    if (i == 1 && !embedded) {
      final code = stateCodes[key];
      if (code != null) embedded = RegExp(r'(?:^|[^A-Za-z])' + code + r'(?:[^A-Za-z]|$)', caseSensitive: false).hasMatch(streetText);
    }
    if (i == 2 && !embedded) embedded = RegExp(r'(?:^|[^0-9])' + RegExp.escape(value) + r'(?:-[0-9]{4})?(?:[^0-9]|$)').hasMatch(streetText);
    if (!embedded) remaining.add(value);
  }
  return <String>[if (streetText.isNotEmpty) streetText, ...remaining].join(', ');
}

Uri? publicShopMapUri({
  required Object? address,
  Object? city,
  Object? state,
  Object? zipCode,
}) {
  // A city alone cannot identify this particular shop. Stored arbitrary map
  // URLs and compatibility coordinates are never navigation targets here.
  for (final part in [address, city, state, zipCode]) {
    if (part != null &&
        (part is! String ||
            part.length > 500 ||
            RegExp(r'[\x00-\x1f\x7f]').hasMatch(part))) {
      return null;
    }
  }
  if (publicContactText(address, 500) == null) return null;
  final query = publicShopAddress(
      address: address, city: city, state: state, zipCode: zipCode);
  return Uri.https('www.google.com', '/maps/search/', {
    'api': '1',
    'query': query,
  });
}
