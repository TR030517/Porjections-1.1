import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';

/// Merchant Services Screen — manage shop services
class MerchantServicesScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantServicesScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantServicesScreen> createState() =>
      _MerchantServicesScreenState();
}

class _MerchantServicesScreenState
    extends ConsumerState<MerchantServicesScreen> {
  List<Map<String, dynamic>> _services = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadServices();
  }

  Future<void> _loadServices() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final api = ref.read(merchantApiProvider);
      final data = await api.getShopServices(widget.shopId);
      if (mounted) {
        setState(() => _services = data.cast<Map<String, dynamic>>());
      }
    } catch (e) {
      if (mounted) setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _showServiceForm({Map<String, dynamic>? existing}) async {
    final nameController = TextEditingController(text: existing?['name'] ?? '');
    final nameEnController = TextEditingController(
      text: existing?['nameEn'] ?? '',
    );
    final durationController = TextEditingController(
      text: existing?['durationMin']?.toString() ?? '60',
    );
    final priceController = TextEditingController(
      text: existing != null
          ? '${(existing['priceCents'] as num? ?? 0) / 100}'
          : '',
    );
    final descController = TextEditingController(
      text: existing?['description'] ?? '',
    );
    String category = existing?['category'] ?? 'MASSAGE';
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
                  isEdit ? 'Edit Service' : 'Add Service',
                  style: Theme.of(
                    ctx,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Service Name *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: nameEnController,
                  decoration: const InputDecoration(
                    labelText: 'Name (English, optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: category,
                  decoration: const InputDecoration(
                    labelText: 'Category *',
                    border: OutlineInputBorder(),
                  ),
                  items:
                      [
                            'MASSAGE',
                            'REFLEXOLOGY',
                            'CUPPING',
                            'SCRAPING',
                            'HEAD_THERAPY',
                            'OTHER',
                          ]
                          .map(
                            (c) => DropdownMenuItem(value: c, child: Text(c)),
                          )
                          .toList(),
                  onChanged: (v) {
                    if (v != null) setSheetState(() => category = v);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: durationController,
                  decoration: const InputDecoration(
                    labelText: 'Duration (min) *',
                    helperText: 'Whole minutes, from 30 to 120',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: priceController,
                  decoration: const InputDecoration(
                    labelText: 'Price (\$) *',
                    prefixText: '\$ ',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: descController,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 2,
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
                      final duration = int.tryParse(
                        durationController.text.trim(),
                      );
                      final price = double.tryParse(
                        priceController.text.trim(),
                      );
                      if (nameController.text.trim().isEmpty ||
                          duration == null ||
                          duration < 5 ||
                          duration > 120 ||
                          price == null ||
                          !price.isFinite ||
                          price < 0) {
                        setSheetState(
                          () => validationMessage =
                              'Enter a name, 30–120 whole minutes, and a valid nonnegative price.',
                        );
                        return;
                      }
                      Navigator.pop(ctx, true);
                    },
                    child: Text(isEdit ? 'Save Changes' : 'Add Service'),
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
        'nameEn': nameEnController.text.trim().isEmpty
            ? null
            : nameEnController.text.trim(),
        'category': category,
        'isActive': isActive,
        'durationMin': int.tryParse(durationController.text.trim()) ?? 60,
        'priceCents':
            ((double.tryParse(priceController.text.trim()) ?? 0) * 100).round(),
        'description': descController.text.trim().isEmpty
            ? null
            : descController.text.trim(),
      };

      try {
        final api = ref.read(merchantApiProvider);
        if (isEdit) {
          await api.updateShopService(existing['id'].toString(), data);
        } else {
          await api.createShopService(widget.shopId, data);
        }
        _loadServices();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(isEdit ? 'Service updated' : 'Service created'),
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
    nameEnController.dispose();
    durationController.dispose();
    priceController.dispose();
    descController.dispose();
  }

  Future<void> _deleteService(String serviceId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Deactivate Service'),
        content: const Text(
          'Existing bookings will be retained. You can reactivate this service by editing its availability.',
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
        await api.deleteShopService(serviceId);
        _loadServices();
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
      appBar: AppBar(title: const Text('Services')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showServiceForm(),
        child: const Icon(Icons.add),
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
                      'Failed to load services',
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
                      onPressed: _loadServices,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            )
          : _services.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.miscellaneous_services_outlined,
                      size: 64,
                      color: Colors.grey[300],
                    ),
                    const SizedBox(height: 16),
                    Text('No services yet', style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(
                      'Tap + to add a service',
                      style: TextStyle(color: Colors.grey[500]),
                    ),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _loadServices,
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _services.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final s = _services[i];
                  final priceCents =
                      (s['priceCents'] as num?)?.toDouble() ?? 0.0;
                  final durationMin = s['durationMin'] ?? 0;
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      vertical: 4,
                      horizontal: 4,
                    ),
                    title: Text(
                      s['name'] ?? '',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text(
                      '${s['isActive'] == false ? 'Inactive · ' : ''}${s['category'] ?? ''}  ·  ${durationMin}min  ·  \$${(priceCents / 100).toStringAsFixed(2)}',
                      style: TextStyle(color: Colors.grey[600]),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.edit_outlined, size: 20),
                          onPressed: () => _showServiceForm(existing: s),
                        ),
                        IconButton(
                          icon: const Icon(
                            Icons.delete_outline,
                            size: 20,
                            color: Colors.red,
                          ),
                          onPressed: () => _deleteService(s['id'].toString()),
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
