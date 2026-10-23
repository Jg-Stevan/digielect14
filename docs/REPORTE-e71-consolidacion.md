# REPORTE — Kit e71 · Consolidación: fixes de métricas y optimizaciones de rendimiento

**Base**: main @ `026ef86` (e70, PR #86) · **Rama**: `feat/e71-consolidacion-v1` · **Fecha**: 2026-10-23
**Commits** (separados para rollback, mandato del kit): `9555a92` fix (Parte 1) · `8a47c7d` perf (Opt-1) · `998d44e` perf (Opt-2/3) · docs.

---

## §0 Resumen

7 ítems del kit (4 fixes de consistencia + 3 optimizaciones), 0 rechazos del pipeline, regla de oro intacta (SIM 8.2/ÓPTIMA/ENVIADO AUTOMÁTICAMENTE re-verificada en vivo). Gates: **tsc 0 · lint 0 · 7/7 suites QA verdes con adendas honestas (33·50·24·49·32·72·34 = 290 checks)** · package.json/bun.lock INTOCABLES.

## §1 M-e71-0 — Recon: archivos reales vs estimaciones del kit

| Kit decía | Real | Nota |
|---|---|---|
| `runner.ts` | `src/lib/e14/masiva/runner.ts` | `reutilizarResultado` L425; bucle en `bucle()` L1340 |
| `informe.ts` | `src/lib/e14/informe.ts` | `yaEnviadas` L982 · `almacenamientoIdbMb` L914 · `gateCompleta` solo LEE `diag.gate.completa` |
| `gate.ts` | **NO EXISTE** | `gateCompleta` se COMPUTA en `scanner-core-bridge.ts` en **2 sitios** (escaneo ~L1625 + pipelineRecorte ~L2214) — el veto se aplicó en AMBOS (helper único, pitfall §9.9) |
| `agregarArchivo` | `masiva/store.ts agregarFiles` + `masiva/cola.ts agregarLote` | la ingesta real es el lote entero |
| `hashSha256` (nuevo campo) | **campo `hashBytes` EXISTENTE (e65)** | MISMO SHA-256 hex 64 de los bytes (`hashBytesDeArchivo`, crypto.subtle) — duplicar el campo rompería el contrato D57 y el índice de enviadas; el kit pedía «guardar como hashSha256 en el registro» → se guarda en el PRIMER write como `hashBytes` (M-e71-1) |
| `e14-masiva-historico-v1` | `masiva/historico.ts` (ledger con `hashBytes` desde e65) | el match de ingesta respeta `COLA_PERSISTENTE` (modo pruebas C-3: el ledger NO marca entre lotes — decisión vigente del dueño) |
| QA escanea | `qa-dedup-enviadas` / `qa-historico-enviadas` / `qa-qr-identidad` escanean literales tocados | adendas honestas en los 3 (§5) |

## §2 PARTE 1 — Fixes de consistencia

### P2.1 — la copia hereda el desenlace del original (`masiva/runner.ts`)
- **Antes**: `reutilizarResultado` estampaba SIEMPRE `DUPLICADA` — la gemela de una RECHAZADA aparecía como DUPLICADA en el informe.
- **Ahora**: `originalEnviada = ENVIADA || OPTIMA` → DUPLICADA (regla e66 intacta — jamás hereda el envío); `!originalEnviada && rechazo` → **RECHAZADA heredada** (el rechazo y el score ya viajan en el spread de la original); resto sin rechazo (ADVERTENCIA/EN_REVISION sin rechazo) → DUPLICADA (copia de un desenlace final — doctrina e66, M-e71-2). `enviadoAutomaticamente=null` y `esperaMs` propio en AMBAS ramas.
- **Aceptación del kit**: lote 1 buena + 1 dup de rechazada → informe `RECHAZADA: 2` (no DUPLICADA). El literal prohibido `if (actaCopia.status === "ENVIADA") {` sigue AUSENTE (QA lo verifica).

### P3.1 — `yaEnviadas` cuenta `statusActa === "ENVIADA"` (`informe.ts`)
- **Causa raíz**: contaba `estado === "YA-ENVIADA"` (dedup contra el ledger, e65) — ese estado SOLO nace en re-subidas de la MISMA sesión (y en modo pruebas el ledger ni participa, C-3) → reportaba 0 en lotes normales.
- **Ahora**: `filas.filter(f => f.statusActa === "ENVIADA").length` (auto OPTIMA + envíos manuales de ESTA cola) = atajo honesto de `porStatusActa.ENVIADA` (intacto). La unión dedup `'ya-enviada'` del informe queda intacta (export-only).

### P9 — `almacenamientoMB` fórmula 1e6 literal (`informe.ts`)
- **Auditoría honesta (M-e71-3)**: la fórmula previa `Math.round(idb / 1e5) / 10` ya era matemáticamente `idb/1e6` — **el 330 MB NO era un multiplicador erróneo**: es el uso REAL que Chrome reporta en `usageDetails.indexedDB` (LevelDB nunca encoge: páginas muertas de los re-writes de registros — la migración e68 reescribe cada registro — hasta la próxima compactación). El dato vivo (~30 MB) y el uso en disco divergen.
- **Cambio**: fórmula en forma literal del kit `Math.round((idb / 1e6) * 10) / 10` (auditable a la vista; semántica byte-idéntica) + nota en-código. **Nota para el dueño**: si el número sigue alto tras un lote, es compactación pendiente del almacenamiento del navegador — no inflación del informe; vaciar la cola y recargar provoca compactación eventual.

### P10 — veto 4/4 fiduciales (`integridad.ts` + `scanner-core-bridge.ts` ×2)
- **Bug**: con `esquinas=FALTA_tl+tr+bl+br` y quad sano (sin lados al borde, área ≥30%), `verificarCompletitud` ni siquiera medía tinta → `completa=true`; y si la lectura era FUERTE, `lazoPerdonadoPorLectura` perdonaba el lado → el gate podía salir completa con LAS 4 marcas ausentes.
- **Fix**: helper puro `cuatroEsquinasFaltan()` (integridad.ts — junto a `trazaEsquinas`) aplicado DESPUÉS del perdón del marco en el **escaneo** (`completa=false` → RECHAZADA / EN_REVISION_HUMANA al agotar) y en el **recorte manual** (`completa=false` → escudo-manual techo 7.9 — doctrina Q2: el operador VIO el papel; `diag.gate.completa` reporta false igualmente). Guard `!opciones.simular` + esquinas=ESQUINAS_OK → SIM inalcanzable (verificado en vivo). `null` (no medible) → false, jamás condena a ciegas.

## §3 PARTE 2 — Optimizaciones (benchmark aprobado)

### Opt-1 — SHA-256 pre-scan en la ingesta (duplicados instantáneos)
- `agregarFiles` calcula `hashBytesDeArchivo` por archivo **SECUENCIAL y FUERA de la tx de IDB** (una tx auto-commitea con awaits ajenos; RAM: un arrayBuffer a la vez) → `agregarLote(imagenes, paginasPdf, hashesBytes)` estampa `hashBytes` en el **PRIMER write** del registro (M-e71-1).
- **`dedupExactoIngesta`** (store.ts, nuevo): corre tras el swap y **ANTES de `rearrancarTrasEncolar`** — el runner JAMÁS ve un duplicado exacto como PENDIENTE (no paga precalor, ni qr-capa0, ni OCR — ~20 s de ahorro, kit literal):
  - match contra el **índice de enviadas** (ledger+cola, D-e65-3, respeta COLA_PERSISTENTE) → `marcarYaEnviada` via `"bytes"` (maquinaria e65 EXACTA);
  - match contra la **cola viva** (filas previas + anteriores del MISMO lote — el mismo archivo 2× en una carga) → verificar ENVIADA → YA-ENVIADA o **DUPLICADA instantánea** con `dupOf` (mismo patrón anti-zombi de `cadenaDedup`: fila viva + PENDIENTE + write IDB);
  - conservador: hash null → procesa normal; fallo → jamás tumba el encolado.
- `cadenaDedup` acepta el hash pre-computado (`entrada.hashBytes ?? await ...`) — la capa visual (dhash) queda intacta detrás; cero re-hash (−68 ms/file en background).
- **Aceptación medida en vivo (:3001)**: mismo archivo 2× en un lote → trazas `ingesta sha256 ms=9` + `ms=1` (250 KB; ~68 ms en fotos 12 MP reales) + `dedup fila=… instantanea sha256 dupOf=…` y la bandeja pinta **1 pendiente / 1 duplicada** ANTES de pulsar PROCESAR. Re-subida (3.er evento) → `instantanea sha256 dupOf=<original>` contra la fila viva (hashBytes ya estampado en la fila por el pase). Cero OCR.

### Opt-2 — recorte de la esquina estándar antes del barrido (`masiva/identidad-qr.ts`)
- `QR_RECORTE_LADO = 600` (literal del kit). Nuevo tier **`decodificarQrDeRecorte`**: recorte superior-izquierda 600×600 (clampado — `ventanaDePixeles` jamás inventa píxeles) → jsQR (attemptBoth) → zxing (los DOS binarizadores, MISMO contrato del barrido) en UNA pasada.
- Insertado en `decodificarQrDePixeles` entre `base` y `barrido` (traza nueva `tier=recorte-600`): si el QR vive donde el formulario lo pone (el caso de campo), **los barridos ~15 s JAMÁS corren** (<500 ms de tier). Fallback sagrado: el barrido completo de siempre queda DETRÁS — QRs fuera de la esquina estándar (actas rotadas, encuadres raros) conservan SU rescate, y el tier de rotación y el rescate 4096 quedan byte-idénticos.
- El QA ejercita el tier con payloads reales: QR en la esquina → EXACTO en 56 ms; QR fuera del recorte → `null` honesto; orden de la cadena verificado por source-scan.

### Opt-3 — paralelismo 2 workers + mutex de dedup (`masiva/runner.ts`)
- **Pool**: `PROCESAMIENTO_CONCURRENTE = 2` (constante única — revertir a 1 = secuencial byte-idéntico). `bucle()` con `Set<Promise>` + `Promise.race` para liberar slot + `Promise.all(enVuelo)` al terminar (el finally del runner apaga solo cuando TODO aterrizó). **Reserva de fila** (`reservadas`, nace antes del pipeline, muere en el finally) — cierra la ventana entre `siguientePendiente` y el marcarFila(PROCESANDO): ninguna fila se toma dos veces.
- **Vida POR-FILA**: `vidaGlobal` (global mutable) → `Map<string, VidaFila>` con throttle 250 ms por fila — con 2 actas en vuelo cada % es independiente (la detección de 2.ª pasada OCR de UNA fila ya no se contamina con la OTRA).
- **Mutex** (kit: «Mutex simple o encolar la verificación de dedup en un solo hilo»): promesa-cadena FIFO `conExclusionMutua` — secciones críticas: (1) `reutilizarResultado` completa (leer→decidir→escribir la copia), (2) registro del payload capa-0 CON re-chequeo dentro del mutex (dos filas del mismo payload en vuelo ya no pueden pisar la original del mapa), (3) **capa 2 identidad: check+marca atómicos** — dos filas con la MISMA serie aterrizando juntas ya no pueden enviarse DOBLE (la segunda ve la marca de la primera → DUPLICADA con SU desenlace). El OCR/precalor quedan FUERA del mutex (paralelos de verdad).
- **Efectos conocidos declarados**: el chip de progreso muestra UNA fila a la vez (el `progreso` del store es único — cosmético); un watchdog que mate workers (75 s+) puede tumbar el OCR de la fila hermana → ERROR honesto + reproceso (raro — el techo del watchdog no cambia).

## §4 Desviaciones

| ID | Desviación | Justificación |
|---|---|---|
| M-e71-0 | nombres de archivo reales (§1) — `gate.ts` inexistente (2 sitios en el bridge) | recon-first mandato del kit |
| M-e71-1 | `hashSha256` del kit = campo `hashBytes` EXISTENTE (mismo SHA-256) | duplicar el campo rompe D57/índice; la llave es la misma |
| M-e71-2 | ADVERTENCIA/EN_REVISION sin rechazo → DUPLICADA (no RECHAZADA) en P2.1 | el kit define ENVIADA/OPTIMA→DUPLICADA y RECHAZADA→RECHAZADA; el caso intermedio sigue la doctrina e66 (copia de desenlace final) |
| M-e71-3 | P9 ya era `idb/1e6` — cambio de FORMA, no de semántica | auditoría honesta; 330 MB = uso real en disco (§2-P9) |
| M-e71-4 | match ledger en ingesta respeta `COLA_PERSISTENTE` (modo pruebas: solo cola viva) | decisión C-3 vigente del dueño — el kit pide históricamente; en producción (true) el check es completo |
| M-e71-5 | hashes en la ingesta DESPUÉS de pintar los temps (no antes) | cero regresión UX: las filas «GUARDANDO N…» aparecen al instante como hoy |

## §5 Gates y QA (adendas honestas)

- **tsc 0 · lint 0** en cada commit · package.json/bun.lock INTACTOS.
- **7/7 suites**: qa-autoenvio 33/33 · qa-dedup-enviadas **50/50** (+6: Opt-1 y Opt-3 source-scan) · qa-escaneo-ya-recortado 24/24 · qa-historico-enviadas **49/49** (+1 adenda literal P2.1/P3.1, −1 re-literal T-4) · qa-identidad-acta 32/32 · qa-qr-identidad **72/72** (+4: tier recorte-600) · qa-watchdog-relectura 34/34. Total 290 checks.
- Literales adaptados CON adenda comentada: `actaCopia.status = copiaRechazada ? "RECHAZADA" : "DUPLICADA";` (P2.1) · `yaEnviadas: filas.filter((f) => f.statusActa === "ENVIADA").length,` (P3.1) · `entrada.hashBytes ?? (await hashBytesDeArchivo(...))` (Opt-1) · `registrarQrPayload(qrPayloadSeguro, fila.id)` (Opt-3 — orden T-4/F4 intacto).

## §6 Verificación en vivo (:3001, dev — smoke)

1. App carga, **0 errores de página, 0 errores de consola**.
2. MASIVA renderiza; lote [a.png, a.png idéntico] → trazas `ingesta sha256 ms=9/ms=1 hash=7a103b71…` + `dedup … instantanea sha256 dupOf=…` · bandeja: **1 pendiente, 1 duplicada** · re-subida del mismo archivo → `instantanea sha256 dupOf=<original viva>` · **2 duplicadas**.
3. SIM óptima (regla de oro): pipeline completo `completa=true esquinas=sim … score=8.2` → chip **8.2/10 ÓPTIMA — ENVIADO AUTOMÁTICAMENTE** (el veto P10 NO toca SIM; sin regresión).
4. Log del dev server sin errores.

**Pendiente del dueño (SU equipo)**: (a) P2.1 — lote con 1 buena + 1 dup de una RECHAZADA → informe `RECHAZADA: 2`; (b) Opt-1 — re-subir un archivo ya enviado del ledger → YA-ENVIADA sin OCR (en producción, COLA_PERSISTENTE=true); (c) Opt-3 — lote de 10 actas reales → `totalMs` del informe notablemente menor al secuencial (esperado ~×1.6-1.8, no ×2: OCR comparte CPU); (d) Opt-2 — acta con QR difícil → traza `tier=recorte-600` (<500 ms) en vez de `tier=barrido` (~15 s); (e) P9 — comparar `almacenamientoMB` tras vaciar+recargar (compactación).
