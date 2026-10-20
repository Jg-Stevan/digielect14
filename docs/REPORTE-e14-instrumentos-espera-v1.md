# REPORTE — KIT e14-instrumentos-espera-v1 (D57)

| Campo | Valor |
|---|---|
| **Task ID** | 2 (Agente 2) |
| **Rama** | `feat/e14-instrumentos-espera-v1` (desde main `f9e4027`) |
| **Tipo** | Instrumentos de diagnóstico + hint de canvas — **ADITIVO, cero cambios de desenlace** |
| **Gates** | `tsc` 0 · `lint` 0 · `next build` OK · `git diff --name-status main` = zonas exactas del kit |

---

## 1. Problema (evidencia del dueño)

Informe de la corrida 20/10 07:42 (17 actas, 17 ENVIADAS) con outliers sin
explicación:

- `171125.heic`: total **55.6 s** pero OCR 5.2 s y proceso 3.0 s → **~47 s sin
  contar** en ningún campo del diagnóstico.
- `171446.heic` (37.6 s) y `171454.heic` (27.0 s): mismo patrón.

El informe actual NO permite distinguir entre: **espera en cola** (si
`totalMs` cuenta desde `agregadaEn`), **coste del probe de orientación**
(no aparece en ningún campo) o **decode HEIC**.

Adicionalmente la consola del dueño muestra 3 avisos
`Canvas2D: Multiple readback operations using getImageData are faster with
the willReadFrequently attribute set to true` en `handleWarp` y
`handleEnhance` de `public/scanner/detection-worker.js`.

## 2. Principio aplicado

**SOLO campos aditivos.** Ningún cálculo de desenlace, score, gate ni envío
cambia. Los informes previos del dueño siguen parseando (los parsers van por
prefijo / campos con nombre). Si una medición no está disponible, el campo
queda AUSENTE — jamás inventar.

## 3. Fórmula para leer los outliers (la clave del kit)

```
pipeline-real ≈ totalMs − esperaMs
```

- `esperaMs` (NUEVO, solo MASIVA): tiempo desde que la fila se **agregó a la
  cola** (`agregadaEn`) hasta que el runner **inicia el pipeline** de esa fila
  (`tInicio` capturado justo antes de `escanearActa`).
- `totalMs` sigue midiendo EXACTAMENTE lo que medía (no cambia de forma).
- Si el outlier era **espera en cola**: `totalMs` alto con `esperaMs` alto →
  `pipeline-real` normal.
- Lo que quede **sin atribuir** tras la resta reparte entre:
  - **probe de orientación** → ahora visible por acta en
    `diagnostico.orientacionProbeMs` (y en el informe.json por-acta);
  - **decode HEIC** → visible en la traza de consola existente
    (`decode=…ms` del log del pipeline — fuera de alcance de este kit, no se
    persiste).

## 4. Cambios (por tarea)

### T1 — `esperaMs` (espera en cola → inicio de pipeline)

- `src/lib/e14/types.ts` (~línea 110): `tiempos` de `DiagnosticoActa` gana
  `esperaMs?: number` (opcional — registros previos y flujo individual van
  sin él).
- `src/lib/e14/masiva/runner.ts` (`procesarUno`): `tInicio = Date.now()` justo
  ANTES de `escanearActa(...)`; `esperaMs = max(0, tInicio − fila.agregadaEn)`;
  parche inmutable:

```ts
const acta =
  actaBruta.diagnostico != null
    ? {
        ...actaBruta,
        diagnostico: {
          ...actaBruta.diagnostico,
          tiempos: { ...actaBruta.diagnostico.tiempos, esperaMs },
        },
      }
    : actaBruta;
```

- El desenlace completo (envío automático, contadores, thumb, persistencia)
  consume el `acta` YA parcheada — cero cambios de lógica.
- `masiva/tipos.ts` NO se tocó (no hizo falta propagar nada — `agregadaEn`
  ya vive en `FilaMasiva`).

