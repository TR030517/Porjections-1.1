import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/merchant_provider.dart';
import '../../models/merchant.dart';

/// Merchant Shop Edit Screen — edit shop info, business hours, and images
class MerchantShopEditScreen extends ConsumerStatefulWidget {
  final String shopId;
  const MerchantShopEditScreen({super.key, required this.shopId});

  @override
  ConsumerState<MerchantShopEditScreen> createState() => _MerchantShopEditScreenState();
}

class _MerchantShopEditScreenState extends ConsumerState<MerchantShopEditScreen> {
  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();
  final _nameEnController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _zipCodeController = TextEditingController();
  final _descriptionController = TextEditingController();

  late List<_BusinessHourEntry> _hours;
  bool _isSaving = false;
  bool _isHoursSaving = false;
  bool _initialized = false;

  @override
  void dispose() {
    _nameController.dispose();
    _nameEnController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _zipCodeController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  void _initFromShop(MerchantShop shop) {
    if (_initialized) return;
    _initialized = true;
    _nameController.text = shop.name;
    _nameEnController.text = shop.nameEn ?? '';
    _phoneController.text = shop.phone ?? '';
    _addressController.text = shop.address;
    _cityController.text = shop.city;
    _stateController.text = shop.state;
    _zipCodeController.text = shop.zipCode ?? '';
    _descriptionController.text = shop.description ?? '';

    final days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    if (shop.businessHours != null && shop.businessHours!.isNotEmpty) {
      _hours = days.map((day) {
        final existing = shop.businessHours!.where((h) => h.dayOfWeek == day).firstOrNull;
        return _BusinessHourEntry(
          dayOfWeek: day,
          openTime: existing?.openTime ?? '09:00',
          closeTime: existing?.closeTime ?? '18:00',
          isClosed: existing?.isClosed ?? false,
        );
      }).toList();
    }
  }

  Future<void> _saveShop() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);
    try {
      final api = ref.read(merchantApiProvider);
      await api.updateShop(widget.shopId, {
        'name': _nameController.text.trim(),
        'nameEn': _nameController.text.trim().isEmpty ? null : _nameController.text.trim(),
        'phone': _phoneController.text.trim(),
        'address': _addressController.text.trim(),
        'city': _cityController.text.trim(),
        'state': _stateController.text.trim(),
        'zipCode': _zipCodeController.text.trim(),
        'description': _descriptionController.text.trim().isEmpty
            ? null : _descriptionController.text.trim(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Shop updated'), backgroundColor: Colors.green),
        );
        ref.invalidate(merchantShopsProvider);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _saveHours() async {
    setState(() => _isHoursSaving = true);
    try {
      final api = ref.read(merchantApiProvider);
      await api.setBusinessHours(
        widget.shopId,
        _hours.map((h) => {
          'dayOfWeek': h.dayOfWeek,
          'openTime': h.isClosed ? null : h.openTime,
          'closeTime': h.isClosed ? null : h.closeTime,
          'isClosed': h.isClosed,
        }).toList(),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Business hours updated'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save hours: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isHoursSaving = false);
    }
  }

  Future<void> _addImage() async {
    final urlController = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Image'),
        content: TextField(
          controller: urlController,
          decoration: const InputDecoration(
            labelText: 'Image URL',
            hintText: 'https://...',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    if (result == true && urlController.text.trim().isNotEmpty) {
      try {
        final api = ref.read(merchantApiProvider);
        await api.addShopImage(widget.shopId, {'url': urlController.text.trim()});
        ref.invalidate(merchantShopsProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Image added'), backgroundColor: Colors.green),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to add image: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
    urlController.dispose();
  }

  Future<void> _deleteImage(String imageId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Image'),
        content: const Text('Are you sure you want to delete this image?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirm == true) {
      try {
        final api = ref.read(merchantApiProvider);
        await api.deleteShopImage(imageId);
        ref.invalidate(merchantShopsProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Image deleted'), backgroundColor: Colors.green),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to delete: $e'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  Future<void> _pickTime(int index, bool isOpenTime) async {
    final entry = _hours[index];
    final current = isOpenTime ? entry.openTime : entry.closeTime;
    final parts = (current ?? '09:00').split(':');
    final initialTime = TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1]));
    final picked = await showTimePicker(context: context, initialTime: initialTime);
    if (picked != null) {
      final timeStr = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
      setState(() {
        if (isOpenTime) {
          _hours[index] = _BusinessHourEntry(
            dayOfWeek: entry.dayOfWeek,
            openTime: timeStr,
            closeTime: entry.closeTime,
            isClosed: entry.isClosed,
          );
        } else {
          _hours[index] = _BusinessHourEntry(
            dayOfWeek: entry.dayOfWeek,
            openTime: entry.openTime,
            closeTime: timeStr,
            isClosed: entry.isClosed,
          );
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final shopsAsync = ref.watch(merchantShopsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Edit Shop')),
      body: shopsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.error_outline, size: 64, color: Colors.grey[400]),
                const SizedBox(height: 16),
                Text('Failed to load shop data', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(
                  '$err'.length > 120 ? '${'$err'.substring(0, 120)}...' : '$err',
                  style: TextStyle(color: Colors.grey[600], fontSize: 13),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                FilledButton.tonalIcon(
                  onPressed: () => ref.invalidate(merchantShopsProvider),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
        data: (shops) {
          final shop = shops.firstWhere((s) => s.id == widget.shopId,
              orElse: () => shops.first);
          _initFromShop(shop);

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Basic Info ──
                  Text('Basic Information', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _nameController,
                    decoration: const InputDecoration(labelText: 'Shop Name', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _nameEnController,
                    decoration: const InputDecoration(labelText: 'Shop Name (English)', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _phoneController,
                    decoration: const InputDecoration(labelText: 'Phone', border: OutlineInputBorder()),
                    keyboardType: TextInputType.phone,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _descriptionController,
                    decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder()),
                    maxLines: 3,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _addressController,
                    decoration: const InputDecoration(labelText: 'Address', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(child: TextFormField(
                        controller: _cityController,
                        decoration: const InputDecoration(labelText: 'City', border: OutlineInputBorder()),
                      )),
                      const SizedBox(width: 12),
                      Expanded(child: TextFormField(
                        controller: _stateController,
                        decoration: const InputDecoration(labelText: 'State', border: OutlineInputBorder()),
                      )),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _zipCodeController,
                    decoration: const InputDecoration(labelText: 'Zip Code', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: _isSaving ? null : _saveShop,
                      child: _isSaving
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Save Shop Info'),
                    ),
                  ),

                  const SizedBox(height: 32),
                  const Divider(),

                  // ── Business Hours ──
                  Text('Business Hours', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  ...List.generate(_hours.length, (i) {
                    final h = _hours[i];
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                        side: BorderSide(color: Colors.grey.shade200),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(
                          children: [
                            SizedBox(
                              width: 36,
                              child: Text(h.dayLabel, style: const TextStyle(fontWeight: FontWeight.bold)),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: h.isClosed
                                  ? Text('Closed', style: TextStyle(color: Colors.red[400], fontStyle: FontStyle.italic))
                                  : Row(
                                      children: [
                                        InkWell(
                                          onTap: () => _pickTime(i, true),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                            decoration: BoxDecoration(
                                              border: Border.all(color: Colors.grey.shade300),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(h.openTime ?? '--'),
                                          ),
                                        ),
                                        const Padding(
                                          padding: EdgeInsets.symmetric(horizontal: 8),
                                          child: Text('-'),
                                        ),
                                        InkWell(
                                          onTap: () => _pickTime(i, false),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                            decoration: BoxDecoration(
                                              border: Border.all(color: Colors.grey.shade300),
                                              borderRadius: BorderRadius.circular(6),
                                            ),
                                            child: Text(h.closeTime ?? '--'),
                                          ),
                                        ),
                                      ],
                                    ),
                            ),
                            Switch(
                              value: h.isClosed,
                              onChanged: (v) {
                                setState(() {
                                  _hours[i] = _BusinessHourEntry(
                                    dayOfWeek: h.dayOfWeek,
                                    openTime: h.openTime,
                                    closeTime: h.closeTime,
                                    isClosed: v,
                                  );
                                });
                              },
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: _isHoursSaving ? null : _saveHours,
                      child: _isHoursSaving
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Text('Save Business Hours'),
                    ),
                  ),

                  const SizedBox(height: 32),
                  const Divider(),

                  // ── Images ──
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Shop Images', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                      TextButton.icon(
                        onPressed: _addImage,
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Add'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (shop.images != null && shop.images!.isNotEmpty)
                    SizedBox(
                      height: 120,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: shop.images!.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (_, i) {
                          final img = shop.images![i];
                          return Stack(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: Image.network(
                                  img.url,
                                  width: 120,
                                  height: 120,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, _, _) => Container(
                                    width: 120,
                                    height: 120,
                                    color: Colors.grey[200],
                                    child: const Icon(Icons.broken_image, color: Colors.grey),
                                  ),
                                ),
                              ),
                              Positioned(
                                top: 4, right: 4,
                                child: GestureDetector(
                                  onTap: () => _deleteImage(img.id),
                                  child: Container(
                                    padding: const EdgeInsets.all(4),
                                    decoration: const BoxDecoration(
                                      color: Colors.black54,
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.close, size: 16, color: Colors.white),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    )
                  else
                    Container(
                      height: 100,
                      decoration: BoxDecoration(
                        color: Colors.grey[100],
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Center(
                        child: Text('No images yet', style: TextStyle(color: Colors.grey[500])),
                      ),
                    ),
                  const SizedBox(height: 32),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _BusinessHourEntry {
  final String dayOfWeek;
  final String? openTime;
  final String? closeTime;
  final bool isClosed;

  _BusinessHourEntry({
    required this.dayOfWeek,
    this.openTime,
    this.closeTime,
    this.isClosed = false,
  });

  String get dayLabel {
    final map = {
      'MONDAY': 'Mon', 'TUESDAY': 'Tue', 'WEDNESDAY': 'Wed',
      'THURSDAY': 'Thu', 'FRIDAY': 'Fri', 'SATURDAY': 'Sat', 'SUNDAY': 'Sun',
    };
    return map[dayOfWeek] ?? dayOfWeek;
  }
}
