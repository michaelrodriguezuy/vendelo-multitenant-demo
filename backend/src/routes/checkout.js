import express from 'express';
import crypto from 'node:crypto';
import { admin, db } from '../firebase.js';
import { getCredentials } from '../tenant.js';
import { FakeGateway } from '../gateway.js';

const router = express.Router();

/**
 * Crea la preferencia de pago de la tienda del host.
 *
 * Dos decisiones que separan esto del original:
 *
 * 1. El tenant sale del hostname (`req.tenant`), no del body. En el original
 *    `/create_preference` aceptaba `tenantId` del cuerpo sin autenticación:
 *    cualquiera podía crear preferencias contra la cuenta de cualquier tienda.
 *
 * 2. Los precios salen de Firestore, no del carrito que manda el cliente. El
 *    cliente dice QUÉ compra y CUÁNTAS unidades; CUÁNTO CUESTA lo pone el
 *    servidor. Confiar en el precio del body es un descuento del 100%
 *    disponible para cualquiera con las devtools abiertas.
 */
router.post('/api/checkout/preference', async (req, res) => {
  const { tenantId, currency } = req.tenant;
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (items.length === 0) return res.status(400).json({ error: 'el carrito está vacío' });
  if (items.length > 50) return res.status(400).json({ error: 'demasiados ítems' });

  // Resolver cada producto contra el catálogo DEL TENANT DEL HOST.
  // Un id de producto de otra tienda no resuelve acá, y ese es el punto.
  const resolved = [];
  for (const item of items) {
    // Number(), no parseInt(): parseInt('1.5') devuelve 1 y se colaría un
    // decimal como si fuera entero. Number('1.5') es 1.5 y no pasa el chequeo.
    const qty = Number(item.quantity);
    if (!item.productId || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: 'ítem inválido' });
    }

    const snap = await db.collection('products').doc(String(item.productId)).get();

    if (!snap.exists || snap.data().tenantId !== tenantId) {
      return res.status(404).json({ error: `producto ${item.productId} no existe en esta tienda` });
    }

    const product = snap.data();
    if (product.stock < qty) {
      return res.status(409).json({ error: `sin stock: ${product.title}` });
    }

    resolved.push({
      productId: snap.id,
      title: product.title,
      unitPrice: product.price,
      quantity: qty,
    });
  }

  const amount = resolved.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);

  const orderId = `ord_${crypto.randomBytes(10).toString('hex')}`;
  await db.collection('orders').doc(orderId).set({
    tenantId,
    items: resolved,
    amount,
    currency,
    status: 'pending',
    createdAt: admin.firestore.Timestamp.now(),
  });

  const credentials = await getCredentials(tenantId);
  const gateway = new FakeGateway({
    accessToken: credentials.paymentAccessToken,
    webhookSecret: credentials.paymentWebhookSecret,
  });

  // external_reference lleva tenantId y orderId, los dos opacos. El webhook
  // necesita saber a qué tienda imputar el pago y no puede deducirlo del
  // host: la notificación la manda el proveedor, no el navegador del comprador.
  const preference = await gateway.createPreference({
    externalReference: `${tenantId}|${orderId}`,
    items: resolved,
    amount,
    currency,
  });

  res.json({
    orderId,
    amount,
    currency,
    preferenceId: preference.preferenceId,
    paymentId: preference.paymentId,
    checkoutUrl: preference.checkoutUrl,
  });
});

export default router;
