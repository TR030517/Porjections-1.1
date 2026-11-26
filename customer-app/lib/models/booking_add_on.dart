import 'dart:convert';
import 'service_duration.dart';
import 'therapist_selection.dart';

int addOnInteger(dynamic value, String field, {int min = 0, int max = 99999999}) {
  if (value is! num || !value.isFinite || value.remainder(1) != 0 || value < min || value > max) {
    throw FormatException('Invalid $field');
  }
  return value.toInt();
}

String _id(dynamic value) {
  if (value is! String || !RegExp(r'^[1-9]\d{0,18}$').hasMatch(value) || BigInt.parse(value) > BigInt.parse('9223372036854775807')) {
    throw const FormatException('Invalid add-on identity');
  }
  return value;
}

String _text(dynamic value, int max, {bool multiline = false}) {
  if (value is! String || value.trim().isEmpty || value.length > max ||
      RegExp(multiline ? r'[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]' : r'[\u0000-\u001f\u007f]').hasMatch(value) ||
      RegExp(r'</?[a-z][^>]*>', caseSensitive: false).hasMatch(value)) {
    throw const FormatException('Invalid add-on wording');
  }
  return value;
}

class ShopServiceAddOn {
  final String id, serviceId, name, description;
  final int priceCents;
  const ShopServiceAddOn({required this.id, required this.serviceId, required this.name, required this.priceCents, this.description = ''});

  static List<ShopServiceAddOn> parseList(dynamic value, String serviceId) {
    if (value == null) return const [];
    if (value is! List || value.length > 50) return const [];
    final result = <ShopServiceAddOn>[], seen = <String>{};
    try {
      for (final raw in value) {
        if (raw is! Map || raw['isActive'] == false) continue;
        if (raw['currency'] != 'usd' || raw.containsKey('isActive') && raw['isActive'] != true || _id(raw['serviceId']) != serviceId) return const [];
        final id = _id(raw['id']);
        if (!seen.add(id)) return const [];
        final description = raw['description'];
        result.add(ShopServiceAddOn(id: id, serviceId: serviceId, name: _text(raw['name'], 100),
          priceCents: addOnInteger(raw['priceCents'], 'add-on price', max: 10000000),
          description: description == null || description == '' ? '' : _text(description, 1000, multiline: true)));
      }
    } on FormatException { return const []; }
    return List.unmodifiable(result);
  }
}

class BookingAddOnSelection {
  final int participantIndex, sequence;
  final List<String> addOnIds;
  const BookingAddOnSelection({required this.participantIndex, required this.sequence, required this.addOnIds});
  Map<String, dynamic> toJson() => {'participantIndex': participantIndex, 'sequence': sequence, 'addOnIds': [...addOnIds]..sort((a,b) => BigInt.parse(a).compareTo(BigInt.parse(b)))};
}

List<Map<String, dynamic>> addOnSelectionJson(List<BookingAddOnSelection> selections) =>
    (selections.where((row) => row.addOnIds.isNotEmpty).toList()
      ..sort((a,b) => a.participantIndex == b.participantIndex ? a.sequence.compareTo(b.sequence) : a.participantIndex.compareTo(b.participantIndex)))
      .map((row) => row.toJson()).toList(growable: false);

class BookingAddOnLine {
  final String? id, bookingItemId;
  final String sourceAddOnId, name, currency;
  final int participantIndex, sequence, unitPriceCents, quantity, lineTotalCents;
  const BookingAddOnLine({this.id, this.bookingItemId, required this.sourceAddOnId, required this.name,
    required this.currency, required this.participantIndex, required this.sequence, required this.unitPriceCents,
    required this.quantity, required this.lineTotalCents});

  bool sameAttachment(BookingAddOnLine other) => sourceAddOnId == other.sourceAddOnId &&
    participantIndex == other.participantIndex && sequence == other.sequence && name == other.name &&
    unitPriceCents == other.unitPriceCents && quantity == other.quantity && lineTotalCents == other.lineTotalCents && currency == other.currency;

  factory BookingAddOnLine.fromJson(Map<dynamic,dynamic> json) {
    final unit = addOnInteger(json['unitPriceCents'], 'add-on unit price', max: 10000000);
    final quantity = addOnInteger(json['quantity'], 'add-on quantity', min: 1, max: 1);
    final line = addOnInteger(json['lineTotalCents'], 'add-on total');
    if (json['currency'] != 'usd' || unit * quantity != line) throw const FormatException('Invalid add-on amount');
    return BookingAddOnLine(id: json['id'] == null ? null : _id(json['id']),
      bookingItemId: json['bookingItemId'] == null ? null : _id(json['bookingItemId']),
      sourceAddOnId: _id(json['sourceAddOnId']), name: _text(json['name'], 100), currency: 'usd',
      participantIndex: addOnInteger(json['participantIndex'], 'guest', min: 1, max: 6),
      sequence: addOnInteger(json['sequence'], 'segment', min: 1, max: 4), unitPriceCents: unit, quantity: quantity, lineTotalCents: line);
  }

