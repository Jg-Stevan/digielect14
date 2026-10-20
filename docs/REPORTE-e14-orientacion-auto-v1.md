# REPORTE — KIT e14-orientacion-auto-v1 — Probe de orientación por confianza de rec (AGENTE 1 del mega-kit orientacion-tiempos)

## Resumen

El pipeline CORRIGE SOLO la orientación de las actas fotografiadas de costado/cabeza-abajo (causa raíz de las 12 RECHAZADAS del informe 19/10: tira Consulado de Egipto KIT 399 a 90° y 180° — el EXIF ya lo aplica el core, NO es bug de decode). `probeOrientacion()` (`src/lib/e14/orientacion.ts`, NUEVO) corre en AMBOS pipelines (`pipeline()` tras fijar `fotoOcr` y `pipelineRecorte()` tras su fallback), ANTES del OCR completo: 1 pasada det (el MISMO `inferDet` de producción, MISMO singleton ORT — sin sesiones ni descargas nuevas), K=8 crops (las 3 líneas MÁS LARGAS + 5 repartidas cada n/K — donde viven las anclas), y sondeo con **rec CRUDO** (sin cls, sin filtro TEXT_SCORE — `rapidOcrRecLote`) de cada rotación candidata:

- `score(r) = anclas(r)·2 + confMedia(r)·(charsLegibles(r)/40)`, tope 10.
- Guard absoluto: `score(r) < 1.0 Y conf(r) < 0.55` → NO candidata (jamás inventar).
- Decisión: `r* = argmax`; aplicar SOLO si `score(r*) ≥ score(0) + 1.5` y `r* ≠ 0`.
- Atajos: tira vertical (H>W) sondea `[0,180,90,270]` (si 180 dispara, ni 90/270) · horizontal `[0,90,270,180]`.
- Escudos (§3): SIM **OMITIDO** (mismo guard del banda/esquinas — chips intactos) · presupuesto duro `PROBE_BUDGET_MS=4000` a mitad → aborta y sigue con 0° (comportamiento de hoy) · `sinRecorte` corre igual (en esta base solo existe en SIM → cubierto por el MISMO guard) · la rotación JAMÁS cambia el score por sí misma: los caps/gate existentes mandan después.
- Al aplicar (paso 4): se giran `fotoOcr` Y `fotoProcesada` (canvas rotate + re-encode JPEG q0.92) — el acta visible/guardada queda derecha y TODO el downstream (esquinas/completitud/visor/OCR/gate) ve el acta ya corregida. Canvases transitorios liberados (`crops.length = 0`).
- Traza en línea PROPIA (solo AÑADIR — nunca mezclada con `pipeline`/`recorte`/`celda`):
  `[e14] orientacion crop=WxH rot=R probe={...} anclasR=n confR=0.xx aplicado=0|1 ms=NNN` — sin línea si el probe ni siquiera corrió (SIM o fallo duro de init/det; catch general: el probe JAMÁS tumba el pipeline).

## Whitelist §1 vs diff real

| §1 | Real | OK |
|---|---|---|
| `src/lib/e14/orientacion.ts` | NUEVO (probe completo) | ✓ |
| `src/lib/e14/ocr/rapidocr.ts` (exponer batch-rec) | M — 2 exports (`rapidOcrCropsOrientacion`, `rapidOcrRecLote`) al final, tras `rapidOcrReconocer` | ✓ |
| `src/lib/e14/scanner-core-bridge.ts` (puntos de integración) | M — 1 import + bloque probe en `pipeline()` + bloque probe en `pipelineRecorte()` (`const fotoProcesada`→`let` + `parcial.fotoProcesada` se actualiza si aplicó) | ✓ |
| `docs/REPORTE-e14-orientacion-auto-v1.md` | NUEVO (este) | ✓ |
| `docs/worklog.md` / `AGENTS.md` (1 línea) / `docs/ROADMAP.md` (sección propia al final) / `docs/DECISIONS.md` (solo D51) | registrados | ✓ |

