/**
 * Resolución de subdominio → tenant.
 *
 * Función pura: sin red, sin Firestore, sin `window`. Es el corazón del
 * ruteo multi-tenant, así que vive en un módulo propio que importan tanto el
 * backend como el navegador. Una sola definición, un solo set de tests.
 *
 * Que sea pura no es un detalle de estilo: la resolución de tenant es la
 * decisión de la que cuelga todo el aislamiento, y una función pura se puede
 * agotar con una tabla de casos.
 */

/**
 * Subdominios que nunca son una tienda.
 * Sin esta lista, alguien que registre el tenant `admin` se queda con
 * admin.tudominio.com.
 */
export const RESERVED_SUBDOMAINS = Object.freeze([
  'www', 'api', 'admin', 'app', 'static', 'assets', 'cdn', 'mail', 'ftp', 'status',
]);

const RESERVED = new Set(RESERVED_SUBDOMAINS);

/** Etiqueta DNS válida: 2-63 chars, alfanumérica, guiones al medio. */
const LABEL = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

function normalize(label) {
  const s = String(label || '').toLowerCase();
  if (s.length < 2 || s.length > 63) return null;
  if (!LABEL.test(s)) return null;
  if (RESERVED.has(s)) return null;
  return s;
}

/**
 * Extrae el subdominio de tenant de un hostname.
 * Devuelve null cuando no hay ninguno que valga.
 *
 *   norte.vendelo.uy       -> 'norte'
 *   NORTE.vendelo.uy:443   -> 'norte'
 *   norte.localhost:5173   -> 'norte'
 *   vendelo.uy             -> null  (dominio raíz: landing, no una tienda)
 *   www.vendelo.uy         -> null  (reservado)
 *   localhost              -> null
 *   127.0.0.1              -> null
 *   a.b.vendelo.uy         -> 'a'   (solo la primera etiqueta)
 */
export function parseSubdomain(hostname, { rootDomain = 'vendelo.uy' } = {}) {
  if (typeof hostname !== 'string' || !hostname) return null;

  // Un header Host puede llegar con varios valores; quedarse con el primero.
  // Sacar el puerto y normalizar.
  const host = hostname.split(',')[0].trim().toLowerCase().split(':')[0].replace(/\.$/, '');
  if (!host) return null;

  // Las IPs no tienen subdominio.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (host.includes('[') || host.includes(']')) return null; // IPv6

  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  // *.localhost — los navegadores lo resuelven a 127.0.0.1 sin tocar
  // /etc/hosts, y es lo que hace que el demo se pueda probar de verdad.
  if (labels[labels.length - 1] === 'localhost') {
    return normalize(labels[0]);
  }

  const rootLabels = rootDomain.toLowerCase().split('.').filter(Boolean);

  // El dominio raíz pelado no es un tenant.
  if (labels.length <= rootLabels.length) return null;

  // El host tiene que terminar efectivamente en el dominio raíz.
  const tail = labels.slice(-rootLabels.length).join('.');
  if (tail !== rootLabels.join('.')) return null;

  return normalize(labels[0]);
}
