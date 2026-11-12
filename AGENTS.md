# AGENTS.md — digielect14

Reglas para agentes IA (y personas) que editan este repo. El producto es un
digitalizador de actas E-14 que corre en el navegador del celular; trabaja con
**datos electorales reales**.

## Comandos (verificados contra `package.json`)

- `bun install` — gestor: **bun**. No uses npm ni pnpm.
- `bun run preparar` — materializa lo que no se versiona: vendor copiado de `node_modules` y modelos/OpenCV descargados con SHA-256 fijado (`scripts/assets.lock.json`). Un clon limpio lo necesita antes de `bun run test`.
- `bun run dev` — Next.js en el puerto 3000 (OCR a un hilo: `next dev` no emite
  cabeceras COOP/COEP, así que `crossOriginIsolated` es falso).
- `bun run verificar` — preparar + typecheck + lint + test. **Es la puerta de salida**: nada
  se declara terminado sin este comando en verde, y se reporta su salida real.
- `bun run build` — bundle de producción (el `prebuild` genera el worker de capa 0).
- Sueltas: `bun run typecheck` · `bun run lint` · `bun run test` · `bunx knip`.
- `bash scripts/check-quality.sh` — el gate completo (7 pasos: lo anterior más
  build, los 2 smoke de worker y los 7 harnesses `scripts/qa-*.ts`). Es lo mismo
  que corre `.github/workflows/quality.yml`.

## Entorno (bun 1.4.2 y finales de línea)

- **bun fijo en 1.4.2** en los dos workflows. Los smoke comparan los artefactos
  generados de `public/scanner/` byte a byte y el minificador de bun cambia entre
  versiones: subir bun sin regenerar los workers pone el gate rojo.
- `.gitattributes` fuerza LF y `-text` en `public/scanner/*.js`. Sin eso, un clon
  en Windows con `core.autocrlf=true` materializa CRLF y la frescura falla.
- En Windows + Git Bash, `NEXT_PUBLIC_BASE_PATH=/digielect14` se manglea a una
  ruta local: antepón `MSYS_NO_PATHCONV=1`. Los detalles, en `docs/DEUDA.md`.

## Reglas del producto

- La app **no lee votos**: comprueba si la zona de votos tiene tinta (marcador
  obligatorio, D41) y extrae cabecera e identificación. No inventes totales ni
  interpretes el contenido del acta.
- La identificación se valida contra el catálogo oficial DIVIPOLA
  (`public/e14/divipol.json`). Un dato que no está en el catálogo se marca como
  fallo, no se completa a mano.
- Todo comportamiento nuevo de producción va **detrás de un flag**
  (`src/lib/e14/flags.ts`: `DEFAULTS ← public/flags.json ← overrides de
  localStorage`). El mantenedor usa esa cadena como kill-switch; el override manual
  manda sobre el plan por tier y sobre el default.

## Privacidad e integridad

- Son datos electorales reales: **no commitees actas, capturas ni credenciales**,
  y no envíes actas a endpoints distintos del hub (`POST {hub}/v1/actas`,
  autenticado — los fixtures SIM son sintéticas tras la decisión **D86**
  (2026-11-08, cierre de D35): la excepción de la foto real quedó anulada y
  su retirada de la historia está ejecutada con los scripts de `scripts/`).
- No añadas dependencias, telemetría ni servicios externos sin preguntarlo antes.
- Nunca `git push --force` ni reescritura de historial. **Excepción única y
  autorizada por el mantenedor**: purgas puntuales de binarios del historial
  (p. ej. `git filter-repo` para dejar de versionar modelos). Requisitos:
  bundle de respaldo con `--all`, verificación post-reescritura,
  `--force-with-lease` (nunca `--force` a secas) y registrar en
  `docs/DECISIONS.md` el SHA previo y el motivo. Cualquier otro caso sigue
  prohibido.

## Antes de borrar código que parece muerto

1. `bunx knip` lo marca como export unused → revisa si lo consume un
   `scripts/qa-*.ts` (muchas firmas se exigen por **regex sobre el fuente**, no
   por import) o un test con **import dinámico**; en esos casos knip no los ve.
2. Quita el `export` primero y corre `bun run lint`: si aparece «defined but
   never used», era muerto real y se va completo (la constante, el helper y los
   comentarios que solo existían para él).
3. Si el símbolo es ancla de contrato, déjalo exportado y anótalo en
   `docs/DEUDA.md` en vez de tocarlo.
4. **Lo mismo aplica a `dependencies`**: antes de quitar un paquete de
   `package.json`, revisa los `peerDependencies` de `@jg-stevan/scanner-ui` y
   busca el nombre en `node_modules/@jg-stevan/*/dist/`. `framer-motion` no
   aparece en ningún `import` de `src/`, pero lo consume `ZoomableVisor` del UI
   package vía peer: quitarlo rompe la pantalla de revisión, y como bun
   auto-instala peers el build local lo sigue tapando (con npm o pnpm fallaría
   al resolver).
5. **El motor vive en `packages/scanner-core`, consumido como `workspace:*`**
   (ver su `LEEME.md` y `CHANGELOG.md`). No es un paquete de npm: es un
   workspace de este monorepo — lo que ves en `node_modules` es el enlace
   del workspace, no una copia. No lo borres a mano ni lo reinstales con
   npm.

## El motor (`packages/scanner-core`) y la paridad con `supervision-e14`

