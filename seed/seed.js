import admin from 'firebase-admin';
import { TENANTS, seedInto } from './tenants.js';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
process.env.GCLOUD_PROJECT ||= 'demo-vendelo';

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });

const db = admin.firestore();

const result = await seedInto(db, admin.firestore.Timestamp);

for (const t of TENANTS) {
  console.log(`  ${t.subdomain.padEnd(6)} ${t.tenantId}  ${t.products.length} productos`);
}
console.log(`\nListo: ${result.tenants} tiendas, ${result.products} productos.`);
console.log('Probá: http://norte.localhost:5173 · http://sur.localhost:5173 · http://este.localhost:5173');
process.exit(0);
