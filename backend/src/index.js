import express from 'express';
import { resolveTenantFromHost } from './tenant.js';
import webhooksRouter from './routes/webhooks.js';
import storefrontRouter from './routes/storefront.js';
import checkoutRouter from './routes/checkout.js';
import simulateRouter from './routes/simulate.js';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'vendelo.uy';

// El webhook necesita el cuerpo CRUDO para verificar la firma, así que se
// monta antes del parser de JSON y trae su propio express.raw().
app.use(webhooksRouter);

app.use(express.json({ limit: '256kb' }));

/**
 * CORS.
 *
 * Solo subdominios del dominio raíz y de localhost. El original habilitaba
 * `https://*.vercel.app` entero: cualquier sitio alojado en Vercel podía
 * hacer requests con credenciales contra la API.
 */
const ROOT_RE = new RegExp(`^https?://([a-z0-9-]+\\.)?${ROOT_DOMAIN.replace(/\./g, '\\.')}(:\\d+)?$`);
const LOCAL_RE = /^http:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/;

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && (ROOT_RE.test(origin) || LOCAL_RE.test(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * Middleware de tenant.
 *
 * Todo lo que se monta después tiene `req.tenant` garantizado. Ninguna ruta
 * de tienda puede olvidarse de filtrar por tenant, porque el tenant no es un
 * parámetro opcional: es una precondición del handler.
 */
app.use(async (req, res, next) => {
  try {
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    const tenant = await resolveTenantFromHost(host, { rootDomain: ROOT_DOMAIN });

    if (!tenant) {
      return res.status(404).json({
        error: 'tienda no encontrada',
        host,
        hint: 'Probá http://norte.localhost:5173 o http://sur.localhost:5173',
      });
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
});

app.use(storefrontRouter);
app.use(checkoutRouter);
app.use(simulateRouter);

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'error interno' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`backend en :${PORT} (dominio raíz: ${ROOT_DOMAIN})`);
  });
}

export default app;
