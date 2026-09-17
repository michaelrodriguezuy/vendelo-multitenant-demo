import { admin, db } from './firebase.js';
import { getCredentials } from './tenant.js';
import { FakeGateway } from './gateway.js';

/**
 * Procesa una notificación de pago.
 *
 * Vive fuera de la ruta HTTP a propósito: recibe el cuerpo crudo y la firma,
 * y devuelve `{ status, body }`. Así la misma lógica la ejercita el webhook
 * real, el simulador del demo y los tests, sin montar un servidor ni depender
 * de un puerto.
 *
 * El tenant NO sale del hostname: la notificación la manda el proveedor, no
 * el navegador del comprador, así que el Host no dice nada útil. Sale del
 * external_reference, y después se verifica que la orden referenciada
 * realmente pertenezca a ese tenant.
 *
 * Las defensas, de afuera hacia adentro:
 *
 *   1. firma HMAC sobre el cuerpo crudo
 *   2. reserva idempotente del paymentId dentro de una transacción
 *   3. re-consulta del pago contra el proveedor
 *   4. la orden pertenece al tenant del external_reference
 *   5. el monto pagado coincide con el de la orden
 */
export async function processPaymentNotification({ rawBody, signature }) {
  let notification;
  try {
    notification = JSON.parse(rawBody || '{}');
  } catch {
    return { status: 400, body: { error: 'json inválido' } };
  }

  const externalReference = notification.external_reference;
  const paymentId = notification.data?.id;

  if (!externalReference || !paymentId) {
    return { status: 400, body: { error: 'notificación incompleta' } };
  }

  const [tenantId, orderId] = String(externalReference).split('|');
  if (!tenantId || !orderId) {
    return { status: 400, body: { error: 'external_reference inválido' } };
  }

  // ── 1. Firma ──────────────────────────────────────────────────────────────
  // El secreto es POR TENANT. Uno global dejaría que el tenant A firme
  // notificaciones válidas para el tenant B.
  let credentials;
  try {
    credentials = await getCredentials(tenantId);
  } catch {
    return { status: 404, body: { error: 'tenant desconocido' } };
  }

  const gateway = new FakeGateway({
    accessToken: credentials.paymentAccessToken,
    webhookSecret: credentials.paymentWebhookSecret,
  });

  if (!gateway.verifySignature(rawBody, signature)) {
    return { status: 401, body: { error: 'firma inválida' } };
  }

  // ── 2. Idempotencia ───────────────────────────────────────────────────────
  // Sin transacción, dos notificaciones del mismo pago pueden pasar el chequeo
  // de "¿ya lo procesé?" a la vez, antes de que alguna registre nada, y el pago
  // se acredita dos veces. Usar el paymentId como id de documento y crearlo
  // DENTRO de la transacción hace que solo una pueda ganar.
  const lockRef = db.collection('processed_payments').doc(String(paymentId));

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(lockRef);
      if (existing.exists) {
        throw Object.assign(new Error('ALREADY_PROCESSED'), { already: true });
      }
      tx.set(lockRef, {
        paymentId: String(paymentId),
        tenantId,
        orderId,
        status: 'processing',
        reservedAt: admin.firestore.Timestamp.now(),
      });
    });
  } catch (err) {
    if (err.already) return { status: 200, body: { status: 'duplicado ignorado' } };
    throw err;
  }

  // ── 3. Re-consulta contra el proveedor ────────────────────────────────────
  // Nunca confiar en el estado que viene en el cuerpo: el cuerpo lo puede
  // fabricar cualquiera que pase el paso 1.
  const payment = await gateway.getPayment(String(paymentId));

  if (!payment) {
    await lockRef.update({ status: 'pago inexistente' });
    return { status: 404, body: { error: 'pago inexistente' } };
  }
  if (payment.status !== 'approved') {
    await lockRef.update({ status: `ignorado: ${payment.status}` });
    return { status: 200, body: { status: 'pago no aprobado' } };
  }
  if (payment.external_reference !== externalReference) {
    // El paymentId existe pero pertenece a otra orden: alguien reusó un id
    // ajeno para que el pago se acredite acá.
    await lockRef.update({ status: 'external_reference no coincide' });
    return { status: 409, body: { error: 'el pago no corresponde a esta orden' } };
  }

  // ── 4 y 5. Orden del tenant, monto coincidente ────────────────────────────
  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists || orderSnap.data().tenantId !== tenantId) {
    await lockRef.update({ status: 'orden ajena al tenant' });
    return { status: 404, body: { error: 'orden no encontrada en este tenant' } };
  }

  const order = orderSnap.data();
  if (Number(payment.transaction_amount) !== Number(order.amount)) {
    await lockRef.update({ status: 'monto no coincide' });
    return { status: 409, body: { error: 'el monto pagado no coincide con la orden' } };
  }

  // ── Efecto ────────────────────────────────────────────────────────────────
  await db.runTransaction(async (tx) => {
    // Firestore exige todas las lecturas antes que las escrituras.
    const refs = order.items.map((i) => db.collection('products').doc(i.productId));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));

    snaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      tx.update(refs[idx], {
        stock: admin.firestore.FieldValue.increment(-order.items[idx].quantity),
      });
    });

    tx.update(orderRef, {
      status: 'paid',
      paymentId: String(paymentId),
      paidAt: admin.firestore.Timestamp.now(),
    });

    tx.update(lockRef, { status: 'done' });
  });

  return { status: 200, body: { status: 'ok', orderId } };
}
