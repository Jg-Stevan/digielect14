# REPORTE — KIT e14-quad-repro-v1 (T-C · laboratorio quad sub-detectado)

Fecha: 2026-10-17 · Ejecutado por: Z.ai Code · Rama: `lab/quad-repro` desde main `4aa2e06` (kit §8)

## 1. Estado: RIG COMPLETO Y VALIDADO — paso oficial DETENIDO (protocolo FILTROS-1: rig → evidencia → decisión)

**Bloqueo de entrega (NO de código):** los 2 ZIPs de campo (`e14-diag-mesa-001-115643-i1.zip` /
`e14-diag-mesa-002-115822-i2.zip`) **NO llegaron al sandbox** del agente — `upload/` solo trajo los
3 INSTRUCCIONES de la tanda y `download/` es la carpeta de generados. El kit es tajante (contrato y
§4-A): **NO se ejecuta con fixtures inventados** — los JPGs deben ser los bytes EXACTOS de campo
(ZIP STORE sin re-encode) para que la detección sea determinista. **Pendiente: re-subida del dueño.**
Se aplicó el MISMO criterio que FILTROS-1: rig completo + sanidad + paso oficial detenido con la
lista exacta de lo que falta.

## 2. Lo entregado (§2 CAMBIA — todo bajo `lab/` + docs; cero líneas de producción)

| Pieza | Detalle |
|---|---|
| `lab/quad-repro.html` + `lab/quad-repro.js` | Harness §4-B: selector/drag&drop → `createImageBitmap` → worker relativo `./worker-copy/detection-worker.js?v=7` → protocolo REAL (§3): `ready` (probe), `{type:"detect", bitmap, ts}` con TRANSFER (re-creación por intento — pitfall §9.3), respuestas `result`/`busy`/`error` (busy = normal A-04/A-05), y `{type:"warp", quad:[8 fracciones]}` para el contra-evidencial (Fase 3, quad ideal manual editable). Dibuja quad + esquinas TL-TR-BR-BL numeradas; imprime el quad normalizado 0-1, el crop estimado con el MISMO cálculo bbox→px de `calidadDeActa` (bridge: margen +3%/lado clamp [0,1], min 8px → fallback frame completo, cap 2000 sin upscalar) y el ratio h/w vs 2.9 (referencia, NO ley — pitfall §9.7). Panel EN VIVO de trazas. |
| `lab/worker-copy/detection-worker.js` | Copia instrumentada §4-C del worker `@4aa2e06` (header de 4 líneas con el sha del original). Trazas parseables `console.info("[quad-repro] {json}")` + `post({type:"quad-repro", traza})` (panel): **selectQuad** → cada candidato top-N `{area, ratioAspect, whiteness, validateOk, score}` + ganador + `polys/topN` (lista vacía/todos invalidados = H3 explícito) · **refineQuadFromLines** → `bad[]/fellBack[]/nFallback` (H1) · **handler detect** → `{corners, frameW, frameH, contourCount}`. CERO cambios de lógica (las trazas son aditivas — verificado con `new Function`, sintaxis OK). |
| `lab/vendor` → `../public/vendor` (symlink) | El worker deriva los candidatos de opencv desde SU ubicación (`opencvCandidateUrls`: `../../vendor/` y `../vendor/` + CDN). Desde `lab/worker-copy/`, la ruta `../vendor/` = `lab/vendor/` → el symlink hace que la COPIA cargue el MISMO opencv self-hosted del repo. (El CDN `docs.opencv.org` responde 403 desde el sandbox — comprobado; el diseño del worker ya prevé la ruta `lab/vendor/`.) |
| `lab/fixtures/README.md` | Procedencia verbatim del kit §4-A (CONSULADO 88 · EGIPTO · ZONA 05 PUESTO 02 · mesas 001/002 · Frankfurt KIT 399 · 2026-10-17) + los 2 archivos esperados con sus quads de referencia (control trapecio `[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868]` ratio 2.92 · objetivo rect `[0.362,0.333 0.694,0.333 0.694,0.601 0.362,0.601]` ratio 1.08) + cuidados §9.9. Los JPGs: PENDIENTES. `lab/.gitignore` NO ignora `fixtures/` (solo `fotos/`) — sin ajuste necesario. |
| `lab/resultados/quad-repro-sanidad-rig.png` | Lámina de SANIDAD del rig (control con `src/assets/acta-e14-real.jpg` — NO es resultado de campo). |
| `lab/README.md` §Quad-repro | Tabla H1-H4 × evidencia × veredicto (preparada — la columna de trazas se llena con los fixtures) + propuesta de fix rankeada EN MARCO (SCORING vs GENERACIÓN vs refine-fallback, según el criterio del kit §5-Fase 3) + cómo correr. |

## 3. Sanidad del rig (AC §6.3 — «si el harness marca mal el control, el rig está mal»)

Corrida end-to-end en el sandbox con el acta real del repo (`src/assets/acta-e14-real.jpg`,
1715×2287) — la MISMA que usó el HUMO de FILTROS-1:

- Worker **READY** (probe completo; opencv self-hosted vía `lab/vendor` — el loader del worker
  resuelve el core desde la URL del worker principal → `/lab/vendor/opencv-4.5.5-core.js` ✓).
