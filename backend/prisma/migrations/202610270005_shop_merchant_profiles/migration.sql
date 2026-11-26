-- Fail before changing schema or money when old ownership or financial history is inconsistent.
-- MySQL 8 enforces this temporary CHECK; the table is connection-local and disappears on failure.
CREATE TEMPORARY TABLE `_mj2_profile_guard` (`valid` INT NOT NULL CHECK (`valid` = 1));
INSERT INTO `_mj2_profile_guard` (`valid`)
SELECT IF(EXISTS (
  SELECT 1 FROM `merchant_profiles` p
  LEFT JOIN `shops` s ON s.`id` = p.`shop_id`
  LEFT JOIN `users` u ON u.`id` = p.`user_id`
  WHERE s.`id` IS NULL OR u.`id` IS NULL OR p.`user_id` <> s.`owner_id` OR u.`role` <> 'MERCHANT'
) OR EXISTS (
  SELECT 1 FROM `merchant_transactions` t
  LEFT JOIN `merchant_profiles` p ON p.`id` = t.`profile_id`
  LEFT JOIN `bookings` b ON b.`id` = t.`booking_id`
  WHERE p.`id` IS NULL OR (t.`booking_id` IS NOT NULL AND (b.`id` IS NULL OR b.`shop_id` <> p.`shop_id`))
) OR EXISTS (
  SELECT 1 FROM `shops` s LEFT JOIN `merchant_profiles` p ON p.`shop_id` = s.`id`
  LEFT JOIN `users` u ON u.`id` = s.`owner_id`
  WHERE p.`id` IS NULL AND (u.`id` IS NULL OR u.`role` <> 'MERCHANT' OR EXISTS (
    SELECT 1 FROM `bookings` b WHERE b.`shop_id` = s.`id`
    AND (b.`paid_cents` <> 0 OR b.`refunded_cents` <> 0 OR b.`payment_status` <> 'UNPAID'
      OR b.`payment_id` IS NOT NULL
      OR EXISTS (SELECT 1 FROM `payment_records` r WHERE r.`booking_id` = b.`id`)
      OR EXISTS (SELECT 1 FROM `refund_requests` r WHERE r.`booking_id` = b.`id`))
  ) OR EXISTS (SELECT 1 FROM `gift_card_orders` g WHERE g.`shop_id` = s.`id`)
    OR EXISTS (SELECT 1 FROM `gift_card_entitlements` g WHERE g.`shop_id` = s.`id`))
), 0, 1);
DROP TEMPORARY TABLE `_mj2_profile_guard`;

-- Retain all existing profile IDs, owners, provider settings, balances and transaction references.
ALTER TABLE `merchant_profiles`
  ADD INDEX `merchant_profiles_user_id_idx` (`user_id`),
  DROP INDEX `merchant_profiles_user_id_key`,
  ADD CONSTRAINT `merchant_profiles_shop_id_fkey`
  FOREIGN KEY (`shop_id`) REFERENCES `shops` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill only new, internal zero-balance rows, with their own auditable target IDs.
-- External provider account activation is deliberately absent.
START TRANSACTION;
CREATE TEMPORARY TABLE `_mj2_profile_backfill` (`shop_id` BIGINT PRIMARY KEY, `user_id` BIGINT NOT NULL);
INSERT INTO `_mj2_profile_backfill` SELECT s.`id`, s.`owner_id` FROM `shops` s
  LEFT JOIN `merchant_profiles` p ON p.`shop_id` = s.`id` WHERE p.`id` IS NULL;
INSERT INTO `merchant_profiles` (`user_id`, `shop_id`, `balance_cents`, `pending_cents`, `total_earned_cents`, `updated_at`)
  SELECT `user_id`, `shop_id`, 0, 0, 0, CURRENT_TIMESTAMP(3) FROM `_mj2_profile_backfill`;
INSERT INTO `audit_logs` (`action`, `target_type`, `target_id`, `operator_id`, `detail`)
  SELECT 'PROFILE_BACKFILL', 'merchant_profiles', p.`id`, b.`user_id`,
    JSON_OBJECT('migration', '202610270005_shop_merchant_profiles', 'shopId', CAST(b.`shop_id` AS CHAR), 'internalZeroBalance', TRUE, 'externalPaymentsEnabled', FALSE)
  FROM `_mj2_profile_backfill` b JOIN `merchant_profiles` p ON p.`shop_id` = b.`shop_id`;
DROP TEMPORARY TABLE `_mj2_profile_backfill`;
COMMIT;
