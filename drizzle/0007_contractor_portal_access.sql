PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS `contractor_invitation` (
  `id` text PRIMARY KEY NOT NULL,
  `business_id` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `contractor_id` text NOT NULL,
  `email` text NOT NULL,
  `token_digest` text NOT NULL,
  `status` text NOT NULL,
  `expires_at` integer NOT NULL,
  `send_count` integer NOT NULL DEFAULT 1,
  `last_sent_at` integer NOT NULL,
  `last_delivery` text NOT NULL,
  `accepted_at` integer,
  `accepted_user_id` text,
  `revoked_at` integer,
  `created_by_user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`contractor_id`) REFERENCES `contractor`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`accepted_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `contractor_invitation_token_digest_uq` ON `contractor_invitation` (`token_digest`);
CREATE UNIQUE INDEX IF NOT EXISTS `contractor_invitation_pending_uq` ON `contractor_invitation` (`contractor_id`) WHERE `status` = 'pending';
CREATE INDEX IF NOT EXISTS `contractor_invitation_business_idx` ON `contractor_invitation` (`business_id`, `contractor_id`);

CREATE TABLE IF NOT EXISTS `contractor_account` (
  `id` text PRIMARY KEY NOT NULL,
  `business_id` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `contractor_id` text NOT NULL,
  `user_id` text NOT NULL,
  `invitation_id` text,
  `active` integer NOT NULL DEFAULT 1,
  `revoked_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`contractor_id`) REFERENCES `contractor`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`invitation_id`) REFERENCES `contractor_invitation`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX IF NOT EXISTS `contractor_account_contractor_uq` ON `contractor_account` (`contractor_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `contractor_account_business_user_uq` ON `contractor_account` (`business_id`, `user_id`);
CREATE INDEX IF NOT EXISTS `contractor_account_user_idx` ON `contractor_account` (`user_id`);

CREATE TRIGGER IF NOT EXISTS `contractor_invitation_business_required_insert`
BEFORE INSERT ON `contractor_invitation`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_invitation_business_required_update`
BEFORE UPDATE ON `contractor_invitation`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_account_business_required_insert`
BEFORE INSERT ON `contractor_account`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_account_business_required_update`
BEFORE UPDATE ON `contractor_account`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_invitation_status_insert`
BEFORE INSERT ON `contractor_invitation`
FOR EACH ROW
WHEN NEW.`status` NOT IN ('pending', 'accepted', 'revoked')
  OR NEW.`last_delivery` NOT IN ('email', 'link_only', 'email_failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid_invitation');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_invitation_status_update`
BEFORE UPDATE ON `contractor_invitation`
FOR EACH ROW
WHEN NEW.`status` NOT IN ('pending', 'accepted', 'revoked')
  OR NEW.`last_delivery` NOT IN ('email', 'link_only', 'email_failed')
BEGIN
  SELECT RAISE(ABORT, 'invalid_invitation');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_email_revokes_pending_invite`
AFTER UPDATE ON `contractor`
FOR EACH ROW
WHEN lower(trim(OLD.`email`)) != lower(trim(NEW.`email`))
BEGIN
  UPDATE `contractor_invitation`
  SET `status` = 'revoked',
      `revoked_at` = NEW.`updated_at`,
      `updated_at` = NEW.`updated_at`
  WHERE `contractor_id` = NEW.`id`
    AND `business_id` = NEW.`business_id`
    AND `owner_user_id` = NEW.`owner_user_id`
    AND `status` = 'pending';
END;
