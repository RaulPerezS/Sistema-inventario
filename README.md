# 📦 Sistema de Inventario

Sistema web completo para la gestión de inventario multi-almacén, con **API REST documentada** lista para ser consumida por otros sistemas (ERP, e-commerce, POS, apps móviles) y un **panel web** moderno.

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

- **Catálogo**: productos (SKU, código de barras, costo, precio, stock mínimo/máximo), categorías jerárquicas, proveedores, clientes y almacenes.
- **Inventario multi-almacén**: entradas, salidas, **transferencias** entre almacenes y **ajustes por conteo físico**.
- **Kardex** completo por producto (cada movimiento guarda el saldo resultante, usuario y referencia).
- **Costo promedio ponderado** recalculado automáticamente en cada entrada con costo.
- **Órdenes de compra**: borrador → emitida → recepción parcial/total (genera stock).
- **Órdenes de venta**: borrador → confirmada (valida stock) → despachada (descuenta stock).
- **Reportes**: dashboard de KPIs, stock bajo con **sugerencia de reposición**, valorización por categoría/almacén, productos con mayor salida, ventas por día, resumen de movimientos.
- **Exportación CSV** (productos y movimientos) e **importación masiva** de productos (upsert por SKU).
- **Búsqueda por código de barras / SKU** (`/products/lookup`) para lectores.
- **Usuarios y roles**, **API keys** para integraciones y **bitácora de auditoría** de todas las operaciones.

### Garantías de consistencia
- Todas las operaciones de stock se ejecutan en **transacciones**; si un ítem falla, no se aplica ninguno.
- Las salidas usan un `UPDATE ... WHERE quantity >= n` atómico: **el stock nunca queda negativo**, incluso con peticiones concurrentes (cubierto por pruebas).
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

### Usuarios de demostración

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@inventario.local | Admin123! |
| Gerente | gerente@inventario.local | Gerente123! |
| Operador | operador@inventario.local | Operador123! |
| Consulta | consulta@inventario.local | Consulta123! |

---

## 🔐 Roles y permisos

Los roles son jerárquicos: cada uno incluye los permisos de los anteriores.

| Rol | Puede |
|---|---|
| `VIEWER` | Consultar todo: catálogo, stock, movimientos, órdenes y reportes |
| `OPERATOR` | + registrar entradas, salidas y transferencias; crear/confirmar/despachar ventas; recibir compras |
| `MANAGER` | + gestionar catálogo y maestros, ajustes de inventario, órdenes de compra |
| `ADMIN` | + usuarios, API keys, auditoría y eliminación de almacenes |

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
# → { accessToken, refreshToken, user, ... }

# Usar el token
curl http://localhost:4000/api/v1/products?search=laptop \
  -H "Authorization: Bearer <accessToken>"

# Renovar (el refresh token rota en cada uso; reutilizar uno viejo revoca todas las sesiones)
curl -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'
```

### 2. Sistemas externos (API key)

Un administrador crea la clave en **Administración → API Keys** (o `POST /api-keys`), elige sus permisos (hasta `MANAGER`) y opcionalmente una fecha de expiración.

```bash
# Consultar stock desde un e-commerce
curl "http://localhost:4000/api/v1/inventory/stock?search=LAP-001" \
  -H "X-API-Key: inv_xxxxxxxxxxxxxxxx"

# Registrar una salida desde un POS
curl -X POST http://localhost:4000/api/v1/inventory/exits \
  -H "X-API-Key: inv_xxxxxxxxxxxxxxxx" -H "Content-Type: application/json" \
  -d '{"warehouseId":"<uuid>","reference":"TICKET-8812","items":[{"productId":"<uuid>","quantity":2}]}'
```

### Endpoints principales

| Recurso | Endpoints |
|---|---|
| Autenticación | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/logout-all` · `GET /auth/me` · `PATCH /auth/me/password` |
| Productos | `GET/POST /products` · `GET/PATCH/DELETE /products/:id` · `GET /products/:id/movements` · `GET /products/lookup?code=` · `GET /products/export` · `POST /products/import` |
| Inventario | `GET /inventory/stock` · `GET /inventory/movements` · `GET /inventory/movements/export` · `POST /inventory/entries` · `POST /inventory/exits` · `POST /inventory/transfers` · `POST /inventory/adjustments` |
| Órdenes de compra | `GET/POST /purchase-orders` · `GET/PUT/DELETE /purchase-orders/:id` · `POST /:id/order` · `POST /:id/receive` · `POST /:id/cancel` |
| Órdenes de venta | `GET/POST /sales-orders` · `GET/PUT/DELETE /sales-orders/:id` · `POST /:id/confirm` · `POST /:id/fulfill` · `POST /:id/cancel` |
| Maestros | `/categories` · `/warehouses` · `/suppliers` · `/customers` (CRUD completo) |
| Reportes | `/reports/dashboard` · `/reports/low-stock` · `/reports/valuation` · `/reports/movements-summary` · `/reports/top-products` · `/reports/sales-summary` |
| Administración | `/users` · `/api-keys` · `/audit-logs` |
| Sistema | `GET /health` |

La lista completa con esquemas, ejemplos y la opción de probar cada endpoint está en **Swagger UI** (`/api/docs`).

---

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
npm test                       # 25 pruebas de integración
npm run lint && npm run typecheck

cd ../frontend
npm run lint && npm run build
```

Las pruebas cubren: autenticación y rotación de tokens, permisos por rol, API keys, CRUD, costo promedio, transferencias, ajustes, **salidas concurrentes**, ciclos completos de órdenes de compra y venta, reportes, CSV y OpenAPI.

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
| `LOG_LEVEL` | Nivel de logs (pino) | `info` |

## 📌 Notas de producción

- Sirva la aplicación detrás de **HTTPS** (la cookie de refresh es `Secure` en producción).
- Use secretos JWT largos y aleatorios, y una contraseña de base de datos robusta.
- Las migraciones se aplican automáticamente al iniciar el contenedor (`prisma migrate deploy`).
- Los productos se eliminan de forma lógica (conservan su historial); su SKU queda reservado y puede reactivarse vía importación.

## Licencia

MIT
