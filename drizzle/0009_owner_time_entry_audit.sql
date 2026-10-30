PRAGMA foreign_keys=ON;

CREATE TABLE `owner_time_entry_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `business_id` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `entry_id` text NOT NULL,
  `action` text NOT NULL CHECK (`action` IN ('confirm_worked', 'absent', 'worked_as_scheduled', 'hours_override')),
  `old_json` text NOT NULL,
  `new_json` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX `owner_time_entry_audit_scope_idx`
ON `owner_time_entry_audit` (`owner_user_id`, `business_id`, `entry_id`, `created_at`);

CREATE TRIGGER `owner_time_entry_audit_no_update`
BEFORE UPDATE ON `owner_time_entry_audit`
BEGIN
  SELECT RAISE(ABORT, 'owner_time_entry_audit_append_only');
END;

CREATE TRIGGER `owner_time_entry_audit_no_delete`
BEFORE DELETE ON `owner_time_entry_audit`
BEGIN
  SELECT RAISE(ABORT, 'owner_time_entry_audit_append_only');
END;
