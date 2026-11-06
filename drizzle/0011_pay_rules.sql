PRAGMA foreign_keys=ON;

CREATE TABLE `business_pay_rule` (
  `business_id` text PRIMARY KEY NOT NULL REFERENCES `business`(`id`) ON DELETE CASCADE,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `holiday_mode` text NOT NULL DEFAULT 'off' CHECK (`holiday_mode` IN ('off', 'multiplier')),
  `holiday_multiplier_bps` integer,
  `use_nz_public_holidays` integer NOT NULL DEFAULT 0,
  `weekend_saturday_multiplier_bps` integer,
  `weekend_sunday_multiplier_bps` integer,
  `overnight_start_minutes` integer,
  `overnight_end_minutes` integer,
  `overnight_multiplier_bps` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX `business_pay_rule_owner_idx`
ON `business_pay_rule` (`owner_user_id`);

CREATE TABLE `business_holiday` (
  `id` text PRIMARY KEY NOT NULL,
  `business_id` text NOT NULL REFERENCES `business`(`id`) ON DELETE CASCADE,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `holiday_date` text NOT NULL,
  `name` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`business_id`, `holiday_date`)
);

CREATE INDEX `business_holiday_owner_idx`
ON `business_holiday` (`owner_user_id`, `business_id`, `holiday_date`);

ALTER TABLE `time_entry` ADD COLUMN `pay_mode` text NOT NULL DEFAULT 'hourly' CHECK (`pay_mode` IN ('hourly', 'fixed'));
ALTER TABLE `time_entry` ADD COLUMN `fixed_pay_cents` integer;
ALTER TABLE `time_entry` ADD COLUMN `holiday_loading_cents` integer NOT NULL DEFAULT 0;
ALTER TABLE `time_entry` ADD COLUMN `weekend_loading_cents` integer NOT NULL DEFAULT 0;
ALTER TABLE `time_entry` ADD COLUMN `overnight_loading_cents` integer NOT NULL DEFAULT 0;

ALTER TABLE `assignment` ADD COLUMN `pay_mode` text NOT NULL DEFAULT 'hourly' CHECK (`pay_mode` IN ('hourly', 'fixed'));
ALTER TABLE `assignment` ADD COLUMN `fixed_pay_cents` integer;
