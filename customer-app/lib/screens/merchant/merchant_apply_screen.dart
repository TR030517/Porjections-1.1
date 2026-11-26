import 'package:flutter/material.dart';
import '../../theme/customer_theme.dart';

/// Company-managed onboarding; customer accounts cannot promote themselves.
class MerchantApplyScreen extends StatelessWidget {
  const MerchantApplyScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(customerText(context, 'Merchant access', '商家开通')),
    ),
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.business_outlined,
                size: 40,
                color: CustomerPalette.action,
              ),
              const SizedBox(height: 20),
              Text(
                customerText(
                  context,
                  'Contact the company to enable merchant access',
                  '请联系公司开通商家账户',
                ),
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                customerText(
                  context,
                  'Merchant accounts and store associations are configured by the company. Customer sign-in does not grant store management permissions. Existing merchant accounts use the separate /merchant/ portal.',
                  '商家账户和门店关联由公司配置。顾客登录不会获得门店管理权限；已有商家账户请使用独立的 /merchant/ 入口。',
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
