# vendelo-multitenant-demo

Un SaaS de e-commerce multi-tenant reducido a las tres piezas que realmente
definen su arquitectura: **resolución de tenant por subdominio**, **aislamiento
de datos entre tiendas** y **pagos con webhook**.

Extraído de una plataforma en producción y rediseñado. No es el código tal cual
salió: varias decisiones del original estaban mal y acá están corregidas, con
los errores documentados abajo. Si venís a copiar patrones, la sección de
[anti-patrones](#anti-patrones) es la parte útil.

Sin credenciales, sin datos reales, sin dependencias de nube. Todo corre contra
el emulador de Firestore.

```bash
docker compose up --build
```

- http://localhost:5173 — dominio raíz, no es una tienda
- http://norte.localhost:5173 — una tienda
- http://sur.localhost:5173 — otra tienda, mismos endpoints, otros datos
- http://oeste.localhost:5173 — subdominio inexistente, 404
- http://localhost:4000 — UI del emulador

Los navegadores resuelven cualquier `*.localhost` a `127.0.0.1` sin tocar
`/etc/hosts`, así que el ruteo por subdominio se prueba de verdad.

```bash
npm install
npm test          # levanta el emulador, corre los 79 tests, lo apaga
```

---

## El problema

Un tenant es un negocio con su tienda, su catálogo, sus órdenes y sus
credenciales de cobro. Todos comparten una base de datos y un backend. Lo que
un visitante ve —y lo que un dueño de tienda puede tocar— depende enteramente
de resolver bien a qué tenant pertenece cada request.

Las tres piezas se encadenan: la resolución determina el tenant, el aislamiento
determina qué puede hacer ese tenant, y los pagos son donde un error de
cualquiera de las dos se convierte en plata.

```
  norte.vendelo.uy                   sur.vendelo.uy
         │                                  │
         └────────────┬─────────────────────┘
                      │  Host header
              ┌───────▼────────┐
              │   middleware   │  parseSubdomain(Host) → tenants.where(subdomain)
              │   de tenant    │  req.tenant queda garantizado
              └───────┬────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    /storefront  /products   /checkout/preference
         │            │            │
         └────────────┼────────────┘
                      │
              ┌───────▼────────┐
              │   Firestore    │  reglas = capa de enforcement
              └───────┬────────┘
                      │
   tenants/{id}                 ← lectura pública, allowlist de campos
   tenants/{id}/private/…       ← nadie, ni el dueño: solo backend
   products/{id}  tenantId      ← lectura pública, escritura del dueño
   orders/{id}    tenantId      ← lectura del tenant, escritura solo backend
```

---

## Decisiones de diseño

### 1. La resolución de subdominio es una función pura

[`shared/subdomain.js`](shared/subdomain.js) no toca red, ni Firestore, ni
`window`. Recibe un hostname y devuelve un subdominio o `null`.

Eso permite dos cosas. Primero, **agotarla con una tabla de casos**: IPs,
puertos, mayúsculas, FQDN con punto final, etiquetas inválidas, subdominios
reservados, dominios ajenos. De esta función cuelga todo el aislamiento, así
que conviene que no tenga rincones sin probar. Segundo, **el backend y el
navegador comparten una sola definición**, importando el mismo archivo. Dos
implementaciones del mismo parser terminan divergiendo, y la divergencia
aparece justo donde duele.

El navegador la usa solo para UX —saber si estamos en la landing o en una
tienda—. **La resolución que manda es la del servidor**, que lee el header
`Host`.

### 2. El tenant nunca viene del cliente

El middleware de [`backend/src/index.js`](backend/src/index.js) resuelve el
tenant y lo deja en `req.tenant` antes de montar cualquier ruta de tienda.
Ninguna ruta acepta un `tenantId` por parámetro o por body.

Esto es una decisión estructural, no una validación. Un handler no *puede*
olvidarse de filtrar por tenant, porque el tenant no es un argumento opcional
que haya que acordarse de chequear: es una precondición que ya se cumplió
cuando el handler corre. Los tests verifican que mandar `tenantId` en el body
del checkout no cambia nada.

### 3. Lo público y lo secreto se separan por estructura, no por condición

**Firestore no tiene seguridad a nivel de campo.** Las reglas son todo-o-nada
por documento: no existe "permití leer estos quince campos pero no esos seis".
Si un documento es de lectura pública, todos sus campos son públicos.

La tienda necesita leer nombre, logo y horarios sin login. Entonces:

```
tenants/{tenantId}                   ← lectura pública: solo vitrina
tenants/{tenantId}/private/…         ← denegado a todo cliente: credenciales
```

Y en el código, dos funciones con dos nombres distintos:
`getPublicConfig()` y `getCredentials()`. Que estén separadas hace difícil
mandar un secreto al navegador por accidente.

### 4. La allowlist de escritura convierte "seguro por omisión" en "seguro por construcción"

Dejar el documento público y confiar en que nadie escriba un secreto ahí es
seguro **por omisión**: funciona hasta que alguien agrega un campo. Las reglas
lo vuelven estructural:

```javascript
allow update: if isAdminOf(tenantId)
              && request.resource.data.keys().hasOnly([ /* campos de vitrina */ ]);
```

Ahora la regla dice **qué puede haber** en el documento, no qué no. Escribir un
`paymentAccessToken` ahí es rechazado por la base de datos.

Un detalle que se pasa fácil: `request.resource.data` son las claves del
documento **resultante**, no las modificadas. Cada campo público nuevo hay que
sumarlo a la lista o la escritura falla.

### 5. La pertenencia sale de un custom claim, no de un documento

```javascript
function isMemberOf(tenantId) {
  return request.auth != null && request.auth.token.tenantId == tenantId;
}
```

Un claim lo firma el backend y el cliente no lo puede alterar. Basar la
autorización en `/users/{uid}.tenantId` —un documento que el propio usuario
suele poder escribir— es circular: el sujeto de la autorización controla el
dato que la decide. Además evita un `get()` extra por cada evaluación de regla,
que en Firestore se factura y cuenta contra un límite duro.

### 6. Los IDs de tenant son opacos

`tnt_7f3c91a2`, no `juan_gmail_com`.

En el sistema original el ID se derivaba del email del dueño. Ese
identificador termina en URLs, en logs, en mensajes de error y en el
`external_reference` que ve la pasarela de pagos. Un ID opaco no cuenta nada de
quién está detrás, y no hay que migrarlo cuando el dueño cambia de correo.

### 7. Los precios salen del servidor

El cliente manda **qué** compra y **cuántas** unidades. **Cuánto cuesta** lo
resuelve el backend contra el catálogo, y contra el catálogo *de ese tenant*:
un ID de producto de otra tienda no resuelve.

Confiar en el precio que manda el carrito es un descuento del 100% disponible
para cualquiera con las devtools abiertas.

### 8. El webhook, de afuera hacia adentro

[`backend/src/payments.js`](backend/src/payments.js) no es una ruta: recibe el
cuerpo crudo y la firma, y devuelve `{ status, body }`. La ruta HTTP es una
cáscara fina. Así la misma lógica la ejercitan el webhook real, el simulador
del demo y los tests, sin levantar un servidor ni depender de un puerto.

1. **Firma HMAC sobre el cuerpo crudo.** Por eso `express.raw()` va antes que
   el parser de JSON: la firma se calcula sobre los bytes exactos que mandó el
   proveedor, y un `JSON.parse` + `stringify` los cambia. El secreto es **por
   tenant**: uno global dejaría que el tenant A firme notificaciones válidas
   para el B.
2. **Reserva idempotente en una transacción.** El `paymentId` es el ID del
   documento de bloqueo y se crea *dentro* de la transacción. Sin eso, dos
   notificaciones simultáneas del mismo pago pasan el chequeo de "¿ya lo
   procesé?" a la vez —ninguna registró nada todavía— y el pago se acredita
   dos veces.
3. **Re-consulta contra el proveedor.** Nunca se confía en el estado que viene
   en el cuerpo.
4. **La orden pertenece al tenant** del `external_reference`.
5. **El monto coincide** con el de la orden.

El tenant del webhook **no** sale del hostname: la notificación la manda el
proveedor, no el navegador del comprador.

---

## Anti-patrones

Todos estos estaban en el sistema del que salió este demo. Cada uno tiene un
test que falla si vuelve.

### El `||` que anula el chequeo de tenant

```javascript
// mal
allow update: if isTenantOwner(request.resource.data.tenantId)
              || isAdminWithActiveSubscription();
```

`isAdminWithActiveSubscription()` solo miraba el rol, no el tenant. La segunda
cláusula hace irrelevante a la primera: **cualquier admin de cualquier tienda
podía editar el catálogo de todas las demás**. Un `||` entre una condición
específica y una genérica siempre gana la genérica.

### Credenciales en un documento de lectura pública

El documento del tenant era `allow read: if true` y contenía el access token de
la pasarela de pagos y usuario y contraseña del proveedor de envíos. Cualquiera
los leía con un GET sin autenticar a la API REST de Firestore.

### Secretos en el estado de React

El contexto que alimenta la tienda cargaba `uesUser` y `uesPassword` en estado
de React. Viajaban al navegador de cada visitante. Nadie los consumía: eran
peso muerto que filtraba credenciales.

### El fallback que publica el dato que estabas protegiendo

```javascript
// mal
emailNotification: tenant.emailNotification || tenant.email
```

`emailNotification` es la casilla de contacto que se le muestra al comprador.
`email` es el correo de la cuenta del dueño. Cuando el primero está vacío, el
fallback publica el segundo. El campo protegido se filtra por la puerta del
campo público.

### "El primer tenant de la colección" como fallback

```javascript
// mal
const snapshot = await db.collection('tenants').limit(1).get();
```

Una función devolvía la config del primer tenant cuando no había tenant
resuelto. Se usaba en el cron de cancelación y en dos endpoints de email: las
notificaciones de una tienda salían con el logo y el nombre de otra. Y devolvía
credenciales de un tenant arbitrario a cualquier request sin tenant. Acá un
host que no resuelve es un **404**.

### Escritura anónima "acotada a un campo"

```javascript
// mal
allow update: if request.resource.data.diff(resource.data)
                     .affectedKeys().hasOnly(['stock']);
```

La intención era permitir el descuento de stock en un checkout sin login. El
efecto es que **cualquiera, sin autenticarse, puede fijar el stock de cualquier
producto de cualquier tienda** al valor que quiera. Acá el stock lo mueve el
backend dentro de la transacción del webhook.

### CORS con un comodín de plataforma

```javascript
// mal
/^https:\/\/(.+\.)?vercel\.app$/
```

Eso no es "mi frontend": es **cualquier sitio alojado en Vercel**, de cualquier
persona. El comodín tiene que ser sobre tu dominio, no sobre el de tu
proveedor de hosting.

### Autorización del lado del cliente

```javascript
// mal
function hasActiveSubscription() {
  return isAdmin() || isSuperAdmin();  // "la expiración se chequea en el front"
}
```

Una regla que delega en un guard del frontend no es una regla. El cliente habla
con Firestore directamente; el guard es una sugerencia.

### Superadmin por email hardcodeado

```javascript
// mal
function isSuperAdmin() { return request.auth.token.email == 'hola@ejemplo.com'; }
```

Acoplado a una casilla concreta, repetido en las reglas y en el frontend, y sin
forma de rotar. Acá no hay superadmin en el cliente: las operaciones
privilegiadas son del backend, que usa el Admin SDK y saltea las reglas por
diseño.

---

## Tests

79 tests en tres archivos, contra el emulador real.

| Archivo | Qué verifica |
|---|---|
| [`tests/subdomain.test.js`](tests/subdomain.test.js) | La función pura, agotada con una tabla: 37 casos |
| [`tests/isolation.rules.test.js`](tests/isolation.rules.test.js) | Las reglas reales con `@firebase/rules-unit-testing`: 27 casos |
| [`tests/tenant-resolution.test.js`](tests/tenant-resolution.test.js) | La API por HTTP con `supertest`: 15 casos |

Los de reglas no testean la aplicación: testean la **capa de enforcement**. Si
las reglas se aflojan, se ponen rojos aunque el backend siga siendo correcto.
Es lo que hace que "las tiendas están aisladas" sea verificable y no una
intención. Entre otras cosas cubren:

- el admin de una tienda no puede escribir el catálogo de otra
- nadie —tampoco el dueño— lee las credenciales desde un cliente
- un `paymentAccessToken` escrito en el documento público es rechazado
- un anónimo no puede tocar el stock
- un producto no se puede "mudar" de tenant
- las órdenes no se crean ni se marcan como pagadas desde un cliente

Los de HTTP cubren la resolución por host, que la config pública no filtre
ningún secreto, que el precio salga del catálogo, que un `tenantId` en el body
se ignore, y el webhook: firma inválida, idempotencia, y una orden de otro
tenant.

Dos bugs aparecieron escribiendo estos tests. Uno estaba en el código
(`parseInt('1.5')` devuelve `1`, así que una cantidad decimal pasaba como
entero) y el otro en la propia tabla de casos. Van anotados porque es el punto:
el valor de agotar una función pura con una tabla es justamente ese.

---

## Estructura

```
shared/subdomain.js        la función pura, compartida por backend y front
backend/src/
  index.js                 middleware de tenant + CORS + montaje de rutas
  tenant.js                resolución contra Firestore, config pública vs credenciales
  payments.js              procesamiento del webhook, sin transporte
  gateway.js               pasarela falsa (firma HMAC, consulta de pagos)
  routes/                  cáscaras HTTP finas
frontend/src/
  TenantContext.jsx        resuelve la tienda y expone solo config pública
  App.jsx                  vitrina mínima + checkout
firestore.rules            la capa de enforcement
seed/tenants.js            3 tiendas ficticias, datos generados
tests/                     79 tests
```

## Qué no está acá

Fuera de alcance a propósito: autenticación y alta de usuarios, panel de
administración, envíos, emails, suscripciones y facturación, carrito
persistente, subida de imágenes.

La pasarela de pagos es una implementación falsa y determinística
([`gateway.js`](backend/src/gateway.js)) para que el demo corra sin
credenciales. Cambiarla por un cliente real de MercadoPago no toca las rutas:
la forma de la integración —credenciales por tenant, firma sobre el cuerpo
crudo, re-consulta del pago— es la misma.

## Licencia

MIT
