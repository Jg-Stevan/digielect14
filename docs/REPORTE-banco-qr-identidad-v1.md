# REPORTE — banco-qr-identidad-v1 (SOLO EVIDENCIA, CERO PRODUCCIÓN)

**Fecha:** 2026-10-22 · **Agente:** Z.ai Code · **Rama:** `tools/banco-qr-identidad-v1`
**Base:** main @ `85b71cd` (#71 mergeado — el kit citaba base f443ee1/#69; main avanzó con
#70/#71, que tocan `masiva`+`docs`: SIN intersección con este banco — `git diff --name-status main`
sigue siendo SOLO `tools/bench-qr-identidad/**` + `docs/**`).

---

## §0 — Qué se construyó (kit §1)

Banco de medición QR en `tools/bench-qr-identidad/` (patrón D58 del bench-dedup-tolerancia):

| Archivo | Rol |
|---|---|
| `bench.html` | Banco standalone: vía de entrada de PRODUCCIÓN (`fileToCaptureDataUrl` del core — EXIF/12MP/HEIC) → canvas de trabajo lado largo **≤ 2048 px** → intentos de decode jsQR A/B/C/C×1.5 (`{inversionAttempts:"attemptBoth"}`, se registran TODOS con `{ok,payload,ms,anchoAlto}`) → toggle **«probar rotaciones»** (90/180/270, primeros ≤6 archivos — VERIFICA la invariancia, no la asume) → tabla por archivo → **grupos por igualdad EXACTA de payload** (sin umbrales) → resumen con **detector de colisión** → export JSON/MD. |
| `jsQR.js` | **Vendido**: jsQR@1.4.0 del npm tarball (`package/dist/jsQR.js`, UMD webpack, MIT, cero deps, 256 KB sin minificar — la estimación ~44 KB del kit corresponde al minificado; se vendió el archivo LITERAL que empaqueta npm). BarcodeDetector nativo PROHIBIDO (kit §5 — determinismo entre máquinas). |
| `heic2any-esm.js` | Wrapper ESM (copia byte-idéntica del bench-dedup-tolerancia) para el `import("heic2any")` bare del core. |
| `resultados/` | Evidencia de la corrida QA: `bench-qr-identidad-resultado.{json,md}`. |

Decisiones de implementación declaradas:

1. **«Mejor intento» en rotaciones = el GANADOR del base** (no la banda más fina): al rotar
   90/180/270 el QR CAMBIA de esquina — repetir una banda fija top-left sobre el rotado
   dejaría de contenerlo y la verificación sería falsa. Si A ganó, se repite A sobre el
   rotado (imagen completa → jsQR maneja orientación nativa). Si NINGUNO ganó, C1.5 con
   floor A. Cada rotación registra `payloadIgualBase` (invariancia verificada por archivo).
2. **Fuente foto/escaneo** = heurística informativa del nombre (stem `171XXX` → escaneo).
   NO afecta grupos ni veredictos (solo el % del resumen) — documentada en README.
3. **Detector de colisión:** 2+ stems de escaneo DISTINTOS compartiendo payload → grupo en
   rojo + NO-GO automático. Re-encodes con nombres distintos (durazno/imagen) compartiendo
   payload es la TESIS GANANDO, no colisión — el juicio final lo emite el dueño con la
   verdad de terreno (kit §4).
4. Hooks QA/dev SOLO-banco: `__bancoQrCargarArchivos(File[])` (misma vía que el input) y
   `__bancoQrGenerarMd()` (mismo string MD que descarga el botón). Trazas `[e14-banco-qr]`
   solo-aditivas.

## §1 — Cómo correrlo (kit ANEXO)

```bash
bun run tools/serve-coop-coep.js 8123
# Abrir: http://localhost:8123/tools/bench-qr-identidad/bench.html
# 1) CARGAR FOTOS REALES — corpus completo EN UNA SOLA CARGA (kit §4)
# 2) (opcional) «probar rotaciones»
# 3) PROCESAR → tabla + grupos + resumen
# 4) DESCARGAR JSON / MD → pegar al agente
```

## §2 — QA headless (kit §2.4) — captura en `docs/REPORTE-banco-qr-identidad-v1-captura.png`

Servidor COOP/COEP 8123 + Chromium headless (agent-browser). Fixtures locales:
`acta-e14-real.jpg` (QR real del acta) + copia renombrada (`-GEMELA.jpg`) +
`acta-sim-baja.jpg` (sin QR esperado). Vía REAL del input file (no hooks) → PROCESAR.

