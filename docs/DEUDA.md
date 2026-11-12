# DEUDA — digielect14

Lo que falta, lo que está bloqueado y lo que **no** se debe tocar. Actualizado
el 2026-11-04 tras la limpieza profunda (fuera `tools/`, `lab/`,
`docs/archive/`, código muerto del módulo masiva y 48 KB de registro de kits en
`AGENTS.md`); cifras y estado re-verificados el 2026-11-12 (rama
`plan/ejecucion-2026-11-12`).

## Inventario que parece muerto y no lo es

- **Exports de `src/lib/e14/obs/`** (`abrirBuffer`, `registrarBreadcrumb`,
  `percentilDe`, `agregarUso`, `selloDe`, `diaDe`, `mezclarContador`,
  `volcarContadores`, `registrarUso`, `flushUso`, `FALLOS_KILL_LOCAL`,
  `TipoEvento`): `knip` los reporta como unused porque sus consumidores no son
  imports estáticos. `scripts/qa-obs-contract.ts` los exige con **regex sobre el
  fuente** (contrato §4.3) y `obs.test.ts` los alcanza con **import dinámico**.
- **`heic2any` (SÍ se quitó, el 2026-11-04)**: se declaraba aquí y en el core,
  pero solo el core lo importa (`dist/image-processor.js`). Al ser dependencia
  dura del core, sigue instalando y resolviendo; quedó como transitiva.
- **`framer-motion`**: desde la capa UI vendorizada (D83) tiene un import estático
  visible en `src/lib/e14/ui/ZoomableVisor.tsx`, así que `knip` ya no lo reporta.
  Antes parecía muerto porque solo lo usaba el `dist` de `@jg-stevan/scanner-ui`.
  **No quitarlo.**
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
  exigiendo «modo de diagnóstico», nombre que el mantenedor renombró a «modo
  desarrollador». Se recalibró **el harness**, no la UI.

Desde el 2026-11-04 esos harnesses **y** los 2 smoke de worker corren en CI
(`.github/workflows/quality.yml`), que además fijó `bun` en 1.4.2 — ver
"Trampas de entorno" abajo. Son **7** desde el mismo día con
`scripts/qa-paridad-motor.ts` (contrato de paridad con `supervision-e14`, D80);
en CI sale «omitido» porque no hay checkout hermano, y en local exige
`E14_HERMANO` o que el hermano esté al lado.

## Trampas de entorno (Windows ↔ CI)

- **`.gitattributes` no existía** y `core.autocrlf=true` materializaba los `.js`
  con CRLF. Los smokes comparan el artefacto generado **byte a byte** contra su
  regeneración, así que en Windows el gate cortaba en paso 4 con un fallo falso
  (`heartbeat.worker.js`: 5.071 bytes con CRLF vs 4.909 reales). Se resolvió
  fijando `* text=auto eol=lf` y `-text` para `public/scanner/*.js`. El índice ya
  estaba en LF (0 archivos `i/crlf`), así que no hubo renormalización.
- **…pero `.gitattributes` no reescribe el working tree que ya está materializado.**
  El clon viejo seguía con 172 archivos en CRLF (el blob en LF, así que
  `git status` los muestra LIMPIOS — el atributo normaliza al comparar y el cache
  de stat ni los lee). Se ve con `git ls-files --eol | grep w/crlf`. Consecuencia
  real, no estética: `public/models/rapidocr/ppocr_keys.txt` servido en DEV tenía
  **6.622 de 6.623 entradas terminadas en `\r`**, y `ocr/rapidocr.ts` partía por
  `"\n"` sin quitarlo ⇒ `ctcDecode` empalmaba `C\rO\rN\rS…` — texto que parece
  legible pero no matchea ni una ancla de `senal-lectura`. En PRODUCCIÓN no se ve
  (el build publica el blob, que es LF): es un fallo **solo de dev**, que se
  diagnostica mal porque «en el deploy funciona». Fix en dos partes: el parser
  ahora es `split(/\r?\n/)` (mismo fix que el hermano, por la misma razón — D80)
  y se renormalizaron los 13 assets servidos bajo `public/` que seguían en CRLF.
  El ancla vive en `scripts/qa-paridad-motor.ts`.