### T2 — `orientacionProbeMs` en el diagnóstico

- `src/lib/e14/types.ts`: `orientacionProbeMs?: number` top-level del
  diagnóstico.
- `src/lib/e14/scanner-core-bridge.ts` — los **2** call-sites de
  `probeOrientacion`:
  1. **Pipeline de escaneo** (~línea 1230): `probeMsOrientacion` se captura
     tras la llamada y se asigna al `diag` construido más abajo.
  2. **Pipeline de recorte manual** (~línea 1861): idéntico.
- Asignación DEFENSIVA en ambos: `if (diag != null && probeMsOrientacion !=
  null) diag.orientacionProbeMs = probeMsOrientacion;` — jamás lanza; si no
  hay diagnóstico, se omite.
- La traza de consola `[e14] orientacion …` (D51) ya existía — esto la hace
  **permanente en la ficha**. SIM sigue sin probe (guard intacto — el campo
  no existe en SIM).

### T3 — `informe.ts` aditivo

- `mediosTiempos`: `"esperaMs"` AÑADIDO al array `campos` (media solo sobre
  actas con el dato).
- `informe.txt` — línea NUEVA justo después de los tiempos medios:

  ```
  - Espera media en cola: Xms (p50 Yms) — pipeline-real ≈ total − espera
  ```

  (p50 calculado sobre las actas que traen `esperaMs`; sin datos → `-`).
- `informe.json`: `totales.tiemposMediosMs.esperaMs` (nuevo, `number | null`)
  + por-acta `tiempos.esperaMs` y `orientacionProbeMs` **solo cuando
  existan** (los objetos de actas sin el campo no cambian de forma).
- `ResumenInforme` (UI): `tiemposMediosMs.esperaMs: number | null` añadido.
- **Los campos viejos no cambian de forma** — compatibilidad con informes
  previos.

### T4 — `willReadFrequently` en `public/scanner/detection-worker.js`

- **5** `getContext("2d")` con `{ willReadFrequently: true }`:
  - Los **3 del canvas COMPARTIDO** (`canvas` reutilizado por `handleDetect`
    ~1740, `handleWarp` ~1782 y `handleEnhance` ~1884): el atributo debe
    estar en el **PRIMER** `getContext` de ese canvas (después no tiene
    efecto) y el primero depende de qué handler corra primero → va en TODOS.
  - Los 2 canvas de salida (`warpCanvas` ~1816, `enhanceCanvas` ~1907 — solo
    dibujo/putImageData sin readback): añadido igualmente, inofensivo (kit
    §4-T4).
- No se tocó ninguna lógica de warp/enhance.

### T5 — Docs

- `docs/DECISIONS.md`: fila **D57** (append).
- `docs/ROADMAP.md`: sección «INSTRUMENTOS-ESPERA» (append).
- `docs/worklog.md`: entrada del kit (append).
- Este REPORTE.

## 5. Evidencia de gates (sandbox)

- `bunx tsc --noEmit` → **0 errores**.
- `bun run lint` (eslint .) → **0 errores**.
- `bun run build` (next build) → **OK** (3/3 páginas estáticas).
- `git diff --name-status main` = EXACTAMENTE:

  ```
  M  public/scanner/detection-worker.js
  M  src/lib/e14/informe.ts
  M  src/lib/e14/masiva/runner.ts
  M  src/lib/e14/scanner-core-bridge.ts   (4 regiones aditivas: 2 capturas probe + 2 asignaciones diag)
  M  src/lib/e14/types.ts                 (+2 campos opcionales)
  + docs (DECISIONS.md, ROADMAP.md, worklog.md, este REPORTE)
  ```

- Zonas PROHIBIDAS sin tocar (verificadas por diff): `orientacion.ts`,
  `ocr/**`, `masiva/dedup.ts`, `masiva/store.ts`, `public/sw.js`.
