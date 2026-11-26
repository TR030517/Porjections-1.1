-- Assignments cannot establish whether an existing customer requested a therapist.
ALTER TABLE `bookings`
  ADD COLUMN `therapist_selection_mode` VARCHAR(20) NOT NULL DEFAULT 'LEGACY_UNKNOWN',
  ADD COLUMN `requested_therapist_ids` JSON NULL;

ALTER TABLE `booking_items`
  ADD COLUMN `therapist_selection_mode` VARCHAR(20) NOT NULL DEFAULT 'LEGACY_UNKNOWN',
  ADD COLUMN `requested_therapist_ids` JSON NULL;
