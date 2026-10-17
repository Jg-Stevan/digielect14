# KIT e14-score-lectura-v1 — SCORE v2: "LA LECTURA MANDA" (digitalizador E-14)

Repo: `Jg-Stevan/digielect14` · Base: `origin/main` · Rama nueva: `feat/score-lectura`
Fecha: 2026-10-17 · Autor del plan: Z.ai Code · Estado: PLAN para agente

---

## §0 — Decisión del dueño (literal)

> "apliquemolo, pero deja este '. El score del disparo en vivo (0→100% del chip de
> escaneo)' y explicame mas tu propuesta de forma simple"

Traducción a alcance:
1. **APLICAR** la mejora del score X/10 (la propuesta A+B+C del análisis previo).
2. **NO TOCAR** el score de disparo en vivo (el 0→100% del chip durante el escaneo):
   `quality.js` del core, el frame loop de ScanView, `SHUTTER_SCORE` — TODO fuera de
   alcance. Solo cambia el score POST-captura (el X/10 del TopBar / banner).
3. La propuesta se implementa COMPLETA (A+B+C) según §3 de este kit.

Algoritmo resultante (nombre interno: **score v2 = base visual recalibrada + ajuste
por lectura**). Principio del proyecto ya establecido («el OCR manda», §X
SPEC-score-legible) elevado a regla: el score deja de medir solo "¿se ve bien?" y
pasa a responder "¿se va a LEER bien?".

---

## §1 — Diagnóstico del score actual (verificado byte a byte en main)

Cadena hoy (`src/lib/e14/scanner-core-bridge.ts`):

| Paso | Dónde | Qué hace |
|---|---|---|
| 1. Recorte | `calidadDeActa` (L385) | bbox del quad +3% margen (L332), cap 2000px (L338), fallback frame completo |
| 2. Métricas | `evaluateQuality` del core (paquete npm, INTOCABLE) | baja a **W=120px**, gris; `sharpness = min(100, σ(Laplaciano)×2.2)`, `contrast = min(100, σ(luminancia)×1.4)`, `brightness = min(100, media/255×100)` |
| 3. Level | dentro del core | `scoreCore = sharp×0.45 + bright×0.25 + cont×0.3` → ≥80 excellent / ≥62 good / ≥45 fair / <45 poor |
| 4. Score 10 | `scoreDeCalidad` (L290) | `(sharp×0.4 + bright×0.3 + contrasteEf×0.3)/10`, 1 decimal; `contrasteEf = ocrLegible ? max(contrast, 80) : contrast` (piso hack, L272/L282) |
| 5. Techos | L311 y alrededores | fair→≤7.9 · poor→≤6.4 · sin señal de contenido→≤4.9 (TECHO_SIN_SENAL L110) |
| 6. Inyección SIM | L824-826 | chip manda (8.2/7.0/4.3) DESPUÉS de scoreDeCalidad |
| 7. Caps posteriores | L858-870, L1186 | escudo fondo ≤7.9 · recortada ≤7.9 · gate RECHAZADA — sobreescriben todo lo anterior |

Debilidades objetivas (motivación de cada cambio):

1. **W=120px es ciego para blur fino** — el Laplaciano sobre una miniatura de 120px
   solo distingue blur GORDO; actas nítidas y mediocres saturan lo mismo (~100).
2. **Pesos 0.4/0.3/0.3 heredados** del quality.ts original, nunca calibrados.
   → NO se recalibran en este kit (falta data suficiente; el ajuste de lectura C
   cumple ese rol con evidencia real).
3. **El OCR entra binario** (legible sí/no vía `ocrTextIsValid`) — el pipeline YA
   tiene el texto completo con mesa/anclas leídas y el score lo ignora.
4. **El piso de contraste 80 es un parche binario** — contradice la medición
   (contraste global bajo POR DISEÑO en documentos: papel blanco ~85% del cuadro).

---

## §2 — Alcance exacto

### CAMBIA (3 cosas)

- **C1 — Nitidez de alta resolución (propuesta A)**: `calidadDeActa` calcula además
  `sharpnessHi` (σ del Laplaciano sobre el recorte a ~1000px, mediana de 9 tiles
  3×3) y `contrastPapel` (spread p95−p5 de luminancia del recorte). El score10 usa
  `sharpnessV2 = sharpnessHi` (fallback `q.sharpness` si no hay recorte).