  static List<BookingAddOnLine> parseList(dynamic value) {
    if (value == null) return const [];
    if (value is! List || value.length > 120) throw const FormatException('Invalid saved add-ons');
    final result = <BookingAddOnLine>[], seen = <String>{};
    for (final raw in value) {
      if (raw is! Map) throw const FormatException('Invalid saved add-on');
      final line = BookingAddOnLine.fromJson(raw);
      if (!seen.add('${line.participantIndex}:${line.sequence}:${line.sourceAddOnId}')) throw const FormatException('Duplicate saved add-on');
      result.add(line);
    }
    return List.unmodifiable(result);
  }
}

class BookingPriceQuote {
  final String shopId, currency, quoteHash, quoteExpiresAt;
  final int mainSubtotalCents, addOnSubtotalCents, subtotalCents, discountEligibleCents,
      discountCents, platformFeeCents, tipCents, totalCents, durationMin;
  final List<BookingAddOnLine> addOns;
  final List<MainDuration> mainDurations;
  final String durationKind;
  int get reservedDurationMin => durationMin;
  const BookingPriceQuote({required this.shopId, required this.currency, required this.quoteHash, required this.quoteExpiresAt,
    required this.mainSubtotalCents, required this.addOnSubtotalCents, required this.subtotalCents,
    required this.discountEligibleCents, required this.discountCents, required this.platformFeeCents,
    required this.tipCents, required this.totalCents, required this.durationMin, required this.addOns, this.mainDurations = const [], this.durationKind = 'TIMED'});

  factory BookingPriceQuote.fromJson(Map<String,dynamic> json) {
    int amount(String key) => addOnInteger(json[key], key);
    final main = amount('mainSubtotalCents'), extra = amount('addOnSubtotalCents'), subtotal = amount('subtotalCents'),
      eligible = amount('discountEligibleCents'), discount = amount('discountCents'), fee = amount('platformFeeCents'), tip = amount('tipCents'), total = amount('totalCents');
    final lines = BookingAddOnLine.parseList(json['addOns']);
    final primary = json.containsKey('mainDurations') ? MainDuration.parseList(json['mainDurations']) : <MainDuration>[];
    final kind = primary.isEmpty ? readDurationKind(json, allowMixed: true) : combinedDurationKind(primary.map((row) => row.durationKind));
    if (json.containsKey('durationKind') && readDurationKind(json, allowMixed: true) != kind || primary.isEmpty && kind != 'TIMED') throw const FormatException('Invalid quoted duration type');
    final reserved = readReservedMinutes(json);
    if (primary.any((row) => row.reservedDurationMin > reserved)) throw const FormatException('Primary block exceeds the reservation span');
    final hash = json['quoteHash'], expires = json['quoteExpiresAt'];
    if (json['currency'] != 'usd' || hash is! String || !RegExp(r'^[a-f0-9]{64}$').hasMatch(hash) ||
        expires is! String || !RegExp(r'Z$').hasMatch(expires) || DateTime.tryParse(expires) == null ||
        main + extra != subtotal || eligible != main || discount > eligible ||
        subtotal - discount + fee + tip != total || lines.fold<int>(0,(sum,line) => sum + line.lineTotalCents) != extra) {
      throw const FormatException('Invalid server quote');
    }
    return BookingPriceQuote(shopId: _id(json['shopId']), currency: 'usd', quoteHash: hash, quoteExpiresAt: expires,
      mainSubtotalCents: main, addOnSubtotalCents: extra, subtotalCents: subtotal, discountEligibleCents: eligible,
      discountCents: discount, platformFeeCents: fee, tipCents: tip, totalCents: total,
      durationMin: addOnInteger(reserved, 'duration', min: 1, max: 480), addOns: lines, mainDurations: primary, durationKind: kind);
  }

  bool get expired => !DateTime.parse(quoteExpiresAt).isAfter(DateTime.now().toUtc());
  bool matches(String shop, int duration, List<BookingAddOnSelection> selections, {List<MainDuration>? expectedDurations}) {
    final expected = <String>{};
    for (final row in selections) {
      for (final id in row.addOnIds) {
        if (!expected.add('${row.participantIndex}:${row.sequence}:$id')) return false;
      }
    }
    return shopId == shop && durationMin == duration && !expired && (expectedDurations == null || sameMainDurations(expectedDurations, mainDurations) && durationKind == combinedDurationKind(expectedDurations.map((row) => row.durationKind))) && addOns.length == expected.length &&
      addOns.every((row) => expected.contains('${row.participantIndex}:${row.sequence}:${row.sourceAddOnId}'));
  }

  bool matchesSavedMain(List<MainDuration> saved) => sameMainDurations(mainDurations, saved);

  bool matchesSaved(List<BookingAddOnLine> saved) => saved.length == addOns.length && saved.every((line) => addOns.any(line.sameAttachment));
}

String bookingQuoteFingerprint(Map<String,dynamic> request) => jsonEncode(request);

/// A failed transport cannot establish whether the original command committed.
/// Retain the exact request and any real quote in memory, never in browser storage.
class BookingReceiptStaff {
  final int participantIndex, sequence;
  final int? requiredStaffCount;
  final TherapistSelection therapistSelection;
  const BookingReceiptStaff({required this.participantIndex, required this.sequence,
    required this.requiredStaffCount, required this.therapistSelection});
}

