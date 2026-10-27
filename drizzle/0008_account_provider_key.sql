PRAGMA foreign_keys=OFF;

DROP INDEX `account_issuer_account_id_uq`;

CREATE TABLE `account_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `issuer` text DEFAULT 'local:credential',
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `access_token` text,
  `refresh_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `id_token` text,
  `password` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

INSERT INTO `account_new` (
  `id`, `user_id`, `issuer`, `account_id`, `provider_id`, `access_token`, `refresh_token`,
  `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `id_token`, `password`,
  `created_at`, `updated_at`
)
SELECT
  `id`, `user_id`, `issuer`, `account_id`, `provider_id`, `access_token`, `refresh_token`,
  `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `id_token`, `password`,
  `created_at`, `updated_at`
FROM `account`;

DROP TABLE `account`;
ALTER TABLE `account_new` RENAME TO `account`;

CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);
CREATE UNIQUE INDEX `account_provider_id_account_id_uq` ON `account` (`provider_id`, `account_id`);

PRAGMA foreign_keys=ON;
