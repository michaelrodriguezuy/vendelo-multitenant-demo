import { describe, it, expect } from 'vitest';
import { parseSubdomain, RESERVED_SUBDOMAINS } from '../shared/subdomain.js';

/**
 * La resolución de subdominio es una función pura, así que se puede agotar
 * con una tabla. Vale la pena agotarla: de acá cuelga a qué tienda pertenece
 * cada request, y por lo tanto todo el aislamiento.
 */
describe('parseSubdomain', () => {
  const casos = [
    // [hostname, esperado, por qué]
    ['norte.vendelo.uy', 'norte', 'subdominio simple'],
    ['NORTE.VENDELO.UY', 'norte', 'se normaliza a minúsculas'],
    ['norte.vendelo.uy:443', 'norte', 'el puerto se descarta'],
    ['norte.vendelo.uy.', 'norte', 'punto final (FQDN absoluto)'],
    ['mi-tienda.vendelo.uy', 'mi-tienda', 'guiones válidos al medio'],
    ['tienda.sucursal.vendelo.uy', 'tienda', 'solo la primera etiqueta'],

    ['norte.localhost', 'norte', '*.localhost para desarrollo'],
    ['norte.localhost:5173', 'norte', '*.localhost con puerto'],

    ['vendelo.uy', null, 'dominio raíz: es la landing, no una tienda'],
    ['vendelo.uy:443', null, 'dominio raíz con puerto'],
    ['localhost', null, 'localhost pelado'],
    ['localhost:5173', null, 'localhost con puerto'],
    ['127.0.0.1', null, 'IPv4 no tiene subdominio'],
    ['127.0.0.1:8080', null, 'IPv4 con puerto'],
    ['[::1]', null, 'IPv6'],
    ['', null, 'vacío'],
    [null, null, 'null'],
    [undefined, null, 'undefined'],
    ['otro-dominio.com', null, 'dominio ajeno sin subdominio'],
    ['norte.otro-dominio.com', null, 'no termina en el dominio raíz'],

    ['a.vendelo.uy', null, 'etiqueta de un solo carácter'],
    ['-mala.vendelo.uy', null, 'no puede empezar con guion'],
    ['mala-.vendelo.uy', null, 'no puede terminar con guion'],
    ['ma_la.vendelo.uy', null, 'guion bajo no es válido en DNS'],
    ['ñandu.vendelo.uy', null, 'no-ASCII: se espera punycode'],
  ];

  it.each(casos)('%s → %s (%s)', (hostname, esperado) => {
    expect(parseSubdomain(hostname)).toBe(esperado);
  });

  it.each(RESERVED_SUBDOMAINS)('rechaza el subdominio reservado %s', (r) => {
    expect(parseSubdomain(`${r}.vendelo.uy`)).toBeNull();
  });

  it('respeta un rootDomain distinto', () => {
    expect(parseSubdomain('norte.otra.com', { rootDomain: 'otra.com' })).toBe('norte');
    expect(parseSubdomain('norte.vendelo.uy', { rootDomain: 'otra.com' })).toBeNull();
  });

  it('se queda con el primer valor si el header Host trae varios', () => {
    // Un Host con coma es un intento de confundir al parser aguas arriba.
    expect(parseSubdomain('norte.vendelo.uy, evil.com')).toBe('norte');
  });
});
