// Add Interstellar URLs to database
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addInterstellarSettings() {
  const settings = [
    { key: 'INTERSTELLAR_GET_URL_PROD', value: 'https://n8n.srv955268.hstgr.cloud/webhook/1611dc49-d04f-418f-9252-d8af42370ade' },
    { key: 'INTERSTELLAR_GET_URL_TEST', value: 'https://n8n.srv955268.hstgr.cloud/webhook-test/1611dc49-d04f-418f-9252-d8af42370ade' },
    { key: 'INTERSTELLAR_POST_URL_PROD', value: 'https://n8n.srv955268.hstgr.cloud/webhook/59b49ae8-76dc-4ba2-848d-16d728fe136d' },
    { key: 'INTERSTELLAR_POST_URL_TEST', value: 'https://n8n.srv955268.hstgr.cloud/webhook-test/59b49ae8-76dc-4ba2-848d-16d728fe136d' },
    { key: 'INTERSTELLAR_BACKUP_URL_PROD', value: '' },
    { key: 'INTERSTELLAR_BACKUP_URL_TEST', value: '' },
    { key: 'INTERSTELLAR_RESTORE_URL_PROD', value: '' },
    { key: 'INTERSTELLAR_RESTORE_URL_TEST', value: '' },
  ];

  console.log('Adding Interstellar settings...');
  
  for (const setting of settings) {
    try {
      await prisma.setting.upsert({
        where: { key: setting.key },
        update: { value: setting.value },
        create: setting
      });
      console.log(`✓ Added ${setting.key}: ${setting.value || '(empty)'}`);
    } catch (error) {
      console.error(`✗ Failed to add ${setting.key}:`, error);
    }
  }

  await prisma.$disconnect();
  console.log('Done!');
}

addInterstellarSettings().catch(console.error);