`git status` = EXACTAMENTE 2 M + 1 ?? de código. Zonas prohibidas (§1: `masiva/**`, `tipos.ts`, `tools/**`, `.gitignore`, `senal-lectura.ts`, `detection-worker.js`, gate/caps/escudos/SIM, `divipol.json`, workflows CI, `package.json`/`bun.lock`) — **VACÍO**. `senal-lectura.ts` solo CONSUMIDO (`ANCLAS_LECTURA` + `norm`, import).

## Evidencias §4/§5 (trazas verbatim del sandbox — build limpio `BUILD_STATIC=1`, arnés local COOP/COEP, `crossOriginIsolated=true`, agente-browser real)

**Fixture (AC-1):** `original.jpg` de `e14-diag-mesa-001` (3024×4032, tira Consulado de Egipto **KIT 399 — la MISMA tira de las 12 RECHAZADAS del dueño**) → `sana.jpg` (EXIF horneado y eliminado — determinista) + `girada90/180/270.jpg` (PIL `transpose`, q90, píxeles girados SIN EXIF = exactamente lo que ve el core tras F-IMPORT). Importadas las 4 en UNA cola MASIVA (la ruta real del dueño).

**Batería 4/4 (consola verbatim, en orden sana → 90 → 180 → 270):**

```
[e14] orientacion crop=763x2441 rot=0   probe={0:10.00,90:0.00,180:0.08,270:0.00} anclas0=4   conf0=0.84 aplicado=0 ms=3609
[e14] orientacion crop=2438x725 rot=270 probe={0:0.00,90:0.07,270:8.60}  anclas270=3 conf270=0.87 aplicado=1 ms=2682
[e14] orientacion crop=699x2434 rot=180 probe={0:0.01,180:8.58}          anclas180=3 conf180=0.79 aplicado=1 ms=2439
[e14] orientacion crop=2434x738 rot=90  probe={0:0.00,90:8.37}           anclas90=3  conf90=0.77 aplicado=1 ms=1986
```

- **sana (AC-3)**: score(0)=**10.00** con 4 anclas — ninguna rotación alcanza el MARGEN → `aplicado=0` → pipeline **IDÉNTICO al pre-kit**: `score=8.5 … lectura=FUERTE anclas=9 … clasif={dep:88,mun:335,zon:05,std:02,mesa:001,pag:1/2,tipo:T,nivel:AUTO,cod:710003993010102}` (baseline prowarm: mismo 8.5/mismo cod — byte a byte).
- **girada90 → rot=270 aplicada** (atajo horizontal: {0,90,270} sondeadas, 180 ni tocada) → `score=8.5 … lectura=FUERTE anclas=8` — RECHAZADA 4.9 → **AUTO ENVIADA**.
- **girada180 → rot=180 aplicada** (atajo vertical: solo {0,180}) → `score=8.5 … lectura=FUERTE anclas=9` — ídem. Antes del probe el OCR de esta foto daba `40 cajas · 5 líneas · conf 69% → 4.9 DEBIL`; con rotación: `40 cajas · 37 líneas · conf 93.9%`.
- **girada270 → rot=90 aplicada** (atajo horizontal: solo {0,90}) → `score=8.5 … lectura=FUERTE anclas=9`.
- Costo del probe: 2.0–3.6 s caliente por acta no-SIM (det ~0.5 s + hasta 4 lotes rec) — dentro del tope 4000 ms; en ninguna corrida tocó el budget.

**§5.2 SIM intacto (escudo):** `sim=8.2` · `sim=7` · `sim=4.3` — los 3 chips EXACTOS de main; **0 trazas** `[e14] orientacion` en SIM (el guard `!opciones.simular` las omite).

