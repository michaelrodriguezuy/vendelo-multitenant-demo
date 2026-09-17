import express from 'express';
import { db } from '../firebase.js';
import { getPublicConfig } from '../tenant.js';

const router = express.Router();

/**
 * Config pública de la tienda que corresponde al host de la request.
 *
 * El tenant sale de `req.tenant`, que puso el middleware a partir del
 * hostname. No hay ningún parámetro con el que el cliente pueda pedir la
 * config de otra tienda.
 */
router.get('/api/storefront', async (req, res) => {
  const config = await getPublicConfig(req.tenant.tenantId);
  if (!config) return res.status(404).json({ error: 'tienda no encontrada' });

  // Allowlist explícita de salida. El documento ya es público por reglas,
  // pero la ruta no reenvía el documento crudo: si mañana entra un campo
  // nuevo, no se publica solo.
  res.json({
    tenantId: config.tenantId,
    subdomain: config.subdomain,
    displayName: config.displayName,
    about: config.about,
    address: config.address,
    openingHours: config.openingHours,
    phone: config.phone,
    currency: config.currency,
    paymentPublicKey: config.paymentPublicKey,
    contactEmail: config.contactEmail,
  });
});

/** Catálogo de la tienda del host. Siempre filtrado por tenant. */
router.get('/api/products', async (req, res) => {
  const snap = await db
    .collection('products')
    .where('tenantId', '==', req.tenant.tenantId)
    .get();

  res.json(
    snap.docs.map((d) => ({
      id: d.id,
      title: d.data().title,
      price: d.data().price,
      stock: d.data().stock,
    }))
  );
});

export default router;
