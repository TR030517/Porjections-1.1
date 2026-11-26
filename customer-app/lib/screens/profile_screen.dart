import 'package:flutter/material.dart';
import '../widgets/public_information_links.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/auth_provider.dart';
import '../l10n/app_localizations.dart';
import '../services/merchant_portal_service.dart';
import '../services/upload_service.dart';
import 'edit_profile_screen.dart';
import 'my_reviews_screen.dart';
import 'coupon_center_screen.dart';
import 'announcement_screen.dart';
import '../navigation/customer_navigation.dart';
import '../navigation/booking_center_navigation.dart';
import 'after_sales_screen.dart';
import 'gift_wallet_screen.dart';
import 'gift_orders_screen.dart';
import 'notification_inbox_screen.dart';
import 'support_screen.dart';
import '../models/user.dart';
import 'customer_password_screen.dart';

/// Profile Screen — user info & settings with spa-themed design
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final user = authState.user;
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
      children: [
        // ── Avatar Section ──────────────────────────────────────────
        _buildAvatarSection(context, ref, user, theme),

        const SizedBox(height: 28),

        // Task groups share their existing business screens and permissions.
        _SectionHeader(
          label: 'Appointments & support',
          theme: theme,
        ),
        const SizedBox(height: 8),
        _MenuTile(
          icon: Icons.calendar_today_outlined,
          title: 'My bookings',
          subtitle: 'All appointments and booking details',
          iconBgColor: const Color(0xFF00897B),
          onTap: () => _openBookings(context, ref, history: false),
        ),
        _MenuTile(
          icon: Icons.history_outlined,
          title: AppLocalizations.of(context)!.bookingHistory,
          subtitle: 'Completed, cancelled and refunded bookings',
          iconBgColor: const Color(0xFF00897B),
          onTap: () => _openBookings(context, ref, history: true),
        ),
        _MenuTile(
          icon: Icons.support_agent,
          title: 'Support requests',
          subtitle: 'Follow up on booking support',
          iconBgColor: const Color(0xFF00897B),
          onTap: () => Navigator.push(context,
            MaterialPageRoute(builder: (_) => const AfterSalesScreen())),
        ),
        _MenuTile(
          icon: Icons.contact_support_outlined,
          title: 'Contact support',
          subtitle: 'Choose a booking or find platform contacts',
          iconBgColor: const Color(0xFF287C7C),
          onTap: () => Navigator.push(context,
            MaterialPageRoute(builder: (_) => const SupportScreen())),
        ),
        _MenuTile(
          icon: Icons.rate_review_outlined,
          title: AppLocalizations.of(context)!.myReviews,
          subtitle: AppLocalizations.of(context)!.viewYourReviews,
          iconBgColor: const Color(0xFF8E24AA),
          onTap: () => Navigator.push(context,
            MaterialPageRoute(builder: (_) => const MyReviewsScreen())),
        ),
        const SizedBox(height: 20),
        _SectionHeader(label: 'Gifts & benefits', theme: theme),
        _MenuTile(
          icon: Icons.card_giftcard_outlined,
          title: 'My gift benefits',
          subtitle: 'Store benefits and usage history',
          iconBgColor: const Color(0xFF0D6B5E),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const GiftWalletScreen()),
          ),
        ),
        _MenuTile(
          icon: Icons.receipt_long_outlined,
          title: 'My gift orders',
          subtitle: 'Store payment and refund records',
          iconBgColor: const Color(0xFF287C7C),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const GiftOrdersScreen()),
          ),
        ),
        _MenuTile(
          icon: Icons.local_activity_outlined,
          title: 'Coupons',
          subtitle: 'Claim & manage discount coupons',
          iconBgColor: const Color(0xFFE67E22),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const CouponCenterScreen()),
          ),
        ),
        const SizedBox(height: 20),
        _SectionHeader(label: 'Messages', theme: theme),
        _MenuTile(
          icon: Icons.notifications_none,
          title: 'Inbox',
          subtitle: 'Booking and benefit updates',
          iconBgColor: const Color(0xFF287C7C),
          onTap: () => Navigator.push(context,
            MaterialPageRoute(builder: (_) => const NotificationInboxScreen())),
        ),
        _MenuTile(
          icon: Icons.campaign_outlined,
          title: AppLocalizations.of(context)!.announcementTitle,
          subtitle: 'Platform announcements',
          iconBgColor: const Color(0xFF0D6B5E),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const AnnouncementScreen()),
          ),
        ),
        const SizedBox(height: 20),
        _SectionHeader(label: 'Account', theme: theme),
        if (user != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
            child: SelectableText('Your account ID: ${user.id}', style: theme.textTheme.bodySmall),
          ),
        _MenuTile(
          icon: Icons.person_outline,
          title: AppLocalizations.of(context)!.editProfile,
          subtitle: AppLocalizations.of(context)!.editNamePhoneEmail,
          iconBgColor: const Color(0xFF0D6B5E),
          onTap: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const EditProfileScreen()),
          ),
        ),
        if (user?.role == 'CUSTOMER' && authState.isLoggedIn)
          _MenuTile(
            icon: Icons.lock_outline,
            title: 'Account password',
            subtitle: 'Change or recover your customer password',
            iconBgColor: const Color(0xFF0D6B5E),
            onTap: () async {
              final changed = await Navigator.push<bool>(context,
                MaterialPageRoute(builder: (_) => const CustomerPasswordScreen()));
              if (context.mounted && changed == true) openCustomerHome(context);
            },
          ),
        _MenuTile(
          icon: Icons.favorite_outline,
          title: AppLocalizations.of(context)!.myFavorites,
          subtitle: AppLocalizations.of(context)!.savedShops,
          iconBgColor: const Color(0xFFE91E63),
          onTap: () => openCustomerHome(context, initialTab: 2),
        ),

        const SizedBox(height: 12),

        // ── Section: Merchant ───────────────────────────────────────
        if (user != null) ...[
          const SizedBox(height: 12),
          _SectionHeader(label: 'Merchant', theme: theme),
          const SizedBox(height: 8),
          _MerchantPortalCard(
            onTap: () async {
              try {
                final opened = await ref.read(merchantPortalLauncherProvider)();
                if (opened) return;
              } catch (_) {
                // Report the unavailable website without falling back to legacy screens.
              }
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'Open /merchant/ on the deployed Massajoy website to sign in with a merchant account.',
                    ),
                  ),
                );
              }
            },
          ),
        ],

        const SizedBox(height: 24),

        // ── Logout Button ──────────────────────────────────────────
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => _confirmLogout(context, ref),
            icon: const Icon(Icons.logout, color: Colors.redAccent),
            label: Text(
              AppLocalizations.of(context)!.logout,
              style: const TextStyle(color: Colors.redAccent),
            ),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Colors.redAccent),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
        ),

        const SizedBox(height: 20),
        const PublicInformationLinks(),
        const SizedBox(height: 40),
      ],
    );
  }

  // ─── Avatar Section ──────────────────────────────────────────

  void _openBookings(BuildContext context, WidgetRef ref, {required bool history}) {
    openBookingCenter(context, ref, history: history);
  }

  Widget _buildAvatarSection(
    BuildContext context,
    WidgetRef ref,
    User? user,
    ThemeData theme,
  ) {
    final initials = _initials(user?.name ?? user?.phone ?? 'U');
    final hasAvatar = user?.avatarUrl != null && user!.avatarUrl!.isNotEmpty;

    return Center(
      child: Column(
        children: [
          // Avatar with gradient ring — tappable for avatar upload
          GestureDetector(
            onTap: () => _pickAndUploadAvatar(context, ref),
            child: Container(
              width: 108,
              height: 108,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const LinearGradient(
                  colors: [Color(0xFF0D6B5E), Color(0xFFD4A848)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Center(
                child: CircleAvatar(
                  radius: 48,
                  backgroundColor: theme.colorScheme.primaryContainer,
                  backgroundImage: hasAvatar
                      ? NetworkImage(user.avatarUrl!)
                      : null,
                  child: hasAvatar
                      ? null
                      : Text(
                          initials,
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: theme.colorScheme.onPrimaryContainer,
                          ),
                        ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            user?.name ?? 'User',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          if (user?.phone != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                user!.phone!,
                style: TextStyle(color: Colors.grey[600], fontSize: 14),
              ),
            ),
          if (user?.email != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                user!.email!,
                style: TextStyle(color: Colors.grey[500], fontSize: 13),
              ),
            ),
        ],
      ),
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────

  String _initials(String name) {
    if (name.isEmpty) return 'U';
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name[0].toUpperCase();
  }

  Future<void> _pickAndUploadAvatar(BuildContext context, WidgetRef ref) async {
    String? url;
    try {
      url = await ref.read(uploadServiceProvider).uploadAvatar();
      if (url == null) return; // Image selection was cancelled.
      await ref.read(authProvider.notifier).refreshProfile();
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is FormatException
                  ? error.message.toString()
                  : 'Avatar uploads are currently unavailable.',
            ),
          ),
        );
      }
      return;
    }
    if (!context.mounted) return;
    final l10n2 = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l10n2.profileUpdated)));
  }

  void _confirmLogout(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(AppLocalizations.of(ctx)!.logout),
        content: Text(AppLocalizations.of(ctx)!.logoutConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              AppLocalizations.of(ctx)!.cancel,
              style: TextStyle(color: Colors.grey[600]),
            ),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                await ref.read(authProvider.notifier).logout();
              } catch (_) {
                  if (context.mounted && !ref.read(authProvider).isLoggedIn) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('You are signed out on this browser. Server sign-out could not be confirmed. Sign in again when you are ready.')));
                  }
              }
              if (context.mounted) {
                openCustomerHome(context);
              }
            },
            child: Text(
              AppLocalizations.of(ctx)!.logout,
              style: const TextStyle(
                color: Colors.redAccent,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  Sub-widgets
// ═══════════════════════════════════════════════════════════════

/// Section header label with primary color
class _SectionHeader extends StatelessWidget {
  final String label;
  final ThemeData theme;

  const _SectionHeader({required this.label, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 4),
      child: Text(
        label,
        style: theme.textTheme.titleSmall?.copyWith(
          color: const Color(0xFF0D6B5E),
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

/// Menu tile with colored icon background
class _MenuTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color iconBgColor;
  final VoidCallback onTap;

  const _MenuTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.iconBgColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 4),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: ListTile(
            leading: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: iconBgColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: iconBgColor, size: 22),
            ),
            title: Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
            ),
            subtitle: Text(
              subtitle,
              style: TextStyle(fontSize: 13, color: Colors.grey[500]),
            ),
            trailing: Icon(
              Icons.chevron_right,
              color: Colors.grey[400],
              size: 22,
            ),
            contentPadding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
          ),
        ),
      ),
    );
  }
}

/// "Merchant Portal" card with primary accent
class _MerchantPortalCard extends StatelessWidget {
  final VoidCallback onTap;

  const _MerchantPortalCard({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(
          color: theme.colorScheme.primary.withValues(alpha: 0.3),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: ListTile(
            leading: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                Icons.storefront,
                color: theme.colorScheme.primary,
                size: 22,
              ),
            ),
            title: Text(
              AppLocalizations.of(context)!.merchantPortal,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 15,
                color: theme.colorScheme.primary,
              ),
            ),
            subtitle: Text(
              'Existing merchant accounts sign in at /merchant/',
              style: TextStyle(fontSize: 13, color: Colors.grey[500]),
            ),
            trailing: Icon(
              Icons.chevron_right,
              color: theme.colorScheme.primary,
              size: 22,
            ),
            contentPadding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
          ),
        ),
      ),
    );
  }
}
