# REPORTE — SPRINT-B · ui-hooks-v1 (Agente 2 · capa visual)

> **Fecha**: 2026-10-23 · rama `refactor/ui-hooks-v1` (desde main `10209b7`,
> merge #90) · kit `AGENTE-2-UI.md` (autocontenido, Task ID: SPRINT-B).
> **Zona respetada**: SOLO `src/components/**` (5 hooks nuevos + 4 pantallas/
> componentes editados) + docs. `src/lib/**`, `src/app/**`, `scripts/**`,
> `package.json`, configs: **INTACTOS** — cero diff.

---

## 1. Resumen (8 líneas)

- **B1 — refactor puro**: `ScanView.tsx` 2,487 → **1,159 líneas** (meta kit
  < 1,400 ✓) extrayendo 5 hooks dedicados en `src/components/e14/hooks/`
  (1,727 líneas movidas). Mismos cuerpos, mismos refs, mismo orden de
  efectos; los imports de `lib` quedan EXACTAMENTE iguales (consume, no
  edita). Cero cambios de comportamiento.
- **B2 — regresión #1/#2 cerrada**: la BARRA DE VIDA D65 T3.3 (~46 líneas,
  nacida en D65/`84cd0be`/`5374382`, perdida en el zip `4f9c871`) re-cableada
  VERBATIM en `MasivaView.tsx` sobre la plomería intacta (`recienListas`,
  `enColaVida`/`posCola`, `colaVida`, `ocrPct` honesto).
- **B3 — regresiones #3/#5/#7 cerradas**: menú §6.3 abandonado (estados +
  efecto Escape + comentarios + 3 llamadas defensivas del segmented),
  `StitchFrameIcon` borrado (grep = solo definición), pulso
  `animate-pulse-sync` del EN LÍNEA restaurado en ActasView.
- **B4 — barrido sin hallazgos accionables**: los botones de icono ya
  llevan aria-label/title (pasadas 3A/overnight), las `key={i}` restantes
  son listas posicionales donde el índice es la identidad correcta
  (esquinas del quad, segmentos, partes de texto). Cero churn.
- **Los 3 warnings lint deliberados ELIMINADOS** (recienListas, posCola,
  modoMenuMontado). Lint final: **0 errores · 1 warning** — el de
  `src/lib/logger.ts` (directiva muerta), **zona PROHIBIDA por el kit**
  (preexistente; se reporta, no se toca).
- **Gate íntegro verde**: tsc 0 · lint 0 err/1 warn (fuera de zona) ·
  vitest 53/53 · QA 7/7 (294 aserciones) · build exit 0 · humo manual
  5/5 en navegador con 0 errores de consola/página.
- Commits atómicos uno por tarea: `refactor(ui)` B1 → `feat(ui)` B2 →
  `fix(ui)` B3 (gate completo por commit).

## 2. B1 — qué se movió a cada hook (movimiento puro)

Fuente única: `git show 10209b7:src/components/e14/screens/ScanView.tsx`.
Los cuerpos se copian TAL CUAL; lo único adaptado es la INYECCIÓN de
propietarios (un objeto de params por hook) y los comentarios de cabecera.
**Patrón de propiedad**: ScanView crea los refs/estados COMPARTIDOS entre
dominios (videoRef, visorRef, streamRef, procesandoRef, cooldownRef,
autoArmado/autoRef, camEstado, sensorProfileRef, avisoVisor/mostrarAviso,
live/setLive, gridOn, videoDims/boxSize, inputs, capturarRef) y los inyecta;
cada hook es dueño de lo que NADIE más toca.

