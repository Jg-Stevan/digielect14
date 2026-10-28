# REPORTE — feat/obs-nucleo-v1 (KIT AGENTE 1 — NÚCLEO DE CAPTURA OBS)

> **Task ID: 7-a** · Ola e14-observabilidad-v1 · branch `feat/obs-nucleo-v1`
> sobre `main` post-#93 (`b603183`). El agente NO mergea — el dueño
> integra 1º (README-KITS §1). Base verificada: PR #93 mergeado
> 2026-10-23T15:19 (precondición del kit cumplida).

---

## 1 · Qué se hizo (C1–C8, un commit por tarea)

| Commit | Tarea | Contenido |
|---|---|---|
| `086b665` | C1 | `obs/tipos.ts` **VERBATIM** §4.2 · `identidad.ts` (idSesion/idDispositivo/appVersion/fnv1a8) · `digest.ts` (digestDe/archivoDeStack/normalizarMensaje/agregarErrores) · 22 tests |
| `4588654` | C2 | `buffer.ts` — DB `e14-obs` v1 (store `eventos`, keyPath `id`, índice `ts`), tope 500 + TTL 30d FIFO, **todo try/catch silencioso**, retención en `mantenimientoBuffer` PURA · fake IDB en tests · +32 tests |
| `b1859b4` | C3 | `logger.ts`: warn/error transportan `ErrorEvento` al buffer (lazy import con `.catch`, mensaje 500/stack 2000, digest, breadcrumbs) · guard anti-recursión en `appendEvento` · `breadcrumbs.ts` nace (ring 30) · **directiva muerta L25 eliminada → lint 0 warnings (la única del repo)** |
| `83052a2` | C4 | `breadcrumbs.ts` completo (listener click capture+passive → aria-label/data-accion, JAMÁS textContent) · `uso.ts` (merge in-memory, flush 30 s/hidden, suscripción selectiva a ambos stores SIN editar componentes) · +7 tests |
| `931d3c7` | C5 | `dispositivo.ts` (nulls honestos iOS, `calcularTier` §4.4 con 13 casos testeados, muestreo 5 min con re-verificación por tick y auto-stop) · `politica.ts` (ver desviación D-orden) |
| `404af8c` | C6 | `export.ts` — `construirReporte` (§4.2) + `descargarReporte` (JSON/ZIP patrón informe.ts, fflate `{level:0}`, `muestras/` SOLO con `miniaturas` ON, `vaciarDespues`→`purgarBuffer`) |
| `cd2c3be` | C7 | `captura.ts` (instalarCaptura/`eventoDeError`/`ErrorBoundaryObs`/`emitirPerfDeActa`) · **cambio quirúrgico del bridge** · `flags.ts` (leerFlags/refrescarFlags/sanearFlags) · consumo mínimo de flags · `transporte.ts` STUB · `page.tsx` bootstrap + ErrorBoundary |
| (este) | C8 | suite final + REPORTE + worklog |

## 2 · Gate (números — cada commit y final)

| Gate | Baseline main | Final rama |
|---|---|---|
| `tsc --noEmit` | 0 errores | **0 errores** |
| `bun run lint` | 0 err / **1 warning** (logger.ts L25) | **0 err / 0 warnings** |
| `bun run test` (vitest) | 70/70 | **153/153** (6 archivos; +83 obs/flags) |
| QA `scripts/qa-*.ts` | 294/294 | **294/294** (7/7 suites, corridos ANTES y DESPUÉS de cada toque con anclas) |
| `bun run build` | exit 0 | **exit 0** |
| `bunx knip` | 17 ítems preexistentes | ver §4 (delta justificado) |

## 3 · Humo — resumen (detalle completo con datos en §6)

- **Captura de error**: `dispatchEvent(new ErrorEvent("error", {error: new TypeError("prueba obs")}))` desde la consola → evento `error` en IndexedDB `e14-obs`/`eventos` con digest 8-hex y breadcrumbs → **verificado**.
- **App idéntica**: pipeline real con acta de prueba (REVISIÓN correcta), navegación de 5 vistas, MASIVA, ayuda `?` — **0 errores de página/consola en todo el flujo** (el rastreo es invisible cuando está sano).

