import { createIntegrationAdminSecret } from '../apps/api/stellar/server/integrationAdminService.js';

const generated = createIntegrationAdminSecret();
console.log('Integration administrator secret (shown once):');
console.log(generated.adminSecret);
console.log('\nSet this deployment environment variable:');
console.log(`MULTISIG_INTEGRATION_ADMIN_SECRET_HASH=${generated.secretHash}`);
