-- Fix Announcement.body to handle long announcement content safely.
ALTER TABLE `Announcement`
  MODIFY `body` LONGTEXT NOT NULL;