| Hook (nuevo) | Líneas | Contenido movido (de ScanView original) | Inyecciones |
|---|---|---|---|
| `useAnilloBestShot.ts` | 220 | RING_MAX_LONG_SIDE, ZSL_DESDE/HASTA_MS, RING_MAX, RING_FEED_MS, `medirGris`/`medirPixeles`, `FrameAnillo`, `liberarCanvas` (export), `empujarAnillo`, `alimentarAnillo`, `liberarAnillo`, `instantanea`, `tomarZsl` | `videoRef` |
| `useLinterna.ts` | 140 | `TORCH_HINT` (export), flashPrefOn/flashRef, torchOn/torchOnRef/torchDisponible, espejos por render (ex-L748-749), `ponerLinterna`, `aplicarLinternaGuardada`, `alternarLinterna` | `streamRef`, `camEstado`, `mostrarAviso` |
| `useDestello.ts` | 270 | NAVEGACION_TRAS_MS (export), `downscaleImage` (módulo), destelloKey, `actaObjetivoRef` (G3 — queda INTERNO: lo escriben despacharCaptura y lo lee mejorarSilenciosa, ambos aquí), `blobToDataUrl`, `canvasABlob`, `despacharCaptura` (interne: única llamada desde despacharArchivo), `archivoDentroDeTope`, `despacharArchivo`, `mejorarSilenciosa` | `sensorProfileRef`, `procesandoRef`, `setProcesando`, `setArchivoPendiente`, `dispararEscaneo`, `mejorarFotoActa` |
| `useSelectorFuente.ts` | 145 | `reintentoCamara` (token §E), `pareceImagen`/`esHeic`, `alElegirArchivo`, `alElegirFotoCamara` | `procesandoRef`, `mostrarAviso`, `archivoDentroDeTope`, `setArchivoPendiente`, `setFuente`, `dispararEscaneo`, `despacharArchivo` |
| `useSesionCamara.ts` | 952 | IS_ANDROID/CAN_TAKEPHOTO, IDEAL_PREVIEW_*, FOTO_LADDER, `esCalidadPrimero`, TAKEPHOTO_TIMEOUT_MS, `declare global` (telemetría), F-LENS v4 completo (BACK/FRONT_RE, `CameraProbeResult`, `hasRealAF`, `readCapsNum`, `probeCamera`, `chooseMainProbe`, caché `e14-main-camera-v1`, PROBE_TIMEOUT_MS), `esIOS` (export), `CamEstado`/`LiveUi` (export), `avisoCamara`, `puedeTomarFotoRef`, `takePhotoBrokenRef`, toastIOSYaRef, telemetriaAtRef, loopRef, `profileActiveSensor`, `tomarFoto`, y los 4 EFECTOS: ARRANQUE (con cierre byte a byte) → re-asignar → «playing» → FRAME LOOP | `videoRef`, `streamRef`, `camEstado`/`setCamEstado`, `reintentoCamara`, `autoRef`/`setAutoArmado`, `procesandoRef`, `cooldownRef`, `capturarRef`, `setLive`, `mostrarAviso`, `setFramePendiente`, `flashRef`, `torchOnRef`, `aplicarLinternaGuardada`, `setTorchDisponible`, `sensorProfileRef`, `alimentarAnillo`, `liberarAnillo` + `fuente` (suscripción propia al store — mismo selector) |

### 2.a Orden de efectos — INVARIADO

Orden de registro EXACTO al original: **§9 warmup → (Escape modoMenu,
eliminado en B3) → ARRANQUE → re-asignar → playing → ResizeObserver →
FRAME LOOP**. Los efectos de sesión viven en `useSesionCamara`, llamado
DESPUÉS del §9 y ANTES del RO de ScanView. Cero dependencias cruzadas
entre ellos (verificado: §9 es prewarm idempotente; RO solo observa el
visor; la sesión solo toca sus refs/estados).

### 2.b Deps de callbacks — única adaptación semánticamente neutra

El linter (`exhaustive-deps` warn SOLO en `screens/ScanView.tsx` — override
por ruta CONGELADO, no tocado) ya no puede verificar que `loopRef`,
`puedeTomarFotoRef`, `takePhotoBrokenRef` y `setDestelloKey` son refs/
setters estables (ahora vienen de hooks). Se añadieron a los arrays de
`capturarInteligente` y `alDisparar` **con comentario**: son objetos con
identidad invariable (Object.is igual en cada render) → la frecuencia de
re-creación de los callbacks es IDÉNTICA al original. Sin directivas
nuevas; las 3 directivas del original NO se arrastraron a `hooks/` (la
regla no aplica fuera de ScanView — kit: probar sin directiva antes de
arrastrar; su justificación quedó como comentario en cada efecto).

## 3. B2 — decisiones

- **Verbatim del histórico**: bloque recuperado de
  `git show 5374382:src/components/e14/screens/MasivaView.tsx` (L611-657;
  `84cd0be`/`e8c98de` no existen en el clone — el nacimiento D65 y el padre
  del zip sí; mismo bloque). Comentario original completo conservado +
  nota SPRINT-B.
- **`ocrPct` honesto restaurado** (comentario «kit T3 honestidad»): solo
  dato REAL del reconocedor (`esActiva && progreso?.etapa === "ocr" &&
  progreso.ocrFraccion != null`). El chip `%` reducido del zip
  (`pctProceso`, píldora con `title`) **CONVIVE** — igual que en las ramas
  previas al zip (información: % sobrevive, se RECUPERAN posición en cola,
  destello, barra ERROR y semántica a11y `role="progressbar"` +
  `aria-valuemin/max/now` + `aria-live="polite"` en el texto de etapa).
- **`etiquetaVida({ etapa })`**: la firma actual acepta `{ etapa,
  fracGlobal? }` — la llamada original compila sin tocar la función
  (ancla QA e65b grepea el FILTRO `colaVida`, no el render — intacto).
- Consumir `recienListas`/`posCola` eliminó los 2 warnings lint
  deliberados de MasivaView (decisiones D65 del dueño — cerradas).

## 4. B3 — decisiones y desviación documentada

