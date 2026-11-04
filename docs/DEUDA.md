# DEUDA — digielect14

Lo que falta, lo que está bloqueado y lo que **no** se debe tocar. Actualizado
el 2026-11-04 tras la limpieza profunda (fuera `tools/`, `lab/`,
`docs/archive/`, código muerto del módulo masiva y 48 KB de registro de kits en
`AGENTS.md`).

## Inventario que parece muerto y no lo es

- **Exports de `src/lib/e14/obs/`** (`abrirBuffer`, `registrarBreadcrumb`,
  `percentilDe`, `agregarUso`, `selloDe`, `diaDe`, `mezclarContador`,
  `volcarContadores`, `registrarUso`, `flushUso`, `FALLOS_KILL_LOCAL`,
  `TipoEvento`): `knip` los reporta como unused porque sus consumidores no son
  imports estáticos. `scripts/qa-obs-contract.ts` los exige con **regex sobre el
  fuente** (contrato §4.3) y `obs.test.ts` los alcanza con **import dinámico**.
- **`framer-motion` en `dependencies`**: ningún `import` de `src/` lo nombra,
  pero es `peerDependency` de `@jg-stevan/scanner-ui` y lo usa `ZoomableVisor`
  (`src/components/e14/screens/ReviewView.tsx:38`). Está en el grafo: hay código
  de motion en los chunks de `.next/static`. **No quitarlo.**
- **`heic2any` (SÍ se quitó, el 2026-11-04)**: se declaraba aquí y en el core,
  pero solo el core lo importa (`dist/image-processor.js`). Al ser dependencia
  dura del core, sigue instalando y resolviendo; quedó como transitiva.
- **Comentarios que citan `apps/scanner-lab`, `SPEC-*` o `KIT e14-*`**: son
  artefactos de las sesiones de desarrollo (repo del motor y briefs). No son
  enlaces rotos; el catálogo real de decisiones es `docs/DECISIONS.md`.
- **`public/` (≈64 MB)**: modelos y runtimes cargados en runtime por red
  (`models/rapidocr`, `models/tess/spa.traineddata.gz`, `vendor/onnxruntime`,
  `vendor/tesseract` con wasm SIMD y no-SIMD, `vendor/opencv`). Ninguno sobra:
  el OCR, el QR y la detección los piden, y el service worker los precachea.

## QA de contrato: verde desde 2026-11-04

Los dos fallos que arrastraba `scripts/check-quality.sh` se cerraron en la limpieza:

- `qa-aa-quickwins.ts` (grises 500/600 con texto ≤11 px): tres microcopias de
  `dev/PanelDev.tsx` y `dev/SeccionRastreo.tsx` pasaron de `text-slate-500` a
  `text-slate-400`. Solo el panel de desarrollador; la UI de campo no se tocó.
- `qa-obs-ui.ts` (`aria-label` de la puerta del modo dev): el ancla seguía
  exigiendo «modo de diagnóstico», nombre que el dueño renombró a «modo
  desarrollador». Se recalibró **el harness**, no la UI.

Desde el 2026-11-04 esos 6 harnesses **y** los 2 smoke de worker corren en CI
(`.github/workflows/quality.yml`), que además fijó `bun` en 1.4.2 — ver
"Trampas de entorno" abajo.

## Trampas de entorno (Windows ↔ CI)

- **`.gitattributes` no existía** y `core.autocrlf=true` materializaba los `.js`
  con CRLF. Los smokes comparan el artefacto generado **byte a byte** contra su
  regeneración, así que en Windows el gate cortaba en paso 4 con un fallo falso
  (`heartbeat.worker.js`: 5.071 bytes con CRLF vs 4.909 reales). Se resolvió
  fijando `* text=auto eol=lf` y `-text` para `public/scanner/*.js`. El índice ya
  estaba en LF (0 archivos `i/crlf`), así que no hubo renormalización.
- **`bun` flotante**: los workflows usaban `setup-bun@v2` sin versión → `latest`.
  El minificador cambia entre versiones y el artefacto de capa 0 se commiteó con
  bun 1.3.x, así que la frescura dependía del día que corriera el job. Fijado en
  **1.4.2** en `quality.yml` y `deploy-pages.yml`.
