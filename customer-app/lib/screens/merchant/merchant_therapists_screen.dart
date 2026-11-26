import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';

/// Merchant Therapists Screen — manage therapists
class MerchantTherapistsScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantTherapistsScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantTherapistsScreen> createState() =>
      _MerchantTherapistsScreenState();
}

class _MerchantTherapistsScreenState
    extends ConsumerState<MerchantTherapistsScreen> {
  List<Map<String, dynamic>> _therapists = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadTherapists();
  }

  Future<void> _loadTherapists() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final api = ref.read(merchantApiProvider);
      final data = await api.getTherapists(widget.shopId);
      if (mounted) {
        setState(() => _therapists = data.cast<Map<String, dynamic>>());
      }
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _showTherapistForm({Map<String, dynamic>? existing}) async {
    final nameController = TextEditingController(text: existing?['name'] ?? '');
    final titleController = TextEditingController(
      text: existing?['title'] ?? '',
    );
    final bioController = TextEditingController(text: existing?['bio'] ?? '');
    final yearsExpController = TextEditingController(
      text: existing?['yearsExp']?.toString() ?? '0',
    );
    String gender = existing?['gender'] ?? '';
    bool isActive = existing?['isActive'] != false;
    String? validationMessage;

    final isEdit = existing != null;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEdit ? 'Edit Therapist' : 'Add Therapist',
                  style: Theme.of(
                    ctx,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Name *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: titleController,
                  decoration: const InputDecoration(
                    labelText: 'Title',
                    hintText: 'e.g. Senior Massage Therapist',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: gender.isEmpty ? null : gender,
                  decoration: const InputDecoration(
                    labelText: 'Gender',
                    border: OutlineInputBorder(),
                  ),
                  items: ['MALE', 'FEMALE']
                      .map(
                        (g) => DropdownMenuItem(
                          value: g,
                          child: Text(g == 'MALE' ? 'Male' : 'Female'),
                        ),
                      )
                      .toList(),
                  onChanged: (v) {
                    if (v != null) setSheetState(() => gender = v);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: yearsExpController,
                  decoration: const InputDecoration(
                    labelText: 'Years of Experience',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: bioController,
                  decoration: const InputDecoration(
                    labelText: 'Bio',
                    hintText: 'Brief introduction...',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 3,
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Available for booking'),
                  value: isActive,
                  onChanged: (value) => setSheetState(() => isActive = value),
                ),
                const SizedBox(height: 24),
                if (validationMessage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      validationMessage!,
                      style: TextStyle(color: Theme.of(ctx).colorScheme.error),
                    ),
                  ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () {
                      final years = int.tryParse(
                        yearsExpController.text.trim(),
                      );
                      if (nameController.text.trim().isEmpty ||
                          years == null ||
                          years < 0 ||
                          years > 60) {
                        setSheetState(
                          () => validationMessage =
                              'Enter a name and whole years of experience from 0 to 60.',
                        );
                        return;
                      }
                      Navigator.pop(ctx, true);
                    },
                    child: Text(isEdit ? 'Save Changes' : 'Add Therapist'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (saved == true) {
      final data = <String, dynamic>{
        'name': nameController.text.trim(),
        'title': titleController.text.trim().isEmpty
            ? null
            : titleController.text.trim(),
        'bio': bioController.text.trim().isEmpty
            ? null
            : bioController.text.trim(),
        'yearsExp': int.tryParse(yearsExpController.text.trim()) ?? 0,
        'gender': gender.isEmpty ? null : gender,
        'isActive': isActive,
      };

      try {
        final api = ref.read(merchantApiProvider);
        if (isEdit) {
          await api.updateTherapist(existing['id'].toString(), data);
        } else {
          await api.createTherapist(widget.shopId, data);
        }
        _loadTherapists();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(isEdit ? 'Therapist updated' : 'Therapist added'),
              backgroundColor: Colors.green,
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }

    nameController.dispose();
    titleController.dispose();
    bioController.dispose();
    yearsExpController.dispose();
  }

  Future<void> _deleteTherapist(String therapistId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Deactivate Therapist'),
        content: const Text(
          'Existing bookings will be retained. You can reactivate this therapist by editing their availability.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Deactivate'),
          ),
        ],
      ),
    );
    if (confirm == true) {
      try {
        final api = ref.read(merchantApiProvider);
        await api.deleteTherapist(therapistId);
        _loadTherapists();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Failed to deactivate: $e'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Therapists')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showTherapistForm(),
        child: const Icon(Icons.person_add),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.error_outline,
                      size: 64,
                      color: Colors.grey[400],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Failed to load therapists',
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _errorMessage!.length > 120
                          ? '${_errorMessage!.substring(0, 120)}...'
                          : _errorMessage!,
                      style: TextStyle(color: Colors.grey[600], fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    FilledButton.tonalIcon(
                      onPressed: _loadTherapists,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            )
          : _therapists.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.people_outline,
                      size: 64,
                      color: Colors.grey[300],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No therapists yet',
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Tap + to add a therapist',
                      style: TextStyle(color: Colors.grey[500]),
                    ),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadTherapists,
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _therapists.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final t = _therapists[i];
                  final name = t['name'] ?? '';
                  final title = t['title'] as String?;
                  final yearsExp = t['yearsExp'] ?? 0;
                  final gender = t['gender'] as String?;

                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      vertical: 4,
                      horizontal: 4,
                    ),
                    leading: CircleAvatar(
                      backgroundColor: theme.colorScheme.primaryContainer,
                      child: Text(
                        (name as String).isNotEmpty
                            ? name[0].toUpperCase()
                            : '?',
                        style: TextStyle(
                          color: theme.colorScheme.onPrimaryContainer,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    title: Text(
                      name,
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      [
                        if (t['isActive'] == false) 'Inactive',
                        if (title != null && title.isNotEmpty) title,
                        if (yearsExp != null && yearsExp > 0)
                          '$yearsExp yr${yearsExp > 1 ? 's' : ''}',
                        if (gender != null && gender.isNotEmpty)
                          gender == 'MALE' ? 'Male' : 'Female',
                      ].join('  \u00B7  '),
                      style: TextStyle(color: Colors.grey[600], fontSize: 13),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.edit_outlined, size: 20),
                          onPressed: () => _showTherapistForm(existing: t),
                        ),
                        IconButton(
                          icon: const Icon(
                            Icons.delete_outlined,
                            size: 20,
                            color: Colors.red,
                          ),
                          onPressed: () => _deleteTherapist(t['id'].toString()),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
    );
  }
}
