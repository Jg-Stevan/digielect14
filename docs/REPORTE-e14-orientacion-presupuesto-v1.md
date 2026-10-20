# REPORTE — KIT e14-orientacion-presupuesto-v1 (D56) — el probe de orientación que sí llega en hardware lento

**Base:** `main @ f9e4027` · **Rama:** `fix/e14-orientacion-presupuesto-v1` · **Tipo:** P0 — fix de producción (actas rotadas en la flota HP 4 cores)
**Zona:** `src/lib/e14/orientacion.ts` (exclusiva) + `src/lib/e14/ocr/rapidocr.ts` (1 región: el `inferDet` de `rapidOcrCropsOrientacion`) + docs

---

## 1. Causa raíz (traza del dueño, citada del kit §1)

El probe de orientación (D51) sondea `rec` sobre 8 crops en 4 rotaciones y aplica la
ganadora si supera a 0° por margen ≥ 1.5. Su presupuesto de aborto era
`PROBE_BUDGET_MS = 4000` con el check ANTES de cada rotación desafiante, y el det
del probe corría a límite **1920**:

```
det a 1920 = 3037 ms   (traza dueño 20/10 03:13: [e14-rapidocr] det run [1,3,640,1920]... OK 3037ms)
rec 8 crops a 0° ≈ 3000 ms  (6030 − 3037)
→ al llegar a rot=90 ya van 6030 ms > 4000 → break → aplicado=0
```

**Consecuencia en la HP del dueño (4 cores):** acta rotada 90° jamás corregida →
el OCR escalonado quemó **42 s en texto vertical** (2 pasadas de basura, conf 74-77%)
→ `esquinas=FALTA_tl+tr+bl+br` (fiduciales girados) → `recortada=1` → score 4.9 RECHAZADA.