- **`deploy-pages.yml` y `quality.yml` usan `bunx next build`**, que NO dispara el
  `prebuild` de `package.json`: publican los bytes commiteados de
  `capa0-qr.worker.js`. Si alguien edita `src/lib/e14/qr/capa0-qr.worker.ts` sin
  regenerar el artefacto, el worker publicado queda viejo — y ahora el smoke de
  CI lo atrapa. Regenerar con `bun run prebuild`.
- **Git Bash manglea `NEXT_PUBLIC_BASE_PATH=/digielect14`** (lo convierte a
  `C:/Program Files/Git/digielect14` y Next rechaza el basePath). En Windows,
  anteponer `MSYS_NO_PATHCONV=1` al comando; en CI (Linux) no aplica.


## Pendiente de decisión del dueño

1. **`src/assets/acta-e14-real.jpg`** (348 KB) es **foto real de un acta** y viaja
   empaquetada como fixture SIM (`scanner-core-bridge.ts:104` y `:343`). El repo
   es público y la regla del proyecto es no commitear actas. Los síndticos
   `acta-sim-*.jpg` ya cubren los tiers; reemplazarla cambia el comportamiento
   del modo SIM (y su peso), por eso no se hizo en la limpieza.
2. **Historial de `.git` (≈55 MB)**: son blobs de binarios ML de commits
   antiguos, no ramas. Reducirlo exige reescribir historial
   (`git filter-repo` / BFG) → roto para cualquiera con clon, y la regla del
   repo prohíbe reescritura de historial sin autorización explícita.
3. **Siete ramas remotas ya mergeadas** (`git branch -r`): borrarlas es acción
   remota y no reversible para otros.
4. **Licencia**: el repo aún no tiene `LICENSE`. Sin ella, "público" implica
   todos los derechos reservados.

## Deuda técnica real

- `docs/evidence/sim-recursos/*.js` (4 scripts, ≈76 KB) son evidencia histórica
  de las corridas de gama baja; `knip` los ve como archivos sueltos. Se van con
  el próximo reporte que los cite o con decisión del dueño.
- El helper `blobADataUrl` está duplicado (privado) en `jornada.ts` y
  `puente/mapear.ts`. Doce líneas de glue de `FileReader`; fusionarlas obligaría
  a `mapear.ts` a importar `image-utils.ts`, que arrastra `@jg-stevan/scanner-core`
  a la capa de envío. Se prefirió duplicación antes que acoplamiento.
- `docs/` sigue siendo la mayor parte del peso documental (≈450 KB tras la
  limpieza). `DECISIONS.md` (94 KB) y `SPEC-*` (≈99 KB) son la referencia de
  comportamiento; los `REPORTE-*` son evidencia puntual de cada kit.
- La bitácora por sesión (`docs/worklog.md`, 528 KB) se retiró del repo: su
  contenido es reconstructible con `git log` + `docs/DECISIONS.md`.
- El worklog retirado dejaba constancia de unos tokens `ghp_`/`vcp_` pegados en
  chat durante los merges de 2026-10-21, con orden de revocarlos. No queda ningún
  literal en el repo (verificado con grep de patrones `ghp_`/`vcp_`/`github_pat_`
  y JWT), pero **confirmar la revocación** en GitHub y Vercel.

## Intocables (con razón)

- `evaluarGate()` y `statusDeScore()`: el desenlace lo decide el gate, no el
  score crudo (D6). Cambiar un umbral sin registrar la decisión está prohibido.
- El veto `INCOMPLETA` y el marcador `SIN_VOTOS` corren **fuera** de `evaluarGate`
  y mandan sobre él (D41).
- `REGISTRO_KITS` (`kits.ts`): solo rellena la mesa cuando la cabecera no la
  leyó; nunca produce `AUTO`. Ampliarlo exige actas oficiales verificadas.
- Los estados de `Acta` y las claves de persistencia (`e14-obs`,
  `e14-flags-overrides`, …): son contrato con el hub y con datos ya guardados en
  dispositivos en campo.
- `public/models/rapidocr/*` y `public/vendor/**`: versionados a mano junto con
  el core; cambiarlos sin re-medir tiempos rompe las decisiones D53/D60/D76.