- **`bun` flotante**: los workflows usaban `setup-bun@v2` sin versión → `latest`.
  El minificador cambia entre versiones y el artefacto de capa 0 se commiteó con
  bun 1.3.x, así que la frescura dependía del día que corriera el job. Fijado en
  **1.4.2** en `quality.yml` y `deploy-cf.yml` (el mismo pin existía en
  `deploy-pages.yml`, retirado con A-02).
- **`quality.yml` y `deploy-cf.yml` usan `bunx next build`** (deploy-cf vía
  `bun run build`, que SÍ dispara el `prebuild`), que NO dispara el
  `prebuild` de `package.json`: publica los bytes commiteados de
  `capa0-qr.worker.js`. Si alguien edita `src/lib/e14/qr/capa0-qr.worker.ts` sin
  regenerar el artefacto, el worker publicado queda viejo — y ahora el smoke de
  CI lo atrapa. Regenerar con `bun run prebuild`.
- **Git Bash manglea `NEXT_PUBLIC_BASE_PATH=/digielect14`** (lo convierte a
  `C:/Program Files/Git/digielect14` y Next rechaza el basePath). En Windows,
  anteponer `MSYS_NO_PATHCONV=1` al comando; en CI (Linux) no aplica.


- **Copiar el `src` del motor desde un working tree de Windows trajo CRLF a un
  repo con `eol=lf`.** `CONTRATO.json` se generó con el md5 de esos bytes y el
  CI (Linux, que clona en LF) lo iba a cortar en rojo el primer run. Dos
  arreglo: los md5 se calculan sobre el contenido con saltos normalizados a LF
  (`SIN_CR` en el harness, ídem en `contrato-core.test.ts`) y el árbol vendorizado
  se renormalizó a LF. Se comprueba sin esperar al CI: `git show HEAD:<ruta>` da
  el blob tal como lo verá Linux, y su md5 tiene que coincidir con el contrato.
  Ojo: `git ls-files --eol | grep w/crlf` muestra que acá casi TODO el working
  tree está en CRLF aunque el índice esté en LF — por eso el md5 por bytes crudos
  nunca debió ser la garantía.

## Pendiente de decisión del mantenedor

1. **CERRADO por D86 (2026-11-08) — `src/assets/acta-e14-real.jpg` salió del
   repo.** Era foto real de un acta empaquetada como fixture SIM; el modo SIM
   carga ahora fixtures sintéticas (`acta-sim-*.jpg`) vía cargadores dinámicos.
   En el hermano `supervision-e14` las actas reales también salieron del árbol
   (D87 de ese repo) y la reescritura de historia quedó preparada en los dos
   repos (D91 acá, D90 allá) — ejecutarla sigue siendo paso del mantenedor.
2. **Historial de `.git` (verificado 2026-11-12: ≈22 MiB con `du -sh .git`)**:
   son blobs de binarios ML de commits
   antiguos, no ramas. Reducirlo exige reescribir historial
   (`git filter-repo` / BFG) → roto para cualquiera con clon, y la regla del
   repo prohíbe reescritura de historial sin autorización explícita.
3. **Ramas remotas mergeadas** (`git branch -r` — verificado 2026-11-12: 28
   ramas remotas, 29 refs contando `origin/HEAD`; 11 ya mergeadas a `main`
   según `git branch -r --merged origin/main`): borrarlas es acción
   remota y no reversible para otros.
4. **Licencia — RESUELTO**: `LICENSE` (MIT) existe en la raíz
   (verificado 2026-11-12).

## Deuda técnica real

- `docs/archivo/sim-recursos/*.js` (4 scripts, ≈76 KB — movidos a archivo el
  2026-11-12) son evidencia histórica
  de las corridas de gama baja; `knip` los ve como archivos sueltos. Se van con
  el próximo reporte que los cite o con decisión del mantenedor.
