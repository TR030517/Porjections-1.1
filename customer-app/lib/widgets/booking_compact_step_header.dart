import 'package:flutter/material.dart';
import '../theme/customer_theme.dart';

/// Keeps the current choice in view on a phone, with step help on demand.
class BookingCompactStepHeader extends StatefulWidget {
  final int currentStep, totalSteps;
  final String title, description;

  const BookingCompactStepHeader({
    super.key,
    required this.currentStep,
    required this.totalSteps,
    required this.title,
    required this.description,
  });

  @override
  State<BookingCompactStepHeader> createState() => _BookingCompactStepHeaderState();
}

class _BookingCompactStepHeaderState extends State<BookingCompactStepHeader> {
  bool _showHelp = false;

  @override
  void didUpdateWidget(covariant BookingCompactStepHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.currentStep != widget.currentStep) _showHelp = false;
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Semantics(
            label: 'Step ${widget.currentStep + 1} of ${widget.totalSteps}',
            excludeSemantics: true,
            child: Text('${widget.currentStep + 1}/${widget.totalSteps}',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: CustomerPalette.action)),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(widget.title,
            key: const ValueKey('booking-current-step-title'),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: CustomerPalette.ink))),
          IconButton(
            tooltip: _showHelp ? 'Hide step help' : 'Show step help',
            isSelected: _showHelp,
            onPressed: () => setState(() => _showHelp = !_showHelp),
            icon: const Icon(Icons.info_outline, size: 20, color: CustomerPalette.muted),
          ),
        ]),
        if (_showHelp) Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 8),
          child: Text(widget.description,
            style: const TextStyle(fontSize: 13, height: 1.5, color: CustomerPalette.muted)),
        ),
      ],
    ),
  );
}
