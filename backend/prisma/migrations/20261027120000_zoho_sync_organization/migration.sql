-- Registro de organización para nuevos intentos; no se infiere para intentos antiguos.
ALTER TABLE `payments` ADD COLUMN `zohoSyncOrganizationId` VARCHAR(100) NULL;
