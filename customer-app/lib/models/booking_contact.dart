/// Booking contact is a snapshot of this visit, not an editable email recipient.
class BookingContact {
  final String name, phone, email;
  const BookingContact({
    required this.name,
    required this.phone,
    required this.email,
  });

  static bool _invalidCharacters(String value) => value.runes.any(
    (rune) =>
        rune <= 0x1f ||
        rune >= 0x7f && rune <= 0x9f ||
        rune >= 0xd800 && rune <= 0xdfff,
  );

  static String? nameError(String value) {
    final name = value.trim();
    if (_invalidCharacters(value)) {
      return 'Use a name without control characters.';
    }
    if (name.isEmpty || name.runes.length > 100) {
      return 'Enter a name between 1 and 100 characters.';
    }
    return null;
  }

  static String? normalizePhone(String value) {
    if (_invalidCharacters(value)) return null;
    final phone = value.trim();
    if (!RegExp(r'^\+[0-9 ()-]+$').hasMatch(phone)) return null;
    final normalized = phone.replaceAll(RegExp(r'[ ()-]'), '');
    return RegExp(r'^\+[1-9][0-9]{6,14}$').hasMatch(normalized)
        ? normalized
        : null;
  }

  static String? phoneError(String value) => normalizePhone(value) == null
      ? 'Enter an international phone number, including + and country code (7–15 digits).'
      : null;

  static String? normalizeEmail(String? value) {
    if (value != null && _invalidCharacters(value)) return null;
    final email = value?.trim().toLowerCase();
    return email != null &&
            email.length <= 254 &&
            RegExp(r'^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$').hasMatch(email)
        ? email
        : null;
  }

  static BookingContact? fromJson(Object? value) {
    if (value is! Map ||
        value['name'] is! String ||
        value['phone'] is! String ||
        value['email'] is! String) {
      return null;
    }
    final name = value['name'] as String,
        phone = normalizePhone(value['phone'] as String),
        email = normalizeEmail(value['email'] as String);
    if (nameError(name) != null || phone == null || email == null) return null;
    return BookingContact(name: name.trim(), phone: phone, email: email);
  }

  bool sameAs(BookingContact? other) =>
      other != null &&
      name == other.name &&
      phone == other.phone &&
      email == other.email;
  Map<String, dynamic> toJson() => {
    'name': name,
    'phone': phone,
    'email': email,
  };
}

class BookingContactDraft {
  final String name, phone;

  /// Populated only from the currently verified account identity.
  final String? email;
  const BookingContactDraft({this.name = '', this.phone = '', this.email});
  BookingContactDraft copyWith({String? name, String? phone}) =>
      BookingContactDraft(
        name: name ?? this.name,
        phone: phone ?? this.phone,
        email: email,
      );
  BookingContact? validatedFor(String? currentVerifiedEmail) {
    final current = BookingContact.normalizeEmail(currentVerifiedEmail);
    if (current == null || current != email) return null;
    return BookingContact.fromJson({
      'name': name,
      'phone': phone,
      'email': current,
    });
  }
}

const bookingContactRecoveryError =
    'This original request cannot be resubmitted with changed or missing contact details. Check your bookings before starting another request. Do not assume that the original request failed.';
