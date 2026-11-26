// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Massajoy';

  @override
  String get subtitle => 'Traditional Chinese Massage · Easy Booking';

  @override
  String get phoneNumber => 'Phone Number';

  @override
  String get sendCode => 'Send Code';

  @override
  String get btnContinue => 'Continue';

  @override
  String get verify => 'Verify';

  @override
  String get verifyPhone => 'Verify Phone';

  @override
  String get enterVerificationCode => 'Enter Verification Code';

  @override
  String codeSentTo(Object phone) {
    return 'A 6-digit code was sent to\n$phone';
  }

  @override
  String get verificationCode => 'Verification Code';

  @override
  String get invalidCode => 'Invalid code. Please try again.';

  @override
  String get failedToSendCode => 'Failed to send code. Please try again.';

  @override
  String get loginWithApple => 'Login with Apple';

  @override
  String get loginWithGoogle => 'Login with Google';

  @override
  String get appleLoginUnavailable =>
      'Apple Sign-In is available in the mobile app';

  @override
  String get termsPrivacy =>
      'By continuing, you agree to our Terms and Privacy Policy';

  @override
  String get searchShops => 'Search massage shops...';

  @override
  String get noShopsFound => 'No shops found';

  @override
  String get noShopsMatch => 'No shops match your search';

  @override
  String get failedToLoadShops => 'Failed to load shops';

  @override
  String get retry => 'Retry';

  @override
  String get categoryAll => 'All';

  @override
  String get categoryTuiNa => 'Tui Na';

  @override
  String get categoryFootMassage => 'Foot Massage';

  @override
  String get categoryCupping => 'Cupping';

  @override
  String get categoryScraping => 'Scraping';

  @override
  String get myBookings => 'My Bookings';

  @override
  String get favorites => 'Favorites';

  @override
  String get profile => 'Profile';

  @override
  String get filters => 'Filters';

  @override
  String get logout => 'Logout';

  @override
  String get tabShops => 'Shops';

  @override
  String get tabBookings => 'Bookings';

  @override
  String get tabFavorites => 'Favorites';

  @override
  String get tabProfile => 'Profile';

  @override
  String get noFavoritesYet => 'No favorite shops yet';

  @override
  String get addFavoritesHint => 'Add some shops to your favorites';

  @override
  String get unableToLoadShop => 'Unable to load shop details';

  @override
  String get bookNow => 'Book Now';

  @override
  String get services => 'Services';

  @override
  String get therapists => 'Therapists';

  @override
  String get reviews => 'Reviews';

  @override
  String get noReviewsYet => 'No reviews yet';

  @override
  String get reset => 'Reset';

  @override
  String get selectService => 'Select Service';

  @override
  String get therapistOptional => 'Therapist (Optional)';

  @override
  String get selectDate => 'Select Date';

  @override
  String get availableTime => 'Available Time';

  @override
  String get bookingSummary => 'Booking Summary';

  @override
  String get confirmBooking => 'Confirm Booking';

  @override
  String get creatingBooking => 'Creating...';

  @override
  String get total => 'Total';

  @override
  String min(Object count) {
    return '$count min';
  }

  @override
  String get bookingConfirmed => 'Confirmed';

  @override
  String failedToCreateBooking(Object error) {
    return 'Failed to create booking: $error';
  }

  @override
  String get failedToLoadBookings => 'Failed to load bookings';

  @override
  String get noBookingsYet => 'No bookings yet';

  @override
  String get bookMassageHint => 'Book a massage to get started';

  @override
  String get writeReview => 'Write Review';

  @override
  String get cancel => 'Cancel';

  @override
  String get cancelBooking => 'Cancel Booking';

  @override
  String get cancelBookingConfirm =>
      'Are you sure you want to cancel this booking?';

  @override
  String get keep => 'Keep';

  @override
  String get delete => 'Delete';

  @override
  String get deleteBooking => 'Delete Booking';

  @override
  String get deleteBookingConfirm =>
      'Are you sure you want to permanently delete this booking? This cannot be undone.';

  @override
  String get deletePermanently => 'Delete Permanently';

  @override
  String get bookingCancelled => 'Cancelled';

  @override
  String get bookingDeleted => 'Booking deleted';

  @override
  String failedToCancel(Object error) {
    return 'Failed to cancel: $error';
  }

  @override
  String failedToDelete(Object error) {
    return 'Failed to delete: $error';
  }

  @override
  String get editProfile => 'Edit Profile';

  @override
  String get notifications => 'Notifications';

  @override
  String get paymentMethods => 'Payment Methods';

  @override
  String get bookingHistory => 'Booking History';

  @override
  String get myFavorites => 'My Favorites';

  @override
  String get myReviews => 'My Reviews';

  @override
  String get settings => 'Settings';

  @override
  String comingSoon(Object feature) {
    return '$feature — coming soon!';
  }

  @override
  String get logoutConfirm => 'Are you sure you want to log out?';

  @override
  String get editNamePhoneEmail => 'Name and email';

  @override
  String get bookingRemindersPromotions => 'Booking reminders, promotions';

  @override
  String get addManageCards => 'Add or manage cards';

  @override
  String get viewPastBookings => 'View past bookings';

  @override
  String get savedShops => 'Saved shops';

  @override
  String get viewYourReviews => 'View your reviews';

  @override
  String get language => 'Language';

  @override
  String get switchToFavorites => 'Switch to Favorites tab to view saved shops';

  @override
  String get writeAReview => 'Write a Review';

  @override
  String get editReview => 'Edit Review';

  @override
  String get rateYourExperience => 'Rate your experience';

  @override
  String get updateYourRating => 'Update your rating';

  @override
  String get tapStarToRate => 'Tap a star to set your rating';

  @override
  String get shareExperienceOptional => 'Share your experience (optional)';

  @override
  String get submitReview => 'Submit Review';

  @override
  String get updateReviewBtn => 'Update Review';

  @override
  String get pleaseSelectRating => 'Please select a rating';

  @override
  String get reviewSubmitted => 'Review submitted successfully';

  @override
  String get reviewUpdated => 'Review updated';

  @override
  String get reviewDeleted => 'Review deleted';

  @override
  String failedToSubmitReview(Object error) {
    return 'Failed to submit review: $error';
  }

  @override
  String failedToUpdateReview(Object error) {
    return 'Failed to update review: $error';
  }

  @override
  String failedToDeleteReview(Object error) {
    return 'Failed to delete: $error';
  }

  @override
  String get failedToLoadReviews => 'Failed to load reviews';

  @override
  String get noReviewsYetHint => 'Complete a booking to leave a review';

  @override
  String get deleteReview => 'Delete Review';

  @override
  String get deleteReviewConfirm =>
      'Are you sure you want to delete this review?';

  @override
  String get edit => 'Edit';

  @override
  String get name => 'Name';

  @override
  String get email => 'Email';

  @override
  String get save => 'Save';

  @override
  String get profileUpdated => 'Profile updated';

  @override
  String failedToUpdateProfile(Object error) {
    return 'Failed to update profile: $error';
  }

  @override
  String get ratingPoor => 'Poor';

  @override
  String get ratingFair => 'Fair';

  @override
  String get ratingGood => 'Good';

  @override
  String get ratingVeryGood => 'Very Good';

  @override
  String get ratingExcellent => 'Excellent';

  @override
  String get minutes => 'mins';

  @override
  String get from => 'from';

  @override
  String reviewsCount(Object count) {
    return '$count reviews';
  }

  @override
  String bookingsCount(Object count) {
    return '$count bookings';
  }

  @override
  String get separator => '·';

  @override
  String get noTherapist => 'No preference';

  @override
  String get loading => 'Loading...';

  @override
  String get errorOccurred => 'An error occurred';

  @override
  String get merchantPortal => 'Merchant Portal';

  @override
  String get becomeMerchant => 'Become a Merchant';

  @override
  String get merchantApply => 'Apply as Merchant';

  @override
  String get merchantApplication => 'Merchant Application';

  @override
  String get applySuccess => 'Application submitted! Pending review.';

  @override
  String get applicationPending =>
      'Your application is under review. We will notify you once approved.';

  @override
  String get applicationRejected =>
      'Application rejected. Please contact support.';

  @override
  String get shopManagement => 'Shop Management';

  @override
  String get serviceManagement => 'Service Management';

  @override
  String get therapistManagement => 'Therapist Management';

  @override
  String get bookingManagement => 'Booking Management';

  @override
  String get dashboard => 'Dashboard';

  @override
  String get shopInfo => 'Shop Info';

  @override
  String get businessHours => 'Business Hours';

  @override
  String get shopImages => 'Shop Images';

  @override
  String get shopCertificates => 'Certificates';

  @override
  String get addService => 'Add Service';

  @override
  String get editService => 'Edit Service';

  @override
  String get addTherapist => 'Add Therapist';

  @override
  String get editTherapist => 'Edit Therapist';

  @override
  String get categoryMassage => 'Massage';

  @override
  String get categoryHeadTherapy => 'Head Therapy';

  @override
  String get categoryOther => 'Other';

  @override
  String get durationMin => 'Duration (min)';

  @override
  String get price => 'Price';

  @override
  String get priceCents => 'Price (cents)';

  @override
  String get bio => 'Bio';

  @override
  String get yearsExp => 'Years of Experience';

  @override
  String get gender => 'Gender';

  @override
  String get male => 'Male';

  @override
  String get female => 'Female';

  @override
  String get avgRating => 'Avg Rating';

  @override
  String get totalRevenue => 'Total Revenue';

  @override
  String get netRevenue => 'Net Revenue';

  @override
  String get totalBookings => 'Total Bookings';

  @override
  String get bookingPending => 'Pending';

  @override
  String get bookingCompleted => 'Completed';

  @override
  String get confirm => 'Confirm';

  @override
  String get complete => 'Complete';

  @override
  String get close => 'Close';

  @override
  String get openTime => 'Open';

  @override
  String get closed => 'Closed';

  @override
  String get address => 'Address';

  @override
  String get city => 'City';

  @override
  String get state => 'State';

  @override
  String get zipCode => 'Zip Code';

  @override
  String get latitude => 'Latitude';

  @override
  String get longitude => 'Longitude';

  @override
  String get category => 'Category';

  @override
  String get description => 'Description';

  @override
  String get shopName => 'Shop Name';

  @override
  String get shopPhone => 'Shop Phone';

  @override
  String get imageUrl => 'Image URL';

  @override
  String get licenseUrl => 'License URL';

  @override
  String get businessLicenseUrl => 'Business License URL';

  @override
  String get mon => 'Mon';

  @override
  String get tue => 'Tue';

  @override
  String get wed => 'Wed';

  @override
  String get thu => 'Thu';

  @override
  String get fri => 'Fri';

  @override
  String get sat => 'Sat';

  @override
  String get sun => 'Sun';

  @override
  String get dailyRevenue => 'Daily Revenue';

  @override
  String get bookingDistribution => 'Booking Distribution';

  @override
  String get shopNameEn => 'Shop Name (English)';

  @override
  String get noServices => 'No services yet';

  @override
  String get noTherapists => 'No therapists yet';

  @override
  String get tabMerchant => 'Merchant';

  @override
  String get merchantApplyTitle => 'Apply as Merchant';

  @override
  String get merchantApplyDesc =>
      'Fill in your shop details to start accepting bookings';

  @override
  String get mapView => 'Map View';

  @override
  String get mapViewTitle => 'Map';

  @override
  String get viewShop => 'View Shop';

  @override
  String get getDirections => 'Get Directions';

  @override
  String get gettingLocation => 'Getting your location...';

  @override
  String get noShopsOnMap => 'No shops to display on map';

  @override
  String get recenter => 'Recenter';

  @override
  String get locationUnavailable =>
      'Location unavailable. Please try again later.';

  @override
  String get paymentTitle => 'Payment';

  @override
  String get paymentOrderSummary => 'Order Summary';

  @override
  String get paymentPriceBreakdown => 'Price Breakdown';

  @override
  String get paymentCardDetails => 'Card Details';

  @override
  String get paymentShop => 'Shop';

  @override
  String get paymentService => 'Service';

  @override
  String get paymentDate => 'Date';

  @override
  String get paymentTime => 'Time';

  @override
  String get paymentDuration => 'Duration';

  @override
  String get paymentSubtotal => 'Subtotal';

  @override
  String get paymentCouponDiscount => 'Coupon Discount';

  @override
  String get paymentPlatformFee => 'Platform Fee';

  @override
  String get paymentCardName => 'Cardholder Name';

  @override
  String get paymentCardNumber => 'Card Number';

  @override
  String get paymentExpiry => 'Expiry';

  @override
  String get paymentCvc => 'CVC';

  @override
  String get paymentPay => 'Pay';

  @override
  String get paymentProcessing => 'Processing...';

  @override
  String get paymentTryAgain => 'Try Again';

  @override
  String get paymentSuccessTitle => 'Payment Successful!';

  @override
  String get paymentSuccessMessage =>
      'Your booking has been confirmed.\nRedirecting to My Bookings...';

  @override
  String get transactions => 'Transactions';

  @override
  String get transactionList => 'Transaction History';

  @override
  String get transactionDate => 'Date';

  @override
  String get transactionType => 'Type';

  @override
  String get transactionAmount => 'Amount';

  @override
  String get transactionFee => 'Fee';

  @override
  String get transactionNet => 'Net';

  @override
  String get transactionStatus => 'Status';

  @override
  String get transactionDescription => 'Description';

  @override
  String get transactionBooking => 'Booking';

  @override
  String get transactionPayment => 'Payment';

  @override
  String get transactionPayout => 'Withdrawal';

  @override
  String get transactionRefund => 'Refund';

  @override
  String get filterByDate => 'Filter by date';

  @override
  String get startDate => 'Start Date';

  @override
  String get endDate => 'End Date';

  @override
  String get exportCsv => 'Export CSV';

  @override
  String get taxReport => 'Tax Report';

  @override
  String get taxYear => 'Tax Year';

  @override
  String get totalGross => 'Total Gross Revenue';

  @override
  String get totalFees => 'Total Fees';

  @override
  String get totalNet => 'Total Net';

  @override
  String get totalRefunds => 'Total Refunds';

  @override
  String get totalPayouts => 'Total Payouts';

  @override
  String get netEarnings => 'Net Earnings';

  @override
  String get noTransactions => 'No transactions found';

  @override
  String get loadingTransactions => 'Loading transactions...';

  @override
  String get requestRefund => 'Request Refund';

  @override
  String get requestRefundConfirm =>
      'Are you sure you want to refund this booking?';

  @override
  String get refundYes => 'Yes, Refund';

  @override
  String get refundSuccess => 'Refund processed successfully';

  @override
  String get failedToRefund => 'Failed to process refund';

  @override
  String get announcementTitle => 'Announcements';

  @override
  String get announcementTypeInfo => 'Info';

  @override
  String get announcementTypeImportant => 'Important';

  @override
  String get announcementTypeUrgent => 'Urgent';

  @override
  String get announcementEmpty => 'No announcements yet';

  @override
  String get readMore => 'Read more';

  @override
  String get categoryMixed => 'Mixed';

  @override
  String get mapLegend => 'Legend';

  @override
  String get labelEnglish => 'English';

  @override
  String get labelChinese => '中文';

  @override
  String get dateAndTime => 'Date & Time';

  @override
  String get chooseTherapist => 'Choose Therapist';

  @override
  String get chooseDateTime => 'Choose Date & Time';

  @override
  String get nextStep => 'Next';

  @override
  String get selected => 'Selected';

  @override
  String get assignTherapist => 'The shop will assign a therapist';

  @override
  String get noLinkedTherapists =>
      'No therapist is listed for this service. Continue without a preference for shop assignment.';

  @override
  String yearsExperience(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count years of experience',
      one: '1 year of experience',
    );
    return '$_temp0';
  }

  @override
  String get selectDateFirst => 'Please select a date first';

  @override
  String get today => 'Today';

  @override
  String get noAvailableSlots => 'No available slots for this date';

  @override
  String selectedMinutes(int count) {
    return '$count min selected';
  }

  @override
  String get selectTimeBlocks =>
      'Choose one available start time; duration follows your specification';

  @override
  String get morning => 'Morning';

  @override
  String get afternoon => 'Afternoon';

  @override
  String get evening => 'Evening';

  @override
  String get estimatedServicePrice => 'Estimated service price';

  @override
  String get reviewTotalBeforeConfirming =>
      'Review the current total before confirming. The shop handles the order offline; confirming does not record a payment.';

  @override
  String get coupon => 'Coupon';

  @override
  String get select => 'Select';

  @override
  String get selectCoupon => 'Select Coupon';

  @override
  String get noApplicableCoupons => 'No applicable coupons for this booking';

  @override
  String get bookingUnavailable => 'This shop has not opened online booking.';

  @override
  String get bookingFailedRetry =>
      'Failed to create booking. Please try again.';

  @override
  String get chooseTherapistWhenBooking =>
      'Choose your therapist when booking.';

  @override
  String get aboutShop => 'About';

  @override
  String get showLess => 'Show less';

  @override
  String get bookService => 'Book';

  @override
  String get shopInfoCopied => 'Shop info copied to clipboard';

  @override
  String get bookingUnavailableHint =>
      'This shop has not opened online booking. Services and prices are available to browse.';

  @override
  String get reviewsUnavailableHint =>
      'This shop is not accepting new or updated reviews. Existing reviews remain available.';

  @override
  String get onlineBookingUnavailable => 'Online booking unavailable';

  @override
  String get favoriteShop => 'Save shop';

  @override
  String get unfavoriteShop => 'Remove saved shop';

  @override
  String get copyShopInfo => 'Copy shop information';

  @override
  String get clearSearch => 'Clear search';

  @override
  String viewAllReviews(int count) {
    return 'View all $count reviews';
  }
}