- **Menú §6.3**: borrados `modoMenuAbierto/modoMenuMontado`, el efecto
  Escape (keydown + doble raf de entrada) y los comentarios huérfanos.
  **ADENDA al kit**: el segmented CÁMARA/SIM/SUBIR conservaba 3 llamadas
  defensivas `setModoMenuAbierto(false)` en sus onClick (plomería colgante
  del JSX que ya no existe — parte del mismo huérfano #3); eliminadas
  también (tsc las habría marcado). grep `scripts/` previo: solo un
  COMENTARIO en `check-quality.sh` (§1: «los 3 warnings deliberados…
  siguen permitidos») — sin anclas de código; ese comentario queda STALE
  a propósito (scripts/ zona prohibida) — nota para el dueño.
- **`StitchFrameIcon`**: condición del kit verificada (grep src/ scripts/
  = solo la definición) → borrado con nota (audit #7).
- **Pulso EN LÍNEA (ActasView)**: `animate-pulse-sync text-[#10b981]`
  cuando `online` — patrón idéntico al botón SIM (L270); clase ya existe
  en globals.css.
- **DESVIACIÓN — `cerrarAyuda`**: el kit pedía «de-exporta (uso interno)»
  si el grep confirmaba ausencia de consumidores. El grep confirmó que no
  tiene consumidores NI INTERNOS (el overlay usa el action `cerrar` del
  store en su componente). De-exportar habría creado un local sin uso =
  warning lint nuevo. Se **BORRÓ** (código muerto del todo — protocolo 3B
  del overnight: «export muerto» ≠ «código muerto»). `abrirAyuda` sí
  tiene consumidores (SideNav/ScanView) — intacta.

## 5. Gate íntegro (por commit y final)

```
bunx tsc --noEmit          → 0 errores            (cada commit)
bun run lint               → 0 errores · 1 warning (cada commit)
                             └ src/lib/logger.ts:25 directiva muerta
                               («no-console») — PREEXISTENTE, zona
                               PROHIBIDA (src/lib) → reportada, NO tocada.
                               Los 3 deliberados del kit: ELIMINADOS.
bun run test               → vitest 53/53          (cada commit)
for f in scripts/qa-*.ts   → autoenvío 33/33 · dedup-enviadas 50/50 ·
                             escaneo-ya-recortado 24/24 · historico 49/49 ·
                             identidad-acta 32/32 · qr-identidad 72/72 ·
                             watchdog-relectura 34/34  (7/7 suites — cada commit)
bun run build              → exit 0 (Next 16, estático)  (cada commit)
```

## 6. Validación manual (humo en navegador — dev :3001, agent-browser)

| Recorrido | Resultado |
|---|---|
| **SIM completo** | chip ÓPTIMA → pipeline real (`[e14] pipeline SIMULACION/file total=10563ms … score=8.2 … clasif={mesa:003 … nivel:AUTO}`) → REVISIÓN con desenlace → auto-envío 10.0. `detMemo=miss` del D62 presente en logs. |
| **Cámara** | sandbox sin cámara/secure-context → overlay §E renderiza con [PROBAR CON SIMULACIÓN] [Reintentar cámara] [Subir foto] (valida `avisoCamara`/`setAvisoCamara`/`reintentoCamara` inyectados por el refactor). Hardware real NO disponible en sandbox — la ruta de aviso/reintento es la que tocó el sprint; la apertura (sondas F-LENS, stream) quedó byte a byte. |
| **MASIVA (3 fotos)** | ingesta → dedup e63k marcó 2 gemelas (fixtures casi idénticos — correcto) → PROCESAR → **barras de vida EN VIVO verificadas en el DOM**: `progressbar "OCR 50%"` con aria-valuenow, etapas PREPARANDO→DETECCIÓN 19/22%→OCR, señal «EN COLA»/PROCESANDO 0/3 en el resumen → 3/3 LISTA con ABRIR en revisión. |
| **Ayuda (?)** | dialog «Cómo funciona el Digitalizador E-14» abre al 1.er uso y cierra con [ENTENDIDO — EMPEZAR]. |
| **Navegación** | ESCANEAR/ACTAS/MASIVA/RESUMEN + CÓMO FUNCIONA — las 5 rutas renderizan. |
| **Consola/página** | 0 errores de página (`agent-browser errors` vacío); solo logs informativos del pipeline. |

## 7. Fuera de alcance (respetado)

- `src/lib/logger.ts` directiva muerta — zona PROHIBIDA (kit §1); el
  overnight la dejó así porque `no-console` no aplica al módulo gateado.
  Fix trivial (borrar la línea 25) — para el dueño o un kit de lib.
- Fila #6 del audit (`wasm.proxy` en rapidocr) — decisión del dueño.
- Comentario stale en `scripts/check-quality.sh` §1 (menciona los 3
  warnings que este sprint eliminó) — scripts/ zona prohibida.
- B4: sin cambios (§1) — el barrido no encontró botones de icono sin
  nombre accesible ni keys inestables reales.

## 8. Continuidad

- Rama `refactor/ui-hooks-v1` → PR DRAFT a main. El agente NO mergea.
- Los hooks son el punto de extensión natural de la Fase 4 (módulos
  grandes): cualquier nuevo comportamiento de cámara/linterna/captura
  entra por su hook, ya no por el componente de 2,500 líneas.
- Pendiente del dueño: humo con hardware real (cámara Android/iOS — las
  rutas de stream quedaron intactas pero el gate final es de campo),
  revisar el PR, y decidir el fix del logger (fuera de zona).
