# Automatización Financiera Zoho · Pago Express

Portal de pagos para que los clientes consulten su deuda mediante el RUT y paguen **el total pendiente** o **solo las facturas vencidas**, utilizando Khipu y registrando el resultado en Zoho Books.

Zoho Books es la fuente de información comercial. El backend conserva una base operativa con clientes, documentos, pagos, intentos y eventos para controlar el proceso, impedir aplicaciones duplicadas y atender incidencias.

> **Estado al 17 de noviembre de 2026:** versión desplegada en MochaHost según confirmación del equipo. El desarrollo funcional y las validaciones locales de los bloques entregados están completados. **La prueba integral final en el hosting, a cargo del responsable de la empresa, sigue pendiente.** El despliegue por sí solo no constituye una aprobación de operación con clientes.
>
> Este README integra la documentación del proyecto y la guía de cPanel/CloudLinux recibida del equipo. Las rutas de servidor y dominios de ejemplo deben contrastarse con la instalación efectiva. No contiene credenciales ni acredita una inspección directa del hosting.

## Contenido

- [Funcionalidades y alcance](#funcionalidades-y-alcance)
- [Arquitectura y flujo](#arquitectura-y-flujo)
- [Tecnologías](#tecnologías)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación local](#instalación-local)
- [Variables de entorno](#variables-de-entorno)
- [Estados y modelo de datos](#estados-y-modelo-de-datos)
- [API y rutas del portal](#api-y-rutas-del-portal)
- [Validación y pruebas](#validación-y-pruebas)
- [Operación y recuperación](#operación-y-recuperación)
- [Despliegue en MochaHost y cPanel](#despliegue-en-mochahost-y-cpanel)
- [Criterio de liberación](#criterio-de-liberación)
- [Mantenimiento y diagnóstico](#mantenimiento-y-diagnóstico)
- [Personalización visual](#personalización-visual)
- [Límites conocidos](#límites-conocidos)
- [Referencias](#referencias)

## Funcionalidades y alcance

### Portal del cliente

- Consulta de deuda mediante RUT, con validación y normalización del identificador.
- Visualización del monto pendiente y del monto vencido.
- Selección entre **pagar deuda total** y **pagar solo deuda vencida**.
- Creación o reutilización controlada de un cobro y redirección al checkout de Khipu.
- Retorno al portal después del checkout, consulta del resultado y actualización de estado.
- Cancelación del cobro según su estado y las comprobaciones del backend.
- Mensajes específicos para pagos pendientes, confirmados, cancelados y casos en revisión.
- Resumen descargable del pago confirmado. Este resumen del portal no sustituye un comprobante bancario ni un documento tributario.
- Diseño adaptable y footer corporativo compartido entre Pago Express, resultado y checkout Mock.

### Integraciones y controles

- Consulta de clientes y facturas en Zoho Books, incluyendo control de paginación y rechazo de lecturas incompletas.
- Uso del **saldo pendiente** de cada factura; una factura parcialmente pagada no vuelve a cobrarse por su total original.
- Selección de vencidas usando el día civil de `America/Santiago`: una factura que vence hoy todavía no cuenta como vencida.
- Reservas de pago y comprobaciones transaccionales para impedir cobros activos superpuestos sobre las mismas facturas.
- Confirmación de Khipu mediante webhook firmado y verificación contra su API.
- Procesamiento idempotente de confirmaciones repetidas.
- Registro de pagos en Books con prevalidación de facturas y reserva persistente del intento de envío.
- Conciliación de envíos inciertos mediante consulta de evidencia existente, sin repetir el cobro ni crear otro pago remoto.
- Diagnóstico y resolución administrativa acotada de conflictos, con historial del operador y del incidente.

## Arquitectura y flujo

```mermaid
flowchart TD
    Cliente["Navegador del cliente"] --> Portal["Frontend React"]
    Portal --> API["Backend NestJS"]
    API --> DB["MySQL / MariaDB"]
    API --> Zoho["Zoho Books"]
    API --> Khipu["Khipu"]
    Portal --> Khipu
    Khipu -->|Webhook firmado| API
```

1. El cliente introduce su RUT en el portal.
2. El backend consulta la fuente configurada. En operación con Zoho, obtiene los datos comerciales y actualiza la representación local cuando la lectura es completa.
3. El portal muestra deuda total y vencida. El backend vuelve a validar la selección y reserva los documentos al preparar el pago.
4. Khipu entrega una URL de checkout. Los datos bancarios se introducen en la pasarela, no en el formulario del portal.
5. El backend valida la notificación de Khipu y consulta la información del proveedor antes de aplicar la confirmación. El navegador también puede solicitar actualización de estado.
6. La confirmación actualiza el pago y los documentos locales de forma controlada y deja eventos e intentos de auditoría.
7. Si la escritura y la sincronización automática están activadas, se intenta registrar el pago en Books con su referencia y sus facturas.
8. Ante un resultado incierto o un conflicto, se conserva evidencia y se bloquean las acciones que podrían producir un duplicado.

**`PAID` no significa necesariamente `SYNCED`.** El cobro puede estar confirmado en el portal y continuar pendiente de registro o revisión en Books. Volver del checkout tampoco constituye, por sí solo, prueba de pago.

La base operativa no es una copia descartable de Zoho: contiene reservas, estados e historial necesarios para prevenir duplicados y reconstruir incidentes. No eliminar registros de producción para desbloquear una prueba.

## Tecnologías

| Capa                       | Tecnología utilizada                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| Frontend                   | React 19, TypeScript, Vite 8, React Router, Material UI                       |
| Formularios y consultas    | React Hook Form, Zod, TanStack Query                                          |
| Estilos                    | Tema MUI, Montserrat y assets corporativos CLS                                |
| Backend                    | NestJS 11, Node.js, TypeScript                                                |
| Persistencia               | Prisma ORM 6; cliente generado 6.19.3 en las validaciones compartidas         |
| Base local                 | MySQL                                                                         |
| Base en la guía de hosting | MariaDB, mediante el conector Prisma `mysql`                                  |
| Pagos                      | Khipu: API o simulación Mock local                                            |
| Información comercial      | Zoho Books, OAuth y organización configurada                                  |
| Publicación                | MochaHost, cPanel, CloudLinux Node.js Selector / Passenger; frontend estático |

Los `package.json` y `package-lock.json` de cada aplicación son la referencia para las dependencias exactas. No actualizar Node, Prisma o librerías a otra versión mayor durante un despliegue rutinario sin validar compatibilidad.

Vite 8 requiere Node.js 20.19+ o 22.12+. Para reproducir la guía de hosting, seleccionar **Node 22.12 o superior dentro de una versión compatible disponible**, y registrar la versión realmente usada. Los scripts administrativos utilizan `node --env-file`.

## Estructura del proyecto

Mapa de los componentes principales; no es un inventario exhaustivo:

```text
backend/
  prisma/
    schema.prisma
    migrations/
  src/
    main.ts
    app.module.ts
    config/
    common/
    health/
    prisma/
    modules/
      customer-data/
      customers/
      documents/
      debts/
      payment-express/
      payments/
      khipu/
      webhooks/khipu-webhook/
      zoho/
        utils/
      integrations/
  scripts/
    payment-recovery.cjs
    payment-recovery-policy.cjs
    payment-review.cjs
    payment-review-resolution.cjs
    resolve-payment-review.cjs
  test/
frontend/
  src/
    api/
    assets/
    features/
      payment-express/
      payment-result/
      mock-khipu/
    router/AppRouter.tsx
    shared/
      components/CorporateFooter.tsx
      config/companyFooter.ts
      layouts/PortalLayout.tsx
      utils/
    theme/
probar-*.ps1
README.md
```

Los scripts `probar-*.ps1` son verificaciones por bloque. No todos tienen el mismo alcance: algunos son aislados; otros crean datos sintéticos en una base local. Consultar [Validación y pruebas](#validación-y-pruebas) antes de ejecutarlos.

## Instalación local

### Requisitos

- Git y Node.js compatible con los lockfiles del proyecto.
- MySQL disponible y una base local separada de producción.
- Acceso a Zoho/Khipu únicamente si se van a probar integraciones externas.
- Dos terminales para backend y frontend.

### Backend

Desde `backend/`:

```bash
npm ci
```

Crear `backend/.env` con los valores de desarrollo descritos más abajo. Si el repositorio incluye una plantilla `.env.example`, usarla como base y completar los campos requeridos.

Verificar que `DATABASE_URL` corresponda a la base local antes de ejecutar:

```bash
npx prisma validate
npm run prisma:generate
npm run prisma:migrate:deploy
npx prisma migrate status
npm run start:dev
```

`prisma:migrate:deploy` aplica las migraciones ya versionadas. Para **crear cambios de esquema durante desarrollo**, existe `npm run prisma:migrate:dev`; revisar y versionar el SQL generado. No ejecutar ese flujo sobre producción.

La API local suele estar en `http://localhost:3000/api`. Los datos de demostración no se cargan automáticamente mediante estas instrucciones. No ejecutar un seed desconocido sobre una base con datos.

### Frontend

Desde `frontend/`:

```bash
npm ci
```

Crear el archivo de entorno de desarrollo correspondiente:

```dotenv
VITE_API_URL=http://localhost:3000/api
```

Arrancar el frontend:

```bash
npm run dev
```

Abrir la URL que indique Vite, habitualmente `http://localhost:5173`.

### Compilación

Desde `backend/`:

```bash
npm run build
```

Desde `frontend/`:

```bash
npm run build
```

El frontend se publica desde `frontend/dist/`. El backend se ejecuta desde su salida compilada; comprobar si el punto de entrada es `dist/main.js` o `dist/src/main.js` en la versión desplegada.

## Variables de entorno

Los ejemplos siguientes contienen marcadores, no credenciales utilizables. No versionar `.env`, tokens, claves API ni salidas de diagnóstico con información sensible.

### API, datos y URLs

| Variable                 | Uso                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `development`, `test` o `production`. Afecta las herramientas de diagnóstico y las restricciones Mock.                              |
| `PORT`                   | Puerto de desarrollo o valor compatible con el arranque del hosting. Respetar el contrato de Passenger y la validación del backend. |
| `API_PREFIX`             | Prefijo de NestJS; el proyecto está integrado con `api`. No agregar espacios.                                                       |
| `DATABASE_URL`           | Conexión Prisma con formato `mysql://usuario:clave@host:puerto/base`.                                                               |
| `CUSTOMER_DATA_SOURCE`   | `local` para datos locales o `zoho` para consulta y actualización desde Books.                                                      |
| `CORS_ALLOWED_ORIGINS`   | Orígenes permitidos separados por comas. El primer origen también se utiliza para formar los retornos al frontend.                  |
| `PUBLIC_BACKEND_URL`     | Base pública usada para construir el webhook. Revisar la composición explicada abajo.                                               |
| `INTEGRATIONS_ADMIN_KEY` | Clave hexadecimal de 64 caracteres para herramientas de integración en desarrollo/test. Nunca enviar al frontend.                   |
| `VITE_API_URL`           | Base de API usada por el frontend; se incorpora al bundle durante el build.                                                         |

**Composición de URLs en el código entregado:**

```text
notify_url = PUBLIC_BACKEND_URL + /api/webhooks/khipu/real
return_url = primer CORS_ALLOWED_ORIGINS + /pago-express/resultado/:paymentId
cancel_url = return_url + ?cancelled=1
```

Para una API publicada en `https://pagos.example.com/api`, la base correspondiente a esa composición es `PUBLIC_BACKEND_URL=https://pagos.example.com`, **sin** `/api`. `VITE_API_URL`, en cambio, sí incluye `/api`.

La guía inicial de hosting incluía `/api` dentro de `PUBLIC_BACKEND_URL`; aplicada sin adaptación a esta implementación produciría `/api/api/webhooks/khipu/real`. Si el arranque o el proxy se adaptaron durante el despliegue, verificar la URL final efectiva antes de cambiar una configuración funcional.

`FRONTEND_URL` apareció en configuraciones iniciales, pero los servicios revisados construyen estos retornos con `CORS_ALLOWED_ORIGINS`. No asumir que cambiar solo `FRONTEND_URL` modifica los enlaces.

### Zoho Books

| Variable                          | Uso                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `ZOHO_CLIENT_ID`                  | Identificador OAuth.                                                                          |
| `ZOHO_CLIENT_SECRET`              | Secreto OAuth.                                                                                |
| `ZOHO_REFRESH_TOKEN`              | Token de renovación OAuth.                                                                    |
| `ZOHO_ORGANIZATION_ID`            | Organización de Books utilizada por la integración.                                           |
| `ZOHO_ACCOUNTS_BASE_URL`          | Endpoint OAuth de la región de la cuenta. Ejemplo: `https://accounts.zoho.com`.               |
| `ZOHO_BOOKS_BASE_URL`             | Base de API Books de esa región. Ejemplo: `https://www.zohoapis.com/books/v3`.                |
| `ZOHO_CUSTOMER_PAYMENT_MODE`      | Modo contable del pago, usado en el proyecto como `banktransfer`.                             |
| `ZOHO_WRITE_PAYMENTS_ENABLED`     | `true` permite escribir pagos en Books; `false` mantiene el ensayo sin envío.                 |
| `ZOHO_AUTO_SYNC_PAYMENTS_ENABLED` | `true` habilita el intento de sincronización automática después de confirmar el pago.         |
| `ZOHO_PAYMENT_RUT_MODE`           | `all` o `allowlist`. Ausente conserva `allowlist`; vacío o desconocido no habilita escritura. |
| `ZOHO_PAYMENT_ALLOWED_RUTS`       | Lista de RUT separados por comas, utilizada únicamente en `allowlist`.                        |

Las URL de Zoho deben coincidir con la región de la cuenta y los permisos del token. Un acceso correcto a una operación no acredita permisos para todas las demás.

#### Apertura de clientes

| Configuración                           | Comportamiento del filtro de sincronización                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ZOHO_PAYMENT_RUT_MODE=all`             | No restringe por la lista de RUT. Mantiene todas las validaciones del pago y sus facturas. |
| `ZOHO_PAYMENT_RUT_MODE=allowlist`       | Solo permite RUT presentes en `ZOHO_PAYMENT_ALLOWED_RUTS`.                                 |
| Selector ausente                        | Aplica `allowlist`.                                                                        |
| `allowlist` y lista vacía               | No permite sincronizar ningún cliente.                                                     |
| Selector vacío, `*`, `ALL` u otro valor | Rechaza el envío por configuración inválida.                                               |

**Esta política filtra la escritura en Books, no el acceso al portal ni la creación del cobro en Khipu.** Volver a una lista restringida no cierra la pasarela a otros clientes. Tampoco basta con apagar la escritura de Zoho para detener cobros.

### Khipu

| Variable                                | Uso                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `KHIPU_PROVIDER`                        | `mock` para simulación local o `real` para usar la API.                                                    |
| `KHIPU_BASE_URL`                        | Base de API configurada, utilizada como `https://payment-api.khipu.com/v3`.                                |
| `KHIPU_AUTH_MODE`                       | `api_key` en la integración usada; el servicio conserva una alternativa `basic`.                           |
| `KHIPU_API_KEY`                         | Credencial del modo `api_key`.                                                                             |
| `KHIPU_RECEIVER_ID`, `KHIPU_SECRET_KEY` | Credenciales requeridas por la alternativa de autenticación correspondiente.                               |
| `KHIPU_NOTIFY_API_VERSION`              | Versión de notificación, `3.0` en el flujo implementado.                                                   |
| `KHIPU_WEBHOOK_SECRET`                  | Secreto con el que se verifica la firma de la notificación.                                                |
| `KHIPU_VALIDATE_WEBHOOK_SIGNATURE`      | Variable histórica. La ruta real entregada exige firma siempre; no utilizarla para omitir la verificación. |

`KHIPU_PROVIDER=real` significa **usar la API**. No distingue DemoBank de cobros bancarios productivos: esa distinción depende de la cuenta/credenciales del proveedor. Un identificador sin prefijo `mock_` no prueba que se haya movido dinero real.

### Perfiles de ejemplo

Desarrollo local sin envío a proveedores:

```dotenv
NODE_ENV=development
PORT=3000
API_PREFIX=api
DATABASE_URL=mysql://USUARIO_LOCAL:CLAVE_CODIFICADA@localhost:3306/BASE_LOCAL
CORS_ALLOWED_ORIGINS=http://localhost:5173
PUBLIC_BACKEND_URL=http://localhost:3000
CUSTOMER_DATA_SOURCE=local
KHIPU_PROVIDER=mock
ZOHO_WRITE_PAYMENTS_ENABLED=false
ZOHO_AUTO_SYNC_PAYMENTS_ENABLED=false
ZOHO_PAYMENT_RUT_MODE=allowlist
ZOHO_PAYMENT_ALLOWED_RUTS=
```

La consulta real a Books puede probarse con `CUSTOMER_DATA_SOURCE=zoho` y sus credenciales, manteniendo ambas escrituras desactivadas. Para recibir webhooks durante desarrollo local se necesita una URL HTTPS accesible desde Khipu, por ejemplo un túnel autorizado. El túnel no es necesario cuando el backend ya está publicado con HTTPS.

Configuración de apertura general, **después de desplegar el código que reconoce `ZOHO_PAYMENT_RUT_MODE`**:

```dotenv
NODE_ENV=production
API_PREFIX=api
CUSTOMER_DATA_SOURCE=zoho
KHIPU_PROVIDER=real
KHIPU_AUTH_MODE=api_key
KHIPU_NOTIFY_API_VERSION=3.0
ZOHO_CUSTOMER_PAYMENT_MODE=banktransfer
ZOHO_WRITE_PAYMENTS_ENABLED=true
ZOHO_AUTO_SYNC_PAYMENTS_ENABLED=true
ZOHO_PAYMENT_RUT_MODE=all
ZOHO_PAYMENT_ALLOWED_RUTS=
```

Completar por separado la base de datos, credenciales, URLs y el puerto/arranque del hosting. No copiar el `.env` local sobre producción. Los valores `true`/`false` deben ser los literales esperados por el código.

## Estados y modelo de datos

### Estado del pago

| Estado        | Interpretación operativa                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `CREATED`     | Registro/reserva inicial del cobro. Un error de comunicación puede dejar pendiente determinar si el proveedor lo creó. |
| `PENDING`     | Cobro pendiente.                                                                                                       |
| `IN_PROGRESS` | Pago en procesamiento/verificación.                                                                                    |
| `PAID`        | Pago confirmado localmente. Revisar por separado su sincronización con Books.                                          |
| `CANCELLED`   | Cancelación registrada. Una confirmación tardía requiere las comprobaciones previstas.                                 |
| `EXPIRED`     | Pago expirado localmente; no descartar automáticamente una confirmación tardía del proveedor.                          |
| `FAILED`      | Fallo registrado; no implica por sí solo ausencia de movimiento remoto.                                                |

`confirmationReviewRequired=true` conserva un bloqueo por conflicto de confirmación, junto con `confirmationReviewReason`. La UI puede presentar `REVIEW_REQUIRED`, pero **no es un nuevo valor del enum `PaymentStatus`**: es una presentación derivada de esa bandera.

### Sincronización con Zoho

| Estado            | Interpretación                                                                |
| ----------------- | ----------------------------------------------------------------------------- |
| `NOT_SYNCED`      | Sin sincronización finalizada. Revisar evidencia del intento antes de enviar. |
| `DRY_RUN_READY`   | Ensayo preparado, sin acreditar un envío real.                                |
| `SENDING`         | Intento reservado. Puede estar activo o haberse interrumpido; no reenviar.    |
| `SYNCED`          | Confirmación local del registro en Books, con identificador remoto.           |
| `REVIEW_REQUIRED` | Resultado incierto que exige conciliación/revisión.                           |
| `FAILED`          | Fallo de registros anteriores; requiere inspección individual.                |

Los identificadores de intento, organización, fecha de inicio, payload persistido e identificadores remotos son evidencia de recuperación. No borrarlos para habilitar otro envío.

### Entidades principales

| Entidad Prisma / tabla                    | Contenido                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `Customer` / `customers`                  | RUT, referencia de cliente Zoho y datos comerciales locales.                |
| `CustomerDocument` / `customer_documents` | Factura, vencimiento, moneda, total, saldo y referencia Zoho.               |
| `Payment` / `payments`                    | Cobro, selección, estado, ID Khipu, revisión y evidencia de sincronización. |
| `PaymentDocument` / `payment_documents`   | Facturas incluidas y monto aplicado por el pago.                            |
| `PaymentAttempt` / `payment_attempts`     | Historial de intentos y transiciones.                                       |
| `PaymentEvent` / `payment_events`         | Eventos recibidos/procesados y auditoría de conciliación o resolución.      |

Los intentos anteriores `PENDING` se conservan como historial aunque después exista uno `PAID` o `CANCELLED`. No interpretar cada fila histórica como el estado actual del pago.

## API y rutas del portal

Con `API_PREFIX=api`, las principales operaciones son:

| Método | Ruta                                            | Finalidad                                                                               |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST` | `/api/payment-express/summary`                  | Consultar deuda por RUT.                                                                |
| `POST` | `/api/payment-express/pay-total`                | Preparar pago de deuda total.                                                           |
| `POST` | `/api/payment-express/pay-overdue`              | Preparar pago de deuda vencida.                                                         |
| `GET`  | `/api/payment-express/result/:paymentId`        | Resultado público del pago.                                                             |
| `POST` | `/api/payments/:paymentId/refresh-khipu-status` | Actualizar el estado mediante el proveedor, sujeto a las reglas del pago.               |
| `POST` | `/api/payments/:paymentId/cancel`               | Solicitar cancelación controlada.                                                       |
| `POST` | `/api/webhooks/khipu/real`                      | Notificación firmada de Khipu.                                                          |
| `POST` | `/api/webhooks/khipu/mock-paid/:paymentId`      | Simulación restringida al entorno permitido.                                            |
| `GET`  | `/api/health`                                   | Estado básico de la API.                                                                |
| `GET`  | `/api/health/db`                                | Verificación de DB; en la implementación revisada **crea un registro** de comprobación. |

Las tres operaciones de Pago Express con cuerpo usan el DTO de RUT:

```json
{ "rut": "RUT_VALIDO_DEL_CLIENTE" }
```

El ejemplo es un marcador y no debe enviarse literalmente. El monto y las facturas se determinan en el backend, no se aceptan como autoridad desde el navegador. Los identificadores locales de pago son UUID; no confundirlos con el ID de Khipu.

Las herramientas `/api/integrations/*` utilizan `x-integrations-key` y solo están habilitadas en `development`/`test` en el guard entregado. Una respuesta `403` en producción es esperada, incluso con clave válida. No cambiar producción a desarrollo para usarlas: recurrir a los scripts administrativos autorizados.

Rutas React:

| Ruta                                 | Vista                          |
| ------------------------------------ | ------------------------------ |
| `/pago-express`                      | Consulta y selección de deuda. |
| `/pago-express/resultado/:paymentId` | Resultado y seguimiento.       |
| `/mock-khipu/checkout/:paymentId`    | Simulación local del checkout. |
| `/` y rutas no reconocidas           | Redirección a Pago Express.    |

`PortalLayout` incorpora el footer común. La pasarela externa de Khipu no utiliza ese layout.

## Validación y pruebas

### Compilación y análisis

Desde `backend/`:

```bash
npm run build
npx prisma validate
npx prisma migrate status
```

Desde `frontend/`:

```bash
npm run build
npm run lint
```

El backend incluye pruebas Jest (`npm test`) y suites de seguridad `.cjs` con el runner de Node. Son mecanismos distintos. El comando de lint histórico del backend se centra en archivos `.ts`; para scripts y tests `.cjs`, utilizar las invocaciones incluidas en los scripts de verificación.

Ejemplo de suites aisladas, desde `backend/` y después del build:

```bash
node --test test/zoho-rut-mode.safety.cjs test/zoho-preflight.safety.cjs test/zoho-reconciliation.safety.cjs test/zoho-payment-shape.safety.cjs
node --test test/payment-recovery.safety.cjs test/payment-review.safety.cjs test/payment-review-resolution.safety.cjs
```

No usar un patrón indiscriminado para ejecutar todos los `.cjs`: existen archivos que prueban una base de datos local y generan registros.

### Verificaciones por bloque

Ejecutar los `.ps1` desde la raíz, no desde `backend/`:

| Script                              | Alcance                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `probar-compatibilidad-zoho.ps1`    | Build, lint y pruebas aisladas de formatos de Books y recuperación.                |
| `probar-recuperacion-operativa.ps1` | Pruebas y diagnóstico de base en modo lectura.                                     |
| `probar-cierre-operativo.ps1`       | Diagnóstico de un caso y generación de `resultado-cierre-operativo.json`.          |
| `probar-resolucion-operativa.ps1`   | Build, lint, pruebas aisladas y tres pruebas MySQL con datos sintéticos.           |
| `probar-apertura-clientes.ps1`      | Política `all`/`allowlist`, prevalidación y conciliación, sin DB ni APIs reales.   |
| `probar-beta-local.ps1`             | Integración local de total/vencidas, reservas y confirmaciones Mock.               |
| `probar-confirmacion-tardia.ps1`    | Validación de confirmaciones tardías y conflictos, incluyendo casos MySQL locales. |

Ejemplo:

```powershell
.\probar-apertura-clientes.ps1
```

Si Windows bloquea la ejecución, revisar la procedencia del archivo y la política del equipo con el responsable correspondiente. No cambiar globalmente las políticas de ejecución para instalar el proyecto.

Las pruebas MySQL entregadas exigen entorno de desarrollo/test, host local y escritura/sincronización Zoho desactivadas. Crean y conservan datos sintéticos. **No ejecutarlas en la base del hosting.** Los scripts aislados no acreditan conectividad real, permisos OAuth o comportamiento de Passenger.

### Evidencia acumulada

Durante el desarrollo se verificaron consultas, selección total/vencidas, reservas superpuestas, cancelación, repeticiones de confirmación, webhook, prevalidación de Books, conciliación, aislamiento por organización y recuperación. Se reportó una prueba local completa con DemoBank y una prueba controlada de registro en Books.

El reporte de resolución operativa compartido termina sin fallos y con la marca final de pruebas completadas. Los recuentos de suites cambiaron a lo largo del proyecto; no sumar cifras de ejecuciones anteriores como si fueran pruebas independientes de una sola versión.

La apertura `all` se desplegó según lo informado por el equipo. La aprobación final debe basarse en el piloto del hosting y en el commit realmente instalado, no solo en estas verificaciones históricas.

## Operación y recuperación

### Principios

- Revisar primero el pago y su evidencia; no repetir una transferencia para corregir un fallo de sincronización.
- No reiniciar estados, quitar banderas ni borrar relaciones con SQL para desbloquear cobros.
- Conservar el ID local, el ID del proveedor, el momento del incidente y el resultado de cada intervención.
- Distinguir Mock, DemoBank y producción antes de autorizar una escritura en Books.
- Mantener un responsable técnico y uno de Finanzas para los casos que no puedan resolverse automáticamente.
- Los comandos se ejecutan desde `backend/` y requieren acceso autorizado al entorno y a sus secretos.

### Diagnóstico de solo lectura

```bash
node --env-file=.env scripts/payment-recovery.cjs --action plan
node --env-file=.env scripts/payment-review.cjs --id ID_LOCAL_UUID
```

El primer diagnóstico limita el listado y avisa si está truncado. El segundo muestra documentos, pagos relacionados, estados y evidencia seleccionada, sin consultar proveedores ni modificar registros. Sustituir los marcadores por valores reales antes de ejecutar.

`--env-file=.env` corresponde a una instalación con ese archivo privado. En un hosting que inyecta variables por el panel, utilizar el entorno efectivo autorizado y verificar cómo se carga para la terminal; no asumir que coincide con el del proceso web.

### Recuperación existente

| Acción           | Efecto posible                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `check-khipu`    | Consulta Khipu; puede confirmar localmente un pago compatible. No inicia automáticamente un envío a Books desde este recuperador. |
| `reconcile-zoho` | Consulta Books y puede registrar localmente una conciliación. No crea otro pago remoto.                                           |
| `send-zoho`      | **Puede crear un pago en Books.** Exige autorización, escritura habilitada y las validaciones/reserva del servicio.               |

Cada acción exige `--id` y `--confirm` con el mismo UUID. Ejemplo de consulta/recuperación autorizada:

```bash
node --env-file=.env scripts/payment-recovery.cjs --id ID_LOCAL_UUID --action check-khipu --confirm ID_LOCAL_UUID
```

Un plan anterior no garantiza que la acción siga permitida: se vuelve a leer el registro. `SENDING`, estados de revisión y evidencia de intentos anteriores impiden reenvíos indiscriminados. El estado Khipu `deleted` se informa sin alterar automáticamente el estado local.

### Resolución de confirmaciones en conflicto

Vista previa:

```bash
node --env-file=.env scripts/resolve-payment-review.cjs --id ID_LOCAL_UUID --action preview
```

Este comando **sí consulta Khipu**, pero no escribe en proveedores ni aplica cambios locales. La resolución está acotada a un único pago `done` y los demás relacionados `deleted`, con los registros en revisión, las mismas facturas, saldos exactos y ausencia de evidencia previa en Zoho.

Tras revisar el plan y obtener aprobación:

```bash
node --env-file=.env scripts/resolve-payment-review.cjs --id ID_LOCAL_UUID --action apply --confirm ID_LOCAL_UUID --plan HASH_DEL_PLAN --operator OPERADOR --ticket INCIDENTE
```

La aplicación vuelve a consultar al proveedor y verifica cambios concurrentes bajo bloqueos. Aplica el saldo una vez, deja `PAID` al confirmado, `CANCELLED` a los eliminados y registra la resolución. No ejecuta sincronización automática de Zoho. Conserva los eventos originales de revisión junto a los nuevos eventos de resolución.

### Inspección de un envío SENDING

```bash
node --env-file=.env scripts/resolve-payment-review.cjs --id ID_LOCAL_UUID --action inspect-sending --confirm ID_LOCAL_UUID --operator OPERADOR --ticket INCIDENTE
```

Puede dejar `SYNCED` localmente si Books contiene una coincidencia completa. No cambia `SENDING` a `NOT_SYNCED`, no presupone fracaso por antigüedad y no habilita reenvío si no encuentra el pago. La reserva se conserva mientras la evidencia sea insuficiente.

El nombre de operador y la referencia de incidente aportan auditoría, **no son un sistema de autenticación**. Restringir el acceso a la cuenta del servidor y a estos comandos.

### Casos que deben escalarse

Dos pagos confirmados para las mismas facturas, importes o documentos incompatibles, evidencia incompleta, cambios contables y fallos antiguos no se resuelven forzando estados. Finanzas decide el tratamiento; el responsable técnico conserva y contrasta la evidencia. El portal no implementa devoluciones ni compensaciones automáticas.

## Despliegue en MochaHost y cPanel

Esta sección incorpora y ajusta la guía de despliegue recibida el 17/11/2026, preparada originalmente el 13/11/2026. El equipo informa que la aplicación ya fue subida. **No recrear la aplicación, sus dominios o su base si ya existen.** Utilizar este procedimiento como referencia para mantener y reproducir el despliegue.

### 1. Registrar la configuración efectiva

Antes de una actualización, identificar en cPanel:

- Versión Node y comando de activación del entorno virtual.
- Application root, URL/montaje y archivo de inicio.
- Document root del frontend.
- Base y usuario de MariaDB/MySQL.
- Ubicación de logs y mecanismo de reinicio.
- Origen de variables de entorno: panel, archivo privado o ambos.
- Commit desplegado y copia funcional anterior.

No incluir contraseñas ni tokens en ese inventario versionado.

La guía usa `https://pagos.cunlogan.com` como ejemplo del frontend y `/api` como ruta de API. Confirmar esos valores con el despliegue real; la documentación recibida no los acreditaba como verificados.

### 2. Distribución de archivos

Ejemplo de organización:

```text
/home/USUARIO_CPANEL/apps/pagos-backend/  # Backend privado, Prisma y arranque
/home/USUARIO_CPANEL/public_html/pagos/  # Solo archivos públicos del frontend
```

El backend, sus variables y sus credenciales deben quedar fuera de `public_html`. Subir código fuente del backend, `prisma/` con migraciones, `package.json`, lockfile, configuración Nest/TypeScript y los scripts administrativos que se vayan a mantener. No publicar `.git`, `.env`, backups o informes financieros.

### 3. Base de datos y respaldos

Conservar la base existente. Para una instalación nueva, crear base/usuario desde la administración de bases de cPanel y asignar permisos apropiados. Prisma utiliza `provider = "mysql"` tanto para MySQL como para MariaDB.

```dotenv
DATABASE_URL=mysql://CUENTA_USUARIO:CLAVE_CODIFICADA@HOST:3306/CUENTA_BASE
```

Los caracteres reservados de las credenciales deben codificarse para una URL. Verificar prefijos de usuario/base y el host informado por el proveedor. Mantener el esquema de Prisma 6 del proyecto; no reemplazarlo por una plantilla de otra versión mayor.

Antes de cambios de esquema o actualizaciones que puedan afectar datos, disponer de un respaldo y de un procedimiento de restauración comprobado. Conservar la copia fuera de la raíz pública.

### 4. Node.js Selector y Passenger

En **Setup Node.js App**, utilizar la aplicación existente y una versión Node compatible. Si se configura una nueva, los campos de referencia son:

| Campo                 | Referencia                                             |
| --------------------- | ------------------------------------------------------ |
| Application mode      | Production                                             |
| Application root      | Ruta privada del backend                               |
| Application URL       | Dominio y ruta asignados realmente a la API            |
| Startup file          | Archivo de arranque verificado, habitualmente `app.js` |
| Environment variables | Configuración del backend y credenciales privadas      |

Activar en la terminal el entorno virtual mediante **el comando exacto que proporciona el panel**. No copiar una ruta de otro usuario ni instalar dependencias fuera de ese entorno.

Passenger administra el proceso. Conservar el arranque y el manejo de puerto que funcionaron en esta instalación: no imponer `PORT=3000` por ser el valor local, ni eliminar un `PORT` que la validación de la aplicación requiere. Verificar compatibilidad entre el valor del hosting, `env.validation.ts` y `app.listen(...)`.

No añadir PM2 como segundo administrador del mismo proceso ni mantener Vite como servidor productivo.

### 5. Instalar, generar y compilar backend

En la raíz privada del backend, con el entorno Node activado:

```bash
npm ci --include=dev
npm run prisma:generate
npm run build
```

Los paquetes de desarrollo son necesarios para compilar. `npm ci` requiere un lockfile coherente y puede entrar en conflicto con instalaciones donde CloudLinux administra `node_modules` como enlace. Si aparece ese caso, seguir el mecanismo del panel/proveedor; la guía original contempla `npm install --include=dev` dentro del entorno virtual. Registrar cualquier cambio del lockfile y no improvisar actualizaciones mayores.

Generar Prisma Client en el servidor o en un entorno compatible con él; no subir `node_modules` generado en Windows.

### 6. Migraciones versionadas

Tras verificar la base de destino y tener respaldo:

```bash
npm run prisma:migrate:deploy
npx prisma migrate status
```

El script existe en el `package.json` de backend revisado y ejecuta `prisma migrate deploy`. No usar `migrate dev`, `migrate reset`, borrado de tablas ni `db push` como procedimiento de actualización productiva. Revisar cada migración nueva antes de aplicarla.

### 7. Archivo de inicio y reinicio

Comprobar dónde quedó el arranque compilado:

```bash
find dist -name main.js
```

Si el backend CommonJS compila a `dist/main.js`, el ejemplo de archivo inicial es:

```js
"use strict";
require("./dist/main.js");
```

Si la salida es `dist/src/main.js`, adaptar esa ruta. **No reemplazar el archivo de arranque instalado si contiene adaptaciones necesarias de Passenger.** La ruta, formato de módulos y puerto deben coincidir con la versión real.

Después de configurar las variables, reiniciar la aplicación desde cPanel y revisar logs. Cambiar `.env` o subir archivos no garantiza que un proceso ya iniciado los haya recargado.

### 8. Frontend estático

Configurar en `frontend/.env.production` la URL pública efectiva de API:

```dotenv
VITE_API_URL=https://pagos.cunlogan.com/api
```

Desde `frontend/`:

```bash
npm ci
npm run build
```

Publicar **el contenido de `frontend/dist/`** en el document root del frontend. Las variables `VITE_` son públicas y quedan incorporadas en el build: no poner ahí secretos. Un cambio de `VITE_API_URL` exige recompilar y volver a publicar.

Conservar los archivos `.htaccess`/Passenger que correspondan a la instalación; no eliminarlos al reemplazar los assets.

### 9. React Router, API y prefijos

Para la SPA en Apache, el fallback debe permitir recargar rutas React, sin convertir llamadas a la API en `index.html`. Ejemplo de reglas para adaptar/integrar con las del hosting:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  # La API debe resolverse mediante el montaje/proxy de Node, no por la SPA.
  RewriteRule ^api(?:/|$) - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
```

La exclusión **no configura por sí sola** Passenger ni el proxy. Requiere que `/api` esté correctamente encaminado a Node. No reemplazar a ciegas las directivas que ya funcionan. Si frontend/API están en dominios separados, o la SPA vive bajo otra subruta, adaptar las reglas y los orígenes.

Verificar el resultado externo completo: el montaje de cPanel y `API_PREFIX=api` no deben producir rutas duplicadas o eliminar un segmento necesario. Revisar también la composición de `PUBLIC_BACKEND_URL` indicada en [Variables de entorno](#variables-de-entorno).

Una respuesta HTTP 200 con HTML del frontend en `/api/health` no es una respuesta correcta de la API: debe ser JSON.

### 10. Comprobación después de publicar

- Frontend y API accesibles por HTTPS.
- `/api/health` devuelve JSON del backend.
- Base conectada, Prisma generado y migraciones esperadas aplicadas.
- `/pago-express/resultado/:paymentId` puede recargarse sin 404 de Apache.
- `VITE_API_URL`, CORS, retorno/cancelación y webhook apuntan al dominio definitivo.
- No hay referencias a `localhost` o ngrok en las URLs de operación productiva.
- La ruta real del webhook conserva cuerpo original y exige firma.
- La cuenta/organización de Books y la cuenta Khipu corresponden al entorno autorizado.

La ruta `/api/health/db` escribe un registro en la implementación revisada. Usarla deliberadamente para verificar esa capacidad; no presentarla como una comprobación de solo lectura ni sondearla continuamente sin revisar su implementación.

## Criterio de liberación

La versión está desplegada, pero falta que el responsable complete y documente el piloto final. Registrar commit, fecha, operador e IDs de referencia, sin adjuntar secretos al repositorio.

- [ ] Build y pruebas de la versión final aprobados.
- [ ] Código del selector `ZOHO_PAYMENT_RUT_MODE` desplegado y proceso reiniciado.
- [ ] Para apertura general: `ZOHO_PAYMENT_RUT_MODE=all`, escritura y sincronización automáticas en `true`.
- [ ] Pago autorizado desde la URL pública y retorno correcto al portal.
- [ ] Webhook atendido por el backend definitivo.
- [ ] Pago local `PAID`, sin revisión pendiente y con `zohoSyncStatus=SYNCED`.
- [ ] Un único pago en Books, con cliente, moneda, monto y facturas correctos.
- [ ] Saldo restante correcto; en pago de vencidas no se alteran facturas no seleccionadas.
- [ ] Recargar el resultado no duplica el registro contable.
- [ ] Información corporativa y contacto aprobados; sin Lorem ipsum en la versión anunciada.
- [ ] Respaldo recuperable, logs y responsables técnico/Finanzas definidos.
- [ ] Secretos fuera del repositorio; cualquier credencial previamente expuesta revocada.
- [ ] Aprobación del responsable para habilitar la operación con clientes.

El piloto puede ejecutarse con la configuración definitiva `all` y lista vacía, sin cambiarla después. El cliente llamado “de prueba” puede generar un movimiento real si se usan credenciales de producción. Usar una operación aprobada y una factura con saldo válido, sin pagos anteriores pendientes de resolver.

Un piloto exitoso acredita ese recorrido y la configuración general, pero no garantiza que los datos de todos los clientes sean válidos. Los casos sin deuda, sin correspondencia de cliente o con inconsistencias seguirán sus validaciones habituales.

## Mantenimiento y diagnóstico

### Actualizaciones

1. Identificar el commit actual y conservar una versión funcional de aplicación y frontend.
2. Respaldar la base antes de cambios con impacto en datos/esquema.
3. Preparar el nuevo build y revisar sus migraciones.
4. Desplegar con el procedimiento del entorno Node y aplicar solo migraciones aprobadas.
5. Reiniciar, comprobar API/URLs e instalar el frontend compilado para ese entorno.
6. Documentar versión y resultado. Ante una incidencia, evaluar reversión del código junto con la compatibilidad del esquema; no asumir que deshacer una migración es inocuo.

Si se necesita detener el portal, usar un procedimiento de mantenimiento del acceso/creación de nuevos pagos que preserve la recepción de confirmaciones de cobros ya emitidos. Los flags de Zoho no constituyen un interruptor de cobro de Khipu.

### Síntomas frecuentes

| Síntoma                                      | Revisión                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `503` del hosting                            | Logs de Passenger, arranque, ruta compilada, Node y variables requeridas.             |
| `/api/*` devuelve HTML                       | Fallback de SPA y montaje de API.                                                     |
| `404` al recargar resultado                  | Reglas de React Router/Apache y document root.                                        |
| URL `/api/api/...`                           | Prefijo de Nest, montaje y composición de `PUBLIC_BACKEND_URL`.                       |
| Frontend llama al entorno anterior           | `VITE_API_URL`, recompilación y assets publicados.                                    |
| Error Prisma o columnas ausentes             | Cliente generado, migraciones, base de destino y reinicio.                            |
| Firma de webhook inválida                    | Secreto correcto, cuerpo original, cabecera y sincronización del reloj.               |
| `403` en integraciones con `production`      | Restricción esperada del guard; usar operación administrativa autorizada.             |
| Lectura de deuda incompleta                  | Respuesta/paginación/permisos de Books; no crear el pago con una lectura parcial.     |
| Factura vinculada a un `PAID`                | Revisar confirmación y sincronización previas, aunque no haya pagos `PENDING`.        |
| Cobro `PAID` pero no `SYNCED`                | Flags, política de RUT, evidencia del intento y diagnóstico; no cobrar nuevamente.    |
| `SENDING` o `REVIEW_REQUIRED`                | Inspección/conciliación; no liberar ni reenviar por antigüedad.                       |
| ESLint no encuentra un `.cjs` en el proyecto | Conservar overrides de scripts/tests JavaScript y las reglas tipadas para TypeScript. |

### Git y datos sensibles

Versionar código, migraciones, lockfiles, documentación y ejemplos sin secretos. Excluir `.env`, tokens, `node_modules`, dumps, logs e informes operativos. Antes de confirmar cambios, revisar:

```bash
git status --short
git diff --stat
git diff --cached --name-only
```

Añadir explícitamente los archivos revisados, confirmar y subir a la rama de trabajo correspondiente. En otro equipo, actualizar una copia limpia con `git pull --ff-only`, instalar con los lockfiles y aplicar únicamente las migraciones que correspondan a su entorno.

No incluir en tickets públicos payloads completos con datos bancarios o credenciales. Los informes de pago deben mantenerse en el canal interno autorizado.

## Personalización visual

El footer utiliza el logo blanco de CLS, fondo azul oscuro y los colores corporativos. Se renderiza desde `PortalLayout`; no agregarlo nuevamente dentro de cada página.

| Archivo                                              | Finalidad                                                |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `frontend/src/shared/components/CorporateFooter.tsx` | Diseño y contenido estructural del footer.               |
| `frontend/src/shared/config/companyFooter.ts`        | Datos de empresa, dirección, correo, teléfono y horario. |
| `frontend/src/shared/layouts/PortalLayout.tsx`       | Componente compartido de las vistas del portal.          |
| `frontend/src/router/AppRouter.tsx`                  | Rutas que usan el layout.                                |
| `frontend/src/assets/logo-cls.png`                   | Logo usado en el portal.                                 |
| `frontend/src/assets/logo-cls-white.png`             | Variante usada sobre fondo oscuro.                       |

Los textos empresariales se entregaron como Lorem ipsum a solicitud del equipo. Sustituirlos por información aprobada antes de anunciar el servicio. Los datos provisionales no generan enlaces `mailto:` o `tel:` ficticios.

## Límites conocidos

- Introducir un RUT no constituye autenticación de identidad ni acceso a una cuenta privada del cliente.
- La aplicación no implementa devoluciones, compensaciones ni resolución automática de cualquier conflicto contable.
- El filtro de RUT de Zoho no restringe los cobros de Khipu.
- La recuperación administrativa requiere intervención autorizada; no se ha documentado un scheduler instalado en el hosting que resuelva periódicamente todos los pendientes.
- Las confirmaciones tardías incompatibles y los posibles dobles pagos se conservan bloqueados hasta su revisión.
- La base y los documentos de Books pueden cambiar por operaciones ajenas al portal; una prevalidación no bloquea las acciones externas de otros usuarios.
- Los ejemplos de hosting no acreditan la versión Node, los directorios o el montaje efectivamente instalados. Registrar esos datos al entregar operación.
- La prueba final de producción continúa pendiente al momento de esta actualización.

No se requiere incorporar nuevas funciones comerciales para realizar el piloto de esta primera versión. Su liberación queda condicionada a la validación y aprobación descritas arriba.

## Referencias

Documentación técnica consultada para la sección de despliegue; mantener las instrucciones alineadas con la versión del proyecto:

- [Requisitos de Vite 8](https://vite.dev/blog/announcing-vite8).
- [Prisma ORM 6: desarrollo y producción](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).
- [Prisma ORM 6: despliegue de migraciones](https://docs.prisma.io/docs/orm/v6/prisma-client/deployment/deploy-database-changes-with-prisma-migrate).
- [CloudLinux Manager y Node.js Selector](https://docs.cloudlinux.com/cloudlinuxos/lve_manager/).
- [cPanel: aplicaciones Node.js](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/).
- [Zoho Books: Customer Payments](https://www.zoho.com/books/api/v3/customer-payments/).
- [Khipu: webhook de pagos](https://docs.khipu.com/en/payment-solutions/instant-payments/payment-webhook).

La guía interna de despliegue aportada por el equipo fue incorporada en la sección correspondiente y ajustada en relación con los prefijos de API, el webhook, el fallback de SPA y los comandos existentes del proyecto.

---

**Última actualización documental:** 17/11/2026.  
**Estado:** desplegado; piloto integral final pendiente de aprobación.  
**Uso y licencia:** respetar las condiciones del titular del proyecto. El paquete backend revisado declara `UNLICENSED`; este README no concede una licencia adicional.
