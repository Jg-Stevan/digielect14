# Banco P3 — dhash full-res vs resize64 (KIT e14-dhash-resize-v1 — SOLO EVIDENCIA)

- Fecha: 2026-10-27T02:56:14.202Z
- Entorno: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/143.0.7499.4 Safari/537.36
- Cores: 2 · DPR: 1
- dhash: copia congelada de `src/lib/e14/masiva/dedup.ts` @ 5d08dd6 (canvas 9×8, hex 16)
- Vías: FULL = `{imageOrientation:"from-image"}` · RESIZE64 = `{imageOrientation:"from-image",resizeWidth:64,resizeHeight:64,resizeQuality:"medium"}` (verbatim del parche P3) · RESIZEPROP64 = aspect preservado (evidence-only)
- Umbral vigente: `DEDUP_HAMMING_MAX = 6` · meta GO: gemelas ≤ 4 · NO-gemelas > 12
- **Veredicto sobre el corpus REALISTA (fotoActa 12 MP)**; actaLike 1000×2920 = estrés (líneas finas → aliasing del downscale en un paso — NO decide)

## Resumen de Hamming (gemelas = mismo píxel-set re-encodeado {png, jpg-q92, jpg-q50})

| métrica | corpus | valor | meta | cumple |
|---|---|---|---|---|
| maxHammingSelfCruce | fotoActa 12MP (PRIMARIO) | 20 | ≤ 4 | false |
| maxHammingGemelasCruce | fotoActa 12MP (PRIMARIO) | 21 | ≤ 4 | false |
| maxHammingGemelasIntraFull (sanity) | fotoActa 12MP (PRIMARIO) | 6 | ≤ 6 | true |
| maxHammingGemelasIntraResize64 | fotoActa 12MP (PRIMARIO) | 1 | ≤ 6 | true |
| minHammingNoGemelasCruce | fotoActa 12MP (PRIMARIO) | 16 | > 12 | true |
| minHammingNoGemelasIntraFull (sanity) | fotoActa 12MP (PRIMARIO) | 0 | > 12 | false |
| maxHammingSelfCruceProp (evidence-only) | fotoActa 12MP (PRIMARIO) | 20 | ≤ 4 | false |
| maxHammingGemelasCruceProp (evidence-only) | fotoActa 12MP (PRIMARIO) | 20 | ≤ 4 | false |
| minHammingNoGemelasCruceProp (evidence-only) | fotoActa 12MP (PRIMARIO) | 18 | > 12 | true |
| maxHammingSelfCruce | actaLike (STRESS) | 26 | ≤ 4 | false |
| maxHammingGemelasCruce | actaLike (STRESS) | 25 | ≤ 4 | false |
| maxHammingGemelasIntraFull (sanity) | actaLike (STRESS) | 11 | ≤ 6 | false |
| maxHammingGemelasIntraResize64 | actaLike (STRESS) | 1 | ≤ 6 | true |
| minHammingNoGemelasCruce | actaLike (STRESS) | 23 | > 12 | true |
| minHammingNoGemelasIntraFull (sanity) | actaLike (STRESS) | 1 | > 12 | false |
| maxHammingSelfCruceProp (evidence-only) | actaLike (STRESS) | 30 | ≤ 4 | false |
| maxHammingGemelasCruceProp (evidence-only) | actaLike (STRESS) | 31 | ≤ 4 | false |
| minHammingNoGemelasCruceProp (evidence-only) | actaLike (STRESS) | 26 | > 12 | true |

## Timing+RAM — fotoActa 12 MP (3024×4032 JPEG q0.9; 7 rondas intercaladas + warmup; DESKTOP headless — NO representativo del dispositivo del dueño)

| vía | p50 ms | p95 ms | media ms | min ms | heap Δ medio MB |
|---|---|---|---|---|---|
| FULL (hoy) | 30.9 | 31.4 | 30.5 | 29 | n/d |
| RESIZE64 (spec P3) | 39.1 | 39.7 | 38.5 | 37.3 | n/d |
| RESIZEPROP64 (evidence-only) | 37.9 | 39.4 | 38.1 | 36.9 | n/d |

Ahorro medio resize64: **-26.3%** p50 · resizeProp64: **-25.1%** p50 (proyección del plan: ~300-800 ms/acta en el dispositivo del dueño — aquí solo el ORDEN DE MAGNITUD y el Δ de RAM son exportables).

## Sensibilidad al color (fotoActa — cruce FULL base ↔ RESIZE64/PROP shift)

| δ canal R | full↔full | resize64↔resize64 | CRUCE full↔resize64 | CRUCE full↔resizeProp64 |
|---|---|---|---|---|
| 1 | 0 | 0 | 13 | 16 |
| 2 | 2 | 1 | 14 | 16 |
| 3 | 3 | 1 | 14 | 16 |
| 5 | 1 | 0 | 13 | 16 |
| 8 | 4 | 1 | 14 | 16 |
| 12 | 0 | 0 | 13 | 16 |

## Veredicto: **NO-GO** (corpus: fotoActa 12 MP (realista))

- [PRIMARIO fotoActa] maxHammingSelfCruce=20 (≤ 4: false)
- [PRIMARIO fotoActa] maxHammingGemelasCruce=21 (≤ 4: false)
- [PRIMARIO fotoActa] minHammingNoGemelasCruce=16 (> 12: true)
- [PRIMARIO fotoActa] sanity camino FULL de hoy sano (intra-gemela ≤ 6): true
- [STRESS actaLike] maxHammingSelfCruce=26 · sanity FULL sano: false (corpus patológico para el downscale en un paso — NO decide)
- [DIAGNÓSTICO] aspect preservado (resizeProp64, evidence-only): self-cruce=20 · gemelas cruce=20 — TAMBIÉN falla → el daño viene del DOBLE REMUESTREO en sí (64 intermedio + drawImage 9×8 ≠ downscale directo FULL→9×8), no solo del aspect cuadrado. Ninguna variante de resize intermedio es compatible con los hashes full-res históricos.

### Caveats (honestidad del instrumento)

- Corpus SINTÉTICO (gemelas por construcción png/jpg — sin HEIC real: canvas no encodea HEIC).
- La gemela HEIC/JPG REAL del dueño debe confirmar el veredicto con «CARGAR FOTOS REALES» antes del rollout.
- Timing/RAM medidos en DESKTOP headless — NO representan el dispositivo del dueño (main-thread contendido); la métrica de decisión es la DETERMINISTICIDAD (Hamming), no el tiempo.
- Sin EXIF en el corpus sintético; producción usa imageOrientation from-image en todas las vías (igual riesgo relativo).
- Un browser que ignore las opciones de resize produce el bitmap FULL → hash idéntico al de hoy (degradación segura).

