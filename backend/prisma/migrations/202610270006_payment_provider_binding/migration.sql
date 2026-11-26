-- Existing Square records deliberately remain NULL: current credentials cannot claim an old payment.
-- Restore and reconcile the original configuration before any manual historical repair.
ALTER TABLE `payment_records` ADD COLUMN `provider_binding` JSON NULL;
