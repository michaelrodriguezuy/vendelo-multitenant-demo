import { createContext, useContext, useEffect, useState } from 'react';
import { parseSubdomain } from '../../shared/subdomain.js';

const TenantContext = createContext(null);

/**
 * Estado de la tienda actual.
 *
 * El navegador usa `parseSubdomain` solo para la UX: saber enseguida si
 * estamos en el dominio raíz (landing) o en una tienda, y qué subdominio
 * mostrar mientras carga.
 *
 * La resolución que MANDA es la del backend, que lee el header Host de la
 * request. El front no le pasa ningún tenantId al servidor: si lo hiciera,
 * cambiar un valor en devtools bastaría para operar contra otra tienda.
 *
 * Y lo que llega acá es solo config pública. Las credenciales de la pasarela
 * viven en tenants/{id}/private/credentials, que las reglas niegan a todo
 * cliente. En el sistema original este mismo contexto cargaba el usuario y la
 * contraseña del proveedor de envíos en el estado de React, o sea en el
 * navegador de cada visitante.
 */
export function TenantProvider({ children }) {
  const subdomain = parseSubdomain(window.location.hostname, {
    rootDomain: import.meta.env.VITE_ROOT_DOMAIN || 'vendelo.uy',
  });

  const [state, setState] = useState({
    loading: true,
    notFound: false,
    isLanding: subdomain === null,
    subdomain,
    store: null,
    products: [],
  });

  useEffect(() => {
    if (subdomain === null) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [storeRes, productsRes] = await Promise.all([
          fetch('/api/storefront'),
          fetch('/api/products'),
        ]);

        if (cancelled) return;

        if (storeRes.status === 404) {
          setState((s) => ({ ...s, loading: false, notFound: true }));
          return;
        }
        if (!storeRes.ok) throw new Error(`storefront: ${storeRes.status}`);

        setState((s) => ({
          ...s,
          loading: false,
          store: await storeRes.json(),
          products: productsRes.ok ? await productsRes.json() : [],
        }));
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setState((s) => ({ ...s, loading: false, notFound: true }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [subdomain]);

  return <TenantContext.Provider value={state}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant fuera de TenantProvider');
  return ctx;
}
