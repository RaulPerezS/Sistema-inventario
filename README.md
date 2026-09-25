# 📦 Sistema de Inventario

Plataforma web **multiempresa y multisucursal** para la gestión de inventario, adaptada a Chile (pesos, RUT e IVA), con **API REST documentada** lista para ser consumida por otros sistemas (ERP, e-commerce, POS, apps móviles), **webhooks** y un **panel web** moderno.

| Capa | Tecnología |
|---|---|
| API | Node.js 22 · TypeScript · Express 5 · Prisma ORM · PostgreSQL 16 |
| Validación y docs | Zod → OpenAPI 3 (Swagger UI) generado automáticamente |
| Seguridad | JWT + refresh tokens rotativos (cookie httpOnly) · API keys · roles · Helmet · rate limiting · auditoría |
| Web | React 19 · Vite · TailwindCSS 4 · TanStack Query · Recharts · modo oscuro · responsive |
| Calidad | Vitest + Supertest (pruebas de integración) · ESLint · GitHub Actions |
| Despliegue | Docker · Docker Compose · Nginx |

---

## ✨ Funcionalidades

### Multiempresa y multisucursal
- **Empresas aisladas** (multi-tenant): cada empresa tiene su RUT, giro, tasa de IVA, catálogo, clientes, proveedores, stock, órdenes, usuarios, API keys, webhooks y auditoría. Ningún dato es visible ni modificable desde otra empresa (cubierto por pruebas).
- **Sucursales** por empresa; cada **almacén pertenece a una sucursal**. El catálogo se comparte en la empresa y el stock se lleva por almacén.
- **Un usuario, varias empresas**: cada persona puede tener acceso a varias empresas con un **rol distinto en cada una**, y cambiar de empresa desde el panel (o con `POST /auth/switch-company`) sin volver a iniciar sesión.
- **Restricción por sucursal**: usuarios y API keys pueden limitarse a ciertas sucursales; solo ven y operan sus almacenes, órdenes, movimientos y reportes.
- **Administrador de plataforma** (p. ej. HGV): crea y administra empresas, con su primera sucursal y su administrador inicial.
- Correlativos (`OC-000001`, `OV-000001`), SKU, códigos de almacén y RUT **únicos por empresa**.

### Chile
- Montos en **pesos chilenos** (sin decimales), formato `es-CL`.
- **RUT** validado con dígito verificador y normalizado (`12.345.678-5` → `12345678-5`).
- **IVA 19 %** (configurable por empresa) con **productos exentos**; las órdenes guardan neto, IVA y total, y el IVA se calcula por tasa y se redondea una vez.

### Inventario
- **Catálogo**: productos (SKU, código de barras, costo, precio, stock mínimo/máximo), categorías jerárquicas, proveedores, clientes y almacenes.
- **Inventario multi-almacén**: entradas, salidas, **transferencias** entre almacenes y **ajustes por conteo físico**.
- **Kardex** completo por producto (cada movimiento guarda el saldo resultante, usuario y referencia).
- **Costo promedio ponderado** recalculado automáticamente en cada entrada con costo.
- **Órdenes de compra**: borrador → emitida → recepción parcial/total (genera stock).
- **Órdenes de venta**: borrador → confirmada (**reserva el stock**) → despachada (consume la reserva). Cancelar libera la reserva.
- **Stock físico, reservado y disponible**: las salidas manuales y transferencias solo pueden usar lo disponible, así dos ventas nunca prometen las mismas unidades.
- **Webhooks**: notificaciones firmadas (HMAC-SHA256) a otros sistemas cuando hay movimientos de stock, stock bajo o cambios en productos y órdenes, con reintentos automáticos e historial de envíos.
- **Reportes** (filtrables por sucursal): dashboard de KPIs, stock bajo con **sugerencia de reposición**, valorización por categoría/sucursal/almacén, productos con mayor salida, ventas netas e IVA débito por día, resumen de movimientos.
- **Exportación CSV** (productos y movimientos) e **importación masiva** de productos (upsert por SKU).
- **Búsqueda por código de barras / SKU** (`/products/lookup`) para lectores.
- **Usuarios y roles**, **API keys** para integraciones y **bitácora de auditoría** de todas las operaciones.