- **C2 — Contraste de papel (propuesta B)**: `contrasteEfectivoDe` pasa a
  `max(q.contrast, contrastPapel, ocrLegible ? 80 : 0)` — el piso existente QUEDA
  (no-regresión por construcción), el spread de tinta rescata actas borrosas-pero-
  legibles sin depender del binario del OCR.
- **C3 — Ajuste por lectura (propuesta C)**: en los 2 sitios de llamada (L813 y
  L1174), tras `scoreDeCalidad` y ANTES de la inyección SIM/caps posteriores:
  ```ts
  const senal = senalDeLectura(texto, clasificacion.parciales);
  if (senal.nivel === "FUERTE" && calidad.level !== "poor") score = Math.max(score, 8.5);
  else if (senal.nivel === "DEBIL") score = Math.min(score, 5.9);
  // MEDIA → el score queda como lo deje la visión
  ```
- **C4 — Trazas**: el log de auditoría gana `lectura=FUERTE|MEDIA|DEBIL anclas=k`
  (los 2 logs, L936 y L1236).

### NO CAMBIA (lista dura — prohibido tocar)

- **El score de disparo en vivo** (0→100% del chip de escaneo): `quality.js` del
  core (`WEIGHTS`, `SHUTTER_SCORE=0.8`, `SHUTTER_SUSTAIN_MS=400`), el frame loop de
  ScanView, el trigger ZSL. **Fuera de alcance por orden del dueño.**
- `packages/scanner-core` (npm) — INTOCABLE. Todo vive en `src/lib/e14/`.
- `evaluateQuality` y su `level` del core (labels/chips de UX siguen igual).
- `evaluarGate`, `statusDeScore`, el veto INCOMPLETA, marcadores de votos, escudo
  fondo (≤7.9), recortada (≤7.9) — aplican DESPUÉS del ajuste C3 y siguen MANDANDO
  (un acta recortada con lectura FUERTE se queda ≤7.9: los caps posteriores ganan).
- Inyección SIM (L824-826): los 3 chips siguen mostrando 8.2/7.0/4.3.
- `TECHO_SIN_SENAL=4.9`, `PISO_CONTRASTE_LEGIBLE=80`, techos fair/poor dentro de
  `scoreDeCalidad` (byte a byte intactos).
- `clasificarCabecera`, DIVIPOL, `verificarCompletitud`, `medirZonaVotos`, `ocrBanda`.
- ScanView, store, el gate de identificación, la matriz del informe, PROD-1/PROD-2.

---

## §3 — Definición exacta del score v2

```
SENAL DE LECTURA (texto OCR post-banda + parciales de clasificación):
  anclas = # de ANCLAS_LECTURA que matchean (regex estructurales, §4-A)
  chars  = norm(texto).replace(" ","").length   (norm = la del informe/informe-análisis)
  FUERTE = (mesa leída Y anclas ≥ 4) o anclas ≥ 6
  MEDIA  = cabecera E-14 leída o anclas ≥ 2 o chars ≥ 150
  DEBIL  = resto

SCORE (orden completo, cada paso puede bajar/subir el anterior):
  1. bruto = (sharpnessV2×0.4 + brightness×0.3 + contrasteEfectivo×0.3) / 10
  2. level recalculado con sharpnessV2/contrasteEfectivo (misma fórmula duplicada
     del core que ya existe en scoreDeCalidad — mismos umbrales 80/62/45)
  3. techos visuales: fair→≤7.9 · poor→≤6.4   (intactos)
  4. sin señal de contenido → ≤4.9            (intacto)
  5. NUEVO — lectura: FUERTE y level≠poor → piso 8.5 · DEBIL → techo 5.9
     (piso vence al techo fair — el OCR manda — pero NUNCA al techo poor)
  6. redondeo 1 decimal
  7. inyección SIM (si aplica) → 8. caps posteriores (escudo/recortada/gate)
```

Constantes nuevas (módulo `senal-lectura.ts`, con rationale):