**Frase autoridad: el motor vive en `packages/scanner-core`, consumido como
`workspace:*`** (una sola fuente, sin vendorizado ni npm). Este repo y
`supervision-e14` (supervisor masivo) comparten el negocio que decide el
resultado de un acta — `clasificador.ts`, `completitud.ts`, `divipol.ts`,
`kits.ts`, `integridad.ts`, `marcadores.ts`, `senal-lectura.ts` — y el motor
de OCR: el MISMO paquete workspace copiado idéntico en los dos repos
(byte a byte; lo coteja `scripts/qa-paridad-motor.ts` con el hermano en
disco). Igual de compartidos: el mismo `tesseract.js` con el mismo
`spa.traineddata`, las mismas ONNX PP-OCRv4, el mismo `divipol.json`. Lo que
NO se comparte ni se porta: la cola/bandeja/runner del lote (aquí es un
puesto individual) y el PP-OCRv5.

Editar el motor: cambia el archivo en `packages/scanner-core/src/**` y
**aplícalo igual en el hermano en el mismo commit** (el paquete es un
workspace local, no se publica por cada ajuste — el mantenedor decide si/toque
cuándo publicar a npm; `0.5.0` aún no está publicada). Si solo lo arreglas
aquí, el golden del hermano se pone rojo con la misma edición pendiente.

El contrato vive en `packages/scanner-core/tests/fixtures/contrato-motor.json`
(21 cabeceras SINTÉTICAS + su salida exacta; enlazado desde
`src/lib/e14/contrato-motor.test.ts`). Cada repo lo valida contra SU copia
del motor:

- `src/lib/e14/contrato-motor.test.ts` (vitest) · `scripts/gen-contrato-motor.ts`
  (regenera) · `scripts/qa-paridad-motor.ts` (coteja los dos checkouts en
  disco; «omitido» en CI sin hermano).
- **Se toca el negocio clasificador y el test pone rojo** → es un cambio de
  comportamiento REAL: regenera (`bun scripts/gen-contrato-motor.ts`), revisa
  el diff del golden descriptor por descriptor y cópialo a la misma ruta del
  hermano. Allí el mismo golden pone rojo hasta que el hermano sincronice el
  código.
- **NO se escribe un generador en el hermano**: una sola fuente de verdad, si
  no cada repo "arregla" su esperado hacia su propio comportamiento y la
  paridad se vuelve decorativa.
- Salida de OCR sobre píxeles, `quad` y `score` NO están en el contrato
  (necesitan navegador/wasm). El `puente/` de envío es exclusivo de este repo.

## Estilo

- Responde en español; identificadores de dominio, comentarios y commits quedan
  en español (Conventional Commits: `feat(e14): …`, `fix(e14): …`).
- Muerto = fuera. Sin `_vars`, sin re-exports de compatibilidad, sin comentarios
  describiendo código removido.
- Un commit pequeño y frecuente vale más que un commit gigante.
- **El motor sí se puede editar** (es código de este repo:
  `packages/scanner-core/src/**`, workspace `workspace:*`), con tres
  condiciones: (1) la misma edición en `supervision-e14` en el mismo commit,
  (2) regenerar y propagar el golden `contrato-motor.json` si el cambio toca
  el clasificador, (3) si el cambio altera la lectura de un acta —umbral,
  recorte, normalización de texto—, pasar además los tests de frontera del
  paquete (`bun test packages/scanner-core`). Todo comportamiento *nuevo* de
  producción sigue detrás de un flag de `src/lib/e14/flags.ts`.

## Dependencias (política de pinning, 6.1.3)

- **Caret por defecto** (`^`) en `dependencies`/`devDependencies`; el lock
  (`bun.lock`) fija el exacto que corre en CI. Excepción: los motores cuyo
  comportamiento es decisión de producto se fijan EXACTOS
  (`onnxruntime-web 1.30.0`, `tesseract.js 5.1.1`, `zxing-wasm 3.1.6`) —
  subirlos sin re-medir rompe las decisiones D53/D60/D76.
- **`bun audit` en CI, semanal** (job programado): dependencias con
  vulnerabilidad CONOCIDA en paths de BUILD se suben en la misma semana
  (no es opcional); las de runtime pasan por la regla de arriba (decisión
  registrada antes de subir un motor).
- Antes de añadir una dependencia: `AGENTS.md §Privacidad` manda (preguntar
  primero).

## Cómo se lee este repo

Los comentarios citan **kits** (`e14-*`), **decisiones** (`D<n>`) y secciones
de spec. Las decisiones están en `docs/DECISIONS.md`; los kits y las specs son
artefactos de sesiones de desarrollo previas que no viajan en el repo, así que
una mención sin archivo no es un enlace roto. `apps/scanner-lab/…` es el
laboratorio del repo de ORIGEN del motor (`Jg-Stevan/web-scanner`) — el motor
VIVO es `packages/scanner-core`.

## Dónde está qué

`packages/scanner-core/` EL MOTOR (workspace `workspace:*`: pipeline,
OCR, clasificador, completitud, marcadores, workers) · `src/lib/e14/` la
capa de dominio de ESTA app (pipeline L2, puente de envío, observabilidad,
política del gate en `politica/`) · `src/components/e14/` pantallas y hooks
de cámara (consumen el motor vía `src/lib/e14/fachada.ts` — regla 7.5) ·
`src/app/` rutas de Next · `scripts/` QA y utilidades de build · `docs/`
decisiones, arquitectura y reportes de medición. El detalle por módulo está
en `docs/ARQUITECTURA.md`.