## 4 · Desviaciones al contrato (todas documentadas, ninguna BLOQUEANTE para 2/3)

1. **`nuevoUuid()` exportado de identidad.ts** (infra): el contrato §4.3 lista 4 firmas; el buffer necesita generar el `id` de cada evento — un solo generador canónico (con fallback honesto a `getRandomValues`). Firma adicional, no reemplaza ninguna.
2. **Orden C5/C6**: `politica.ts` se creó en el commit C5 (el muestreo de salud del C5 consume `leerModoDev/leerPolitica` — dependencia del contrato). C6 quedó con export.ts completo. Mismo contenido, mismo árbol de archivos, un commit distinto.
3. **Guard anti-recursión**: el kit pedía flag `capturando` module-level en obs. Implementado como **guard de re-entrada dentro de `appendEvento`** (si el rastreo ya está emitiendo, cualquier append anidado se descarta). Misma garantía, superficie mínima: logger y captura (C7) obtienen la protección sin conocer el flag.
4. **perfResumen**: el kit nombra `useE14Store.getState()`. Las actas masivas NO viven en RAM (filas livianas, lección L7) — se agregan vía `masiva/cola.listarMapeados` **SOLO-LECTURA** (mapper dentro del cursor, extrae SOLO el diagnóstico; los Blobs jamás se retienen). Sin esto el reporte vería 1 acta de toda la jornada.
5. **`ErrorBoundaryObs` en captura.ts**: componente de clase con `createElement` (sin JSX, mantiene el `.ts` del contrato de zona).
6. **`refrescarFlags`**: el kit decía «refresca cada 24h si hay endpoint de flags». Definición operativa: el endpoint ES `public/flags.json` (estático, deployable por el dueño). `404` → `"sin-endpoint"` (estado normal hoy: el archivo no existe); fallo de red → `"error"` con backoff exponencial 1m→24h y fallback al último cacheado (offline-safe).
7. **knip — delta explicado**: los ítems obs/flags restantes son (a) superficie de CONTRATO que consumen los agentes 2/3 después del merge (política/modo-dev/overrides → panel UI del agente 2; `transporte.ts` completo → agente 3; `TipoEvento`/`PerfActa` → eventos del outbox), y (b) puras del núcleo consumidas por los tests vía `import()` dinámico (obligado: el grafo de `../store`/core no es resoluble estático en node — los mocks ligeros exigen import tardío). **Cero exports muertos reales**: cada uno tiene consumidor actual (test) o consumidor diseñado en los kits 2/3. Si el dueño quiere silenciarlos en la ola, `knip.json` (su zona) puede añadir `"src/lib/e14/obs/**"` a `ignore`.
8. **`PerfActa.tiempos`**: el bridge emite SOLO `procesoMs/calidadMs/ocrMs/totalMs` (los opcionales `decodeMs/detectMs` son `number|null` y el contrato exige `Record<string, number>` — no se inventan ceros).

## 5 · poolWorkers — NO tocado (protocolo del kit)

`PROCESAMIENTO_CONCURRENTE = 2` en `masiva/runner.ts` L133 está **anclado byte-idéntico** en `qa-dedup-enviadas.ts` L375 (`runner.includes("const PROCESAMIENTO_CONCURRENTE = 2;")`). Kit C7: «si está dentro de un bloque anclado NO lo toques y documenta» → **no se tocó**; el kill switch `poolWorkers` queda SIN wiring hasta que el dueño libere la constante (o desplace el ancla conscientemente).

## 6 · Humo (build de PRODUCCIÓN standalone :3001 + agent-browser)

> El dev server (turbopack) muere por el techo de memoria del sandbox (cgroup 2.38 GB con el next del workspace vivo) → el humo corre contra `bun run build` + `server.js` standalone — MISMO código que producción, mejor evidencia.

