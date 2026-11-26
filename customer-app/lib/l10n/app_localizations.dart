import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh'),
  ];

  /// App title
  ///
  /// In en, this message translates to:
  /// **'Massajoy'**
  String get appTitle;

  /// No description provided for @subtitle.
  ///
  /// In en, this message translates to:
  /// **'Traditional Chinese Massage · Easy Booking'**
  String get subtitle;

  /// No description provided for @phoneNumber.
  ///
  /// In en, this message translates to:
  /// **'Phone Number'**
  String get phoneNumber;

  /// No description provided for @sendCode.
  ///
  /// In en, this message translates to:
  /// **'Send Code'**
  String get sendCode;

  /// No description provided for @btnContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get btnContinue;

  /// No description provided for @verify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verify;

  /// No description provided for @verifyPhone.
  ///
  /// In en, this message translates to:
  /// **'Verify Phone'**
  String get verifyPhone;

  /// No description provided for @enterVerificationCode.
  ///
  /// In en, this message translates to:
  /// **'Enter Verification Code'**
  String get enterVerificationCode;

  /// No description provided for @codeSentTo.
  ///
  /// In en, this message translates to:
  /// **'A 6-digit code was sent to\n{phone}'**
  String codeSentTo(Object phone);

  /// No description provided for @verificationCode.
  ///
  /// In en, this message translates to:
  /// **'Verification Code'**
  String get verificationCode;

  /// No description provided for @invalidCode.
  ///
  /// In en, this message translates to:
  /// **'Invalid code. Please try again.'**
  String get invalidCode;

  /// No description provided for @failedToSendCode.
  ///
  /// In en, this message translates to:
  /// **'Failed to send code. Please try again.'**
  String get failedToSendCode;

  /// No description provided for @loginWithApple.
  ///
  /// In en, this message translates to:
  /// **'Login with Apple'**
  String get loginWithApple;

  /// No description provided for @loginWithGoogle.
  ///
  /// In en, this message translates to:
  /// **'Login with Google'**
  String get loginWithGoogle;

  /// No description provided for @appleLoginUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Apple Sign-In is available in the mobile app'**
  String get appleLoginUnavailable;

  /// No description provided for @termsPrivacy.
  ///
  /// In en, this message translates to:
  /// **'By continuing, you agree to our Terms and Privacy Policy'**
  String get termsPrivacy;

  /// No description provided for @searchShops.
  ///
  /// In en, this message translates to:
  /// **'Search massage shops...'**
  String get searchShops;

  /// No description provided for @noShopsFound.
  ///
  /// In en, this message translates to:
  /// **'No shops found'**
  String get noShopsFound;

  /// No description provided for @noShopsMatch.
  ///
  /// In en, this message translates to:
  /// **'No shops match your search'**
  String get noShopsMatch;

  /// No description provided for @failedToLoadShops.
  ///
  /// In en, this message translates to:
  /// **'Failed to load shops'**
  String get failedToLoadShops;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @categoryAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get categoryAll;

  /// No description provided for @categoryTuiNa.
  ///
  /// In en, this message translates to:
  /// **'Tui Na'**
  String get categoryTuiNa;

  /// No description provided for @categoryFootMassage.
  ///
  /// In en, this message translates to:
  /// **'Foot Massage'**
  String get categoryFootMassage;

  /// No description provided for @categoryCupping.
  ///
  /// In en, this message translates to:
  /// **'Cupping'**
  String get categoryCupping;

  /// No description provided for @categoryScraping.
  ///
  /// In en, this message translates to:
  /// **'Scraping'**
  String get categoryScraping;

  /// No description provided for @myBookings.
  ///
  /// In en, this message translates to:
  /// **'My Bookings'**
  String get myBookings;

  /// No description provided for @favorites.
  ///
  /// In en, this message translates to:
  /// **'Favorites'**
  String get favorites;

  /// No description provided for @profile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// No description provided for @filters.
  ///
  /// In en, this message translates to:
  /// **'Filters'**
  String get filters;

  /// No description provided for @logout.
  ///
  /// In en, this message translates to:
  /// **'Logout'**
  String get logout;

  /// No description provided for @tabShops.
  ///
  /// In en, this message translates to:
  /// **'Shops'**
  String get tabShops;

  /// No description provided for @tabBookings.
  ///
  /// In en, this message translates to:
  /// **'Bookings'**
  String get tabBookings;

  /// No description provided for @tabFavorites.
  ///
  /// In en, this message translates to:
  /// **'Favorites'**
  String get tabFavorites;

  /// No description provided for @tabProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get tabProfile;

  /// No description provided for @noFavoritesYet.
  ///
  /// In en, this message translates to:
  /// **'No favorite shops yet'**
  String get noFavoritesYet;

  /// No description provided for @addFavoritesHint.
  ///
  /// In en, this message translates to:
  /// **'Add some shops to your favorites'**
  String get addFavoritesHint;

  /// No description provided for @unableToLoadShop.
  ///
  /// In en, this message translates to:
  /// **'Unable to load shop details'**
  String get unableToLoadShop;

  /// No description provided for @bookNow.
  ///
  /// In en, this message translates to:
  /// **'Book Now'**
  String get bookNow;

  /// No description provided for @services.
  ///
  /// In en, this message translates to:
  /// **'Services'**
  String get services;

  /// No description provided for @therapists.
  ///
  /// In en, this message translates to:
  /// **'Therapists'**
  String get therapists;

  /// No description provided for @reviews.
  ///
  /// In en, this message translates to:
  /// **'Reviews'**
  String get reviews;

  /// No description provided for @noReviewsYet.
  ///
  /// In en, this message translates to:
  /// **'No reviews yet'**
  String get noReviewsYet;

  /// No description provided for @reset.
  ///
  /// In en, this message translates to:
  /// **'Reset'**
  String get reset;

  /// No description provided for @selectService.
  ///
  /// In en, this message translates to:
  /// **'Select Service'**
  String get selectService;

  /// No description provided for @therapistOptional.
  ///
  /// In en, this message translates to:
  /// **'Therapist (Optional)'**
  String get therapistOptional;

  /// No description provided for @selectDate.
  ///
  /// In en, this message translates to:
  /// **'Select Date'**
  String get selectDate;

  /// No description provided for @availableTime.
  ///
  /// In en, this message translates to:
  /// **'Available Time'**
  String get availableTime;

  /// No description provided for @bookingSummary.
  ///
  /// In en, this message translates to:
  /// **'Booking Summary'**
  String get bookingSummary;

  /// No description provided for @confirmBooking.
  ///
  /// In en, this message translates to:
  /// **'Confirm Booking'**
  String get confirmBooking;

  /// No description provided for @creatingBooking.
  ///
  /// In en, this message translates to:
  /// **'Creating...'**
  String get creatingBooking;

  /// No description provided for @total.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get total;

  /// No description provided for @min.
  ///
  /// In en, this message translates to:
  /// **'{count} min'**
  String min(Object count);

  /// No description provided for @bookingConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get bookingConfirmed;

  /// No description provided for @failedToCreateBooking.
  ///
  /// In en, this message translates to:
  /// **'Failed to create booking: {error}'**
  String failedToCreateBooking(Object error);

  /// No description provided for @failedToLoadBookings.
  ///
  /// In en, this message translates to:
  /// **'Failed to load bookings'**
  String get failedToLoadBookings;

  /// No description provided for @noBookingsYet.
  ///
  /// In en, this message translates to:
  /// **'No bookings yet'**
  String get noBookingsYet;

  /// No description provided for @bookMassageHint.
  ///
  /// In en, this message translates to:
  /// **'Book a massage to get started'**
  String get bookMassageHint;

  /// No description provided for @writeReview.
  ///
  /// In en, this message translates to:
  /// **'Write Review'**
  String get writeReview;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @cancelBooking.
  ///
  /// In en, this message translates to:
  /// **'Cancel Booking'**
  String get cancelBooking;

  /// No description provided for @cancelBookingConfirm.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to cancel this booking?'**
  String get cancelBookingConfirm;

  /// No description provided for @keep.
  ///
  /// In en, this message translates to:
  /// **'Keep'**
  String get keep;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @deleteBooking.
  ///
  /// In en, this message translates to:
  /// **'Delete Booking'**
  String get deleteBooking;

  /// No description provided for @deleteBookingConfirm.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to permanently delete this booking? This cannot be undone.'**
  String get deleteBookingConfirm;

  /// No description provided for @deletePermanently.
  ///
  /// In en, this message translates to:
  /// **'Delete Permanently'**
  String get deletePermanently;

  /// No description provided for @bookingCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get bookingCancelled;

  /// No description provided for @bookingDeleted.
  ///
  /// In en, this message translates to:
  /// **'Booking deleted'**
  String get bookingDeleted;

  /// No description provided for @failedToCancel.
  ///
  /// In en, this message translates to:
  /// **'Failed to cancel: {error}'**
  String failedToCancel(Object error);

  /// No description provided for @failedToDelete.
  ///
  /// In en, this message translates to:
  /// **'Failed to delete: {error}'**
  String failedToDelete(Object error);

  /// No description provided for @editProfile.
  ///
  /// In en, this message translates to:
  /// **'Edit Profile'**
  String get editProfile;

  /// No description provided for @notifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// No description provided for @paymentMethods.
  ///
  /// In en, this message translates to:
  /// **'Payment Methods'**
  String get paymentMethods;

  /// No description provided for @bookingHistory.
  ///
  /// In en, this message translates to:
  /// **'Booking History'**
  String get bookingHistory;

  /// No description provided for @myFavorites.
  ///
  /// In en, this message translates to:
  /// **'My Favorites'**
  String get myFavorites;

  /// No description provided for @myReviews.
  ///
  /// In en, this message translates to:
  /// **'My Reviews'**
  String get myReviews;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @comingSoon.
  ///
  /// In en, this message translates to:
  /// **'{feature} — coming soon!'**
  String comingSoon(Object feature);

  /// No description provided for @logoutConfirm.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to log out?'**
  String get logoutConfirm;

  /// No description provided for @editNamePhoneEmail.
  ///
  /// In en, this message translates to:
  /// **'Name and email'**
  String get editNamePhoneEmail;

  /// No description provided for @bookingRemindersPromotions.
  ///
  /// In en, this message translates to:
  /// **'Booking reminders, promotions'**
  String get bookingRemindersPromotions;

  /// No description provided for @addManageCards.
  ///
  /// In en, this message translates to:
  /// **'Add or manage cards'**
  String get addManageCards;

  /// No description provided for @viewPastBookings.
  ///
  /// In en, this message translates to:
  /// **'View past bookings'**
  String get viewPastBookings;

  /// No description provided for @savedShops.
  ///
  /// In en, this message translates to:
  /// **'Saved shops'**
  String get savedShops;

  /// No description provided for @viewYourReviews.
  ///
  /// In en, this message translates to:
  /// **'View your reviews'**
  String get viewYourReviews;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @switchToFavorites.
  ///
  /// In en, this message translates to:
  /// **'Switch to Favorites tab to view saved shops'**
  String get switchToFavorites;

  /// No description provided for @writeAReview.
  ///
  /// In en, this message translates to:
  /// **'Write a Review'**
  String get writeAReview;

  /// No description provided for @editReview.
  ///
  /// In en, this message translates to:
  /// **'Edit Review'**
  String get editReview;

  /// No description provided for @rateYourExperience.
  ///
  /// In en, this message translates to:
  /// **'Rate your experience'**
  String get rateYourExperience;

  /// No description provided for @updateYourRating.
  ///
  /// In en, this message translates to:
  /// **'Update your rating'**
  String get updateYourRating;

  /// No description provided for @tapStarToRate.
  ///
  /// In en, this message translates to:
  /// **'Tap a star to set your rating'**
  String get tapStarToRate;

  /// No description provided for @shareExperienceOptional.
  ///
  /// In en, this message translates to:
  /// **'Share your experience (optional)'**
  String get shareExperienceOptional;

  /// No description provided for @submitReview.
  ///
  /// In en, this message translates to:
  /// **'Submit Review'**
  String get submitReview;

  /// No description provided for @updateReviewBtn.
  ///
  /// In en, this message translates to:
  /// **'Update Review'**
  String get updateReviewBtn;

  /// No description provided for @pleaseSelectRating.
  ///
  /// In en, this message translates to:
  /// **'Please select a rating'**
  String get pleaseSelectRating;

  /// No description provided for @reviewSubmitted.
  ///
  /// In en, this message translates to:
  /// **'Review submitted successfully'**
  String get reviewSubmitted;

  /// No description provided for @reviewUpdated.
  ///
  /// In en, this message translates to:
  /// **'Review updated'**
  String get reviewUpdated;

  /// No description provided for @reviewDeleted.
  ///
  /// In en, this message translates to:
  /// **'Review deleted'**
  String get reviewDeleted;

  /// No description provided for @failedToSubmitReview.
  ///
  /// In en, this message translates to:
  /// **'Failed to submit review: {error}'**
  String failedToSubmitReview(Object error);

  /// No description provided for @failedToUpdateReview.
  ///
  /// In en, this message translates to:
  /// **'Failed to update review: {error}'**
  String failedToUpdateReview(Object error);

  /// No description provided for @failedToDeleteReview.
  ///
  /// In en, this message translates to:
  /// **'Failed to delete: {error}'**
  String failedToDeleteReview(Object error);

  /// No description provided for @failedToLoadReviews.
  ///
  /// In en, this message translates to:
  /// **'Failed to load reviews'**
  String get failedToLoadReviews;

  /// No description provided for @noReviewsYetHint.
  ///
  /// In en, this message translates to:
  /// **'Complete a booking to leave a review'**
  String get noReviewsYetHint;

  /// No description provided for @deleteReview.
  ///
  /// In en, this message translates to:
  /// **'Delete Review'**
  String get deleteReview;

  /// No description provided for @deleteReviewConfirm.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to delete this review?'**
  String get deleteReviewConfirm;

  /// No description provided for @edit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get edit;

  /// No description provided for @name.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get name;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @profileUpdated.
  ///
  /// In en, this message translates to:
  /// **'Profile updated'**
  String get profileUpdated;

  /// No description provided for @failedToUpdateProfile.
  ///
  /// In en, this message translates to:
  /// **'Failed to update profile: {error}'**
  String failedToUpdateProfile(Object error);

  /// No description provided for @ratingPoor.
  ///
  /// In en, this message translates to:
  /// **'Poor'**
  String get ratingPoor;

  /// No description provided for @ratingFair.
  ///
  /// In en, this message translates to:
  /// **'Fair'**
  String get ratingFair;

  /// No description provided for @ratingGood.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get ratingGood;

  /// No description provided for @ratingVeryGood.
  ///
  /// In en, this message translates to:
  /// **'Very Good'**
  String get ratingVeryGood;

  /// No description provided for @ratingExcellent.
  ///
  /// In en, this message translates to:
  /// **'Excellent'**
  String get ratingExcellent;

  /// No description provided for @minutes.
  ///
  /// In en, this message translates to:
  /// **'mins'**
  String get minutes;

  /// No description provided for @from.
  ///
  /// In en, this message translates to:
  /// **'from'**
  String get from;

  /// No description provided for @reviewsCount.
  ///
  /// In en, this message translates to:
  /// **'{count} reviews'**
  String reviewsCount(Object count);

  /// No description provided for @bookingsCount.
  ///
  /// In en, this message translates to:
  /// **'{count} bookings'**
  String bookingsCount(Object count);

  /// No description provided for @separator.
  ///
  /// In en, this message translates to:
  /// **'·'**
  String get separator;

  /// No description provided for @noTherapist.
  ///
  /// In en, this message translates to:
  /// **'No preference'**
  String get noTherapist;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get loading;

  /// No description provided for @errorOccurred.
  ///
  /// In en, this message translates to:
  /// **'An error occurred'**
  String get errorOccurred;

  /// No description provided for @merchantPortal.
  ///
  /// In en, this message translates to:
  /// **'Merchant Portal'**
  String get merchantPortal;

  /// No description provided for @becomeMerchant.
  ///
  /// In en, this message translates to:
  /// **'Become a Merchant'**
  String get becomeMerchant;

  /// No description provided for @merchantApply.
  ///
  /// In en, this message translates to:
  /// **'Apply as Merchant'**
  String get merchantApply;

  /// No description provided for @merchantApplication.
  ///
  /// In en, this message translates to:
  /// **'Merchant Application'**
  String get merchantApplication;

  /// No description provided for @applySuccess.
  ///
  /// In en, this message translates to:
  /// **'Application submitted! Pending review.'**
  String get applySuccess;

  /// No description provided for @applicationPending.
  ///
  /// In en, this message translates to:
  /// **'Your application is under review. We will notify you once approved.'**
  String get applicationPending;

  /// No description provided for @applicationRejected.
  ///
  /// In en, this message translates to:
  /// **'Application rejected. Please contact support.'**
  String get applicationRejected;

  /// No description provided for @shopManagement.
  ///
  /// In en, this message translates to:
  /// **'Shop Management'**
  String get shopManagement;

  /// No description provided for @serviceManagement.
  ///
  /// In en, this message translates to:
  /// **'Service Management'**
  String get serviceManagement;

  /// No description provided for @therapistManagement.
  ///
  /// In en, this message translates to:
  /// **'Therapist Management'**
  String get therapistManagement;

  /// No description provided for @bookingManagement.
  ///
  /// In en, this message translates to:
  /// **'Booking Management'**
  String get bookingManagement;

  /// No description provided for @dashboard.
  ///
  /// In en, this message translates to:
  /// **'Dashboard'**
  String get dashboard;

  /// No description provided for @shopInfo.
  ///
  /// In en, this message translates to:
  /// **'Shop Info'**
  String get shopInfo;

  /// No description provided for @businessHours.
  ///
  /// In en, this message translates to:
  /// **'Business Hours'**
  String get businessHours;

  /// No description provided for @shopImages.
  ///
  /// In en, this message translates to:
  /// **'Shop Images'**
  String get shopImages;

  /// No description provided for @shopCertificates.
  ///
  /// In en, this message translates to:
  /// **'Certificates'**
  String get shopCertificates;

  /// No description provided for @addService.
  ///
  /// In en, this message translates to:
  /// **'Add Service'**
  String get addService;

  /// No description provided for @editService.
  ///
  /// In en, this message translates to:
  /// **'Edit Service'**
  String get editService;

  /// No description provided for @addTherapist.
  ///
  /// In en, this message translates to:
  /// **'Add Therapist'**
  String get addTherapist;

  /// No description provided for @editTherapist.
  ///
  /// In en, this message translates to:
  /// **'Edit Therapist'**
  String get editTherapist;

  /// No description provided for @categoryMassage.
  ///
  /// In en, this message translates to:
  /// **'Massage'**
  String get categoryMassage;

  /// No description provided for @categoryHeadTherapy.
  ///
  /// In en, this message translates to:
  /// **'Head Therapy'**
  String get categoryHeadTherapy;

  /// No description provided for @categoryOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get categoryOther;

  /// No description provided for @durationMin.
  ///
  /// In en, this message translates to:
  /// **'Duration (min)'**
  String get durationMin;

  /// No description provided for @price.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get price;

  /// No description provided for @priceCents.
  ///
  /// In en, this message translates to:
  /// **'Price (cents)'**
  String get priceCents;

  /// No description provided for @bio.
  ///
  /// In en, this message translates to:
  /// **'Bio'**
  String get bio;

  /// No description provided for @yearsExp.
  ///
  /// In en, this message translates to:
  /// **'Years of Experience'**
  String get yearsExp;

  /// No description provided for @gender.
  ///
  /// In en, this message translates to:
  /// **'Gender'**
  String get gender;

  /// No description provided for @male.
  ///
  /// In en, this message translates to:
  /// **'Male'**
  String get male;

  /// No description provided for @female.
  ///
  /// In en, this message translates to:
  /// **'Female'**
  String get female;

  /// No description provided for @avgRating.
  ///
  /// In en, this message translates to:
  /// **'Avg Rating'**
  String get avgRating;

  /// No description provided for @totalRevenue.
  ///
  /// In en, this message translates to:
  /// **'Total Revenue'**
  String get totalRevenue;

  /// No description provided for @netRevenue.
  ///
  /// In en, this message translates to:
  /// **'Net Revenue'**
  String get netRevenue;

  /// No description provided for @totalBookings.
  ///
  /// In en, this message translates to:
  /// **'Total Bookings'**
  String get totalBookings;

  /// No description provided for @bookingPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get bookingPending;

  /// No description provided for @bookingCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get bookingCompleted;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @complete.
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get complete;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @openTime.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get openTime;

  /// No description provided for @closed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get closed;

  /// No description provided for @address.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get address;

  /// No description provided for @city.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get city;

  /// No description provided for @state.
  ///
  /// In en, this message translates to:
  /// **'State'**
  String get state;

  /// No description provided for @zipCode.
  ///
  /// In en, this message translates to:
  /// **'Zip Code'**
  String get zipCode;

  /// No description provided for @latitude.
  ///
  /// In en, this message translates to:
  /// **'Latitude'**
  String get latitude;

  /// No description provided for @longitude.
  ///
  /// In en, this message translates to:
  /// **'Longitude'**
  String get longitude;

  /// No description provided for @category.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get category;

  /// No description provided for @description.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get description;

  /// No description provided for @shopName.
  ///
  /// In en, this message translates to:
  /// **'Shop Name'**
  String get shopName;

  /// No description provided for @shopPhone.
  ///
  /// In en, this message translates to:
  /// **'Shop Phone'**
  String get shopPhone;

  /// No description provided for @imageUrl.
  ///
  /// In en, this message translates to:
  /// **'Image URL'**
  String get imageUrl;

  /// No description provided for @licenseUrl.
  ///
  /// In en, this message translates to:
  /// **'License URL'**
  String get licenseUrl;

  /// No description provided for @businessLicenseUrl.
  ///
  /// In en, this message translates to:
  /// **'Business License URL'**
  String get businessLicenseUrl;

  /// No description provided for @mon.
  ///
  /// In en, this message translates to:
  /// **'Mon'**
  String get mon;

  /// No description provided for @tue.
  ///
  /// In en, this message translates to:
  /// **'Tue'**
  String get tue;

  /// No description provided for @wed.
  ///
  /// In en, this message translates to:
  /// **'Wed'**
  String get wed;

  /// No description provided for @thu.
  ///
  /// In en, this message translates to:
  /// **'Thu'**
  String get thu;

  /// No description provided for @fri.
  ///
  /// In en, this message translates to:
  /// **'Fri'**
  String get fri;

  /// No description provided for @sat.
  ///
  /// In en, this message translates to:
  /// **'Sat'**
  String get sat;

  /// No description provided for @sun.
  ///
  /// In en, this message translates to:
  /// **'Sun'**
  String get sun;

  /// No description provided for @dailyRevenue.
  ///
  /// In en, this message translates to:
  /// **'Daily Revenue'**
  String get dailyRevenue;

  /// No description provided for @bookingDistribution.
  ///
  /// In en, this message translates to:
  /// **'Booking Distribution'**
  String get bookingDistribution;

  /// No description provided for @shopNameEn.
  ///
  /// In en, this message translates to:
  /// **'Shop Name (English)'**
  String get shopNameEn;

  /// No description provided for @noServices.
  ///
  /// In en, this message translates to:
  /// **'No services yet'**
  String get noServices;

  /// No description provided for @noTherapists.
  ///
  /// In en, this message translates to:
  /// **'No therapists yet'**
  String get noTherapists;

  /// No description provided for @tabMerchant.
  ///
  /// In en, this message translates to:
  /// **'Merchant'**
  String get tabMerchant;

  /// No description provided for @merchantApplyTitle.
  ///
  /// In en, this message translates to:
  /// **'Apply as Merchant'**
  String get merchantApplyTitle;

  /// No description provided for @merchantApplyDesc.
  ///
  /// In en, this message translates to:
  /// **'Fill in your shop details to start accepting bookings'**
  String get merchantApplyDesc;

  /// No description provided for @mapView.
  ///
  /// In en, this message translates to:
  /// **'Map View'**
  String get mapView;

  /// No description provided for @mapViewTitle.
  ///
  /// In en, this message translates to:
  /// **'Map'**
  String get mapViewTitle;

  /// No description provided for @viewShop.
  ///
  /// In en, this message translates to:
  /// **'View Shop'**
  String get viewShop;

  /// No description provided for @getDirections.
  ///
  /// In en, this message translates to:
  /// **'Get Directions'**
  String get getDirections;

  /// No description provided for @gettingLocation.
  ///
  /// In en, this message translates to:
  /// **'Getting your location...'**
  String get gettingLocation;

  /// No description provided for @noShopsOnMap.
  ///
  /// In en, this message translates to:
  /// **'No shops to display on map'**
  String get noShopsOnMap;

  /// Tooltip for the recenter map button
  ///
  /// In en, this message translates to:
  /// **'Recenter'**
  String get recenter;

  /// Hint shown when recenter is tapped before location is ready
  ///
  /// In en, this message translates to:
  /// **'Location unavailable. Please try again later.'**
  String get locationUnavailable;

  /// No description provided for @paymentTitle.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get paymentTitle;

  /// No description provided for @paymentOrderSummary.
  ///
  /// In en, this message translates to:
  /// **'Order Summary'**
  String get paymentOrderSummary;

  /// No description provided for @paymentPriceBreakdown.
  ///
  /// In en, this message translates to:
  /// **'Price Breakdown'**
  String get paymentPriceBreakdown;

  /// No description provided for @paymentCardDetails.
  ///
  /// In en, this message translates to:
  /// **'Card Details'**
  String get paymentCardDetails;

  /// No description provided for @paymentShop.
  ///
  /// In en, this message translates to:
  /// **'Shop'**
  String get paymentShop;

  /// No description provided for @paymentService.
  ///
  /// In en, this message translates to:
  /// **'Service'**
  String get paymentService;

  /// No description provided for @paymentDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get paymentDate;

  /// No description provided for @paymentTime.
  ///
  /// In en, this message translates to:
  /// **'Time'**
  String get paymentTime;

  /// No description provided for @paymentDuration.
  ///
  /// In en, this message translates to:
  /// **'Duration'**
  String get paymentDuration;

  /// No description provided for @paymentSubtotal.
  ///
  /// In en, this message translates to:
  /// **'Subtotal'**
  String get paymentSubtotal;

  /// No description provided for @paymentCouponDiscount.
  ///
  /// In en, this message translates to:
  /// **'Coupon Discount'**
  String get paymentCouponDiscount;

  /// No description provided for @paymentPlatformFee.
  ///
  /// In en, this message translates to:
  /// **'Platform Fee'**
  String get paymentPlatformFee;

  /// No description provided for @paymentCardName.
  ///
  /// In en, this message translates to:
  /// **'Cardholder Name'**
  String get paymentCardName;

  /// No description provided for @paymentCardNumber.
  ///
  /// In en, this message translates to:
  /// **'Card Number'**
  String get paymentCardNumber;

  /// No description provided for @paymentExpiry.
  ///
  /// In en, this message translates to:
  /// **'Expiry'**
  String get paymentExpiry;

  /// No description provided for @paymentCvc.
  ///
  /// In en, this message translates to:
  /// **'CVC'**
  String get paymentCvc;

  /// No description provided for @paymentPay.
  ///
  /// In en, this message translates to:
  /// **'Pay'**
  String get paymentPay;

  /// No description provided for @paymentProcessing.
  ///
  /// In en, this message translates to:
  /// **'Processing...'**
  String get paymentProcessing;

  /// No description provided for @paymentTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try Again'**
  String get paymentTryAgain;

  /// No description provided for @paymentSuccessTitle.
  ///
  /// In en, this message translates to:
  /// **'Payment Successful!'**
  String get paymentSuccessTitle;

  /// No description provided for @paymentSuccessMessage.
  ///
  /// In en, this message translates to:
  /// **'Your booking has been confirmed.\nRedirecting to My Bookings...'**
  String get paymentSuccessMessage;

  /// No description provided for @transactions.
  ///
  /// In en, this message translates to:
  /// **'Transactions'**
  String get transactions;

  /// No description provided for @transactionList.
  ///
  /// In en, this message translates to:
  /// **'Transaction History'**
  String get transactionList;

  /// No description provided for @transactionDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get transactionDate;

  /// No description provided for @transactionType.
  ///
  /// In en, this message translates to:
  /// **'Type'**
  String get transactionType;

  /// No description provided for @transactionAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get transactionAmount;

  /// No description provided for @transactionFee.
  ///
  /// In en, this message translates to:
  /// **'Fee'**
  String get transactionFee;

  /// No description provided for @transactionNet.
  ///
  /// In en, this message translates to:
  /// **'Net'**
  String get transactionNet;

  /// No description provided for @transactionStatus.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get transactionStatus;

  /// No description provided for @transactionDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get transactionDescription;

  /// No description provided for @transactionBooking.
  ///
  /// In en, this message translates to:
  /// **'Booking'**
  String get transactionBooking;

  /// No description provided for @transactionPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get transactionPayment;

  /// No description provided for @transactionPayout.
  ///
  /// In en, this message translates to:
  /// **'Withdrawal'**
  String get transactionPayout;

  /// No description provided for @transactionRefund.
  ///
  /// In en, this message translates to:
  /// **'Refund'**
  String get transactionRefund;

  /// No description provided for @filterByDate.
  ///
  /// In en, this message translates to:
  /// **'Filter by date'**
  String get filterByDate;

  /// No description provided for @startDate.
  ///
  /// In en, this message translates to:
  /// **'Start Date'**
  String get startDate;

  /// No description provided for @endDate.
  ///
  /// In en, this message translates to:
  /// **'End Date'**
  String get endDate;

  /// No description provided for @exportCsv.
  ///
  /// In en, this message translates to:
  /// **'Export CSV'**
  String get exportCsv;

  /// No description provided for @taxReport.
  ///
  /// In en, this message translates to:
  /// **'Tax Report'**
  String get taxReport;

  /// No description provided for @taxYear.
  ///
  /// In en, this message translates to:
  /// **'Tax Year'**
  String get taxYear;

  /// No description provided for @totalGross.
  ///
  /// In en, this message translates to:
  /// **'Total Gross Revenue'**
  String get totalGross;

  /// No description provided for @totalFees.
  ///
  /// In en, this message translates to:
  /// **'Total Fees'**
  String get totalFees;

  /// No description provided for @totalNet.
  ///
  /// In en, this message translates to:
  /// **'Total Net'**
  String get totalNet;

  /// No description provided for @totalRefunds.
  ///
  /// In en, this message translates to:
  /// **'Total Refunds'**
  String get totalRefunds;

  /// No description provided for @totalPayouts.
  ///
  /// In en, this message translates to:
  /// **'Total Payouts'**
  String get totalPayouts;

  /// No description provided for @netEarnings.
  ///
  /// In en, this message translates to:
  /// **'Net Earnings'**
  String get netEarnings;

  /// No description provided for @noTransactions.
  ///
  /// In en, this message translates to:
  /// **'No transactions found'**
  String get noTransactions;

  /// No description provided for @loadingTransactions.
  ///
  /// In en, this message translates to:
  /// **'Loading transactions...'**
  String get loadingTransactions;

  /// No description provided for @requestRefund.
  ///
  /// In en, this message translates to:
  /// **'Request Refund'**
  String get requestRefund;

  /// No description provided for @requestRefundConfirm.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to refund this booking?'**
  String get requestRefundConfirm;

  /// No description provided for @refundYes.
  ///
  /// In en, this message translates to:
  /// **'Yes, Refund'**
  String get refundYes;

  /// No description provided for @refundSuccess.
  ///
  /// In en, this message translates to:
  /// **'Refund processed successfully'**
  String get refundSuccess;

  /// No description provided for @failedToRefund.
  ///
  /// In en, this message translates to:
  /// **'Failed to process refund'**
  String get failedToRefund;

  /// No description provided for @announcementTitle.
  ///
  /// In en, this message translates to:
  /// **'Announcements'**
  String get announcementTitle;

  /// No description provided for @announcementTypeInfo.
  ///
  /// In en, this message translates to:
  /// **'Info'**
  String get announcementTypeInfo;

  /// No description provided for @announcementTypeImportant.
  ///
  /// In en, this message translates to:
  /// **'Important'**
  String get announcementTypeImportant;

  /// No description provided for @announcementTypeUrgent.
  ///
  /// In en, this message translates to:
  /// **'Urgent'**
  String get announcementTypeUrgent;

  /// No description provided for @announcementEmpty.
  ///
  /// In en, this message translates to:
  /// **'No announcements yet'**
  String get announcementEmpty;

  /// No description provided for @readMore.
  ///
  /// In en, this message translates to:
  /// **'Read more'**
  String get readMore;

  /// Mixed category label
  ///
  /// In en, this message translates to:
  /// **'Mixed'**
  String get categoryMixed;

  /// Map legend title
  ///
  /// In en, this message translates to:
  /// **'Legend'**
  String get mapLegend;

  /// English language label
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get labelEnglish;

  /// Chinese language label
  ///
  /// In en, this message translates to:
  /// **'中文'**
  String get labelChinese;

  /// No description provided for @dateAndTime.
  ///
  /// In en, this message translates to:
  /// **'Date & Time'**
  String get dateAndTime;

  /// No description provided for @chooseTherapist.
  ///
  /// In en, this message translates to:
  /// **'Choose Therapist'**
  String get chooseTherapist;

  /// No description provided for @chooseDateTime.
  ///
  /// In en, this message translates to:
  /// **'Choose Date & Time'**
  String get chooseDateTime;

  /// No description provided for @nextStep.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get nextStep;

  /// No description provided for @selected.
  ///
  /// In en, this message translates to:
  /// **'Selected'**
  String get selected;

  /// No description provided for @assignTherapist.
  ///
  /// In en, this message translates to:
  /// **'The shop will assign a therapist'**
  String get assignTherapist;

  /// No description provided for @noLinkedTherapists.
  ///
  /// In en, this message translates to:
  /// **'No therapist is listed for this service. Continue without a preference for shop assignment.'**
  String get noLinkedTherapists;

  /// No description provided for @yearsExperience.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 year of experience} other{{count} years of experience}}'**
  String yearsExperience(int count);

  /// No description provided for @selectDateFirst.
  ///
  /// In en, this message translates to:
  /// **'Please select a date first'**
  String get selectDateFirst;

  /// No description provided for @today.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get today;

  /// No description provided for @noAvailableSlots.
  ///
  /// In en, this message translates to:
  /// **'No available slots for this date'**
  String get noAvailableSlots;

  /// No description provided for @selectedMinutes.
  ///
  /// In en, this message translates to:
  /// **'{count} min selected'**
  String selectedMinutes(int count);

  /// No description provided for @selectTimeBlocks.
  ///
  /// In en, this message translates to:
  /// **'Choose one available start time; duration follows your specification'**
  String get selectTimeBlocks;

  /// No description provided for @morning.
  ///
  /// In en, this message translates to:
  /// **'Morning'**
  String get morning;

  /// No description provided for @afternoon.
  ///
  /// In en, this message translates to:
  /// **'Afternoon'**
  String get afternoon;

  /// No description provided for @evening.
  ///
  /// In en, this message translates to:
  /// **'Evening'**
  String get evening;

  /// No description provided for @estimatedServicePrice.
  ///
  /// In en, this message translates to:
  /// **'Estimated service price'**
  String get estimatedServicePrice;

  /// No description provided for @reviewTotalBeforeConfirming.
  ///
  /// In en, this message translates to:
  /// **'Review the current total before confirming. The shop handles the order offline; confirming does not record a payment.'**
  String get reviewTotalBeforeConfirming;

  /// No description provided for @coupon.
  ///
  /// In en, this message translates to:
  /// **'Coupon'**
  String get coupon;

  /// No description provided for @select.
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get select;

  /// No description provided for @selectCoupon.
  ///
  /// In en, this message translates to:
  /// **'Select Coupon'**
  String get selectCoupon;

  /// No description provided for @noApplicableCoupons.
  ///
  /// In en, this message translates to:
  /// **'No applicable coupons for this booking'**
  String get noApplicableCoupons;

  /// No description provided for @bookingUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This shop has not opened online booking.'**
  String get bookingUnavailable;

  /// No description provided for @bookingFailedRetry.
  ///
  /// In en, this message translates to:
  /// **'Failed to create booking. Please try again.'**
  String get bookingFailedRetry;

  /// No description provided for @chooseTherapistWhenBooking.
  ///
  /// In en, this message translates to:
  /// **'Choose your therapist when booking.'**
  String get chooseTherapistWhenBooking;

  /// No description provided for @aboutShop.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get aboutShop;

  /// No description provided for @showLess.
  ///
  /// In en, this message translates to:
  /// **'Show less'**
  String get showLess;

  /// No description provided for @bookService.
  ///
  /// In en, this message translates to:
  /// **'Book'**
  String get bookService;

  /// No description provided for @shopInfoCopied.
  ///
  /// In en, this message translates to:
  /// **'Shop info copied to clipboard'**
  String get shopInfoCopied;

  /// No description provided for @bookingUnavailableHint.
  ///
  /// In en, this message translates to:
  /// **'This shop has not opened online booking. Services and prices are available to browse.'**
  String get bookingUnavailableHint;

  /// No description provided for @reviewsUnavailableHint.
  ///
  /// In en, this message translates to:
  /// **'This shop is not accepting new or updated reviews. Existing reviews remain available.'**
  String get reviewsUnavailableHint;

  /// No description provided for @onlineBookingUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Online booking unavailable'**
  String get onlineBookingUnavailable;

  /// No description provided for @favoriteShop.
  ///
  /// In en, this message translates to:
  /// **'Save shop'**
  String get favoriteShop;

  /// No description provided for @unfavoriteShop.
  ///
  /// In en, this message translates to:
  /// **'Remove saved shop'**
  String get unfavoriteShop;

  /// No description provided for @copyShopInfo.
  ///
  /// In en, this message translates to:
  /// **'Copy shop information'**
  String get copyShopInfo;

  /// No description provided for @clearSearch.
  ///
  /// In en, this message translates to:
  /// **'Clear search'**
  String get clearSearch;

  /// No description provided for @viewAllReviews.
  ///
  /// In en, this message translates to:
  /// **'View all {count} reviews'**
  String viewAllReviews(int count);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
