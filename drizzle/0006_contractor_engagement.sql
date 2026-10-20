ALTER TABLE `contractor` ADD COLUMN `preferred_name` text NOT NULL DEFAULT '';
ALTER TABLE `contractor` ADD COLUMN `start_date` text;
ALTER TABLE `contractor` ADD COLUMN `engagement_status` text NOT NULL DEFAULT 'active';
ALTER TABLE `contractor` ADD COLUMN `gst_registered` integer NOT NULL DEFAULT 0;
ALTER TABLE `contractor` ADD COLUMN `gst_number` text NOT NULL DEFAULT '';
ALTER TABLE `contractor` ADD COLUMN `internal_notes` text NOT NULL DEFAULT '';
ALTER TABLE `contractor` ADD COLUMN `emergency_contact_name` text NOT NULL DEFAULT '';
ALTER TABLE `contractor` ADD COLUMN `emergency_contact_phone` text NOT NULL DEFAULT '';

UPDATE `contractor`
SET `engagement_status` = 'archived'
WHERE `active` = 0 AND `engagement_status` = 'active';

CREATE TRIGGER IF NOT EXISTS `contractor_engagement_insert`
BEFORE INSERT ON `contractor`
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.`engagement_status` NOT IN ('draft', 'invited', 'active', 'suspended', 'archived')
      THEN RAISE(ABORT, 'invalid_engagement_status')
    WHEN (NEW.`engagement_status` IN ('invited', 'active')) != CASE WHEN NEW.`active` != 0 THEN 1 ELSE 0 END
      THEN RAISE(ABORT, 'engagement_active_mismatch')
  END;
END;

CREATE TRIGGER IF NOT EXISTS `contractor_engagement_update`
BEFORE UPDATE ON `contractor`
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.`engagement_status` NOT IN ('draft', 'invited', 'active', 'suspended', 'archived')
      THEN RAISE(ABORT, 'invalid_engagement_status')
    WHEN (NEW.`engagement_status` IN ('invited', 'active')) != CASE WHEN NEW.`active` != 0 THEN 1 ELSE 0 END
      THEN RAISE(ABORT, 'engagement_active_mismatch')
  END;
END;