- **Arranque limpio**: shell oscuro completo (SideNav lg+ / BottomNav móvil, ESCANEAR con CÁMARA/SIM/SUBIR, overlay de ayuda 1.ª visita, banner PWA) · **0 errores de página, 0 errores de consola** en TODO el flujo.
- **Captura de error (kit §Validación 2)**: `dispatchEvent(new ErrorEvent("error", {error: new TypeError("prueba obs humo")}))` → IndexedDB `e14-obs`/`eventos`:
  `{ mensaje: "TypeError: prueba obs humo", digest: "9a0636ec" (8 hex), tipo: "TypeError", archivo: null (error sintético sin frame src/ — null honesto), breadcrumbs: 7 (4 clicks + 3 vistas), sesion ✓, dispositivo ✓, appVersion "0.1.0" }`.
- **Uso de features**: navegación ESCANEAR→ACTAS→MASIVA→RESUMEN → 3 eventos `uso` (`{dia: "2026-10-23", vista, accion: "abrir-vista", n: 1}`) con fecha local correcta; flush al `visibilitychange` verificado (los contadores duermen 30 s en memoria — diseño del C4).
- **Emisión perf del puente (cambio quirúrgico C7) — END-TO-END**: upload de un acta de prueba → pipeline REAL (no SIM) → REVISIÓN con RECHAZADA 4.9/10 (gate correcto para una imagen no-E14) → evento `perf` en el buffer:
  `{ actaIdHash: "880024a7" (FNV-1a — el id plano JAMÁS sale), status: "RECHAZADA", intento: 1, tiempos: {procesoMs: 298.5, calidadMs: 58.2, ocrMs: 6515.4, totalMs: 11595.3} (OCR real), scoreVisual: 4.9, scoreFinal: 4.9, gate: "RECHAZADA", ocrValido: true }`.
- **App idéntica (kit §Validación 3)**: REVISIÓN renderiza con todas sus CTAs (Recortar/Rotar/Imagen/REPETIR), badge ACTAS «1», EN LÍNEA, barra de score 4.9/10 RECHAZADA — el rastreo es invisible cuando está sano.
- **Salud sin timer (cero costo OFF)**: sin `e14-dev-mode` en localStorage, el muestreo no creó timer (0 eventos `salud` tras la jornada completa — condición del C5 verificada en vivo).

## 7 · Fuera de alcance (zonas PROHIBIDAS respetadas)

`runner.ts` (solo lectura) · `masiva/cola.ts`/`historico.ts` · `informe.ts` · `diagnostico.ts` · `ScanView/MasivaView/ActasView` · `docs/ROADMAP.md`/`DECISIONS.md` (los edita el dueño) · `package.json` (**cero dependencias nuevas** — todo con APIs del navegador + fflate ya presente).

## 8 · Qué queda para los agentes 2/3

- **Agente 2 (UI modo dev)**: panel sobre `leerModoDev/guardarModoDev`, toggles de `PoliticaDatos` (`leerPolitica/guardarPolitica`), kill switch `leerOverridesFlags/guardarOverridesFlags`, badge TopBar, `estadoTransporte()` ya expuesto.
- **Agente 3 (transporte+QA)**: implementa `transporte.ts` (outbox `e14-obs-outbox` — DB PROPIA) y sus QA; el stub ya compila y firma el contrato §4.3.
- **Rebase**: la branch ya está empujada — `git fetch origin && git rebase origin/feat/obs-nucleo-v1`.

## 9 · Cómo probar (dueño)

1. `bun run dev` → abrir la app → DevTools → Application → IndexedDB → `e14-obs` → `eventos` (habrá eventos `uso` tras navegar).
2. Desde la consola: `dispatchEvent(new ErrorEvent("error", {error: new TypeError("prueba obs")}))` → nuevo evento `error` con `digest` y `breadcrumbs`.
3. `localStorage.setItem("e14-dev-mode","on")` + recargar → tras 5 min aparece un evento `salud` (o `iniciarMuestreoSalud()` desde consola para la muestra inmediata).
4. Export manual (cuando el panel del agente 2 lo exponga): `descargarReporte("json", true)` desde consola → JSON + buffer vaciado.
