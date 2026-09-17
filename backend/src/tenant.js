import { db } from './firebase.js';
import { parseSubdomain } from '../../shared/subdomain.js';

/**
 * Campos que nunca pueden vivir en el documento público del tenant.
 * Fuente de verdad: tenants/{tenantId}/private/credentials
 */
export const SENSITIVE_FIELDS = Object.freeze([
  'paymentAccessToken',
  'paymentWebhookSecret',
  'shippingApiUser',
  'shippingApiPassword',
  'accountEmail',
]);

/**
 * Resuelve el tenant a partir del hostname de la request.
 *
 * El backend NUNCA toma el tenantId del body. Un endpoint público que confía
 * en un identificador mandado por el cliente deja que cualquiera opere en
 * nombre de cualquier tienda.
 */
export async function resolveTenantFromHost(hostname, opts) {
  const subdomain = parseSubdomain(hostname, opts);
  if (!subdomain) return null;

  const snap = await db
    .collection('tenants')
    .where('subdomain', '==', subdomain)
    .limit(1)
    .get();

  if (snap.empty) return null;

  return { tenantId: snap.docs[0].id, ...snap.docs[0].data() };
}

/** Config pública del tenant. Es lo único que puede viajar al navegador. */
export async function getPublicConfig(tenantId) {
  const snap = await db.collection('tenants').doc(tenantId).get();
  if (!snap.exists) return null;
  return { tenantId: snap.id, ...snap.data() };
}

/**
 * Credenciales del tenant. Solo backend.
 *
 * Deliberadamente separada de getPublicConfig: que sean dos funciones
 * distintas, con dos nombres distintos, hace difícil mandar un secreto al
 * cliente por accidente. En el sistema original una sola función devolvía
 * todo mezclado y el contexto de React terminó publicando credenciales.
 */
export async function getCredentials(tenantId) {
  const snap = await db.doc(`tenants/${tenantId}/private/credentials`).get();
  if (!snap.exists) {
    throw new Error(`El tenant ${tenantId} no tiene credenciales configuradas`);
  }
  return snap.data();
}

export { parseSubdomain };
