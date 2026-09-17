import crypto from 'node:crypto';

/**
 * Pasarela de pagos.
 *
 * En producción esto es MercadoPago. Acá es una implementación falsa y
 * determinística para que el demo corra con `docker compose up` sin una sola
 * credencial real. Lo que importa del ejemplo no es el proveedor sino la
 * forma de integrarlo:
 *
 *   - las credenciales se resuelven POR TENANT, no de una variable global
 *   - la firma del webhook se valida antes de mirar el payload
 *   - el estado del pago se re-consulta contra el proveedor: nunca se confía
 *     en lo que llega en el cuerpo de la notificación
 *
 * Cambiar FakeGateway por un cliente real no toca las rutas.
 */
export class FakeGateway {
  constructor({ accessToken, webhookSecret }) {
    if (!accessToken) throw new Error('accessToken requerido');
    this.accessToken = accessToken;
    this.webhookSecret = webhookSecret;
  }

  /** Crea la preferencia de checkout. */
  async createPreference({ externalReference, items, amount, currency }) {
    const preferenceId = `pref_${crypto.randomBytes(8).toString('hex')}`;
    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;

    // El proveedor registra el monto que le dijimos. Cuando el webhook
    // pregunte por el pago, ESTA es la fuente de verdad, no la notificación.
    PAYMENTS.set(paymentId, {
      id: paymentId,
      status: 'approved',
      external_reference: externalReference,
      transaction_amount: amount,
      currency_id: currency,
      items_count: items.length,
    });

    return { preferenceId, paymentId, checkoutUrl: `/api/checkout/simulate/${paymentId}` };
  }

  /** Consulta el pago contra el proveedor. */
  async getPayment(paymentId) {
    return PAYMENTS.get(paymentId) || null;
  }

  /**
   * Valida la firma del webhook: HMAC-SHA256 sobre el cuerpo crudo.
   *
   * Sin esto cualquiera que conozca la URL puede postear "pago aprobado".
   * El sistema original no validaba firma: su única defensa era re-consultar
   * el pago, lo que frena el fraude directo pero no frena que te inunden de
   * notificaciones falsas ni que se procese un id de pago ajeno.
   */
  verifySignature(rawBody, signature) {
    if (!this.webhookSecret || !signature) return false;

    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');

    // Comparación en tiempo constante: `===` filtra información por timing.
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  static sign(rawBody, secret) {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}

// Los pagos del proveedor falso viven en memoria: es un demo.
const PAYMENTS = new Map();
