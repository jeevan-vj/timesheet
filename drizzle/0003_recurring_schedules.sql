CREATE TABLE `assignment_schedule_version` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `assignment_id` text NOT NULL,
  `weekdays_mask` integer NOT NULL,
  `paid_minutes` integer NOT NULL,
  `effective_from` text NOT NULL,
  `effective_to` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`assignment_id`) REFERENCES `assignment`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE INDEX `assignment_schedule_version_owner_idx` ON `assignment_schedule_version` (`owner_user_id`);
CREATE INDEX `assignment_schedule_version_assignment_idx` ON `assignment_schedule_version` (`owner_user_id`,`assignment_id`,`effective_from`);
ALTER TABLE `time_entry` ADD `occurrence_kind` text DEFAULT 'manual' NOT NULL;
ALTER TABLE `time_entry` ADD `schedule_version_id` text;
