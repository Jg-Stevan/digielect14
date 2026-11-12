# Contribuir a digielect14

Guía mínima. La fuente de verdad de las REGLAS del repo es
[`AGENTS.md`](./AGENTS.md) — léela antes del primer PR (regla de oro:
**nada rompe la app**, comentarios en español, sin secretos en archivos).

## Arranque rápido

```bash
bun install          # bun 1.4.x fijado (misma versión en CI)
bun run dev          # :3000 (corre `preparar` antes: vendor + assets)
```

## Gate local (lo mismo que corre el CI)

```bash
bash scripts/check-quality.sh
```

Equivalente paso a paso a `.github/workflows/quality.yml`:

1. `bunx tsc --noEmit` — 0 errores.
2. `bun run lint` — 0 errores / 0 warnings.
3. `bun run build` — build de producción.
4. `bun scripts/smoke-*.mjs` — workers precompilados y frescos (byte a byte).
5. `bun run test` — vitest (`src/**/*.test.ts`).
6. `bun scripts/qa-*.ts` — los 7 harnesses de contrato/regresión.
7. `bunx knip` — informativo (no rompe).

Suite del PAQUETE aparte (el motor vive en `packages/scanner-core`):

```bash
bun run test:paquete   # bun test packages/scanner-core (incluye el contrato md5)
```

## Reglas que más se olvidan

- **Jamás commitear actas reales (SEC-10/D86):** ni fotos de actas, ni
  capturas con datos de jurados, ni volcados de sesión (ver `SECURITY.md` y
  `.gitignore`; las capturas de campo quedan fuera del repo).
- **Jamás reescribir historial sin autorización registrada (D90/D91):**
  cualquier `git filter-repo` / force-push requiere una decisión D-xx
  registrada que la autorice; lo demás es historia inmutable.
- **`packages/scanner-core` se cambia en ESPEJO:** todo cambio del paquete se
  aplica idéntico (byte a byte) en ambos repos (dig y sup) y deja
  `qa-paridad-motor` en 20/20. Anúncialo en el título del PR y espera la
  pasada espejo del hermano (además del contrato md5 D81/D82 de abajo).
- **Convención de decisiones D-xx-sup / D-xx-dig:** cada repo lleva su
  propia numeración (pueden divergir); en dig viven en `docs/DECISIONS.md`,
  en sup en `docs/adr/` y los reportes de seguimiento. No re-numeres
  decisiones existentes; las nuevas van al final con fecha y motivo.
- **Motor vendorizado/compartido**: `packages/scanner-core` y los módulos de
  `src/lib/e14/core/` están md5-trazados (`core/CONTRATO.json` +
  `contrato-core.test.ts`). Si editas el motor, regenera los md5 del contrato
  en el MISMO commit y justifica el cambio (regla D81/D82).
- **Workers**: los `.worker.js` de `public/scanner/` son artefactos
  precompilados — se regeneran con `bun run prebuild` y el smoke compara
  bytes; jamás editarlos a mano.
- **Commits**: un PR = un bloque del plan de remediación (ver
  `docs/ROADMAP.md` / plan), con su evidencia en la descripción.
- **Secretos**: nada de tokens en el repo (`SECURITY.md`); los deploys usan
  `secrets.CF_API_TOKEN` en los workflows de `.github/workflows/`.
- **Issues/PRs**: usa las plantillas de `.github/ISSUE_TEMPLATE/` y
  `.github/PULL_REQUEST_TEMPLATE.md` (gates verdes, espejo si toca el
  motor, sin actas reales, docs al día).

## Conducta y reportes

- Conducta: ver [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
- Vulnerabilidades: **no abras un issue público**; sigue [`SECURITY.md`](./SECURITY.md).
