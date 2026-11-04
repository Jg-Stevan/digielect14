# AGENTS.md — digielect14

Reglas para agentes IA (y personas) que editan este repo. El producto es un
digitalizador de actas E-14 que corre en el navegador del celular; trabaja con
**datos electorales reales**.

## Comandos (verificados contra `package.json`)

- `bun install` — gestor: **bun**. No uses npm ni pnpm.
- `bun run dev` — Next.js en el puerto 3000 (OCR a un hilo: `next dev` no emite
  cabeceras COOP/COEP, así que `crossOriginIsolated` es falso).
- `bun run verificar` — typecheck + lint + test. **Es la puerta de salida**: nada
  se declara terminado sin este comando en verde, y se reporta su salida real.
- `bun run build` — bundle de producción (el `prebuild` genera el worker de capa 0).
- Sueltas: `bun run typecheck` · `bun run lint` · `bun run test` · `bunx knip`.
- `bash scripts/check-quality.sh` — el gate completo (7 pasos: lo anterior más
  build, los 2 smoke de worker y los 6 harnesses `scripts/qa-*.ts`). Es lo mismo
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
  localStorage`). El dueño usa esa cadena como kill-switch; el override manual
  manda sobre el plan por tier y sobre el default.

## Privacidad e integridad

- Son datos electorales reales: **no commitees actas, capturas ni credenciales**,
  y no envíes actas a endpoints distintos del hub (`POST {hub}/actas`).
- No añadas dependencias, telemetría ni servicios externos sin preguntarlo antes.
- Nunca `git push --force` ni reescritura de historial.

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
   `package.json`, revisa los `peerDependencies` de `@jg-stevan/scanner-core` y
   `@jg-stevan/scanner-ui` (en sus propios `package.json`) y busca el nombre en
   `node_modules/@jg-stevan/*/dist/`. `framer-motion` no aparece en ningún
   `import` de `src/`, pero lo consume `ZoomableVisor` del UI package vía peer:
   quitarlo rompe la pantalla de revisión, y como bun auto-instala peers el
   build local lo sigue tapando (con npm o pnpm fallaría al resolver).

## Estilo

- Responde en español; identificadores de dominio, comentarios y commits quedan
  en español (Conventional Commits: `feat(e14): …`, `fix(e14): …`).
- Muerto = fuera. Sin `_vars`, sin re-exports de compatibilidad, sin comentarios
  describiendo código removido.
- No toques el motor (`packages/scanner-core`, npm `@jg-stevan/scanner-core`)
  desde aquí. Si hace falta un cambio en el core, márcalo `[REQUIERE-CORE]` y
  proponlo en el repo del motor.
- Un commit pequeño y frecuente vale más que un commit gigante.

## Dónde está qué

`src/lib/e14/` lógica de dominio (pipeline, OCR, QR, clasificación, puente de
envío, observabilidad) · `src/components/e14/` pantallas y hooks de cámara ·
`src/app/` rutas de Next · `scripts/` QA y utilidades de build · `docs/`
decisiones, arquitectura y reportes de medición. El detalle por módulo está en
`docs/ARQUITECTURA.md`.

## Cómo se lee este repo

Los comentarios citan **kits** (`e14-*`), **decisiones** (`D<n>`) y secciones de
spec. Las decisiones están en `docs/DECISIONS.md`; los kits y las specs son
artefactos de sesiones de desarrollo previas que no viajan en el repo, así que
una mención sin archivo no es un enlace roto. `apps/scanner-lab/…` es el
laboratorio del repo del motor (`Jg-Stevan/web-scanner`), origen de las copias
de la UI y del worker de detección.
