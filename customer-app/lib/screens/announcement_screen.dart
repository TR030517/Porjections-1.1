import 'package:flutter/material.dart';
import '../services/announcement_service.dart';
import '../services/api_service.dart';
import '../l10n/app_localizations.dart';

/// Announcement Screen — displays active platform announcements
class AnnouncementScreen extends StatefulWidget {
  const AnnouncementScreen({super.key});

  @override
  State<AnnouncementScreen> createState() => _AnnouncementScreenState();
}

class _AnnouncementScreenState extends State<AnnouncementScreen> {
  final AnnouncementService _service = AnnouncementService(ApiService());
  List<Announcement>? _announcements;
  bool _loading = true;
  String? _error;
  int _expandedIndex = -1;
  int _requestVersion = 0;

  @override
  void initState() {
    super.initState();
    _fetchAnnouncements();
  }

  Future<void> _fetchAnnouncements() async {
    if (!mounted) return;
    final request = ++_requestVersion;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _service.getActiveAnnouncements();
      if (!mounted || request != _requestVersion) return;
      setState(() {
        _announcements = items;
      });
    } catch (_) {
      if (!mounted || request != _requestVersion) return;
      setState(() {
        _error = 'Unable to load announcements.';
      });
    } finally {
      if (mounted && request == _requestVersion) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  void dispose() {
    _requestVersion++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(
        title: Text(t.announcementTitle),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: _buildBody(theme, t),
    );
  }

  Widget _buildBody(ThemeData theme, AppLocalizations t) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(t.errorOccurred, style: TextStyle(color: Colors.grey[600])),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: _fetchAnnouncements,
              icon: const Icon(Icons.refresh),
              label: Text(t.retry),
            ),
          ],
        ),
      );
    }

    final announcements = _announcements ?? [];
    if (announcements.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.campaign_outlined, size: 64, color: Colors.grey[300]),
            const SizedBox(height: 16),
            Text(
              t.announcementEmpty,
              style: TextStyle(
                fontSize: 16,
                color: Colors.grey[500],
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetchAnnouncements,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: announcements.length,
        itemBuilder: (context, index) {
          final item = announcements[index];
          final isExpanded = _expandedIndex == index;
          return _AnnouncementCard(
            announcement: item,
            isExpanded: isExpanded,
            onTap: () {
              setState(() {
                _expandedIndex = isExpanded ? -1 : index;
              });
            },
          );
        },
      ),
    );
  }
}

/// Individual announcement card widget
class _AnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  final bool isExpanded;
  final VoidCallback onTap;

  const _AnnouncementCard({
    required this.announcement,
    required this.isExpanded,
    required this.onTap,
  });

  Color _typeColor() {
    switch (announcement.type) {
      case 'URGENT':
        return const Color(0xFFE53935);
      case 'IMPORTANT':
        return const Color(0xFFF57C00);
      default:
        return const Color(0xFF1976D2);
    }
  }

  IconData _typeIcon() {
    switch (announcement.type) {
      case 'URGENT':
        return Icons.warning_amber_rounded;
      case 'IMPORTANT':
        return Icons.info_outline;
      default:
        return Icons.campaign_outlined;
    }
  }

  String _typeLabel(AppLocalizations t) {
    switch (announcement.type) {
      case 'URGENT':
        return t.announcementTypeUrgent;
      case 'IMPORTANT':
        return t.announcementTypeImportant;
      default:
        return t.announcementTypeInfo;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = AppLocalizations.of(context)!;
    final typeColor = _typeColor();
    final isUrgent = announcement.type == 'URGENT';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: isUrgent ? 3 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: isUrgent
            ? BorderSide(color: typeColor.withValues(alpha: 0.3))
            : BorderSide.none,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row: icon, type badge, date
              Row(
                children: [
                  Icon(_typeIcon(), color: typeColor, size: 20),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: typeColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      _typeLabel(t),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: typeColor,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Text(
                    _formatDate(announcement.createdAt),
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[500],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // Title
              Text(
                announcement.title,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 6),

              // Content
              AnimatedCrossFade(
                firstChild: Text(
                  announcement.content,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.grey[700],
                    height: 1.5,
                  ),
                ),
                secondChild: Text(
                  announcement.content,
                  style: TextStyle(
                    fontSize: 14,
                    color: Colors.grey[700],
                    height: 1.5,
                  ),
                ),
                crossFadeState: isExpanded
                    ? CrossFadeState.showSecond
                    : CrossFadeState.showFirst,
                duration: const Duration(milliseconds: 200),
              ),

              // Expand/collapse indicator
              if (announcement.content.length > 100)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    isExpanded ? 'Read less' : t.readMore,
                    style: TextStyle(
                      fontSize: 13,
                      color: typeColor,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inDays == 0) return 'Today';
    if (diff.inDays == 1) return 'Yesterday';
    if (diff.inDays < 7) return '${diff.inDays} days ago';
    return '${date.month}/${date.day}/${date.year}';
  }
}
