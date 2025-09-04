-- Add interstellar webhook URLs
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_GET_URL_PROD', 'https://n8n.srv955268.hstgr.cloud/webhook/1611dc49-d04f-418f-9252-d8af42370ade');
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_GET_URL_TEST', 'https://n8n.srv955268.hstgr.cloud/webhook-test/1611dc49-d04f-418f-9252-d8af42370ade');
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_POST_URL_PROD', 'https://n8n.srv955268.hstgr.cloud/webhook/59b49ae8-76dc-4ba2-848d-16d728fe136d');
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_POST_URL_TEST', 'https://n8n.srv955268.hstgr.cloud/webhook-test/59b49ae8-76dc-4ba2-848d-16d728fe136d');

-- Add backup/restore webhook URLs
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_BACKUP_URL_PROD', '');
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_BACKUP_URL_TEST', '');
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_RESTORE_URL_PROD', '');
INSERT INTO Setting (key, value) VALUES ('INTERSTELLAR_RESTORE_URL_TEST', '');