class BookingRecoveryAttempt {
  final String actorId;
  final BookingPriceQuote? quote;
  final Map<String,dynamic> _payload;
  final List<MainDuration> _timedMainDurations;
  final int _timedSpan;
  final int participantCount, requiredStaffCount;
  BookingRecoveryAttempt({required this.actorId, this.quote, required Map<String,dynamic> payload,
    List<MainDuration> mainDurations = const [], int? reservedDurationMin,
    this.participantCount = 1, this.requiredStaffCount = 1})
      : _payload = _freeze(payload) as Map<String,dynamic>,
        _timedMainDurations = List.unmodifiable(mainDurations),
        _timedSpan = reservedDurationMin ?? quote?.durationMin ?? 0;
  static dynamic _freeze(dynamic value) {
    if (value is Map) return Map<String,dynamic>.unmodifiable(value.map((key,item) => MapEntry(key as String, _freeze(item))));
    if (value is List) return List<dynamic>.unmodifiable(value.map(_freeze));
    return value;
  }
  String get requestKey => _payload['requestKey'] as String;
  String get shopId => _payload['shopId'] as String;
  int get reservedDurationMin => quote?.durationMin ?? _timedSpan;
  String get durationKind => quote?.durationKind ?? 'TIMED';
  String get originalDate => _payload['date'] as String;
  String get originalStartTime => _payload['startTime'] as String;
  Map<String,dynamic> get payload => Map<String,dynamic>.from(jsonDecode(jsonEncode(_payload)) as Map);
  static TherapistSelection _requestedBy(Map<String,dynamic> request) {
    final ids = List<String>.from(request['preferredTherapistIds'] as List? ?? [if (request['therapistId'] != null) request['therapistId'] as String]);
    return TherapistSelection.fromJson({'therapistSelectionMode': ids.isEmpty ? 'AUTO' : 'SPECIFIC', 'requestedTherapistIds': ids});
  }
  bool _matchesStaff(TherapistSelection selection, int? guests, int? staff,
      List<BookingReceiptStaff> rows) {
    if (guests != participantCount || staff != requiredStaffCount) return false;
    final requestRows = _payload['items'] is List
      ? [for (final row in _payload['items'] as List) Map<String,dynamic>.from(row as Map)] : null;
    final expectedTop = requestRows == null ? _requestedBy(_payload) : _requestedBy({
      'preferredTherapistIds': requestRows.expand((row) => _requestedBy(row).requestedIds).toSet().toList(),
    });
    if (!selection.sameRequestAs(expectedTop)) return false;
    final expectedRows = quote?.mainDurations ?? _timedMainDurations;
    if (rows.length != expectedRows.length) return false;
    for (final expected in expectedRows) {
      final saved = rows.where((row) => row.participantIndex == expected.participantIndex && row.sequence == expected.sequence);
      if (saved.length != 1) return false;
      final request = requestRows?.where((row) => row['participantIndex'] == expected.participantIndex && row['sequence'] == expected.sequence);
      if (request != null && request.length != 1) return false;
      if (!saved.single.therapistSelection.sameRequestAs(_requestedBy(request?.single ?? _payload)) ||
          saved.single.requiredStaffCount != (requestRows != null || participantCount > 1 ? 1 : requiredStaffCount)) {
        return false;
      }
    }
    return true;
  }
  bool matchesSaved({required String id, required String shop, required String reservationKind,
    required String? localDate, required String? localStartTime, required int priceCents, required int? totalCents,
    required TherapistSelection therapistSelection, required int? participantCount,
    required int? requiredStaffCount, required List<BookingReceiptStaff> staffItems,
    required int durationMin, required String savedDurationKind, required List<MainDuration> mainDurations,
    required List<BookingAddOnLine> addOns}) {
    // Equal prices and services cannot identify a visit. Keep an ambiguous
    // response recoverable until its saved shop-local arrival also matches.
    // SINGLE is the server's ordinary-order value; STANDARD is retained only
    // for older receipts. Neither may satisfy an itinerary's PLAN identity.
    final kindMatches = _payload['items'] is List
      ? reservationKind == 'PLAN'
      : const {'SINGLE', 'STANDARD'}.contains(reservationKind);
    if (id.trim().isEmpty || shop != shopId ||
        !kindMatches ||
        localDate != originalDate || localStartTime != originalStartTime ||
        !_matchesStaff(therapistSelection, participantCount, requiredStaffCount, staffItems)) {
      return false;
    }
    final accepted = quote;
    if (accepted != null) {
      return priceCents == accepted.subtotalCents && totalCents == accepted.totalCents &&
        durationMin == accepted.durationMin && savedDurationKind == accepted.durationKind && accepted.matchesSaved(addOns) && accepted.matchesSavedMain(mainDurations);
    }
    return durationMin == _timedSpan && savedDurationKind == 'TIMED' && addOns.isEmpty &&
      sameMainDurations(_timedMainDurations, mainDurations);
  }
}
