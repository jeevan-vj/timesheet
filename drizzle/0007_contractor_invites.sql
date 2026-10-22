CREATE TABLE `contractor_invite` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `business_id` text NOT NULL REFERENCES `business`(`id`) ON DELETE RESTRICT,
  `contractor_id` text NOT NULL REFERENCES `contractor`(`id`) ON DELETE CASCADE,
  `invited_email` text NOT NULL,
  `token_digest` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `expires_at` integer NOT NULL,
  `accepted_by_user_id` text REFERENCES `user`(`id`) ON DELETE RESTRICT,
  `accepted_at` integer,
  `acceptance_nonce` text,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `contractor_invite_contractor_uq` ON `contractor_invite` (`business_id`, `contractor_id`);
CREATE UNIQUE INDEX `contractor_invite_token_digest_uq` ON `contractor_invite` (`token_digest`);
CREATE INDEX `contractor_invite_owner_idx` ON `contractor_invite` (`owner_user_id`, `business_id`);

CREATE TABLE `contractor_user` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `business_id` text NOT NULL REFERENCES `business`(`id`) ON DELETE RESTRICT,
  `contractor_id` text NOT NULL REFERENCES `contractor`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `contractor_user_contractor_uq` ON `contractor_user` (`business_id`, `contractor_id`);
CREATE UNIQUE INDEX `contractor_user_business_user_uq` ON `contractor_user` (`business_id`, `user_id`);
CREATE INDEX `contractor_user_user_idx` ON `contractor_user` (`user_id`);

CREATE TRIGGER `contractor_invite_status_insert`
BEFORE INSERT ON `contractor_invite`
FOR EACH ROW WHEN NEW.`status` NOT IN ('pending', 'accepted', 'expired', 'revoked')
BEGIN SELECT RAISE(ABORT, 'invalid_invite_status'); END;

CREATE TRIGGER `contractor_invite_status_update`
BEFORE UPDATE ON `contractor_invite`
FOR EACH ROW WHEN NEW.`status` NOT IN ('pending', 'accepted', 'expired', 'revoked')
BEGIN SELECT RAISE(ABORT, 'invalid_invite_status'); END;

CREATE TRIGGER `contractor_invite_tenancy_insert`
BEFORE INSERT ON `contractor_invite`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `contractor`
  WHERE `id` = NEW.`contractor_id`
    AND `owner_user_id` = NEW.`owner_user_id`
    AND `business_id` = NEW.`business_id`
)
BEGIN SELECT RAISE(ABORT, 'not_found'); END;
CREATE TRIGGER `contractor_invite_tenancy_update`
BEFORE UPDATE ON `contractor_invite`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `contractor`
  WHERE `id` = NEW.`contractor_id`
    AND `owner_user_id` = NEW.`owner_user_id`
    AND `business_id` = NEW.`business_id`
)
BEGIN SELECT RAISE(ABORT, 'not_found'); END;

CREATE TRIGGER `contractor_user_tenancy_insert`
BEFORE INSERT ON `contractor_user`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `contractor`
  WHERE `id` = NEW.`contractor_id`
    AND `owner_user_id` = NEW.`owner_user_id`
    AND `business_id` = NEW.`business_id`
)
BEGIN SELECT RAISE(ABORT, 'not_found'); END;

CREATE TRIGGER `contractor_user_tenancy_update`
BEFORE UPDATE ON `contractor_user`
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM `contractor`
  WHERE `id` = NEW.`contractor_id`
    AND `owner_user_id` = NEW.`owner_user_id`
    AND `business_id` = NEW.`business_id`
)
BEGIN SELECT RAISE(ABORT, 'not_found'); END;