**La prueba de que el fix cabe está en la misma traza:** la pasada 1 del escalonado
corrió det a límite 1280 → **1183 ms** en la MISMA imagen (banco B3 GO: −56%, 0 cajas
perdidas, 120/120 votos — PR #34).

**Corroboración inversa:** en la corrida del dueño 20/10 07:42 (Linux 8 cores) el probe
CUPÓ dentro de los 4000 ms y la misma acta rotada (`171518`) salió **8.5 FUERTE, 16.7 s**.
Mismo código, dos desenlaces: solo cambia el hardware. Este kit hace el probe
independiente de la velocidad del equipo.

## 2. Los 4 arreglos (kit §3)

| # | Qué | Dónde | Efecto |
|---|-----|-------|--------|
| **T1** | Atajo de lectura-sana: tras computar scores[0], si `senalDeLectura(texto).nivel !== "DEBIL"` → break (rotar es riesgo puro; la acta sana no sondea 90/270/180) | `orientacion.ts` (bucle del sondeo) | Actas sanas: probe de ~5.3 s → **~4.0 s** (medido A/B) y cero riesgo de que un desafiante deforme una lectura que ya era buena |
| **T2** | det del probe a `DET_CAP_RAPIDO` (1280) — `inferDet(rt, src, DET_CAP_RAPIDO)`; `rapidOcrCropsOrientacion` tiene UN único caller (el probe); op1 y la sesión det INTACTOS | `ocr/rapidocr.ts` (ÚNICA edición del archivo, 1 región) | El det del probe baja de 3037 ms (HP 4 cores) a **~1183 ms** (misma imagen, banco B3) — el probe vuelve a caber en hardware lento |
| **T3** | `PROBE_BUDGET_MS` 4000 → **12000** — presupuesto HONESTO: solo lo pagan actas con lectura DEBIL a 0° (las sanas salen por T1) | `orientacion.ts` | El caso roto cabe: det 1.2 s + rec0 3 s + rec90 3 s + rec270 3 s ≈ **10.2 s < 12 s** ✓ |
| **T4** | Traza: campo aditivo **al final**: `cortes=sana\|presupuesto\|vacio\|completo` (sana=salió por T1 · presupuesto=aborto por budget · vacio=det sin cajas · completo=el probe terminó su decisión, INCLUYE el atajo MARGEN que ya decidió ganadora) | `orientacion.ts` (los 2 puntos de emisión) | Los instrumentos del dueño parsean por prefijo — contrato D51 §2.1 paso 5 (solo AÑADIR) intacto; los campos previos no cambian de forma |

## 3. Tabla de costes esperados (post-fix)

| Caso | Coste del probe | Desenlace |
|------|----------------|-----------|
| Acta SANA (lee a 0°) | det 1.2 s + rec0 ~3 s ≈ **4.2 s** (sale por T1, sin desafiante) | `cortes=sana aplicado=0` — como hoy |
| Acta rotada horizontal (gana 90/270 — caso del dueño) | det 1.2 + rec0 3 + rec90 3 + rec270 3 (gana, break) ≈ **10.2 s** < 12 s | `aplicado=1 cortes=completo` — REPARADO |
| Acta rotada vertical (gana 180) | det 1.2 + rec0 3 + rec180 3 + rec90 3 ≈ **10.2 s** < 12 s | `aplicado=1 cortes=completo` |
| Hardware aún más lento (presupuesto agotado) | tope **12 s** → aborto honesto | `cortes=presupuesto` → sigue con 0° como hoy (jamás peor que el status quo) |

## 4. Evidencia de validación (sandbox — arnés build estático COOP/COEP, HeadlessChrome, 2 cores; actas REALES del dueño: tira KIT 399 `e14-diag-mesa-001` + mesa-002)

- **§5.1 acta rotada 90° REAL** (girada con PIL ROTATE_90 — CCW; el fix aplicado es su inverso rot=90):
  `[e14] orientacion crop=2433x738 rot=90 probe={0:0.00,90:7.35} anclas90=3 conf90=0.60 aplicado=1 ms=3507 cortes=completo`
  → `[e14] ocr-escalonado pasada1=1280 lectura=FUERTE reocr=0 elegido=1280 anclas1=10 ms1=9834`
  → pipeline: **score=8.5 · nivel=AUTO · cod:710003993010102 · lectura=FUERTE anclas=10 · conf 0.93** — el OCR leyó las anclas REALES (CONSULADO/PAIS/ZONA/PUESTO/MESA/KIT/E-14), pasada 1 FUERTE sin reocr, clasificación AUTO con el código dorado. **El caso roto del dueño queda reparado.**
- **§5.2 acta sana REAL (misma foto sin girar):**
  `[e14] orientacion crop=752x2440 rot=0 probe={0:10.00} anclas0=4 conf0=0.85 aplicado=0 ms=3965 cortes=sana`
  → pipeline: **score=8.5 · nivel=AUTO · cod:710003993010102** — desenlace **IDÉNTICO al de main** (verificado A/B, §5) y probe **ms≈4 s** como predice el kit (baja por T1+T2).
- **A/B contra main (`f9e4027`), misma foto sana, mismo arnés:** main sondea `{0:10.00,180:0.05}` y sale en **ms=5315** SIN `cortes=`; esta rama sale en **ms=3965** con `cortes=sana` — **−1350 ms (−25%)** en el probe de la acta sana, mismo desenlace (8.5 AUTO, mismo cod; det/rec dentro de ruido). El campo nuevo es el ÚNICO delta de la traza (forma de los campos previos byte-idéntica).
- **SIM intacto (gate):** chips **8.2 / 7.0 / 4.3 exactos** (ÓPTIMA 8.2 · MEDIO 7.0 · BAJA 4.3, trazas `sim=` en consola) con **0 trazas** `orientacion`/`ocr-escalonado` (el probe NO corre en SIM — guard del bridge intacto).
- **Gates:** lint 0 · tsc 0 · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` OK · `git diff --name-status main` = EXACTAMENTE `orientacion.ts` + `rapidocr.ts` (1 región) + docs (§6).

## 5. A/B y desviación honesta del arnés

- **A/B:** el build de main sirve en el MISMO arnés (:3031) y la misma importación produce la traza descrita arriba (5315 ms, sin `cortes=`) — confirma que la única diferencia de comportamiento es la del kit (T1/T2/T3/T4).
- **Artefacto pre-existente del arnés headless (NO regresión del kit):** en el navegador headless sin cámara, la vista ESCANEAR tras IMPORTAR muestra en su tarjeta el desenlace del preview del detection-worker (RECHAZADA 0.0, recorte incorrecto) aunque la traza del pipeline dé 8.5 AUTO. **Verificado por A/B: main (`f9e4027`) reproduce el MISMO artefacto byte a byte** (misma tarjeta, mismo recorte) con sus propias trazas 8.5 AUTO — es decir, el estado de esa tarjeta en headless no discrimina entre ambas ramas y NO es efecto de este kit. La fuente de verdad de la aceptación (kit §5) son las trazas `[e14] orientacion` + el desenlace del pipeline, ambas verificadas. En el navegador real del dueño el mismo flujo produjo 8.5 FUERTE (su corrida 07:42, acta 171518).

## 6. Verificación de zona

`git diff --name-status main`:
```
M	docs/DECISIONS.md          (D56 append)
M	docs/ROADMAP.md            (sección nueva)
A	docs/REPORTE-e14-orientacion-presupuesto-v1.md  (este)
M	docs/worklog.md            (append)
M	src/lib/e14/ocr/rapidocr.ts     (1 región: inferDet de rapidOcrCropsOrientacion)
M	src/lib/e14/orientacion.ts      (T1 + T3 + T4 + docblock)
```
`scanner-core-bridge.ts`, `types.ts`, `informe.ts`, `masiva/**`, `public/**`, `tools/**`,
workflows, `package.json`: INTACTOS (cero bytes).

## 7. Pendiente del dueño

- **AC-5-D56:** repetir la validación §5 en SU equipo — en la HP 4 cores: traza esperada
  `... aplicado=1 cortes=completo` con el det del probe a 1280 (la traza nueva
  `cortes=` debe aparecer; en las sanas `cortes=sana`) y el acta rotada 90°
  saliendo ≥ 7 (OPTIMA/ADVERTENCIA) en vez de 4.9 RECHAZADA.
- Los instrumentos del dueño pueden empezar a parsear `cortes=` (prefijo seguro).
- **NO mergea el agente — el dueño mergea** (kit §6).