### Garantías de consistencia
- Todas las operaciones de stock se ejecutan en **transacciones**; si un ítem falla, no se aplica ninguno.
- Las salidas usan un `UPDATE ... WHERE quantity - reserved >= n` atómico: **el stock nunca queda negativo ni se vende lo reservado**, incluso con peticiones concurrentes (cubierto por pruebas). Una restricción `CHECK` en la base garantiza `0 ≤ reservado ≤ físico`.
- Las transiciones de estado de órdenes son atómicas (no se puede despachar dos veces).
- Numeración correlativa sin huecos por concurrencia (`OC-000001`, `OV-000001`).

---

## 🚀 Puesta en marcha

### Opción A — Docker Compose (todo en un comando)

```bash
cp .env.example .env
# Edite .env y complete JWT_ACCESS_SECRET y JWT_REFRESH_SECRET (openssl rand -hex 48)
docker compose up -d --build

# Datos de demostración (opcional, una sola vez)
docker compose exec api npm run db:seed
```

- Web: http://localhost:8080
- API: http://localhost:4000/api/v1
- Documentación interactiva: http://localhost:4000/api/docs

### Opción B — Desarrollo local

Requisitos: Node.js ≥ 20 y PostgreSQL ≥ 14.

```bash
# 1. Base de datos
createdb inventario

# 2. API
cd backend
cp .env.example .env          # ajuste DATABASE_URL si es necesario
npm install
npm run db:migrate            # crea las tablas
npm run db:seed               # datos de demostración
npm run dev                   # http://localhost:4000

# 3. Web (en otra terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxy /api → :4000)
```

### Datos de demostración

El seed crea dos empresas: **Comercial Los Andes SpA** (sucursales Santiago Centro y Antofagasta) y **Distribuidora Del Sur Limitada** (sucursal Concepción).

| Usuario | Correo | Contraseña | Acceso |
|---|---|---|---|
| Administrador de plataforma | admin@inventario.local | Admin123! | Administra todas las empresas |
| Gerente | gerente@inventario.local | Gerente123! | Gerente en Los Andes |
| Operador | operador@inventario.local | Operador123! | Operador en Los Andes, **solo sucursal Santiago** |
| Consulta | consulta@inventario.local | Consulta123! | Consulta en **ambas empresas** (puede cambiar entre ellas) |
| Admin Del Sur | admin@delsur.cl | DelSur123! | Administradora de Del Sur |

---

## 🔐 Roles y permisos

Los roles se asignan **por empresa** y son jerárquicos: cada uno incluye los permisos de los anteriores. Además, cualquier rol puede restringirse a ciertas sucursales.

| Rol | Puede |
|---|---|
| `VIEWER` | Consultar todo: catálogo, stock, movimientos, órdenes y reportes |
| `OPERATOR` | + registrar entradas, salidas y transferencias; crear/confirmar/despachar ventas; recibir compras |
| `MANAGER` | + gestionar catálogo y maestros, ajustes de inventario, órdenes de compra |
| `ADMIN` | + datos de la empresa, sucursales, usuarios, API keys, webhooks, auditoría y eliminación de almacenes |
| Administrador de plataforma | Gestiona empresas (`/companies`) y puede operar en cualquiera de ellas |

---

## 🔌 Consumo de la API

- Base: `/api/v1` · Especificación: `/api/openapi.json` (importable en **Postman / Insomnia**; también exportada en [`docs/openapi.json`](docs/openapi.json)).
- Respuestas de listas paginadas: `{ "data": [...], "meta": { page, limit, total, totalPages } }`.
- Parámetros comunes: `page`, `limit` (máx. 100), `search`, `sortBy`, `sortOrder`.
- Errores uniformes: `{ "error": { "code", "message", "details", "requestId" } }` con códigos HTTP `400, 401, 403, 404, 409, 422, 429`.
- Cada respuesta incluye `X-Request-Id` para trazabilidad.

### 1. Usuarios (JWT)

```bash
# Login
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@inventario.local","password":"Admin123!"}'
# → { accessToken, refreshToken, user, company, role, branches, companies, ... }
# Opcional: "companyId" en el login para entrar directo a una empresa

# Cambiar de empresa (emite tokens nuevos)
curl -X POST http://localhost:4000/api/v1/auth/switch-company \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"companyId":"<uuid>"}'

# Usar el token
curl http://localhost:4000/api/v1/products?search=laptop \
  -H "Authorization: Bearer <accessToken>"

# Renovar (el refresh token rota en cada uso; reutilizar uno viejo revoca todas las sesiones)
curl -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'
```

