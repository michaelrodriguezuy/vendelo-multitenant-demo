import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
} from 'firebase/firestore';

/**
 * Tests de AISLAMIENTO contra las reglas reales, corriendo en el emulador.
 *
 * Esto no testea la lógica de la app: testea la capa de enforcement. Si las
 * reglas se aflojan, estos tests se ponen rojos aunque el backend siga igual
 * de correcto. Es la única forma de que "las tiendas están aisladas" sea una
 * afirmación verificable y no una intención.
 */

const A = 'tnt_aaaa1111';
const B = 'tnt_bbbb2222';

let testEnv;

/** Cliente autenticado como miembro/admin de un tenant, vía custom claims. */
const asAdminOf = (t) => testEnv.authenticatedContext(`u_${t}`, { tenantId: t, role: 'admin' }).firestore();
const asUserOf = (t) => testEnv.authenticatedContext(`m_${t}`, { tenantId: t, role: 'staff' }).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-vendelo',
    firestore: {
      rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8085,
    },
  });
});

afterAll(async () => { if (testEnv) await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    for (const [t, sub] of [[A, 'alfa'], [B, 'beta']]) {
      await setDoc(doc(db, 'tenants', t), {
        subdomain: sub,
        displayName: `Tienda ${sub}`,
        currency: 'UYU',
        paymentPublicKey: `pk-${sub}`,
      });
      await setDoc(doc(db, 'tenants', t, 'private', 'credentials'), {
        paymentAccessToken: `secreto-${sub}`,
        paymentWebhookSecret: `wh-${sub}`,
      });
      await setDoc(doc(db, 'products', `prd_${sub}`), {
        tenantId: t, title: `Producto de ${sub}`, price: 100, stock: 10,
      });
      await setDoc(doc(db, 'orders', `ord_${sub}`), {
        tenantId: t, amount: 100, status: 'pending',
      });
    }
  });
});

describe('config pública del tenant', () => {
  it('cualquiera puede leerla: la tienda funciona sin login', async () => {
    await assertSucceeds(getDoc(doc(asAnon(), 'tenants', A)));
  });

  it('se puede resolver por subdominio sin autenticar', async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(asAnon(), 'tenants'), where('subdomain', '==', 'alfa')))
    );
    expect(snap.size).toBe(1);
    expect(snap.docs[0].id).toBe(A);
  });
});

describe('credenciales', () => {
  it('un anónimo no las lee', async () => {
    await assertFails(getDoc(doc(asAnon(), 'tenants', A, 'private', 'credentials')));
  });

  it('el propio admin del tenant tampoco: son solo del backend', async () => {
    await assertFails(getDoc(doc(asAdminOf(A), 'tenants', A, 'private', 'credentials')));
  });

  it('el admin de otro tenant menos todavía', async () => {
    await assertFails(getDoc(doc(asAdminOf(B), 'tenants', A, 'private', 'credentials')));
  });

  it('nadie las escribe desde un cliente', async () => {
    await assertFails(
      setDoc(doc(asAdminOf(A), 'tenants', A, 'private', 'credentials'), { paymentAccessToken: 'x' })
    );
  });
});

describe('allowlist del documento público', () => {
  it('el admin puede editar campos de vitrina de SU tienda', async () => {
    await assertSucceeds(
      updateDoc(doc(asAdminOf(A), 'tenants', A), { displayName: 'Nuevo nombre' })
    );
  });

  it('NO puede meter un secreto en el documento público', async () => {
    // Este es el bug que originó el rediseño: el doc es de lectura pública,
    // así que un campo sensible acá queda expuesto a internet entera.
    await assertFails(
      updateDoc(doc(asAdminOf(A), 'tenants', A), { paymentAccessToken: 'se-filtraria' })
    );
  });

  it('NO puede agregar un campo arbitrario no previsto', async () => {
    await assertFails(updateDoc(doc(asAdminOf(A), 'tenants', A), { campoNuevo: 'x' }));
  });

  it('NO puede cambiar el subdominio', async () => {
    await assertFails(updateDoc(doc(asAdminOf(A), 'tenants', A), { subdomain: 'beta' }));
  });

  it('NO puede editar la tienda de otro', async () => {
    await assertFails(updateDoc(doc(asAdminOf(B), 'tenants', A), { displayName: 'secuestrada' }));
  });

  it('un miembro sin rol admin no edita nada', async () => {
    await assertFails(updateDoc(doc(asUserOf(A), 'tenants', A), { displayName: 'x' }));
  });

  it('nadie crea ni borra tenants desde un cliente', async () => {
    await assertFails(setDoc(doc(asAdminOf(A), 'tenants', 'tnt_nuevo'), { subdomain: 'x' }));
    await assertFails(deleteDoc(doc(asAdminOf(A), 'tenants', A)));
  });
});

