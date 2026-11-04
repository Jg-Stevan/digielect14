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
   sintéticas (`src/assets/acta-sim-*.jpg`).
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
