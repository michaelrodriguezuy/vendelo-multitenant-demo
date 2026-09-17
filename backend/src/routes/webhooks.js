import express from 'express';
import { processPaymentNotification } from '../payments.js';

const router = express.Router();

/**
 * Webhook de pagos.
 *
 * La ruta es una cáscara fina: adapta HTTP y delega en
 * processPaymentNotification. Toda la lógica y las defensas están ahí, y por
 * eso se pueden ejercitar sin levantar un servidor.
 *
 * express.raw() es obligatorio: la firma se calcula sobre los bytes exactos
 * que mandó el proveedor. Si el cuerpo pasa por JSON.parse y se vuelve a
 * serializar, cualquier diferencia de formato invalida el HMAC.
 */
router.post(
  '/api/webhooks/payments',
  express.raw({ type: '*/*', limit: '64kb' }),
  async (req, res, next) => {
    try {
      const { status, body } = await processPaymentNotification({
        rawBody: Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '',
        signature: req.get('x-signature'),
      });
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