| Constante | Valor | Rationale |
|---|---|---|
| `PISO_LECTURA_FUERTE` | 8.5 | lectura con mesa+anclas = acta útil; banca por encima de ADVERTENCIA (statusDeScore: ≥8 → OPTIMA/auto-envío normal, el gate sigue decidiendo) |
| `TECHO_LECTURA_DEBIL` | 5.9 | casi-nada leído = no merece zona OPTIMA/ADVERTENCIA alta; RECHAZADA/BAJO honesto |
| `HI_RES_LADO` | 1000 px | lado largo del canvas de análisis; costo <80ms, cap CROP_LADO_MAX=2000 ya existe |
| `LAP_NORM` | ×2.2 cap 100 | MISMA normalización del core (cambio solo de resolución) |
| `PAPER_SPREAD_NORM` | 160 | papel ~220 − tinta ~60 = 160 → 100; documento legible típico |
| `TILES` | 3×3 mediana | 1 reflejo/mancha no tumba la nitidez |

---

## §4 — Especificación por archivo

### A) NUEVO `src/lib/e14/senal-lectura.ts` (puro, sin DOM, testeable headless)

```ts
/** KIT e14-score-lectura-v1 — señal de lectura para el score v2.
 *  FUENTE: ANCLAS_ESTRUCTURALES de src/lib/e14/informe/analisis-texto.ts
 *  (rama informe-telemetria-ocr). Si esa rama ya está mergeada en la base,
 *  IMPORTAR de allí; si NO, copia local documentada (instrumento de medición,
 *  no GT — las 10 regex estructurales sin valores del acta). */
export type NivelLectura = "FUERTE" | "MEDIA" | "DEBIL";
export interface SenalLectura { nivel: NivelLectura; chars: number; anclas: number; }

export const ANCLAS_LECTURA: [string, RegExp][] = [
  ["cabecera E-14", /E\s*-\s*14/i],
  ["REGISTRADURÍA", /REGISTRADUR[IÍ]A/i],
  ["CONSULADO n", /CONSULADO[::\s.]*\d|CONSULADOS/i],
  ["PAÍS n", /PA[IÍ]S[::\s.]*\d/i],
  ["ZONA n", /ZONA[::\s.]*\d+/i],
  ["PUESTO n", /PUESTO[::\s.]*\d+/i],
  ["MESA nnn", /MESA[::\s.]*\d+/i],
  ["Ver Pag n de n", /Ver\.?\s*:?\s*\d+\s*Pag\.?\s*:?\s*\d+\s*de\s*\d+/i],
  ["KIT nnn", /KIT[::\s.]*\d+/i],
  ["código 1D 15d", /\b\d{15}\b/],
];

export function norm(s: string): string { /* idéntica al informe: upper→NFD sin
  diacríticos→[^A-Z0-9]+→" "→trim */ }

export function senalDeLectura(
  texto: string,
  parciales?: { mesa?: number | null; cabecera?: boolean },
): SenalLectura {
  const chars = norm(texto).replace(/ /g, "").length;
  const anclas = ANCLAS_LECTURA.filter(([, re]) => re.test(texto)).length;
  const mesaLeida = (parciales?.mesa != null && Number.isFinite(parciales.mesa)) || /MESA[::\s.]*\d+/i.test(texto);
  const nivel: NivelLectura =
    (mesaLeida && anclas >= 4) || anclas >= 6 ? "FUERTE"
    : /E\s*-\s*14/i.test(texto) || anclas >= 2 || chars >= 150 ? "MEDIA"
    : "DEBIL";
  return { nivel, chars, anclas };
}
```

### B) `src/lib/e14/scanner-core-bridge.ts` — modificaciones

**B1 — `calidadDeActa` (L385) + tipo local**: tras dibujar el canvas del recorte
(hoy cap 2000), derivar el canvas de análisis a `HI_RES_LADO=1000` (solo downscale,
nunca upscalar) y computar:

