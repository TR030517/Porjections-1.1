-- Preserve the original provisioning status and its history while allowing
-- the distinct credential-save receipt emitted by saveCredentials. Replacing
-- the CHECK in one ALTER keeps every committed schema version constrained.
ALTER TABLE `account_provision_operations`
  DROP CHECK `account_provision_status_check`,
  ADD CONSTRAINT `account_provision_status_check`
    CHECK (`status` IN ('APPLIED', 'CREDENTIALS_APPLIED'));