- **SIM intacto por diseño**: el runner (T1) es solo MASIVA/ARCHIVO; el probe
  (T2) ya estaba guardado por `!opciones.simular`; informe (T3) y worker (T4)
  no participan del desenlace SIM. Los chips 8.2/7.0/4.3 no tienen vía de
  cambio (ninguna línea de gate/score fue editada).

## 6. Validación que corresponde al dueño (kit §6)

1. **MASIVA con 3-4 fotos reales**: el informe nuevo muestra `esperaMs`
   (media y p50) y `orientacionProbeMs` por acta cuando el probe corrió.
   - Fila procesada inmediatamente → `esperaMs` pequeña (~0-2 s).
   - Añadir varias y ver cómo la ÚLTIMA acumula espera ≈ suma de las
     anteriores (la cola es FIFO secuencial).
2. **Consola en un escaneo real**: **0 avisos**
   `Canvas2D … willReadFrequently` en warp/enhance.
3. **Un desenlace (score/status/anclas) de acta sana IDÉNTICO al de main.**

## 7. Desviaciones del kit

- Ninguna funcional. Única nota de alcance: `masiva/tipos.ts` (marcado
  «✏️ exclusiva si se necesita propagar») quedó SIN tocar — no fue necesario.
- El `p50` de la línea del txt lo calcula `renderTxt` sobre las filas (el kit
  lo pide en la línea pero no especificaba el cálculo — mediana estándar,
  promedio de los dos centrales en pares).

## 8. Entrega

- Commits: código (`feat(e14): KIT e14-instrumentos-espera-v1 (D57)…`) y
  docs (`docs(e14): …`) por separado.
- **PR DRAFT** con `D57` en el título → revisión del arquitecto → **mergea el
  dueño**. NO se mergea desde el agente.

## 9. CI — estado del head y el gate `Worker parity` (IMPORTANTE para el arquitecto)

CI del head `d8aff45`:

| Check | Resultado | Nota |
|---|---|---|
| **Quality Gate** | ✅ success | `tsc --noEmit` + `lint` + `build` — los gates del kit §5 |
| **Vercel Preview** | ✅ success | preview desplegado |
| **Worker parity** | ❌ failure | **esperado y explicado aquí** — decisión del dueño |

**Causa exacta:** el workflow `worker-parity.yml` exige que
`public/scanner/detection-worker.js` sea **byte-idéntico** al worker del repo
hermano (`web-scanner/apps/scanner-lab/public/scanner/detection-worker.js`,
rama main). Verificado hoy: el worker del lab es byte-idéntico al de
e14-main (`69647 B`, herencia del sync `6172456`) y **NO** trae
`willReadFrequently` — por eso el T4 del kit (mandatario, zona ✏️ exclusiva)
enciende el gate por diseño.

**Histórico relevante:** la paridad se ha roto antes por avance del lab
(quad-repro: «parity ×2 rojo EXTERNO — sync del worker es decisión del
dueño») y se resolvió con commits `sync(worker)` (`bbc4b01`, `6172456`).
Aquí el origen del cambio es e14 (la evidencia de consola es del dueño EN
ESTA app), no el lab.

**Rutas de resolución (decisión del dueño/arquitecto — el agente NO toca
web-scanner sin mandato):**

- **A (recomendada, espejo del precedente sync):** aplicar la MISMA edición
  de 5 líneas (`{ willReadFrequently: true }` en los mismos 5 `getContext`)
  al worker del lab en `web-scanner` main → el gate vuelve a verde SIN tocar
  esta rama (el diff se hace contra lab main en runtime). El atributo es
  correcto en ambos: ambos hacen `getImageData` sobre el canvas compartido.
- **B:** aceptar el rojo TEMPORAL de parity en este PR y que el dueño sincronice
  después; o revertir T4 aquí y dejar que la mejora entre por un `sync(worker)`
  futuro (el kit T4 llegaría vía lab → e14).

**Honestidad:** NO se ocultó el fallo; Quality Gate (el gate técnico del kit)
está verde. El desenlace no depende del atributo (hint de rendimiento del
canvas 2d — no altera píxeles).
