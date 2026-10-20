# Banco B5 — det 960/1280/1920 (KIT e14-bancos-b5-b7-pagnull-v1 — SOLO EVIDENCIA)

- Fecha: 2026-10-20T13:31:51.824Z
- Criterio: caja perdida = caja a 1920 sin match IoU ≥ 0.5 entre AABB de quads mapeados a fuente · GO = 0 perdidas a 960 en el 100% del corpus
- Corpus: 4 páginas sintéticas 1000×2920 (seed 0xe14de7a2, mismo generador del banco det1280 PR #34) + 0 fotos reales locales (ninguna)
- Entorno: HeadlessChrome (sandbox 2 núcleos) · numThreads=2 · COI=True · EP wasm vendido
- ORT-web: ?

## Tabla (acta | límite | nCajas | cajasPerdidas vs 1920 | ms)

| acta | límite | nCajas | cajasPerdidas vs 1920 | ms |
|---|---|---|---|---|
| sintetica-p1 | 1280 | 71 | 0 | 304.2 |
| sintetica-p1 | 960 | 71 | 1 | 198.6 |
| sintetica-p2 | 1280 | 71 | 0 | 316.3 |
| sintetica-p2 | 960 | 71 | 1 | 193.1 |
| sintetica-p3 | 1280 | 71 | 0 | 341.9 |
| sintetica-p3 | 960 | 71 | 2 | 193.7 |
| sintetica-p4 | 1280 | 71 | 0 | 311.6 |
| sintetica-p4 | 960 | 71 | 1 | 190.7 |

## Resumen

- det Σ ms: 1920=2787.8 · 1280=1274.1 · 960=776.1 (960 ≈ 0.28× de 1920; teoría (960/1920)²=0.25)
- Cajas perdidas a 1280: **0** (71 cajas/página idéntico al banco B3 GO — réplica validada)
- **Cajas perdidas a 960: 5** (1+1+2+1 — las 4 páginas pierden al menos una caja)

## Veredicto

**NO-GO** — pierde UNA caja → NO-GO documentado (kit D58 §T1). La pasada 1 a 960 NO se recomienda (kit futuro D60 queda SIN evidencia GO; 1280 se mantiene como la palanca activa D53).
