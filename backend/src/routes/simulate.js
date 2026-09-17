import express from 'express';
import { getCredentials } from '../tenant.js';
import { FakeGateway } from '../gateway.js';
import { processPaymentNotification } from '../payments.js';

const router = express.Router();

/**
 * Simulador de la pantalla de pago del proveedor.
 *
 * Existe solo para que el recorrido del demo se pueda completar sin salir a
 * internet: arma la notificación y la firma igual que lo haría la pasarela, y
 * la procesa por el mismo camino que el webhook real. En producción esta ruta
 * no existe.
 */
router.post('/api/checkout/simulate/:paymentId', async (req, res, next) => {
  try {
    const { tenantId } = req.tenant;
    const { paymentId } = req.params;
    const { orderId } = req.body;

    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });

    const credentials = await getCredentials(tenantId);

    const rawBody = JSON.stringify({
      type: 'payment',
      data: { id: paymentId },
      external_reference: `${tenantId}|${orderId}`,
    });

    const { status, body } = await processPaymentNotification({
      rawBody,
      signature: FakeGateway.sign(rawBody, credentials.paymentWebhookSecret),
    });

    res.status(status).json(body);
  } catch (err) {
    next(err);
  }
});

export default router;
