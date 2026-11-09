# SECURITY — digielect14

## Qué es este software y qué toca

Una app web que digitaliza **actas E-14 del voto exterior colombiano** en el
navegador del celular de quien custodia el puesto. Trabaja con datos electorales
reales y con imágenes de documentos públicos de una elección en curso.

## Modelo de privacidad

- **Procesamiento 100 % local.** El QR, la detección de bordes, el warp, el OCR y
  el gate corren en el dispositivo (`onnxruntime-web`, `zxing-wasm`,
  `tesseract.js`). No hay backend de procesado ni subida a un servicio tercero.
- **Una sola salida con datos:** `POST {hub}/actas` (ver
  [docs/ENDPOINT-REPORTES.md](docs/ENDPOINT-REPORTES.md)). El hub es del dueño
  del proyecto. No se añade telemetría, analítica ni servicios externos.
- **Observabilidad sin PII.** `src/lib/e14/obs/` registra errores, rendimiento y
  uso con identificadores opacos (`fnv1a8` sobre `actaId`) y **nunca** texto del
  acta, coordenadas ni contenido de votos. Las miniaturas quedan detrás del
  permiso `politica.miniaturas`. Lo vigila `scripts/qa-obs-privacidad.ts`.
- **La app no lee votos.** Se limita a identificar el acta (depto/municipio/zona/
  puesto/mesa contra el catálogo DIVIPOLA) y a comprobar que la zona de votos
  tenga tinta (`src/lib/e14/marcadores.ts`, decisión D41). No interpreta números
  ni produce totales.

## Reglas para quien contribuya

1. **No commitees actas, capturas ni credenciales.** Nada de fotos reales en el
   repo, ni en fixtures, ni en `docs/`. Los fixtures del modo SIM son imágenes
   sintéticas (`src/assets/acta-sim-*.jpg`) — desde la decisión **D35**
   (2026-11-08, ver `docs/DECISIONS.md`) la foto real que estaba en el HEAD fue
   retirada y la historia se reescribe con el script de `scripts/`; la
   excepción histórica quedó documentada allí, no aquí.
2. **No envíes actas a endpoints distintos del hub.** Ni para depurar, ni como
   "fallback", ni a un servicio de terceros.
3. **No añadas dependencias, telemetría ni servicios externos** sin acuerdo
   explícito del dueño: cada dependencia es superficie de riesgo y peso en un
   dispositivo de gama baja.
4. **No toques los umbrales del gate ni el veto de votos** sin registrar la
   decisión en `docs/DECISIONS.md`: son control de integridad, no preferencia de
   UI.
5. **Nunca `git push --force`** ni reescritura de historial: el repo es la
   trazabilidad de qué versión corría en cada puesto el día de la elección.

## Reportar una vulnerabilidad

No abras un issue público para algo que afecte a datos electorales en producción.
Escríbeme por un canal privado (perfil de GitHub → email) con el archivo, la línea
y el escenario reproductible. Respondo antes de 7 días; si hace falta coordinar
una versión en campo, lo primero es el kill-switch de flags
(`public/flags.json`), que permite desactivar el comportamiento afectado sin
redeploy del modelo.

## Inventario de secretos y configuración

- No hay `.env` en el repo ni en runtime: la app es estática. `.dev.vars*` está
  gitignoreado y solo `.dev.vars.example` se versiona.
- Credenciales de deploy (`vercel`/`wrangler`/`CLOUDFLARE_API_TOKEN`) se usan
  desde la sesión local del dueño con `bunx wrangler login`. **Nunca** van en un
  commit, en un workflow ni en un chat.
- `wrangler.jsonc` lleva el nombre del worker y sus bindings; no contiene
  secretos.


## El receptor (`e14-puente`) — autenticación y retención (Ola 0)

El hub de producción (`e14-puente.julistevan02.workers.dev`) tiene **fuente
versionado** en el paquete de remediación (`e14-puente/` — cierra H-1) y:

- **Escritura autenticada (0.1):** `POST /v1/actas` exige HMAC-SHA256 del
  **body crudo** (`x-e14-ts` + `x-e14-firma`, ventana de 5 min, comparación en
  tiempo constante) con la clave de jornada — **S-1**: el cliente serializa una
  vez, firma y envía los mismos bytes; **S-2**: rotación real con clave previa
  en gracia + anti-replay best-effort (KV, TTL 330 s; KV es eventualmente
  consistente — el dedupe por hash del almacenamiento es la segunda red). Sin
  clave provisionada, el cliente no envía (falla cerrado). La clave NUNCA vive
  en el bundle: se provisiona por canal aparte (config local del operador, QR
  presencial) y rota por jornada.
