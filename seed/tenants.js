/**
 * Datos de ejemplo. Todo inventado: tenants, productos y credenciales son
 * ficticios y solo existen dentro del emulador.
 *
 * Los tenantId son OPACOS a propósito. En el sistema del que sale este demo
 * el id se derivaba del email del dueño (`juan_gmail_com`), así que el
 * identificador llevaba PII adentro y terminaba en URLs, en logs y en el
 * external_reference que ve la pasarela de pagos. Un id opaco no cuenta nada
 * de quién está detrás, y no hay que migrarlo cuando el dueño cambia de mail.
 */
export const TENANTS = [
  {
    tenantId: 'tnt_7f3c91a2',
    subdomain: 'norte',
    displayName: 'Almacén del Norte',
    about: 'Almacén de barrio con entrega en el día.',
    address: 'Av. Siempreviva 1234',
    openingHours: 'Lunes a sábado de 9 a 19',
    phone: '+598 99 000 001',
    currency: 'UYU',
    paymentPublicKey: 'demo-public-key-norte',
    bankName: 'Banco Demo',
    bankAccount: '0001-0001',
    bankHolder: 'Almacén del Norte SRL',
    contactEmail: 'hola@almacendelnorte.example',
    credentials: {
      paymentAccessToken: 'demo-access-token-norte-NO-ES-REAL',
      paymentWebhookSecret: 'demo-webhook-secret-norte',
      shippingApiUser: 'demo-user-norte',
      shippingApiPassword: 'demo-pass-norte',
      accountEmail: 'duenio-norte@example.test',
    },
    products: [
      { title: 'Yerba 1kg', price: 320, stock: 40 },
      { title: 'Café molido 500g', price: 480, stock: 25 },
      { title: 'Miel artesanal', price: 260, stock: 12 },
    ],
  },
  {
    tenantId: 'tnt_2b8e4d60',
    subdomain: 'sur',
    displayName: 'Bazar del Sur',
    about: 'Bazar y regalería desde 1998.',
    address: 'Calle Falsa 742',
    openingHours: 'Lunes a viernes de 10 a 18',
    phone: '+598 99 000 002',
    currency: 'UYU',
    paymentPublicKey: 'demo-public-key-sur',
    bankName: 'Banco Demo',
    bankAccount: '0002-0002',
    bankHolder: 'Bazar del Sur SA',
    contactEmail: 'contacto@bazardelsur.example',
    credentials: {
      paymentAccessToken: 'demo-access-token-sur-NO-ES-REAL',
      paymentWebhookSecret: 'demo-webhook-secret-sur',
      shippingApiUser: 'demo-user-sur',
      shippingApiPassword: 'demo-pass-sur',
      accountEmail: 'duenio-sur@example.test',
    },
    products: [
      { title: 'Juego de copas x6', price: 1290, stock: 8 },
      { title: 'Mantel de lino', price: 980, stock: 15 },
    ],
  },
  {
    tenantId: 'tnt_c04a15f7',
    subdomain: 'este',
    displayName: 'Librería del Este',
    about: 'Libros nuevos y usados.',
    address: 'Ruta 9 km 12',
    openingHours: 'Martes a domingo de 11 a 20',
    phone: '+598 99 000 003',
    currency: 'UYU',
    paymentPublicKey: 'demo-public-key-este',
    bankName: 'Banco Demo',
    bankAccount: '0003-0003',
    bankHolder: 'Librería del Este',
    contactEmail: 'info@libreriadeleste.example',
    credentials: {
      paymentAccessToken: 'demo-access-token-este-NO-ES-REAL',
      paymentWebhookSecret: 'demo-webhook-secret-este',
      shippingApiUser: 'demo-user-este',
      shippingApiPassword: 'demo-pass-este',
      accountEmail: 'duenio-este@example.test',
    },
    products: [{ title: 'Cuaderno tapa dura', price: 350, stock: 30 }],
  },
];

/** Escribe los datos de ejemplo. `db` es un Firestore (Admin o de tests). */
export async function seedInto(db, Timestamp) {
  const now = Timestamp.now();
  let products = 0;

  for (const t of TENANTS) {
    const { tenantId, credentials, products: catalogo, ...publicFields } = t;

    // Documento público: solo campos de vitrina. Ningún secreto acá.
    await db.collection('tenants').doc(tenantId).set({ ...publicFields, createdAt: now, updatedAt: now });

    // Credenciales en la subcolección privada, que las reglas niegan a TODOS
    // los clientes. Solo el backend (Admin SDK) las lee.
    await db.doc(`tenants/${tenantId}/private/credentials`).set(credentials);

    for (const [i, p] of catalogo.entries()) {
      await db
        .collection('products')
        .doc(`prd_${tenantId.slice(4)}_${i + 1}`)
        .set({ tenantId, ...p, createdAt: now });
      products++;
    }
  }

  return { tenants: TENANTS.length, products };
}