- **El HEIC de 12 MP sigue costando ~6,9 s.** El tope de D82 corta el caso que
  mataba el acta (50 MP), pero NO acelera el archivo que sí se decodifica:
  heic2any 0.0.4 decodifica a resolución nativa y no admite `width`/`height`
  (verificado en su `dist`), así que el recorte en el decode no existe. La
  salida real sería usar libheif directo (o una lib que sí recorte) dentro del
  worker propio de `public/scanner/`, con su propio kit de evidencia. Mientras
  tanto, el camino caro solo se paga en IMPORTAR un HEIC: la cámara del puesto
  dispara JPEG.
- El helper `blobADataUrl` está duplicado (privado) en `jornada.ts` y
  `puente/mapear.ts`. Doce líneas de glue de `FileReader`; fusionarlas obligaría
  a `mapear.ts` a importar `image-utils.ts`, que arrastra el motor
  (`src/lib/e14/core/`) a la capa de envío. Se prefirió duplicación antes que
  acoplamiento.
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

## Deuda abierta tras D88 (2026-11-10)

- **Acta `084906` no cierra AUTO con Tesseract**: SUGERIDA con `fast` y con
  `best` en los 4 equipos medidos (A56, A13, TECNO KN3 y Chrome de escritorio);
  el pipeline la acepta después con RapidOCR. Investigar qué campos de cabecera
  rechaza `clasificarCabecera` (DIVIPOLA, completitud, conf por campo) antes de
  tocar umbrales. Cualquier corrección es cambio del motor compartido: golden
  `contrato-motor.json` regenerado y misma edición en `supervision-e14`.
- **Tesseract en iOS sin verificar**: falta medir en Safari/WebKit con un Mac
  para Web Inspector; el entorno HTTPS de LAN con CA local ya se probó
  (`https://<ip>:8443`, COOP/COEP y cámara funcionando).
- **Worker de Tess tras importaciones encadenadas**: fallo intermitente sin
  recargar página (visto en A13 y PC); no se reproduce con recarga limpia. En
  campo cada acta llega tras una captura nueva; revisar si conviene reiniciar
  el worker por importación.

## 7. H-41 residuales — excepciones documentadas (C-7 del plan de cierre)

Criterio del cierre: `rg -i "dueñ"` en CÓDIGO ACTIVO (`*.ts`/`*.tsx`/`*.mjs`/
`*.yml`/`*.sh`) → **0 matches** en ambos repos (verificado 2026-11-12). Los
residuales restantes son excepciones documentadas:

1. **Datos oficiales (NO se tocan — fidelidad DIVIPOLA):**
   `public/e14/divipol.json` (ambos repos). Los matches son substrings de
   topónimos oficiales de sedes de votación: «I.E FONTIDUEÑO JAIME ARANGO R»,
   «SEC PRIMARIA IE FONTIDUEÑO JAIME ARANGO» (FONTIDUEÑO = nombre propio del
   corregimiento/sede, dato de la Registraduría). Igual criterio para
   `divipola-exterior.json` de sup si lo hubiera.
2. **Documentos archivados (histórico — se conservan tal cual):**
   `docs/archivo/auditoria/GUIA-AUDITORIA-supervision-e14.md:31,93,98` (sup) ·
   `docs/archivo/sim-recursos/README.md:52` (dig). Excepción anotada en la
   fila H-41 del CIERRE-REPORTE.
3. **Artefacto generado upstream (pendiente de regeneración upstream):**
   `public/scanner/detection-worker.js` +
   `packages/scanner-core/assets/scanner/detection-worker.js` (ambos repos,
   3 hits por archivo). Son comentarios muertos embebidos («aviso Canvas2D del
   dueño») de una fuente YA saneada en la Ola 4 — el bundle no se regeneró
   entonces. Este repo NO tiene pipeline para regenerarlo (el bundle proviene
   de `src/scanner/core/*` del repo origen web-scanner, ver cabecera del
   archivo; `preparar` regenera `capa0-qr.worker.js` — verificado idéntico —
   pero no el detection-worker). Sin impacto funcional (comentarios); queda el
   pendiente de regeneración en el pipeline upstream.