```ts
interface PageQualityV2 extends PageQuality { sharpnessHi: number; contrastPapel: number; }

/** Laplaciano 4-vecinos sobre gris; mediana de varianza de 9 tiles 3×3;
 *  sharpnessHi = min(100, σ_mediana×2.2). Histograma 256 bins del mismo gris
 *  para p5/p95 (percentiles por barrido acumulado, SIN sort);
 *  contrastPapel = min(100, (p95−p5)×100/160). Fallback (frame completo):
 *  MISMO cálculo sobre el frame — fallback nunca queda sin señales. */
```
- `willReadFrequently: true` (ya existe), un solo `getImageData`.
- El fallback `evaluateQuality(fotoOriginal)` del catch → adjunta
  `sharpnessHi/contrastPapel` del frame vía el MISMO helper (o 0/0 si falla
  también — score v2 degrada a comportamiento actual).

**B2 — `scoreDeCalidad` (L290)**: acepta `PageQualityV2`; usa
`sharpnessV2 = q.sharpnessHi || q.sharpness` en `bruto` Y en el recálculo del
level (fórmula/umbrales duplicados byte a byte iguales, solo cambia la entrada);
`contrasteEfectivoDe` (L282) → `Math.max(q.contrast, (q as PageQualityV2).contrastPapel, ocrLegible ? PISO_CONTRASTE_LEGIBLE : 0)`. Techos fair/poor/sin-señal intactos.

**B3 — sitios de llamada (L813 y L1174)**: insertar C3 (bloque §2) EXACTAMENTE
entre `scoreDeCalidad(...)` y la inyección SIM (L824) / caps posteriores (L858+,
L1186). Nada antes, nada después.

**B4 — logs (L936, L1236)**: añadir token `lectura=${senal.nivel} anclas=${senal.anclas}`
y `piso=${score>=8.5&&senal.nivel==="FUERTE"}` al log de auditoría existente.

### C) `docs/` + worklog
- `docs/REPORTE-score-lectura-v1.md`: tabla antes/después con las 4 fotos reales
  (`public/fotos-lab/`) + los 3 SIM, con el log de auditoría de cada una.
- Worklog `docs/AGENTS.md` + registro del kit.

---

## §5 — Casos borde

| Caso | Comportamiento |
|---|---|
| Acta nítida perfecta (level excellent) + FUERTE | ≥8.5 → OPTIMA (como hoy por visión, ahora garantizado por lectura) |
| Acta borrosa (level poor) que AUN lee mesa+4 anclas | se queda ≤6.4 — el techo poor NUNCA lo salta el piso (evidencia física dura) |
| Acta fair (7.9) con lectura FUERTE | 8.5 — el piso vence al techo fair (el OCR manda); si además es recortada/escudo-fondo, el cap posterior la devuelve a ≤7.9 |
| Foto de la bolsa de papas / fondo | sin señal → 4.9 (intacto) + DEBIL ≤5.9 (no empeora) |
| OCR vacío | ocrLegible=false, sin piso de contraste, DEBIL → ≤5.9; sin señal → 4.9 |
| Banda leída en 2ª pasada (ocrBanda) | el texto ya se suma ANTES del score → las anclas la ven (bien; MESA en la banda no es típico) |
| SIM (3 chips) | inyección L824 DESPUÉS del ajuste → 8.2/7.0/4.3 idénticos |
| Recorte con fallback al frame | sharpnessHi/contrastPapel del frame; sin recorte posible → 0/0 → score v2 == score actual |
| `recortar()` desde el editor (pipelineRecorte L1174) | MISMO ajuste C3 — mismo criterio en re-análisis |
| Página 2 (constancias, sin zona de votos) | señal de lectura por anclas normales (FIRMA/CONSTANCIAS no cuentan como anclas — mismas 10 estructurales) |

---

## §6 — Validación headless del agente (obligatoria antes del PR)

1. `bun run lint` limpio.
2. Smoke del módulo puro (bun -e, sin archivos de test):
   - `senalDeLectura("ACTA DE ESCRUTINIO ... ZONA: 15 PUESTO: 02 MESA: 012 ... KIT 745 ... 710007453010202")` → FUERTE (≥6 anclas)
   - `senalDeLectura("")` → DEBIL
   - `senalDeLectura("hola mundo")` → DEBIL
   - `senalDeLectura("E-14 REGISTRADURIA")` → MEDIA (cabecera, 2 anclas)
3. Dev server: los 3 chips SIM muestran 8.2/7.0/4.3 y clasificación OPTIMA/
   ADVERTENCIA/RECHAZADA idénticas a hoy (no-regresión dura).
