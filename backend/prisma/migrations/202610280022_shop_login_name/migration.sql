-- Independent shop login names do not require per-shop contact details.
-- Existing accounts remain unchanged and may continue their existing login.
ALTER TABLE `users`
  ADD COLUMN `login_name` VARCHAR(64) NULL,
  ADD UNIQUE INDEX `users_login_name_key` (`login_name`);