**§5.1 estática:** `bun run lint` 0-0 · `bunx tsc --noEmit` 0 · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` OK.

**AC-4:** traza presente en 4/4 actas no-SIM de la batería (100% donde el probe corrió). Det sin cajas → traza `probe={0:0.00} … aplicado=0` (sin línea solo si init/det falla duro — catch §5).

## Lecciones del sandbox (por qué la muestra es «3 más largas + 5 repartidas»)

1. **Spread puro cada len/8** (1.ª implementación): los 8 crops cayeron en el CUERPO del acta («VOTOS NULOS», «TOTAL VOTOS INCINERADOS», «PATRIA»… — verificado con dump visual de los crops) → 0 anclas → en 180° `score=0.99 < 0.10+1.5` → **no aplicaba** (el guard hizo su trabajo: no inventa; la muestra no traía anclas).
2. **«3 más anchas» midiendo tl→tr**: en actas ±90° las líneas son verticales y tl→tr mide el GROSOR, no el largo → regresión medida en 90° (score 270: 3.83 → 1.06 → no aplicaba).
3. **Solución final**: lado MAYOR del rect (`max(|p0→p1|, |p1→p2|)`) para elegir las 3 más largas + 5 repartidas por centro Y → **4/4 verdes** con los mismos K=8, guard y MARGEN kit-literal. El kit dice «p. ej. boxesFuente cada len/8» — el «p. ej.» deja la muestra a criterio; esta es la razón documentada (código y D51).

## Desviaciones

1. **MUESTREO (documentada arriba):** «p. ej. cada len/8» → 3 más largas + 5 repartidas. K=8 kit-literal; sin esto AC-1 falla en 180° y regresa en 90°.
2. **`pipelineRecorte`:** `const fotoProcesada` → `let` (el probe puede reemplazarla por la derecha) y `parcial.fotoProcesada` se actualiza si aplicó (el horneado temprano del kit recorte-manual D42 queda consistente con la foto final). El horneado NO se elimina ni se retrasa.
3. **Det sin cajas:** traza propia con `aplicado=0` (AC-4 — y NUNCA se alimenta un lote vacío a rec).
4. **BLOQUEADA: ninguna.**
5. **AC-2 (real, dueño):** pendiente de las 6 fotos del informe en SU equipo — bloqueante para merge final, no para abrir el PR (kit §4). Nota favorable: el fixture de este reporte ES la tira del dueño (KIT 399) rotada sintéticamente — el caso 180°/90° real ya quedó demostrado en sandbox.

## Pasos del dueño

1. Revisar el PR (CI verde) → **merge** (AC-2 en mano: procesar las 6 fotos del informe por MASIVA — cada una debe trazar `[e14] orientacion … aplicado=1` y terminar con lectura ≥2 anclas; las 4 ENVIADAS deben seguir `aplicado=0` y 8.5).
2. Redeploy producción (docs/DEPLOY-vercel.md §2 — el botón Redeploy reconstruye el commit VIEJO, §3) + **Ctrl+Shift+R**.
3. En producción: repetir 2-3 fotos rotadas + 1 sana; verificar las trazas y que el acta visible/guardada (y el ZIP del informe) sale DERECHA.

## Notas de diseño (para el rastreador del dueño)

- El probe corre SIEMPRE antes de esquinas/completitud/OCR → el acta corregida beneficia a TODO el downstream (en 180° las esquinas pasaban de FALTA×3 a medirse sobre el acta derecha).
- `ocrIn`/trazas existentes SIN campos nuevos (regla §2.1 paso 5) — la corrección queda registrada SOLO en la línea `[e14] orientacion`.
- El rec crudo del probe es intencionalmente SIN cls y SIN TEXT_SCORE: un crop mal rotado debe puntuar BAJO, no desaparecer del cómputo.
- Coste memoria: 8 crops + hasta 8 girados transitorios por sondeo, liberados al terminar; las dataURL giradas reemplazan a las anteriores (re-encode q0.92, mismas dimensiones giradas).
