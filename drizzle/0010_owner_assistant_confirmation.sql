PRAGMA foreign_keys=ON;

CREATE TABLE `owner_assistant_confirmation` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `business_id` text NOT NULL REFERENCES `business`(`id`) ON DELETE RESTRICT,
  `action` text NOT NULL CHECK (`action` IN ('create_contractor', 'create_site', 'assign_site')),
  `created_at` integer NOT NULL
);

CREATE INDEX `owner_assistant_confirmation_scope_idx`
ON `owner_assistant_confirmation` (`owner_user_id`, `business_id`, `created_at`);

CREATE TRIGGER `owner_assistant_confirmation_no_update`
BEFORE UPDATE ON `owner_assistant_confirmation`
BEGIN
  SELECT RAISE(ABORT, 'owner_assistant_confirmation_append_only');
END;

CREATE TRIGGER `owner_assistant_confirmation_no_delete`
BEFORE DELETE ON `owner_assistant_confirmation`
BEGIN
  SELECT RAISE(ABORT, 'owner_assistant_confirmation_append_only');
END;
