PRAGMA foreign_keys=ON;

DROP INDEX `account_issuer_account_id_uq`;
ALTER TABLE `account` DROP COLUMN `issuer`;
CREATE UNIQUE INDEX `account_provider_id_account_id_uq` ON `account` (`provider_id`, `account_id`);
