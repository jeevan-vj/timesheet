PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS `business` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `nzbn` text DEFAULT '' NOT NULL,
  `address` text DEFAULT '' NOT NULL,
  `contact_email` text NOT NULL,
  `contact_phone` text DEFAULT '' NOT NULL,
  `timezone` text DEFAULT 'Pacific/Auckland' NOT NULL,
  `currency` text DEFAULT 'NZD' NOT NULL,
  `week_start` text DEFAULT 'monday' NOT NULL,
  `onboarding_completed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `business_member` (
  `id` text PRIMARY KEY NOT NULL,
  `business_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`business_id`) REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS `business_member_business_user_uq` ON `business_member` (`business_id`,`user_id`);
CREATE INDEX IF NOT EXISTS `business_member_user_id_idx` ON `business_member` (`user_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `business_member_active_user_uq` ON `business_member` (`user_id`) WHERE `active` = 1;

ALTER TABLE `site` ADD `business_id` text REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict;
ALTER TABLE `contractor` ADD `business_id` text REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict;
ALTER TABLE `assignment` ADD `business_id` text REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict;
ALTER TABLE `assignment_schedule_version` ADD `business_id` text REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict;
ALTER TABLE `time_entry` ADD `business_id` text REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict;
ALTER TABLE `week_approval` ADD `business_id` text REFERENCES `business`(`id`) ON UPDATE no action ON DELETE restrict;

CREATE INDEX IF NOT EXISTS `site_business_id_idx` ON `site` (`business_id`);
CREATE INDEX IF NOT EXISTS `contractor_business_id_idx` ON `contractor` (`business_id`);
CREATE INDEX IF NOT EXISTS `assignment_business_id_idx` ON `assignment` (`business_id`);
CREATE INDEX IF NOT EXISTS `assignment_schedule_version_business_id_idx` ON `assignment_schedule_version` (`business_id`);
CREATE INDEX IF NOT EXISTS `time_entry_business_id_idx` ON `time_entry` (`business_id`);
CREATE INDEX IF NOT EXISTS `week_approval_business_id_idx` ON `week_approval` (`business_id`);

INSERT INTO `business` (
  `id`, `name`, `nzbn`, `address`, `contact_email`, `contact_phone`,
  `timezone`, `currency`, `week_start`, `onboarding_completed_at`, `created_at`, `updated_at`
)
SELECT
  'biz_' || `user`.`id`,
  `user`.`name`,
  '',
  '',
  `user`.`email`,
  '',
  'Pacific/Auckland',
  'NZD',
  'monday',
  `user`.`created_at`,
  `user`.`created_at`,
  `user`.`created_at`
FROM `user`
WHERE NOT EXISTS (
  SELECT 1 FROM `business` WHERE `business`.`id` = 'biz_' || `user`.`id`
);

INSERT INTO `business_member` (
  `id`, `business_id`, `user_id`, `role`, `active`, `created_at`, `updated_at`
)
SELECT
  'mem_' || `user`.`id`,
  'biz_' || `user`.`id`,
  `user`.`id`,
  'owner',
  1,
  `user`.`created_at`,
  `user`.`created_at`
FROM `user`
WHERE NOT EXISTS (
  SELECT 1 FROM `business_member` WHERE `business_member`.`id` = 'mem_' || `user`.`id`
);

UPDATE `site`
SET `business_id` = (
  SELECT `business_member`.`business_id`
  FROM `business_member`
  WHERE `business_member`.`user_id` = `site`.`owner_user_id`
    AND `business_member`.`active` = 1
    AND `business_member`.`role` = 'owner'
)
WHERE `business_id` IS NULL;

UPDATE `contractor`
SET `business_id` = (
  SELECT `business_member`.`business_id`
  FROM `business_member`
  WHERE `business_member`.`user_id` = `contractor`.`owner_user_id`
    AND `business_member`.`active` = 1
    AND `business_member`.`role` = 'owner'
)
WHERE `business_id` IS NULL;

UPDATE `assignment`
SET `business_id` = (
  SELECT `business_member`.`business_id`
  FROM `business_member`
  WHERE `business_member`.`user_id` = `assignment`.`owner_user_id`
    AND `business_member`.`active` = 1
    AND `business_member`.`role` = 'owner'
)
WHERE `business_id` IS NULL;

UPDATE `assignment_schedule_version`
SET `business_id` = (
  SELECT `business_member`.`business_id`
  FROM `business_member`
  WHERE `business_member`.`user_id` = `assignment_schedule_version`.`owner_user_id`
    AND `business_member`.`active` = 1
    AND `business_member`.`role` = 'owner'
)
WHERE `business_id` IS NULL;

UPDATE `time_entry`
SET `business_id` = (
  SELECT `business_member`.`business_id`
  FROM `business_member`
  WHERE `business_member`.`user_id` = `time_entry`.`owner_user_id`
    AND `business_member`.`active` = 1
    AND `business_member`.`role` = 'owner'
)
WHERE `business_id` IS NULL;

UPDATE `week_approval`
SET `business_id` = (
  SELECT `business_member`.`business_id`
  FROM `business_member`
  WHERE `business_member`.`user_id` = `week_approval`.`owner_user_id`
    AND `business_member`.`active` = 1
    AND `business_member`.`role` = 'owner'
)
WHERE `business_id` IS NULL;

CREATE TABLE IF NOT EXISTS `business_backfill_guard` (
  `id` integer PRIMARY KEY NOT NULL CHECK (`id` = 1),
  `unmapped` integer NOT NULL CHECK (`unmapped` = 0)
);

INSERT INTO `business_backfill_guard` (`id`, `unmapped`)
SELECT 1, (
  (SELECT COUNT(*) FROM `user` WHERE trim(`name`) = '' OR trim(`email`) = '')
  + (SELECT COUNT(*) FROM `user` AS `u` WHERE (
      SELECT COUNT(*) FROM `business_member` AS `m` WHERE `m`.`user_id` = `u`.`id` AND `m`.`active` = 1
    ) <> 1)
  + (SELECT COUNT(*) FROM `assignment` AS `a`
      WHERE `a`.`owner_user_id` <> (SELECT `s`.`owner_user_id` FROM `site` AS `s` WHERE `s`.`id` = `a`.`site_id`)
         OR `a`.`owner_user_id` <> (SELECT `c`.`owner_user_id` FROM `contractor` AS `c` WHERE `c`.`id` = `a`.`contractor_id`))
  + (SELECT COUNT(*) FROM `assignment_schedule_version` AS `v`
      WHERE `v`.`owner_user_id` <> (SELECT `a`.`owner_user_id` FROM `assignment` AS `a` WHERE `a`.`id` = `v`.`assignment_id`))
  + (SELECT COUNT(*) FROM `time_entry` AS `t`
      WHERE `t`.`owner_user_id` <> (SELECT `s`.`owner_user_id` FROM `site` AS `s` WHERE `s`.`id` = `t`.`site_id`)
         OR `t`.`owner_user_id` <> (SELECT `c`.`owner_user_id` FROM `contractor` AS `c` WHERE `c`.`id` = `t`.`contractor_id`))
  + (SELECT COUNT(*) FROM `site` WHERE `business_id` IS NULL)
  + (SELECT COUNT(*) FROM `contractor` WHERE `business_id` IS NULL)
  + (SELECT COUNT(*) FROM `assignment` WHERE `business_id` IS NULL)
  + (SELECT COUNT(*) FROM `assignment_schedule_version` WHERE `business_id` IS NULL)
  + (SELECT COUNT(*) FROM `time_entry` WHERE `business_id` IS NULL)
  + (SELECT COUNT(*) FROM `week_approval` WHERE `business_id` IS NULL)
)
WHERE NOT EXISTS (
  SELECT 1 FROM `business_backfill_guard` WHERE `id` = 1
);

CREATE TRIGGER IF NOT EXISTS `site_business_required_insert`
BEFORE INSERT ON `site`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `site_business_required_update`
BEFORE UPDATE ON `site`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_business_required_insert`
BEFORE INSERT ON `contractor`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `contractor_business_required_update`
BEFORE UPDATE ON `contractor`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `assignment_business_required_insert`
BEFORE INSERT ON `assignment`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `assignment_business_required_update`
BEFORE UPDATE ON `assignment`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `assignment_schedule_version_business_required_insert`
BEFORE INSERT ON `assignment_schedule_version`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `assignment_schedule_version_business_required_update`
BEFORE UPDATE ON `assignment_schedule_version`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `time_entry_business_required_insert`
BEFORE INSERT ON `time_entry`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `time_entry_business_required_update`
BEFORE UPDATE ON `time_entry`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `week_approval_business_required_insert`
BEFORE INSERT ON `week_approval`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;

CREATE TRIGGER IF NOT EXISTS `week_approval_business_required_update`
BEFORE UPDATE ON `week_approval`
FOR EACH ROW
WHEN NEW.`business_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'business_required');
END;
