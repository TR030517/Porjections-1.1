-- Keep every historical personal schedule, including deliberately disabled shifts.
ALTER TABLE `therapists` ADD COLUMN `schedule_mode` VARCHAR(20) NOT NULL DEFAULT 'SHOP';
UPDATE `therapists` t SET t.`schedule_mode` = 'CUSTOM'
WHERE EXISTS (SELECT 1 FROM `therapist_shifts` s WHERE s.`therapist_id` = t.`id`);

-- Defaults apply to new configurations only. Never reinterpret existing prices.
ALTER TABLE `shop_services` ALTER COLUMN `price_basis` SET DEFAULT 'PER_BOOKING';
ALTER TABLE `shop_service_variants` ALTER COLUMN `price_basis` SET DEFAULT 'PER_BOOKING';

ALTER TABLE `bookings`
  ADD COLUMN `participant_count_snapshot` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `required_staff_count_snapshot` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `booking_items` ADD COLUMN `required_staff_count_snapshot` INTEGER NOT NULL DEFAULT 1;
-- Historical supported items assigned one employee per participant. Infer from
-- saved items, never from today's mutable service policy or price basis.
UPDATE `bookings` b JOIN (
  SELECT `booking_id`, COUNT(DISTINCT `participant_index`) AS `participants`
  FROM `booking_items` GROUP BY `booking_id`
) i ON i.`booking_id` = b.`id`
SET b.`participant_count_snapshot` = i.`participants`,
    b.`required_staff_count_snapshot` = i.`participants`;
