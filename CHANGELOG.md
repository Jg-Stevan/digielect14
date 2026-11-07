# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) — este
archivo cubre la APP `digitalizador-e14` (raíz del workspace). El MOTOR tiene
su propio changelog: [`packages/scanner-core/CHANGELOG.md`](./packages/scanner-core/CHANGELOG.md)
(última entrada del paquete: **0.5.0** — 2026-11-07, migración v2.3).

## [0.5.0] — 2026-11-07

Alineada con `@jg-stevan/scanner-core` 0.5.0 (paquete único del motor — ver
su changelog para las 120 tests de paridad y la procedencia web-scanner ·
feba267 · v0.4.1). Cambios de esta app en la remediación (olas 0–7):

### Cambiado
- Vista shell (`src/app/page.tsx`): las 4 vistas pesadas (Analyzing/Review/
  Actas/Resumen) salen del bundle inicial con `next/dynamic` (§5.1) —
  ScanView sigue eager por ser la vista inicial.
- `pdf-export`: jsPDF con import DINÁMICO (chunk de ~868 KB fuera del
  bundle inicial, §5.1).

### Añadido
- Deploy automático de Cloudflare Pages (`.github/workflows/deploy-cf.yml`)
  y check diario de frescura de deploys (`frescura-deploys.yml`, §5.3).
- `generateBuildId` determinista en `next.config.ts` (§6.5).
- VERSION del SW + `?v=` del detection-worker derivadas del build en CI (§6.6).
- CSP + `nosniff` + `Referrer-Policy` en `public/_headers` (§6.7).
- Worker de fallback canvas (`packages/scanner-core/workers/fallback-canvas.ts`,
  §5.4) — el warp+realce de la ruta de degradación deja el hilo principal.
- Detección temprana de HEIC por magic bytes (§6.13) — `heic-detect.ts` +
  rechazo antes de despachar a heic2any.
- Escalera de migración (`onupgradeneeded` + `e.oldVersion`) en las IndexedDB
  de jornada/transporte/heartbeat-WAL (§6.11) y exposición del
  `QuotaExceededError` de las escrituras de jornada por callback (§6.10).
- Instrumentación de multihilo OCR (§5.2): evento obs único por sesión con
  `crossOriginIsolated`/`hardwareConcurrency`/hilos ORT.
- Cadena de suministro: Dependabot, `bun audit` informativo en CI, cota de
  tamaño de bundle (20 MB), cobertura informativa, LICENSE/CONTRIBUTING (§6.1/6.4/6.9).

### Eliminado
- Workflow anidado muerto `packages/scanner-core/.github/workflows/…`
  (GitHub Actions solo lee el `.github/workflows/` raíz — §6.14).

## [0.4.1] — 2026-11-04
Kits de campo sobre el motor 0.4.1 (decode-único + precalor D66, HEIC tope
D82, vendorizado D81/D83 — detalle en `docs/DECISIONS.md`).
