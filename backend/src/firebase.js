import admin from 'firebase-admin';

// El demo corre siempre contra el emulador: no hay service account ni
// credenciales reales en ningún lado. Si FIRESTORE_EMULATOR_HOST está seteado,
// el SDK de Admin lo detecta solo y no valida credenciales.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'FIRESTORE_EMULATOR_HOST no está seteado. Este demo no se conecta a un ' +
      'proyecto real de Firebase a propósito. Usá `docker compose up`.'
  );
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-vendelo' });
}

export const db = admin.firestore();
export { admin };