Resultados medidos:

- **3/3 decode (100%)** — ganador **A** (imagen completa a 2048) en los 3.
- **G1 ← acta-real + acta-real-GEMELA**: payload idéntico `7UfaHJKbmbZx766vul1NWL/H0swwzefhl5P2YMRLqjk=`
  (**44 chars = Base64 de 32 bytes — exacto al kit §0.2**). Agrupación por igualdad exacta ✓.
- **G2 ← acta-sim-baja**: payload DISTINTO (`LcyzMYaRFQAksxU26WzUETABJVEb…`) — el acta sim
  TAMBIÉN lleva QR y decodifica a su propio payload → **actas distintas ⇒ payloads distintos**
  (kit §0.2, 9/9 sin colisiones). Detector de colisión: **0** ✓.
- **Rotaciones (toggle ON):** 90°✓=base · 180°✓=base · 270°✓=base en los 3 archivos —
  invariancia VERIFICADA con payload idéntico.
- **Tiempos:** core 63.9-78.4 ms por archivo (vía fileToCaptureDataUrl) · trabajo 1152×2048
  y 1536×2048. En consola: trazas `[e14-banco-qr]` con el detalle A/B/C/C1.5 por archivo.
- **Export:** botones JSON/MD ejecutados sin excepciones; `JSON.stringify(ultimoJson)` =
  7,258 B; `generarMd()` (mismo string del botón) salvado a `resultados/`.
- Cero errores de página durante toda la sesión.

## §3 — Gates

`tsc` 0 · `lint` 0 · `git diff --name-status main` = SOLO `tools/bench-qr-identidad/**` +
`docs/**` (red lines 3 y 10: cero cambios en `src/`, `public/`, `package.json`, `bun.lock`).
Commit Conventional `feat(tools): banco qr identidad v1` · PR con merge de 2 padres ·
worklog append.

**DESVIACIÓN MÍNIMA DECLARADA (scope del diff):** +1 entrada en `eslint.config.mjs`
(ignore de `tools/bench-qr-identidad/jsQR.js`). El kit no la previó: eslint SÍ lintea
`tools/` y el vendor UMD de jsQR falla por diseño (`module.exports` del wrapper webpack +
expresiones sueltas del bundle). Se aplicó el **mismo criterio «JS vendor» ya existente**
(`public/vendor/**`, `public/scanner/**`, `lab/**/*.bundle.js`) en vez de mutar los bytes
del vendor (determinismo del kit §5). Es tooling de lint — cero efecto en producción,
red line 3 intacta (`src/`, `public/`, `package.json`, `bun.lock` intocados).

## §4 — FASE 0 del dueño (kit §4): el test del dinero

1. Servir + abrir el banco en SU máquina (Chrome 155/Windows, igual que la FASE 0 del e63h).
2. Cargar EN UNA SOLA CARGA todo el corpus real: 12 re-fotos `20261021_16*.jpg` ·
   `durazno1-8.heic` + `imagen1-10.jpg` · escaneos `171500/171506/171512/171518/171446/171454`
   (+ gemelas) · fixture si quiere.
3. (Opcional) «probar rotaciones» para la invariancia.
4. «DESCARGAR RESULTADOS» y pegar JSON + MD al chat.

**Criterio de GO del kit e63m** (lo evalúa el agente con los números): re-encodes que al
dhash dieron 8-33 agrupan con sus gemelas ✅ · tasa global ≥ ~70-80% ✅ · colisión ❌ NO-GO
automático · escaneos ~100% ✅ bonus. Si NO-GO: quedan las alternativas ya medidas (§2.2
carrera con trazas, mitigación operativa de un formato por papel) y el QR se cierra CON EVIDENCIA.

## §5 — Red lines (kit §3) — verificación

1. `HAMMING_MAX=6`/umbrales/`DEDUP_CINTA_CIERTA=2`/constantes D65: **ni se mencionan** (el
   banco no los usa — grep cero en `tools/bench-qr-identidad/`). ✓
2. `proxy=true` en ocr/rapidocr.ts: intocado (cero diff en `src/`). ✓
3. Cero cambios en `src/`, `public/`, `package.json`, `bun.lock` — verificado por
   `git diff --name-status main`. ✓
4. El banco no calcula hashes ni umbrales: solo decodifica y agrupa por igualdad exacta. ✓
5. Commits Conventional · trazas solo-aditivas (`[e14-banco-qr]`). ✓
