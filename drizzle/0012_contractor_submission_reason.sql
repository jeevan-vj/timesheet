PRAGMA foreign_keys=ON;

ALTER TABLE `time_entry` ADD COLUMN `submission_reason` text NOT NULL DEFAULT '';