- **Lectura autenticada (0.2):** `GET /v1/actas` exige Bearer `CLAVE_LECTURA`
  (distinta de la de escritura); el listado no arrastra fotos — la foto baja de
  `/v1/foto/<hash>` también autenticada. El token del panel vive en la
  configuración local del supervisor (`localStorage["e14-token-lectura"]`,
  nunca en el bundle — H-2). `GET /v1/actas/contador` es público (solo números,
  sin PII) y `GET /salud` sigue público (healthcheck sin datos).
- **Rate limit (0.3/H-3):** regla WAF del borde como enforcement real
  (30/min por IP sobre `/v1/*`, dimensionada para el tráfico anónimo) + cuota
  granular en el worker (30/min por IP pre-auth, 120/min por dispositivo
  autenticado — el NAT compartido del puesto no bloquea operadores legítimos).
  El contador KV es best-effort (eventualmente consistente).
- **Retención (0.4):** «las actas se expurgan a **30 días** de la jornada, o
  antes si se confirma la recepción oficial» — cron diario 03:00 UTC con
  minimización opcional de fotos ya validadas (la foto es el 99,7 % del peso y
  lo sensible pre-publicación). Expurgo bajo demanda: `DELETE /v1/actas/:hash`
  con `CLAVE_ADMIN`.
- **Medición de la fuga original (F1, cifras fechadas — corrección C-2):**
  el 5-nov-2026 `GET /actas` sin credenciales devolvía **1,28 MB (4 fotos ×
  ~316 KB base64)**; al 7-nov-2026 había **6 actas almacenadas (~1,9 MB
  proyectados)**. Ambas mediciones son del mismo defecto: GET público de
  lectura. Cerrado con la autenticación de lectura arriba.

## Rol legal y mínimo de cumplimiento (0.6)

Quien opera el hub y el panel asume el rol de **responsable del tratamiento**
sobre lo que retiene. Marco: Ley estatutaria 1581 de 2012 + Decreto 1074 de
2015 (finalidad, seguridad, acceso y circulación restringida — principio de
seguridad, art. 4; el régimen reforzado se cita del **art. 7** y la
autorización previa del **art. 6**; el deber de seguridad se regula en el
Decreto 1377 de 2013 y el Título de seguridad del Decreto 1074 de 2015 —
cotejado contra fuente oficial al integrar, ver H-5 del documento de
correcciones). La SIC no exige PIA explícito; el PIA ligero de la fase 2 es la
medida de gobernanza voluntaria elegida. La app muestra qué se envía, a dónde
y cuánto se retiene (aviso de privacidad en la ayuda — lenguaje de operador,
no jurídico); el panel lo repite en Configuración.

## Respuesta a incidentes (H-6)

Si se detecta escritura no autenticada (lote inyectado, firma repetida, datos
que nadie reconoce):

1. **Rotar las claves YA**: `wrangler secret put CLAVE_JORNADA` (nueva) y mover
   la vigente a `CLAVE_JORNADA_PREVIA` (o vaciarla si se sospecha compromiso de
   ambas). Rotar `CLAVE_LECTURA` si hubo lectura anómala.
2. **Revisar el KV de datos** (`DATOS`): listar lo ingresado en la ventana
   sospechosa (`GET /v1/actas?desde=` con token), identificar lo no auténtico.
3. **Purgar lo inyectado**: `DELETE /v1/actas/:hash` por cada item (con log).
4. **Anotar el evento** (qué, cuándo, alcance, acción) en un issue privado y
   en la bitácora de la jornada.
5. Si hubo lectura de fotos por terceros antes del cierre de F1 (el GET público
   ya no existe), tratarlo como fuga confirmada: rotación + purga + nota en
   `DECISIONS.md`.

## Monitoreo mínimo del hub (H-6)

Probe diario de `GET /salud` (workflow `frescura-deploys.yml` o Cloudflare
Health Check) que abre issue si falla. El hub es el activo P0: sin probe, una
caída silenciosa deja puestos sin poder enviar sin que nadie lo sepa.
