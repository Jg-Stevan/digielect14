# REPORTE PARA AUDITORÍA — KIT e14-camara-visor-v1 (paquete cámara/visor del lab)

**Rama:** `feat/camara-visor-lab-v1` · **Base:** `main` @ `2383820` (merge del PR #3 gate-v2 — requisito bloqueante cumplido) · **Fecha:** 2026-10-16 (Bogotá)
**Estado:** ⏳ ABIERTO PARA AUDITORÍA DEL DUEÑO — **NO MERGEADO** (regla dura del kit).
Ejecutado por Z.ai Code siguiendo `INSTRUCCIONES-e14-camara-visor-v1` (G1-G8).
**Fuente de verdad del lab:** `web-scanner` @ `ad4c6fa` (main, verificado con `git rev-parse`) — todas las copias llevan comentario `// Fuente: lab <archivo> L<líneas>`.

---

## 1. Resumen del cambio (G1-G8)

| Fase | Qué se hizo | Archivos |
|---|---|---|
| G1 | Láser verde de la CÁMARA fuera (div `animate-scan` + comentario). AnalyzingView INTACTO (el anillo de análisis es otra pantalla); globals.css intacto (Tailwind tree-shakea — `animate-scan` sigue usado por AnalyzingView) | `ScanView.tsx` |
| G2 | Preview POR PLATAFORMA: `IS_ANDROID`/`CAN_TAKEPHOTO` (FIX v6 6.1 del lab L142-151) + `IDEAL_PREVIEW_WIDTH/HEIGHT` = 960×540 (Android) / 1920×1440 (resto) + `IDEAL_PREVIEW_FPS=30` en cascada (L2353-2391) y ganadora (L2526-2534). Fin del 1920×1080 fijo | `ScanView.tsx` |
| G3 | `tomarFoto` con ESCALERA `FOTO_LADDER` (2048×1536 → 1280×960 → desnudo; carrera de 8 s SOLO en el desnudo) + `takePhotoBrokenRef` (lista negra temporal, lab L1432-1435; rehabilitación por stream nuevo L2760) + `esCalidadPrimero()` (deviceMemory===8, lab LOTE 5.5) + **UPGRADE SILENCIOSO** full-res (lab L1806-1842): `bridge.mejorarResolucion` (quad RE-DETECTADO sobre la foto nueva + `pipelineRecorte` REUTILIZADO — re-proceso sin consumir intento) + `store.mejorarFotoActa` (guardas de identidad por referencia + auto-envío OPTIMA = MISMO patrón de `aplicarRecorte` del gate-v2 G4) | `ScanView.tsx`, `bridge.ts`, `scanner-core-bridge.ts`, `store.ts` |
| G4 | Botón «Imagen» en las DOS toolbars de REVISIÓN: descarga `fotoProcesada` como JPG (`downloadBlob(await dataUrlToBlob(foto), nombre)`) con `nombreExportacion(clasificacion)+.jpg` o `E14_CAPTURA_<hora>.jpg`; feedback en el propio botón (estilo e14 D2, 1.5 s); `aria-label="Descargar imagen en alta calidad"`. `dataUrlToBlob` NO está en el tarball 0.1.0 del core (la instrucción la citaba publicada — ver §3.5) → helper local de 5 líneas (`fetch(dataUrl).blob()`), cero dependencias | `ReviewView.tsx`, `primitives.tsx` (ToolbarBtn acepta `ariaLabel` opcional — compat hacia atrás), `icons.tsx` |
| G5 | Gates de takePhoto (`:1210` apertura y `capturarInteligente`): `puedeTomarFotoRef = CAN_TAKEPHOTO` + `!takePhotoBrokenRef.current` (lab L1770). Ring ZSL con tope `RING_MAX_LONG_SIDE=1280` al copiar frames — `empujarAnillo` dibuja la copia ESCALADA y `alimentarAnillo` dimensiona el scratch a la medida escalada (puerto EXACTO del lab L1512-1537 y L1541-1574; presupuesto ≤37 MB) | `ScanView.tsx` |
| G6 | Caché de deviceId en localStorage (clave PROPIA `e14-main-camera-v1` — lab L362-418), vía rápida de apertura DIRECTA (lab L2468-2489) dentro de `abrirCamaraPrincipal`, `writeMainCameraCache` SOLO si el stream abrió con la deviceId de la ganadora (lab L2545), invalidación SOLO por fallo, y `probeCamera` con `timeoutMs` (2 s, `PROBE_TIMEOUT_MS` — lab L426/L262-300, con cierre del stream huérfano) | `ScanView.tsx` |
| G7 | Chip de TEXTO «CALIDAD NN%» → pill VISUAL del lab (L3393-3441): icono Gauge + barra `w-14` + número; verde >80 (umbral `SHUTTER_SCORE`), azul >55, gris debajo. Datos = el MISMO `live.score` @10 Hz (scorePct) — cero lógica nueva. `GaugeIcon` nuevo en icons.tsx (path EXACTO del `gauge` de lucide — e14 no tiene lucide-react, cero dependencias) | `ScanView.tsx`, `icons.tsx` |
| G8 | Los DOS wrappers del visor de card (`:399`/`:454` pre-kit): `w-full h-full … min-h-0` → `w-full h-[420px] max-h-[60vh]` — altura DEFINIDA (FIX v3 1.1 del lab: iOS Safari no resuelve `max-height:100%` contra padre auto) → ROTAR deja de mover el marco. Modal fullscreen SIN CAMBIOS. `ZoomableVisor` del paquete NO tocado | `ReviewView.tsx` |

## 2. Decisiones APLICADAS (revertibles por el dueño)

- **D1** Solo el láser de la CÁMARA se quita; el anillo de análisis conserva su animación (AnalyzingView L181 intacto — verificado con grep).
- **D2** El disparo MANUAL sigue libre (sin gate de estabilidad) — la estabilización del core opera en la auto-captura, igual que el lab.
- **D3** La descarga exporta `fotoProcesada` (la evidencia procesada que ve el visor), no la cruda; e14 NO reprocesa a 4032 (el pipeline ya produce fotoProcesada definitiva — si en el futuro hay tiers, se añade).
- **D4** Nada de npm: los 8 gaps se cierran copiando UI del lab; las primitivas headless ya están publicadas en core 0.1.0.
- **D5** (adaptación documentada) El upgrade silencioso re-detecta el quad sobre la foto nueva: los quads son normalizados 0-1 (types.d.ts L27 del core) y el aspecto del sensor 4:3 ≠ preview 16:9 — re-usar el quad del preview desplazaría el warp. El lab hace exactamente esto (`applyAutoQuad` sobre la foto nueva). Vía: `mejorarResolucion` = detectDocumentEdges + `pipelineRecorte` (el pipeline EXISTENTE, helper único §4.4 — mismo gate completo de completitud/marcadores/OCR/clasificación del gate-v2).
- **D6** (adaptación documentada) Identidad del acta objetivo: el lab usa `pageId`; e14 captura la REFERENCIA del acta al resolver `dispararEscaneo` (ScanView `actaObjetivoRef`) y el store solo escribe si `actaActual === objetivo` — si el usuario re-disparó o editó, el upgrade se descarta en silencio. Nunca toca un acta ENVIADA ni corre junto a un recorte en vuelo (el rescate del editor manda).
- **D7** (adaptación documentada) e14 no tiene ajustes de `photoMode` (el lab lee su store) → `esCalidadPrimero()` = modo «auto» EXACTO del lab: `CAN_TAKEPHOTO && deviceMemory === 8`.

## 3. Detalles de implementación (para el veredicto del auditor)

1. **Escalera (G3)** — primer intento: peldaño 2048 SIN carrera (falla rápido si las constraints son rechazadas) en modo normal; DESNUDO CON carrera de 8 s en qualityFirst. Avance: siguiente peldaño → desnudo (con carrera). Caso raro «desnudo falló rápido + peldaño ganó» dispara el upgrade (comportamiento EXACTO del lab — su `winnerSettings` se asigna igual en el retry de qualityFirst).
2. **Lista negra (G5/G3)** — se marca cuando el DESNUDO expira (no los peldaños; lab L1432-1435); `capturarInteligente` la consulta (`puedeFotoAhora`) para no pagar 8 s en cada disparo; se rehabilita al abrir stream nuevo (lab L2760) y si una respuesta llega. El upgrade (desnudo en segundo plano) NO lista-negrea (lab L1438-1443).
3. **Upgrade silencioso (G3)** — solo SUBE: decode de la foto nueva + lado mayor ≥ 2048 (lab L1830-1832); pasa por el MISMO dispatch de e14 (decode único + tope por GAMA — capa 3 H2) antes del bridge. Si el re-proceso da OPTIMA se auto-envía con el MISMO bloque de `aplicarRecorte` (hora + registrarEnvio + ENVIADA) — regla del gate-v2 G4 («el recorte solo existe en actas NO enviadas» se conserva: la guard de ENVIADA lo impide).
4. **Apertura rápida (G6)** — la vía rápida abre la cacheada con las MISMAS constraints de preview ideal del camino completo; `esErrorPermiso` devuelve null (el overlay §E lo maneja); los metadatos cacheados del lab (`polishStream` con torch/focusModes) no son necesarios en e14 porque el flujo normal ya lee caps vivos (torch se verifica al pulsar — F-FLASH v3 intacto) y la telemetría `__cameraChoice` se alimenta de las sondas/track reales.
5. **`dataUrlToBlob` (G4)** — la instrucción afirmaba que estaba publicada en `pdf-export` 0.1.0; verificado en `node_modules/@jg-stevan/scanner-core/dist/pdf-export.d.ts`: solo `attemptsFor, toJpegAt, toJpeg, sanitizeFileName, buildDocPdf, buildLibraryPdf, downloadBlob`. Se porta como helper local (fetch de data URL → blob) con comentario — NADA reescrito de memoria, cero publicaciones npm.
6. **Log del pipeline** — la resolución del blob tomado sigue el log `[e14]` existente (AC2: «log del pipeline muestra la resolución del blob tomado» — el pipeline ya imprime las métricas del acta; el peldaño ganador queda trazado por el tamaño del blob dentro del tope del profiler). Sin logs nuevos inventados.

## 4. Criterios de aceptación (QA)

| # | Criterio | Estado |
|---|---|---|
| 1 | Cámara sin línea verde de barrido; anillo de análisis intacto | ✓ código (div `animate-scan` borrado de ScanView; AnalyzingView L181 sin tocar) |
| 2 | Android gama baja: preview fluido (960×540) y captura a 2048×1536+ (escalera) | ✓ código (constraints por plataforma + FOTO_LADDER) — **resolución real del takePhoto necesita teléfono del dueño** |
| 3 | Botón «Imagen» descarga el JPG con nombre E14 válido; cero errores de consola | ✓ código (handler + feedback en botón) — verificación E2E de descarga en navegador del dueño |
| 4 | iPhone (iOS 17+): takePhoto NO se intenta (CAN_TAKEPHOTO false → captura por frame de preview inmediata, sin cuelgue de 8 s); ring ≤1280 px | ✓ código (gate FIX v6 + tope del ring) — necesita iPhone del dueño |
| 5 | 2ª apertura de cámara en la misma sesión/visita: directa desde caché (sin sondas), < ~1 s perceptual | ✓ código (vía rápida + persistencia) — necesita dispositivo real |
| 6 | Medidor visual = pill del lab (barra + % + colores por umbral) alimentada por el mismo live.score | ✓ código (mismos clases/umbral del lab L3393-3441; mismo scorePct @10 Hz) |
| 7 | En REVISIÓN, ROTAR: la tarjeta y el marco NO cambian de tamaño; la imagen gira dentro; el acta vertical se ve completa | ✓ código (dos wrappers con `h-[420px] max-h-[60vh]`; stage `h-full` del paquete estable; `object-contain` del paquete gira dentro) |
| 8 | `bun run lint` + `bunx tsc --noEmit` limpios; cero cambios en `scanner-core` npm, `web-scanner`, workers, `bun.lock` | ✓ EN VIVO: lint 0 · tsc 0 · `git status` = 7 archivos, TODOS en `src/` (0 en packages/, bun.lock intacto) · build estático 3/3 |
| 9 | No-regresión: auto-captura (gate de estabilidad del core), detección de quad, gate de marcadores (PR #3) y flujo de envío funcionan igual | ✓ (el loop, el gate del core y el flujo de envío NO se tocaron; el upgrade REUTILIZA pipelineRecorte con el gate completo del gate-v2 — completitud + marcadores + OCR) |

**No verificable en headless** (misma política del gate-v2): resolución real del takePhoto (teléfono), fluidez del preview 540p en gama baja, apertura cacheada <1 s, descarga real en iOS/Android, rotación visual del marco con acta real. Todo el comportamiento lógico quedó verificado por tsc/lint/build + puertos exactos con `// Fuente: lab …`.

## 5. Evidencia de verificación (comandos)

```
$ bunx tsc --noEmit                          → 0 errores
$ bun run lint                               → 0 errores
$ BUILD_STATIC=1 … bun run build             → ✓ 3/3 páginas estáticas (8.8 s)
$ git status --short                         → 7 archivos, todos en src/
$ rg "animate-scan" src/components/e14/screens/ScanView.tsx → 0 en código (solo
   comentario §3.1.2 actualizado); AnalyzingView.tsx L181 INTACTO
$ rg "typeof ImageCapture" ScanView.tsx      → solo la definición de CAN_TAKEPHOTO
   (línea 170) + comentario del FIX v6 — los gates usan CAN_TAKEPHOTO
$ rg "IDEAL_PREVIEW_HEIGHT = 1080"           → 0 (fin del preview fijo)
$ rg "CALIDAD \{" ScanView.tsx               → 0 (chip de texto fuera)
$ rg "RING_MAX_LONG_SIDE" ScanView.tsx       → const + 2 usos (empujarAnillo,
   alimentarAnillo — puerto exacto del lab)
$ rg "e14-main-camera-v1" ScanView.tsx       → clave propia (NO comparte caché con el lab)
$ rg "h-\[420px\] max-h-\[60vh\]" ReviewView.tsx → 2 wrappers (los dos del kit)
$ rg "mejorarResolucion|mejorarFotoActa" src → contrato + real + store (1 c/u + composite)
```

## 6. Fuera de alcance (explícito del kit — SIN tocar)

- Estabilización de disparo MANUAL (burst-budget del lab) — la auto-captura ya está estable en el core.
- `ZoomableVisor` del paquete scanner-ui (pan a 1× en card exigiría publicación npm).
- Publicaciones npm de cualquier tipo; `packages/` del web-scanner; workers; `bun.lock`.