### 2. Sistemas externos (API key)

Un administrador crea la clave en **Administración → API Keys** (o `POST /api-keys`), elige sus permisos (hasta `MANAGER`), opcionalmente las sucursales permitidas y una fecha de expiración. La clave pertenece a la empresa en que se creó: todas sus operaciones quedan dentro de esa empresa.

```bash
# Consultar stock desde un e-commerce
curl "http://localhost:4000/api/v1/inventory/stock?search=LAP-001" \
  -H "X-API-Key: inv_xxxxxxxxxxxxxxxx"

# Registrar una salida desde un POS
curl -X POST http://localhost:4000/api/v1/inventory/exits \
  -H "X-API-Key: inv_xxxxxxxxxxxxxxxx" -H "Content-Type: application/json" \
  -d '{"warehouseId":"<uuid>","reference":"TICKET-8812","items":[{"productId":"<uuid>","quantity":2}]}'
```

### 3. Webhooks

En **Administración → Webhooks** (o `POST /webhooks`) se registra una URL y los eventos a recibir: `inventory.movements.created`, `inventory.low_stock`, `product.created|updated|deleted`, `purchase_order.created|status_changed`, `sales_order.created|status_changed` (o `*`).

Cada envío es un `POST` JSON `{ id, event, companyId, createdAt, data }` con las cabeceras `X-Webhook-Event`, `X-Webhook-Id`, `X-Webhook-Timestamp` y `X-Webhook-Signature`. Para verificar la firma:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
// compare expected con la cabecera X-Webhook-Signature (use timingSafeEqual)
```

Responda con un código 2xx para confirmar la recepción; si no, se reintenta con espera exponencial (30 s, 1, 2, 4 y 8 min; hasta 6 intentos). Los envíos se guardan en una cola en PostgreSQL (`FOR UPDATE SKIP LOCKED`), por lo que sobreviven a reinicios y funcionan con varias instancias de la API.

### Endpoints principales

| Recurso | Endpoints |
|---|---|
| Autenticación | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/switch-company` · `POST /auth/logout` · `POST /auth/logout-all` · `GET /auth/me` · `PATCH /auth/me/password` |
| Empresa y sucursales | `GET/PATCH /company` · `GET/POST /branches` · `GET/PATCH/DELETE /branches/:id` |
| Productos | `GET/POST /products` · `GET/PATCH/DELETE /products/:id` · `GET /products/:id/movements` · `GET /products/lookup?code=` · `GET /products/export` · `POST /products/import` |
| Inventario | `GET /inventory/stock` · `GET /inventory/movements` · `GET /inventory/movements/export` · `POST /inventory/entries` · `POST /inventory/exits` · `POST /inventory/transfers` · `POST /inventory/adjustments` |
| Órdenes de compra | `GET/POST /purchase-orders` · `GET/PUT/DELETE /purchase-orders/:id` · `POST /:id/order` · `POST /:id/receive` · `POST /:id/cancel` |
| Órdenes de venta | `GET/POST /sales-orders` · `GET/PUT/DELETE /sales-orders/:id` · `POST /:id/confirm` · `POST /:id/fulfill` · `POST /:id/cancel` |
| Maestros | `/categories` · `/warehouses` · `/suppliers` · `/customers` (CRUD completo) |
| Reportes | `/reports/dashboard` · `/reports/low-stock` · `/reports/valuation` · `/reports/movements-summary` · `/reports/top-products` · `/reports/sales-summary` |
| Administración | `/users` · `/api-keys` · `/webhooks` · `/audit-logs` |
| Plataforma | `GET/POST /companies` · `GET/PATCH /companies/:id` |
| Sistema | `GET /health` |

La lista completa con esquemas, ejemplos y la opción de probar cada endpoint está en **Swagger UI** (`/api/docs`).

---

## 🎨 Diseño visual

La interfaz usa el sistema de diseño de **HGV Human Technology** ("Enterprise HCM Nexus"):

| Rol | Color | Uso |
|---|---|---|
| Midnight Navy | `#0B192C` / `#1E3E62` | Barra de navegación, panel KPI destacado, login |
| Electric Azure | `#008DDA` / `#00A9FF` | Estados interactivos, foco, enlaces, selección, series de datos |
| Solar Orange | `#FF6500` / `#F58220` | Acciones principales (CTA), pendientes y alertas |
| Neutros slate | `#F8FAFC` → `#0F172A` | Superficies, bordes y texto |

