import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import request from 'supertest';
import admin from 'firebase-admin';
import { seedInto, TENANTS } from '../seed/tenants.js';

/**
 * Resolución de tenant y aislamiento a nivel HTTP, contra el emulador.
 *
 * Complementa los tests de reglas: aquellos verifican qué deja pasar
 * Firestore; estos verifican que la API nunca acepte un tenant que venga del
 * cliente y que no se pueda cruzar de una tienda a otra por la puerta de la
 * aplicación.
 */

const NORTE = TENANTS.find((t) => t.subdomain === 'norte');
const SUR = TENANTS.find((t) => t.subdomain === 'sur');

let app;
let db;

/** El middleware prefiere x-forwarded-host, que es lo que llega tras un proxy. */
const host = (req, hostname) => req.set('x-forwarded-host', hostname);

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8085';
  process.env.GCLOUD_PROJECT ||= 'demo-vendelo';
  process.env.ROOT_DOMAIN = 'vendelo.uy';

  app = (await import('../backend/src/index.js')).default;
  db = admin.firestore();
});

afterAll(async () => { await admin.app().delete(); });

beforeEach(async () => {
  for (const c of ['tenants', 'products', 'orders', 'processed_payments']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await seedInto(db, admin.firestore.Timestamp);
});

describe('resolución por subdominio', () => {
  it('sirve la tienda del host', async () => {
    const res = await host(request(app).get('/api/storefront'), 'norte.vendelo.uy');
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(NORTE.tenantId);
    expect(res.body.displayName).toBe(NORTE.displayName);
  });

  it('el mismo endpoint sirve OTRA tienda con otro host', async () => {
    const res = await host(request(app).get('/api/storefront'), 'sur.vendelo.uy');
    expect(res.body.tenantId).toBe(SUR.tenantId);
  });

  it('funciona con *.localhost, que es como se prueba en local', async () => {
    const res = await host(request(app).get('/api/storefront'), 'norte.localhost:5173');
    expect(res.body.tenantId).toBe(NORTE.tenantId);
  });

  it('un subdominio inexistente da 404, no una tienda por defecto', async () => {
    const res = await host(request(app).get('/api/storefront'), 'oeste.vendelo.uy');
    expect(res.status).toBe(404);
  });

  it('el dominio raíz da 404: no es una tienda', async () => {
    const res = await host(request(app).get('/api/storefront'), 'vendelo.uy');
    expect(res.status).toBe(404);
  });
});

describe('la config pública nunca lleva secretos', () => {
  it('no filtra credenciales ni el email de cuenta', async () => {
    const res = await host(request(app).get('/api/storefront'), 'norte.vendelo.uy');
    const body = JSON.stringify(res.body);

    for (const [k, v] of Object.entries(NORTE.credentials)) {
      expect(body, `filtró el campo ${k}`).not.toContain(v);
      expect(res.body[k]).toBeUndefined();
    }
    // La clave pública de la pasarela SÍ es pública: va en el navegador.
    expect(res.body.paymentPublicKey).toBe(NORTE.paymentPublicKey);
  });
});

describe('aislamiento del catálogo', () => {
  it('cada host ve solo sus productos', async () => {
    const norte = await host(request(app).get('/api/products'), 'norte.vendelo.uy');
    const sur = await host(request(app).get('/api/products'), 'sur.vendelo.uy');

    expect(norte.body).toHaveLength(NORTE.products.length);
    expect(sur.body).toHaveLength(SUR.products.length);

    const titulosSur = new Set(sur.body.map((p) => p.title));
    for (const p of norte.body) expect(titulosSur.has(p.title)).toBe(false);
  });
});

describe('checkout', () => {
  it('cobra con el precio del catálogo, no con el del cliente', async () => {
    const productos = (await host(request(app).get('/api/products'), 'norte.vendelo.uy')).body;
    const p = productos[0];

    const res = await host(
      request(app).post('/api/checkout/preference'),
      'norte.vendelo.uy'
    ).send({ items: [{ productId: p.id, quantity: 2, unitPrice: 1, price: 1 }] });

    expect(res.status).toBe(200);
    // Mandamos price: 1 y lo ignoró: el total sale del catálogo.
    expect(res.body.amount).toBe(p.price * 2);
  });

  it('rechaza un producto de otra tienda', async () => {
    const productosSur = (await host(request(app).get('/api/products'), 'sur.vendelo.uy')).body;

    const res = await host(
      request(app).post('/api/checkout/preference'),
      'norte.vendelo.uy'
    ).send({ items: [{ productId: productosSur[0].id, quantity: 1 }] });

    expect(res.status).toBe(404);
  });

  it('ignora un tenantId mandado en el body', async () => {
    const productos = (await host(request(app).get('/api/products'), 'norte.vendelo.uy')).body;

    const res = await host(
      request(app).post('/api/checkout/preference'),
      'norte.vendelo.uy'
    ).send({ tenantId: SUR.tenantId, items: [{ productId: productos[0].id, quantity: 1 }] });

    expect(res.status).toBe(200);
    const order = await db.collection('orders').doc(res.body.orderId).get();
    expect(order.data().tenantId).toBe(NORTE.tenantId);
  });

  it('rechaza cantidades inválidas', async () => {
    const productos = (await host(request(app).get('/api/products'), 'norte.vendelo.uy')).body;
    for (const quantity of [0, -1, 1.5, 1000, 'dos']) {
      const res = await host(
        request(app).post('/api/checkout/preference'),
        'norte.vendelo.uy'
      ).send({ items: [{ productId: productos[0].id, quantity }] });
      expect(res.status, `quantity=${quantity}`).toBe(400);
    }
  });
});

describe('webhook de pagos', () => {
  async function crearOrden(subdominio = 'norte.vendelo.uy') {
    const productos = (await host(request(app).get('/api/products'), subdominio)).body;
    const res = await host(request(app).post('/api/checkout/preference'), subdominio)
      .send({ items: [{ productId: productos[0].id, quantity: 1 }] });
    return { ...res.body, product: productos[0] };
  }

  it('acredita la orden y descuenta stock', async () => {
    const orden = await crearOrden();

    const res = await host(
      request(app).post(`/api/checkout/simulate/${orden.paymentId}`),
      'norte.vendelo.uy'
    ).send({ orderId: orden.orderId });

    expect(res.status).toBe(200);

    const order = await db.collection('orders').doc(orden.orderId).get();
    expect(order.data().status).toBe('paid');

    const product = await db.collection('products').doc(orden.product.id).get();
    expect(product.data().stock).toBe(orden.product.stock - 1);
  });

  it('rechaza una notificación sin firma válida', async () => {
    const orden = await crearOrden();

    const res = await request(app)
      .post('/api/webhooks/payments')
      .set('content-type', 'application/json')
      .set('x-signature', 'firma-inventada')
      .send(JSON.stringify({
        type: 'payment',
        data: { id: orden.paymentId },
        external_reference: `${NORTE.tenantId}|${orden.orderId}`,
      }));

    expect(res.status).toBe(401);

    const order = await db.collection('orders').doc(orden.orderId).get();
    expect(order.data().status).toBe('pending');
  });

  it('es idempotente: el segundo webhook no descuenta stock de nuevo', async () => {
    const orden = await crearOrden();

    await host(request(app).post(`/api/checkout/simulate/${orden.paymentId}`), 'norte.vendelo.uy')
      .send({ orderId: orden.orderId });
    const res2 = await host(request(app).post(`/api/checkout/simulate/${orden.paymentId}`), 'norte.vendelo.uy')
      .send({ orderId: orden.orderId });

    expect(res2.status).toBe(200);

    const product = await db.collection('products').doc(orden.product.id).get();
    expect(product.data().stock).toBe(orden.product.stock - 1);
  });

  it('no acredita una orden de otro tenant', async () => {
    const ordenSur = await crearOrden('sur.vendelo.uy');

    // El tenant norte intenta que el pago de una orden de sur se acredite
    // contra su propio external_reference.
    const res = await host(
      request(app).post(`/api/checkout/simulate/${ordenSur.paymentId}`),
      'norte.vendelo.uy'
    ).send({ orderId: ordenSur.orderId });

    expect(res.status).toBeGreaterThanOrEqual(400);

    const order = await db.collection('orders').doc(ordenSur.orderId).get();
    expect(order.data().status).toBe('pending');
  });
});
