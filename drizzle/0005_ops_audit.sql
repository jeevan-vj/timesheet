CREATE TABLE IF NOT EXISTS `ops_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `action` text NOT NULL,
  `sql_text` text,
  `params_json` text,
  `old_json` text,
  `new_json` text,
  `reason` text NOT NULL,
  `row_count` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `ops_audit_created_at_idx` ON `ops_audit` (`created_at`);

CREATE TRIGGER IF NOT EXISTS `ops_audit_no_update`
BEFORE UPDATE ON `ops_audit`
BEGIN
  SELECT RAISE(ABORT, 'ops_audit_append_only');
END;

CREATE TRIGGER IF NOT EXISTS `ops_audit_no_delete`
BEFORE DELETE ON `ops_audit`
BEGIN
  SELECT RAISE(ABORT, 'ops_audit_append_only');
END;