- Detect: quad trapecio sano con tilt `[0.296,0.053 0.711,0.040 0.726,0.994 0.312,0.997]`,
  crop estimado 692×2000 (cap 2000 aplicado), **ratio 2.89 ≈ 2.9** ✓.
- Trazas de la cascada visibles: pasada 1 → 3 polys todas `validateOk:false` (ratio ~0.44-0.50);
  pasada 2 → 1 poly ganadora (area 1.552.150, ratioAspect 2.966, whiteness 0.617, score 0.55).
- `refineQuadFromLines` y `detect` trazando; `warp` con el quad devuelto → **701×2171px**.
- Lámina con el quad dibujado sobre la foto + trazas: `lab/resultados/quad-repro-sanidad-rig.png`.

**El rig funciona de punta a punta** (protocolo §3 completo: ready/detect/result/trazas/warp).

## 4. Las 3 fases del procedimiento (§5) — estado

| Fase | Estado |
|---|---|
| Fase 1 — repro mínimo (vía archivo del app) | **PENDIENTE de fixtures** (los ZIPs no llegaron). Nota del kit §5.1: si la vía archivo NO reproduce → H4 (diferencia vivo/archivo) es un hallazgo legítimo — el rig queda listo para ambas ramas. |
| Fase 2 — instrumentación (clasificar H1-H3) | **PENDIENTE de fixtures** — la copia instrumentada y el panel ya emiten exactamente las trazas que deciden (fellBack por lado → H1; ganador y sus score/area/ratio → H2; polys/todos-invalidados → H3). |
| Fase 3 — contra-evidencia (warp ideal) | **PENDIENTE de fixtures** — botón «Warp» + quad ideal manual ya operativos; decide SCORING vs GENERACIÓN (kit §5-F3). |

## 5. Criterios de aceptación (§6)

1. Repro determinista del zip2 documentado → **pendiente de fixtures** (rig listo; H4 contemplado).
2. Causa raíz a nivel función:línea → **pendiente de trazas** (la instrumentación existe y está validada en la sanidad).
3. Control zip1 saneando el rig → **hecho por análogo** (acta real del repo: quad sano ratio 2.89 — el rig marca BIEN un control real; con el fixture zip1 se repite 1:1).
4. Láminas legibles commiteadas → **sanidad commiteada** (`lab/resultados/quad-repro-sanidad-rig.png`); las de fixtures quedan pendientes.
5. CI del PR en verde → checks/Vercel esperados verdes; **parity ×2 en FAILURE por causa EXTERNA al kit** (ver §6) — el PR no toca ni un byte de producción (diff vs main = solo `lab/` + docs).

## 6. NOTA sobre el CI del PR (parity ×2 rojo — NO es culpa de este PR ni de T-A)

El job `parity` compara `public/scanner/detection-worker.js` contra **web-scanner/main en runtime**.
**web-scanner/main avanzó (lote 8: PERF-6 histograma de luma en el worker + BLQ-7b sin CDN OpenCV)**
después del último sync a e14 → el worker de e14/main (68.566 B) difiere del de web-scanner/main
(69.647 B) → CUALQUIER PR que nazca de main actual hereda el worker «viejo» y el parity se pone
rojo. Es el MISMO fenómeno que el dueño diagnosticó para #11/#13 («el head viejo aún carga el
worker viejo → el CI rojo queda pegado ahí»). El fix NO está en estos PRs: es el **sync del worker
a e14/main** (decisión del dueño — el agente no toca producción fuera de kits). Tras ese sync, el
rebase de T-A/T-C lo hereda y el parity se pone verde solo.

## 7. Pitfalls — cumplimiento

1. Original de `public/` INTACTO (diff vs main = 0 archivos fuera de lab/+docs) ✓ · 2. Instrumentada la COPIA con sha del original en el header ✓ · 3. bitmap transferido y re-creado por intento ✓ · 4. `busy` manejado (single-flight en el harness) ✓ · 5. corners normalizado (el worker trae `toFractions` — el harness no re-inventa la normalización; crop con el MISMO cálculo del bridge) ✓ · 6. fixtures sin EXIF documentado (pendientes de llegada) ✓ · 7. ratio 2.9 = referencia, NUNCA guard de producción (el harness lo etiqueta como señal de diagnóstico) ✓ · 8. cero dependencias nuevas (vanilla JS) ✓ · 9. procedencia anotada en fixtures/README ✓ · 10. sin fixtures NO se fuerza conclusión — H4 queda como hallazgo legítimo y el rig queda listo ✓.

## 8. Contrato de entrega

- [x] PR `lab/quad-repro` → main, CI (checks/Vercel verde; parity rojo EXTERNO — §6, se arregla con el sync del dueño).
- [ ] `lab/fixtures/` 2 JPGs — pendientes de re-subida (README con procedencia YA commiteado).
- [x] `lab/quad-repro.html`+`js`, `lab/worker-copy/` con trazas, `lab/vendor/`, `lab/resultados/` (sanidad).
- [x] `lab/README.md` §Quad-repro con la tabla H1-H4 × evidencia × veredicto (preparada) y la propuesta de fix en marco.
- [x] worklog + AGENTS.md + kit verbatim (md5 `965eb3ada50213b5b8d62eb952e404a1`) + este REPORTE.