4. Importar las 4 fotos reales (`public/fotos-lab/`, fotos del digitalizador):
   - 3 legibles (2× Frankfurt P2 + Frankfurt P1 + El Cairo P1) → log
     `lectura=FUERTE anclas≥4` y score final ≥8.5 SALVO que caigan
     escudo-fondo/recortada (entonces ≤7.9 con piso ignorado — CORRECTO).
   - Documentar el X/10 y los techos aplicados de CADA foto en el REPORTE.
5. Confirmar en los logs que NO hay llamada nueva a OCR (la señal usa el texto
   ya leído — costo 0 en tiempo de OCR) y que CALIDAD sigue <200ms.

---

## §7 — QA del dueño (después del merge)

1. Escanear el acta real en buena luz → esperar ≥8.5 con banner ÓPTIMA.
2. Escanear con sombra/reflejo parcial → la mediana de tiles no debe dejarse
   engañar por UN reflejo (comparar con el score de hoy).
3. Escanear borroso a propósito → ≤6.4 (techo poor) aunque el OCR lea algo.
4. Probar el chip MEDIO y BAJA de SIM → 7.0 y 4.3 idénticos.
5. Enviar al asistente: los 4 X/10 nuevos de las fotos del lab + logs
   (`lectura=... anclas=...`) para el análisis antes/después y posible
   recalibración fina (PAPER_SPREAD_NORM / umbrales de FUERTE).

---

## §8 — Rama base y entregables

- **Base**: `origin/main` @ actual. OJO: PROD-1 (`feat/ocr-lee-original`) y PROD-2
  (`feat/motor-rapidocr`) tocan ESTE MISMO archivo en la MISMA zona (paso OCR +
  sitio del score). Orden de merge recomendado: PROD-1 → PROD-2 → score-lectura.
  Si el agente branquea desde main y hay conflicto al mergear, es SOLO en las
  líneas L775-826/L1160-1186 (zona OCR→score): re-resolver manteniendo AMBOS
  cambios (el filtro/motor del OCR de PROD-1/2 + el ajuste de lectura C3).
- **Rama**: `feat/score-lectura` · PR sin merge (espera auditoría, como siempre).
- **Commits**: estilo del repo (`feat(e14): ... — kit score-lectura-v1 FASE ...`).
- **Prohibido**: `bun run build`, tocar `packages/`, mover el dev server del 3000.

---

## §9 — Pitfalls (los que han mordido antes)

1. **No recalcular el Laplaciano sobre la foto 12MP completa** — solo el recorte
   derivado a 1000px (el getImageData de 12MP congela el hilo).
2. **Percentiles por histograma 256 bins** — NUNCA sort de ~10⁶ píxeles.
3. **Mediana, no promedio, de los 9 tiles** — el promedio se deja engañar por un
   reflejo especular (varianza altísima en el filo del reflejo).
4. **El piso 8.5 NO vence al techo poor ni a los caps posteriores** (escudo fondo,
   recortada, gate RECHAZADA). Si un QA muestra una recortada con 8.5, el orden de
   las operaciones está mal — revisar §4-B3.
5. **SIM por encima de todo** — la inyección (L824-826) va DESPUÉS del ajuste;
   moverla rompe la demo del dueño (no-regresión dura AC-S2 de simulacion-scores).
6. **No borrar el piso PISO_CONTRASTE_LEGIBLE** — queda dentro del max (C2). Quitarlo
   es regresión silenciosa en actas con tinta débil.
7. **`PageQuality` es del core** — extender con tipo local `PageQualityV2`, nunca
   modificar el paquete ni redeclarar el import.
8. **El texto que llega a `senalDeLectura` es el POST-banda** (consenso-frankfurt
   FASE 4 ya suma `ocrBanda` antes) — no volver a llamar OCR.
9. **Dos sitios de llamada, un solo criterio** — pipeline de escaneo (L813) y
   pipelineRecorte (L1174) deben quedar idénticos; divergencia = bug de re-análisis.
10. **`norm()` debe ser la del informe** (mismo plegado) — si el informe se mergea
    primero, importarla; duplicarla genera dos definiciones de "chars" y los números
    del reporte no van a cuadrar con el lab.