Tipografías **Plus Jakarta Sans** (títulos y cifras) e **Inter** (texto y tablas). Todos los tokens (colores, sombras, series de gráficos) están centralizados en [`frontend/src/index.css`](frontend/src/index.css); los gráficos los leen en tiempo de ejecución, así que se adaptan también al modo oscuro.

## 🗂️ Estructura del proyecto

```
.
├── backend/
│   ├── prisma/                 # schema.prisma, migraciones y seed
│   ├── src/
│   │   ├── config/env.ts       # variables de entorno validadas con Zod
│   │   ├── docs/               # registro OpenAPI
│   │   ├── lib/                # router tipado, errores, paginación, auditoría, CSV…
│   │   ├── middleware/         # autenticación/autorización y manejo de errores
│   │   ├── modules/            # un módulo por dominio (auth, products, inventory, …)
│   │   ├── app.ts              # composición de Express (seguridad, logs, docs, rutas)
│   │   └── server.ts           # arranque y apagado ordenado
│   └── tests/                  # pruebas de integración contra PostgreSQL real
├── frontend/
│   └── src/
│       ├── components/         # UI reutilizable, CrudPage genérico, editor de ítems
│       ├── hooks/              # acceso a la API con TanStack Query
│       ├── lib/                # cliente HTTP con renovación automática de token, auth, formatos
│       └── pages/              # dashboard, productos, movimientos, órdenes, reportes, admin…
├── docs/openapi.json           # especificación exportada
├── docker-compose.yml
└── .github/workflows/ci.yml
```

Cada endpoint se declara **una sola vez** con `ApiRouter`: el mismo esquema Zod valida la petición, tipa el handler, aplica el rol mínimo y genera la documentación OpenAPI, por lo que la documentación nunca se desincroniza del código.

---

## 🧪 Pruebas y calidad

```bash
cd backend
createdb inventario_test       # base de datos exclusiva para pruebas (ver .env.test)
npm test                       # 46 pruebas de integración
npm run lint && npm run typecheck

cd ../frontend
npm run lint && npm run build
```

Las pruebas cubren: **aislamiento entre empresas**, **restricción por sucursal**, cambio de empresa, usuarios compartidos entre empresas, autenticación y rotación de tokens, permisos por rol, API keys, RUT, IVA y exentos, **reservas de stock**, **salidas concurrentes**, webhooks firmados con reintentos, costo promedio, transferencias, ajustes, ciclos completos de órdenes de compra y venta, reportes, CSV y OpenAPI.

---

## ⚙️ Variables de entorno (backend)

| Variable | Descripción | Por defecto |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL | — |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secretos (mín. 32 caracteres) | — |
| `JWT_ACCESS_EXPIRES_IN` | Vigencia del access token | `15m` |
| `JWT_REFRESH_EXPIRES_DAYS` | Vigencia del refresh token | `7` |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma | `http://localhost:5173` |
| `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` | Peticiones por ventana (general / login) | `1000` / `20` |
| `TAX_RATE` | IVA por defecto para empresas nuevas (%) | `19` |
| `MONEY_DECIMALS` | Decimales de los montos (0 para CLP) | `0` |
| `CURRENCY` | Moneda | `CLP` |
| `WEBHOOKS_ENABLED` | Activa el worker de envío de webhooks | `true` |
| `LOG_LEVEL` | Nivel de logs (pino) | `info` |

## 📌 Notas de producción

- Sirva la aplicación detrás de **HTTPS** (la cookie de refresh es `Secure` en producción).
- Use secretos JWT largos y aleatorios, y una contraseña de base de datos robusta.
- Las migraciones se aplican automáticamente al iniciar el contenedor (`prisma migrate deploy`).
- Los productos se eliminan de forma lógica (conservan su historial); su SKU queda reservado y puede reactivarse vía importación.
- La migración a multiempresa conserva los datos existentes: se asignan a una "Empresa principal" con una sucursal "Casa Matriz", los roles de cada usuario pasan a su membresía y los administradores existentes quedan como administradores de plataforma. Edite el RUT de esa empresa después de migrar.

## Licencia

MIT