describe('productos', () => {
  it('el catálogo es público: es una tienda', async () => {
    await assertSucceeds(getDoc(doc(asAnon(), 'products', 'prd_alfa')));
  });

  it('el admin edita su propio catálogo', async () => {
    await assertSucceeds(updateDoc(doc(asAdminOf(A), 'products', 'prd_alfa'), { price: 150 }));
  });

  it('el admin de B NO edita el catálogo de A', async () => {
    // En el sistema original la regla era
    //   isTenantOwner(...) || isAdminWithActiveSubscription()
    // y la segunda cláusula solo miraba el rol, no el tenant: cualquier admin
    // podía escribir el catálogo de cualquier tienda.
    await assertFails(updateDoc(doc(asAdminOf(B), 'products', 'prd_alfa'), { price: 1 }));
  });

  it('el admin de B NO borra productos de A', async () => {
    await assertFails(deleteDoc(doc(asAdminOf(B), 'products', 'prd_alfa')));
  });

  it('un anónimo NO toca el stock', async () => {
    // El original permitía update sin autenticar mientras solo cambiara
    // `stock`, sin validar tenant ni rango.
    await assertFails(updateDoc(doc(asAnon(), 'products', 'prd_alfa'), { stock: 99999 }));
  });

  it('el admin NO puede mudar un producto a otro tenant', async () => {
    await assertFails(updateDoc(doc(asAdminOf(A), 'products', 'prd_alfa'), { tenantId: B }));
  });

  it('el admin de B NO puede crear productos a nombre de A', async () => {
    await assertFails(
      setDoc(doc(asAdminOf(B), 'products', 'prd_falso'), { tenantId: A, title: 'x', price: 1, stock: 1 })
    );
  });
});

describe('órdenes', () => {
  it('un miembro lee las órdenes de su tenant', async () => {
    await assertSucceeds(getDoc(doc(asUserOf(A), 'orders', 'ord_alfa')));
  });

  it('NO lee las de otro tenant', async () => {
    await assertFails(getDoc(doc(asUserOf(B), 'orders', 'ord_alfa')));
  });

  it('un anónimo no lee ninguna', async () => {
    await assertFails(getDoc(doc(asAnon(), 'orders', 'ord_alfa')));
  });

  it('nadie las crea desde un cliente: el precio lo pone el servidor', async () => {
    await assertFails(
      setDoc(doc(asAdminOf(A), 'orders', 'ord_trucha'), { tenantId: A, amount: 1, status: 'paid' })
    );
  });

  it('nadie las marca como pagadas desde un cliente', async () => {
    await assertFails(updateDoc(doc(asAdminOf(A), 'orders', 'ord_alfa'), { status: 'paid' }));
  });
});

describe('deny por defecto', () => {
  it('una colección no contemplada no se lee ni se escribe', async () => {
    await assertFails(getDoc(doc(asAdminOf(A), 'coleccion_inventada', 'x')));
    await assertFails(setDoc(doc(asAdminOf(A), 'coleccion_inventada', 'x'), { a: 1 }));
  });

  it('el registro de idempotencia de pagos es solo del backend', async () => {
    await assertFails(getDoc(doc(asAdminOf(A), 'processed_payments', 'pay_1')));
  });
});
