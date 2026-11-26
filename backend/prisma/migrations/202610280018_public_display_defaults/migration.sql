-- Only canonical display settings; do not invent contacts or overwrite existing operator input.
INSERT INTO platform_configs (`key`,`value`,`type`,`description`,`isPublic`,`created_at`,`updated_at`)
VALUES ('site_name','Massajoy','STRING','Site display name',true,NOW(3),NOW(3)),
('support_email','','STRING','Public customer support email',true,NOW(3),NOW(3)),
('support_phone','','STRING','Public customer support phone',true,NOW(3),NOW(3))
ON DUPLICATE KEY UPDATE `key`=`key`;
