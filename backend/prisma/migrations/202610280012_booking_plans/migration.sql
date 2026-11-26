ALTER TABLE `shop_services` ADD COLUMN `price_basis` VARCHAR(20) NOT NULL DEFAULT 'PER_PERSON';
ALTER TABLE `shop_service_variants` ADD COLUMN `price_basis` VARCHAR(20) NOT NULL DEFAULT 'PER_PERSON';
ALTER TABLE `bookings`
  ADD COLUMN `tip_cents` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `reservation_kind` VARCHAR(20) NOT NULL DEFAULT 'SINGLE';
ALTER TABLE `booking_items`
  ADD COLUMN `sequence` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `offset_min` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `price_basis_snapshot` VARCHAR(20) NOT NULL DEFAULT 'PER_PERSON',
  ADD COLUMN `quoted_unit_price_cents` INTEGER NULL,
  ADD COLUMN `assigned_therapist_id` BIGINT NULL;
-- Persist the known active assignment before lifecycle expiry removes it from projections.
-- Historical released/missing assignments remain unknown; never guess from another item.
UPDATE `booking_items` AS i
JOIN `bookings` AS b ON b.`id`=i.`booking_id`
JOIN (SELECT `booking_item_id`, MIN(`resource_id`) AS `therapist_id`
      FROM `booking_resource_locks` WHERE `resource_type`='THERAPIST' AND `status`='ACTIVE'
      AND `booking_item_id` IS NOT NULL GROUP BY `booking_item_id` HAVING COUNT(DISTINCT `resource_id`)=1) AS l
  ON l.`booking_item_id`=i.`id`
JOIN `therapists` AS t ON t.`id`=l.`therapist_id` AND t.`shop_id`=b.`shop_id`
SET i.`assigned_therapist_id`=l.`therapist_id`;
ALTER TABLE `booking_items`
  ADD UNIQUE INDEX `booking_items_participant_sequence_key` (`booking_id`,`participant_index`,`sequence`),
  DROP INDEX `booking_items_participant_key`,
  ADD INDEX `booking_items_assigned_therapist_idx` (`assigned_therapist_id`),
  ADD CONSTRAINT `booking_items_assigned_therapist_id_fkey` FOREIGN KEY (`assigned_therapist_id`) REFERENCES `therapists` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
