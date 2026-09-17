import { useState } from 'react';
import { TenantProvider, useTenant } from './TenantContext.jsx';
import './styles.css';

const TIENDAS = ['norte', 'sur', 'este'];

function Landing() {
  const { protocol, port } = window.location;
  const base = port ? `:${port}` : '';
  return (
    <main className="card">
      <h1>Demo multi-tenant</h1>
      <p>
        Estás en el dominio raíz, que no es una tienda. Cada tienda vive en su
        propio subdominio y todo el aislamiento cuelga de ahí.
      </p>
      <ul className="stores">
        {TIENDAS.map((s) => (
          <li key={s}>
            <a href={`${protocol}//${s}.localhost${base}`}>{s}.localhost{base}</a>
          </li>
        ))}
      </ul>
      <p className="muted">
        También podés probar un subdominio inexistente, por ejemplo{' '}
        <code>oeste.localhost{base}</code>.
      </p>
    </main>
  );
}

function NotFound({ subdomain }) {
  return (
    <main className="card">
      <h1>Tienda no encontrada</h1>
      <p>
        No hay ninguna tienda en <code>{subdomain}</code>.
      </p>
      <p className="muted">
        El backend devuelve 404 en vez de caer a una tienda por defecto. Caer a
        &quot;la primera de la colección&quot; es como se filtra la config de un
        tenant arbitrario a cualquiera que pegue en el host equivocado.
      </p>
      <p>
        <a href={`${window.location.protocol}//localhost:${window.location.port}`}>Volver</a>
      </p>
    </main>
  );
}

function Checkout({ store, products }) {
  const [qty, setQty] = useState(() => Object.fromEntries(products.map((p) => [p.id, 0])));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const items = products
    .filter((p) => qty[p.id] > 0)
    .map((p) => ({ productId: p.id, quantity: qty[p.id] }));

  const total = products.reduce((acc, p) => acc + p.price * (qty[p.id] || 0), 0);

  async function pagar() {
    setBusy(true);
    setResult(null);
    try {
      // Se manda QUÉ y CUÁNTO, nunca el precio: lo pone el servidor.
      const prefRes = await fetch('/api/checkout/preference', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const pref = await prefRes.json();
      if (!prefRes.ok) throw new Error(pref.error || 'error al crear la preferencia');

      const payRes = await fetch(pref.checkoutUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: pref.orderId }),
      });
      const pay = await payRes.json();

      setResult({
        ok: payRes.ok,
        text: payRes.ok
          ? `Orden ${pref.orderId} pagada: ${pref.amount} ${pref.currency}`
          : pay.error || 'el pago falló',
      });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Catálogo</h2>
      <table className="catalog">
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.title}</td>
              <td className="num">{p.price} {store.currency}</td>
              <td className="num muted">stock {p.stock}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  max={p.stock}
                  value={qty[p.id] ?? 0}
                  onChange={(e) =>
                    setQty({ ...qty, [p.id]: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="total">Total: <strong>{total} {store.currency}</strong></p>

      <button onClick={pagar} disabled={busy || items.length === 0}>
        {busy ? 'Procesando…' : 'Pagar (simulado)'}
      </button>

      {result && (
        <p className={result.ok ? 'ok' : 'err'}>{result.text}</p>
      )}
    </section>
  );
}

function Store() {
  const { loading, notFound, isLanding, subdomain, store, products } = useTenant();

  if (isLanding) return <Landing />;
  if (loading) return <main className="card"><p className="muted">Cargando…</p></main>;
  if (notFound || !store) return <NotFound subdomain={subdomain} />;

  return (
    <main className="card">
      <header>
        <h1>{store.displayName}</h1>
        <p className="muted">{store.about}</p>
      </header>

      <dl className="meta">
        <div><dt>tenantId</dt><dd><code>{store.tenantId}</code></dd></div>
        <div><dt>subdominio</dt><dd><code>{store.subdomain}</code></dd></div>
        <div><dt>dirección</dt><dd>{store.address}</dd></div>
        <div><dt>horario</dt><dd>{store.openingHours}</dd></div>
        <div><dt>contacto</dt><dd>{store.contactEmail}</dd></div>
      </dl>

      <Checkout store={store} products={products} />

      <footer className="muted">
        Todo lo de arriba es config pública. Las credenciales de esta tienda
        están en <code>tenants/{store.tenantId}/private/credentials</code> y
        ningún cliente puede leerlas: las reglas las niegan y esta página nunca
        las pide.
      </footer>
    </main>
  );
}

export function App() {
  return (
    <TenantProvider>
      <Store />
    </TenantProvider>
  );
}
