CREATE TABLE `week_approval` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `week_start` text NOT NULL,
  `status` text NOT NULL,
  `approved_at` integer NOT NULL,
  `reopened_at` integer,
  FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `week_approval_owner_week_uq` ON `week_approval` (`owner_user_id`,`week_start`);
