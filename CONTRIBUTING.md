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
