# Banco B5: det 960 vs 1280 vs 1920 — KIT e14-bancos-b5-b7-pagnull-v1 (D58) — SOLO EVIDENCIA, CERO PRODUCCIÓN

Instrumento de medición para la decisión **D60** (pasada 1 del OCR escalonado a 960 — ahorro estimado
−0.3-0.5 s/acta sobre la palanca D53 ya activa a 1280). **Este banco NO cambia nada de producción**:
`src/` y `public/` quedan intactos; `DET_CAP` vive SOLO aquí (op4 del pre-det — la ÚNICA diferencia local).

- **GO (kit D58 §T1):** 0 cajas perdidas en el 100% del corpus a 960 → se recomienda pasada 1 a 960 (kit futuro D60).
- **NO-GO:** pierde UNA caja → NO-GO documentado.

## Qué hay aquí

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone: réplica del patrón `tools/bench-det1280` (PR #34 — b3 GO) con **3 brazos** — `DET_CAP` ∈ {1920 (referencia/producción), 1280 (D53 activa), 960 (candidato B5)}. MISMA sesión det compartida entre caps (solo cambia op4), MISMO generador de corpus sintético (seed `0xe14de7a2`, 4 páginas acta-like 1000×2920). Métrica del kit: `acta | límite | nCajas | cajasPerdidas vs 1920 | ms` + botón DESCARGAR JSON y DESCARGAR MD (outputs a `resultados/`). Input «AÑADIR FOTOS REALES» para las 9 fotos del dueño (locales, NUNCA se commitean — `tools/assets/.gitignore`). |
| `resultados/` | Outputs JSON+MD de las corridas (sintética en sandbox + la del dueño con sus fotos reales). |

## Criterio de «caja perdida» (kit D58 §T1)

Caja presente a **1920** sin match a 960/1280 con **IoU ≥ 0.5 entre quads** (mapeados al espacio FUENTE por
`mapearAFuente` — misma cadena del banco det1280). Nota honesta: el IoU se mide entre los **AABB** de los
quads (proxy determinista); los quads del mismo texto a distinto cap mapean casi idéntico al espacio fuente,
así que el proxy solo puede FALLAR del lado conservador (una caja mal emparejada con mejor vecino IoU<0.5).

## Cómo reproducir (pasos exactos)

```bash
bun install
# Servir la RAÍZ del repo con COOP/COEP (Cross-Origin-Opener-Policy: same-origin,
# Cross-Origin-Embedder-Policy: require-corp) → numThreads=min(4,cores) como Vercel.
# Ejemplo: bun run tools/serve-coop-coep.js  (o cualquier servidor estático con esos headers)
# Abrir: http://localhost:PORT/tools/bench-det960/bench.html
# Botón «DESCARGAR JSON» / «DESCARGAR MD» (§0.2 del repo — nada se descarga solo).
# window.__benchJson = lectura programática.
```

Con fotos reales del dueño (171125, 170755, 171446, 171454, 171500, 171506, 171512, 171518 en jpg y/o heic):
botón «AÑADIR FOTOS REALES» (o soltarlas en `tools/assets/` — ignoradas por git) y repetir la corrida;
la tabla incluye las fuentes `real-*` con el MISMO criterio.

## Protocolo

1. Por cada cap (1920, 1280, 960): **pasada caliente descartada + pasada medida** (mismo protocolo del banco det1280).
2. Det SOLAMENTE (el criterio B5 es de cajas — rec/cls fuera del criterio).
3. Determinismo: «REPETIR CORRIDA» — el corpus es sintético determinista (seed fija); ms ±10%.

## Veredicto medido (evidencia completa en `docs/REPORTE-e14-bancos-b5-b7-pagnull-v1.md`)

Ver `resultados/` y el REPORTE. **Advertencia honesta:** el corpus sintético valida el MECANISMO;
la validación física con las fotos reales del dueño es la que manda (kit D58 §T1).
