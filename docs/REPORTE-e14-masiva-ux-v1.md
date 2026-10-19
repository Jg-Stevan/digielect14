# REPORTE — e14-masiva-ux-v1

**Fecha:** 2026-10-19 (Bogotá) · **Rama:** `fix/e14-masiva-ux-v1` (desde main `5102cf6`) · **Estado:** PR DRAFT

## 1. Resumen

4 tareas del kit: **T1** detección al importar espera el worker OpenCV (tope 5 s) con 1
reintento si el quad vino del fallback Sobel · **T2** masiva acepta ZIP/RAR/HEIC (deps
fflate + node-unrar-js con import diferido — D47) · **T3** estado de envío visible por
fila (EN COLA / ENVIADA AUTO / ENVIADA) + contadores del lote · **T4** presupuesto de
timeout para masiva (120 s — el default 15 s del escaneo individual queda intacto).
4 commits de producción + 1 docs. lint 0-0 · tsc 0 · build estático OK · SIM byte-idéntica.

## 2. Whitelist §1 vs diff real (`git diff --name-status main...HEAD`)

| Kit | Diff real |
|---|---|
| scanner-core-bridge.ts (T1, T4) | M ✓ |
| masiva/runner.ts (T4 + T3) | M ✓ |
| masiva/store.ts (T2, T3) | M ✓ |
| masiva/tipos.ts (T3 + T2) | M ✓ |
| masiva/archivos.ts (T2) | A ✓ |
| MasivaView.tsx (T2, T3) | M ✓ |
| package.json + bun.lock (T2) | M ✓ (SOLO fflate ^0.8.3 + node-unrar-js ^2.0.2) |
| docs (REPORTE/DECISIONS/ROADMAP/worklog) | registro ✓ |

Zonas prohibidas (`public/`, `next.config.ts`, `vercel.json`, `.github/`, `src/assets/`,
paquete npm, `bridge.ts`) — **diff VACÍO** verificado. `AGENTS.md` NO tocado (no está en
la whitelist §1 de este kit).

## 3. Evidencias por tarea

**T1 — detección confiable al importar** (logs `[e14]` reales):
- Pestaña recién abierta + foto detectable → `detectOrigen=worker` (la espera de
  warm-up ganó; sin espera el quad caía a Sobel — bug reproducido en la línea base).
- Foto difícil (mesa001, el Sobel SIEMPRE erra incluso caliente) →
  `detectOrigen=sobel detectReintento=1` + quad original conservado (kit T1.2 literal).
- Vendor OpenCV bloqueado (network route abort) → flujo completo por Sobel,
  **0 errores de página**, reintento omitido (worker muerto → `caliente=false`).
  OBSERVACIÓN: en ese entorno el warp cae al canvas-warp fallback PREEXISTENTE de main
  y el guard-borde mide distinto (7.9→6.4 en mesa002) — comportamiento de main, no del
  kit (misma ruta de código, verificación A/B no necesaria: el kit no toca warp).
- Formato del log: campos AÑADIDOS AL FINAL (`detectOrigen=`, `detectReintento=1`) —
  nada previo cambió (los instrumentos del dueño siguen parseando).

**T2 — ZIP/RAR/HEIC** (cola masiva, navegador real):
- ZIP 3 imágenes (2 jpg + 1 png) → 3 filas PENDIENTE con nombres de las entradas ✓
- ZIP con contraseña (`zip -P secreto`) → ERROR `PROTEGIDO_O_CORRUPTO` ✓
- ZIP sin imágenes (solo .txt) → ERROR `SIN_IMAGENES_DENTRO` ✓
- ZIP anidado (zip dentro) → ERROR `ARCHIVO_ANIDADO` (por entrada) ✓
- ZIP 501 pngs → **500 PENDIENTE + 1 ERROR `LIMITE_500_POR_COMPRIMIDO`** ✓
- RAR REAL (Downloads.rar del dueño, sin imágenes adentro) → el wasm de node-unrar-js
  cargó en el navegador, abrió el archivo, extrajo entradas (.txt/.json descartadas por
  extensión) → `SIN_IMAGENES_DENTRO` ✓ (camino RAR end-to-end vivo; el caso «RAR con 2
  imágenes» no es creable en el sandbox — no existe binario `rar` — queda para el dueño).
- HEIC con MIME vacío (jpg renombrado a .heic) → entra a la cola y se procesa (pipeline
  completo, RECHAZADA 4.9 determinista) ✓ + aviso «CONVIRTIENDO HEIC…» capturado EN VIVO
  durante el proceso ✓.
- Archivo suelto .pdf → ERROR `FORMATO_NO_SOPORTADO` (ya no se descarta en silencio) ✓.
- `accept` del input verificado en el servidor de preview: `image/*,.heic,.heif,.zip,.rar` ✓.

**T3 — estado de envío por fila**:
- Con conexión: acta 10.0 ÓPTIMA → píldora verde «ENVIADA AUTO» ✓.
- OFFLINE (toggle de la app): misma foto → auto-envío a la cola → píldora ámbar
  «EN COLA» + contadores `ENVIADAS 1 · EN COLA 1 · PENDIENTES 0 · ERRORES 1` ✓.
- Reactivar conexión → fila drenada a «ENVIADA AUTO», contador `EN COLA 0` ✓.
- Recargar página con la cola llena → los estados sobreviven (se derivan del registro
  IDB: `hashSha256 === "EN COLA"`, kit-literal) ✓.

**T4 — timeout de masiva**:
- 3 imágenes de un ZIP procesadas SECUENCIAL en orden (cero solape — el await del bucle
  D45 manda) ✓; acta 10.0 en masiva termina con su status real (no RECHAZADA por tiempo) ✓.
- Actas locales tardan 3-10 s (< 15 s — el presupuesto 120 s no llega a bindir aquí); el
  caso real (~21 s multihilo en Vercel) queda para el dueño. El default 15_000 del flujo
  individual quedó INTACTO (`opciones.timeoutMs ?? TIMEOUT_MS`) — SIM + imports corren
  idénticos (§4). Timeout REAL (>120 s) → mismo texto «TIEMPO DE PROCESADO EXCEDIDO».

## 4. Métricas — SIM antes/después (paridad byte-idéntica, §4.4)

| Acta | Antes (main) | Después (rama) | Desenlace |
|---|---|---|---|
| Óptima | total 9514 ms · conf 0.93 · 8.2 | total 8821 ms · conf 0.93 · 8.2 | idéntico (mismo quad, piso10, origen=worker) |
| Intermedia | total 7808 ms · score 7.0 | total 7425 ms · score 7.0 | idéntico (as-is, mismo cod) |
| Baja | total 4290 ms · conf 0.62 · 4.3 | det 2435 ms · conf 0.62 · 4.3 | idéntico (sin-clasificar) |

Import individual mesa002-original (§4.6): antes total 9966 ms / rec 5361 / conf 0.91 /
7.9 → después total 10068 ms (**+1.0 %**) / rec 5282 / conf 0.91 / 7.9 + `detectReintento=1`.
Nada empeora >10 % (la espera solo corre con worker frío).

## 5. Peso del bundle (T2 — D47, import diferido)

| Métrica | main | rama | delta |
|---|---|---|---|
| Chunks EAGER (iniciales, index.html) | 1,358,404 B (8) | 1,363,981 B (9) | **+5,577 B (+0.41 %)** |
| Chunks totales (incl. lazy zip/rar) | 3,164,382 B | 3,209,979 B | +45,597 B (lazy — solo carga al llegar un comprimido) |

El unrar.wasm (207 KB) viaja como asset del PROPIO paquete npm (emitido a
`static/media/unrar.*.wasm` por el bundler — `public/` y `src/assets/` intocables).

## 6. Desviaciones / adaptaciones (§0.2 — ninguna BLOQUEADA)

1. **`extraerArchivo` devuelve `ResultadoExtraccion`** (`{archivos, errores}`) y no el
   `Promise<File[]>` del kit: sus PROPIOS guards (anidado por entrada + límite 500 con
   encolado parcial) no son expresables con `File[]` solo. Contraseña/corrupto SÍ lanza.
2. **`OpcionesEscaneoConTimeout` = intersección LOCAL** en scanner-core-bridge.ts:
   `bridge.ts` (casa de `OpcionesEscaneo`) NO está en la whitelist §1 — el método de la
   clase se ensancha por bivariance de métodos TS y el runner pasa la variable tipada
   (sin excess-check). Comportamiento idéntico al pedido.
3. **Drenaje también al MONTAR** (`refrescarEnviosTrasDrenaje` en el effect de `online`
   sin guard de transición): el toggle vive en REVISIÓN — puede usarse con MasivaView
   desmontada o tras recargar. online=true + hashSha256 "EN COLA" ⇒ drenaje ya ocurrido;
   idempotente. Hallado y corregido durante la verificación (bug del primer intento).
4. **`hashDrenaje()`** (3 líneas) espejo del `hashMock` del store principal — store.ts
   NO está en la whitelist (mismo formato de hash demo visible en REVISIÓN/RESUMEN).
5. **Filas ERROR persisten** (`RegistroMasiva.error?: string` aditivo) — los guards de
   formato sobreviven la recarga (honestidad de la bandeja; sin datos que procesar).

## 7. Pasos que el dueño debe repetir en SU PC

1. **RAR con imágenes** (aquí no existe `rar` para crear el archivo de prueba): un .rar
   con 2 fotos → 2 filas PENDIENTE → PROCESAR.
2. **HEIC real de iPhone** (el decode heic2any con contenido HEIC verdadero — el
   renombrado local prueba la aceptación y el aviso, no el decode real).
3. **T4 real**: lote con actas lentas (~21 s en su PC con multihilo) → en los logs el
   pipeline N termina ANTES de que empiece N+1 y ninguna queda RECHAZADA
   «TIEMPO DE PROCESADO EXCEDIDO» falsamente.
4. **T1 en su cámara/import**: foto difícil con pestaña recién abierta → en el log
   `detectOrigen=worker` en la mayoría; si sigue `sobel` con `detectReintento=1`, es el
   quad original (comportamiento actual, sin error).
5. **Offline real**: modo avión → capturar/lote → «EN COLA» → conexión → «ENVIADA».
