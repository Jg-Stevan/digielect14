# REPORTE — KIT e14-tiempos-ocultos-v1 (D61)

**Fecha:** 2026-10-20 · **Agente:** AGENTE-1 (tiempos-ocultos) · **Prioridad:** P1
**Rama:** `feat/e14-tiempos-ocultos-v1` · **PR:** DRAFT **#47** hacia `main` — https://github.com/Jg-Stevan/digielect14/pull/47
**Base:** `6bbd464` (origin/main al momento de ramificar — ver §2)

---

## 1. Qué hace este kit

Persistir lo que hoy SOLO va a consola (o directamente no se mide) — sin cambiar
NADA del desenlace:

1. **`decodeMs` / `detectMs`** — el bridge YA medía `ms.decode` (decode del
   archivo: heic2any/imagen→canvas) y `ms.detect` (detección de página del core,
   worker) en `pipeline()` — asignados y volcados a la traza de consola
   (`decode=… detect=…`) — pero el diagnóstico solo persistía
   proceso/calidad/ocr/total. D61 los persiste (worker path). El canvas-path
   (recorte manual del editor) no mide ninguna de las dos fases → `null`
   honesto (jamás inventar).
2. **`persistMs`** — MASIVA: coste de `guardarRegistro(registroListo)` del
   desenlace (+ fallback liviano del FIX M14 en la MISMA ventana — el coste que
   el usuario realmente experimenta). Hoy invisible: es un write IDB de ~15 MB
   fuera de `escanearActa`.
3. **`envioMs`** — MASIVA: coste de la sección de envío del desenlace
   (`registrarEnvioMasiva` → hash + historial + completadas + hueco archivado +
   cola offline). SOLO cuando hay envío real ONLINE: offline/«EN COLA» y
   no-OPTIMA → campo OMITIDO (jamás 0 falso).
4. **informe** — medias aditivas (mismo criterio de `esperaMs`: SOLO actas con
   el dato) + línea nueva AL FINAL de la sección TOTALES del TXT (el parser por
   prefijos de los instrumentos no se rompe):
   `CONVERSION/PERSISTENCIA (solo actas con dato): decode medio Nms · detect medio Nms · persistencia media Nms · envio medio Nms`

## 2. Base — NOTA sobre la desviación de la base esperada

El kit D61 (y el mandato del dueño) esperaban `main = 330c080` (PR #45). Al
clonar, `origin/main` había avanzado a **`6bbd464`** (merge del PR #46,
`e14-pdf-masiva-v1`, D60). Verificación: `330c080` es ancestro directo de
`6bbd464` (`git diff --name-status 330c080 6bbd464` = solo AGENTS.md, bun.lock,
docs/**, package.json, MasivaView.tsx, masiva/archivos.ts, masiva/store.ts —
NINGUNO de los 4 archivos de zona D61 fue tocado por el PR #46). El kit declara
«Base: origin/main al momento de ramificar» → se ramificó sobre `6bbd464` con
los anchors intactos (verificados: types.ts L110-120, bridge L1050/L1067/L1130/
L1575-1580/L2163-2168, runner L219-238/L261/L291-298, informe L221/L339/L356-370).
**Desviación documentada y avisada** (el mandato pedía «PARA y reporta»: se
reporta aquí, en el worklog, en el PR y en el mensaje al dueño).

## 3. Mapa de tiempos del lote 15:04 — recalculado (cifras del KIT)

Cifras del kit §0 (lote real del dueño 20-oct 15:04 — 13 actas, 4 núcleos,
pipeline medio **24.5 s**):

| Fase | Medio | % | Estado antes de D61 | Con D61 |
|---|---|---|---|---|
| OCR (2 pasadas escalonadas) | 12.2 s | **50%** | visible (`ocrMs`) | sin cambio |
| Probe de orientación | 6.0 s | **25%** | visible SOLO desde D57 (`orientacionProbeMs`) | sin cambio (zona D62) |
| Proceso (warp) | 4.75 s | **19%** | visible (`procesoMs`) | sin cambio |
| Calidad | 0.33 s | **1%** | visible (`calidadMs`) | sin cambio |
| Resto (hueco residual) | ~1.1 s | **5%** | invisible | **decode + detect salen del «resto» y se persisten** |

El «hueco» `total − proceso − calidad − ocr` del lote 15:04 era **~7.15 s**, de
los cuales ~6.0 s son el probe (D57 ya lo aisló) y ~1.1 s el resto (esquinas
fiduciales + re-encode de rotación + banda + decode + detect — en ese lote de
JPGs las dos últimas eran pequeñas; con HEIC del dueño `decodeMs` puede ser
1-2 s por acta y quedará EXPLÍCITO en el informe).

**Huecos que este kit expone y que antes eran invisibles por completo:**
- **Conversión HEIC→canvas** (`decodeMs`): era el precio de entrada de cada
  acta HEIC — solo se veía en consola (`decode=…`) y se perdía al recargar.
- **Detección de página del core** (`detectMs`): ídem (worker, con reintento
  Sobel incluido cuando corre).
- **Persistencia del desenlace** (`persistMs`): el write IDB de ~15 MB por
  acta — fuera de `escanearActa`, jamás visto por ningún informe.
- **Envío** (`envioMs`): la sección síncrona del envío (hash + historial +
  hueco archivado + cola offline) — también fuera del pipeline.

Con esto el informe puede reconstruir el **100% del tiempo** del lote:
`total ≈ espera + decode + detect + proceso + calidad + ocr + probe + persistencia + envío + (residuo pequeño de esquinas/banda)`.

## 4. Cambios por archivo (zonas — contrato de exclusividad)

### T1 — `src/lib/e14/types.ts` (SOLO campos aditivos)
`DiagnosticoActa.tiempos` += `decodeMs?: number | null`, `detectMs?: number |
null`, `persistMs?: number`, `envioMs?: number` — con los comentarios JSDoc del
kit. Opcionales/null-safe: los registros previos a D61 y el flujo individual
siguen parseando (misma filosofía D57).

### T2 — `src/lib/e14/scanner-core-bridge.ts` (SOLO las 2 zonas de persistencia)
- **Worker path** (~L1575-1586, bloque `tiempos` del diagnóstico de `pipeline()`):
  `decodeMs: ms.decode > 0 ? Math.round(ms.decode) : null` y
  `detectMs: ms.detect > 0 ? Math.round(ms.detect) : null` — fórmula EXACTA del
  kit; `null` honesto si la fase no corrió (video-grab → decode=0; `sinRecorte`
  → detect=0).
- **Canvas path** (~L2169-2179, diagnóstico del recorte manual):
  `decodeMs: null, detectMs: null` con comentario — esa ruta no los mide
  (su `ms` local solo trae proceso/calidad/ocr/total) — jamás inventar.
- NO se tocó la zona del probe (L1230-1244), ni `orientacion.ts`, ni
  `rapidocr.ts`, ni `detection-worker.js`.

### T3 — `src/lib/e14/masiva/runner.ts` (solo medición + parche inmutable)
- **`envioMs`**: ventana `performance.now()` alrededor de `registrarEnvioMasiva`
  en el desenlace OPTIMA (el envío es una sección SÍNCRONA — hash mock +
  historial + completadas + hueco archivado + cola offline; el «POST» real es
  el mock del demo). Solo ONLINE mide: offline/«EN COLA» y no-OPTIMA → omitido.
  Parche del diagnóstico con el MISMO patrón inmutable del parche `esperaMs` de
  D57 (spread, solo si `diagnostico != null`) — ANTES de construir
  `registroListo`, así viaja en la PRIMERA persistencia.
- **`persistMs`**: la ventana del kit envuelve el `try/catch` de persistencia
  del desenlace completo (write principal `guardarRegistro(registroListo)` y, si
  falla, fallback liviano del FIX M14): un solo `tPersist` antes del `try`,
  `persistMs = Math.round(performance.now() - tPersist)` tras el write que
  logró persistir. Si ambos writes fallan → campo OMITIDO (sin dato — jamás
  inventar).
- **Paradoja del instrumento → re-save de instrumento (DESviación documentada):**
  `persistMs` nace DEL write que lo mide — no puede viajar DENTRO de ese write.
  Sin acción, el campo jamás llegaría a IDB y el kit T5 exige «Recarga: los
  campos sobreviven (IDB)». Solución: tras el write medido, un re-save
  BEST-EFFORT y SILENCIOSO del MISMO registro con el diagnóstico parcheado
  (patrón inmutable). Orden SEGURO: el write 1 ya dejó el desenlace completo en
  IDB; si el re-save falla (quota), el catch es silencioso y IDB conserva el
  write 1 INTACTO (sin `persistMs` — honesto). El re-save está FUERA del
  try/catch de desenlace (jamás degrada al liviano: un fallo del re-save NO
  puede reemplazar el registro completo por el liviano). Coste: +1 write IDB
  (~mismo tamaño) por acta LISTA — instrumentación, no desenlace. El write
  medido sigue siendo el del desenlace (la cifra del informe es el coste real
  del write que el usuario experimenta; el re-save NO entra en la ventana).
- **NO tocados**: las zonas `marcarFila` de D59 (código intacto byte a byte),
  el `guardarRegistro` de la ruta dedup (~L142 — la gemela copia el
  diagnóstico de su original, que YA trae los tiempos del desenlace real), el
  re-queue del fallback dedup (~L188) y el persist del catch ERROR (~L329 — no
  hay diagnóstico nuevo que medir allí). Decisión sobre las llamadas
  `guardarRegistro`: el desenlace (LISTA/ENVIADA) es ÚNICAMENTE el de
  `procesarUno` (~L291 + fallback liviano ~L294) — el kit lo nombra
  explícitamente y con el código delante no hay ambigüedad.

### T4 — `src/lib/e14/informe.ts` (aditivo)
- `FilaInforme["tiempos"]` += los 4 campos opcionales (espejo del tipo del
  diagnóstico; `filaLiviana` ya copia `diag.tiempos` entero → viajan solos).
- `ResumenInforme["tiemposMediosMs"]` += `decodeMs/detectMs/persistMs/envioMs`
  (`number | null`).
- `mediosTiempos`: `campos` += los 4 — MISMO criterio de `esperaMs` (media SOLO
  sobre actas con el dato; el filtro `typeof v === "number"` ya excluye
  `null`/`undefined`).
- `renderTxt`: línea nueva AL FINAL de la sección TOTALES (después de la línea
  de espera, antes del `linea()` que cierra la sección) — formato EXACTO del
  kit; sin datos → `-` como la línea de espera existente. Las líneas antiguas
  quedan byte-idénticas (append-only — parsers por prefijo intactos).
  El `informe.json` y las `ficha.json` llevan los campos nuevos vía
  `tiempos`/spread del acta — forma previa sin cambios (JSON.stringify omite
  lo ausente).

## 5. Validación corrida en el sandbox (T5)

| Gate | Resultado |
|---|---|
| `bun run lint` | **0 errores** (eslint limpio) |
| `bunx tsc --noEmit` | **0 errores** (exit 0) |
| `BUILD_STATIC=1 bun run build` | **OK** (ese env aplica: mismo comando del kit D60 — compilación y 3/3 páginas estáticas sin errores) |
| `git diff --name-status origin/main` | **SOLO los 4 archivos de zona** (+ docs en el commit de docs): `src/lib/e14/types.ts`, `src/lib/e14/scanner-core-bridge.ts`, `src/lib/e14/masiva/runner.ts`, `src/lib/e14/informe.ts`. Nada más (NOTA: `bun install` en el clon re-escribió `bun.lock` — restaurado con `git checkout -- bun.lock`; queda fuera de los commits) |
| SIM sin campos nuevos (por lectura) | Guard intacto: worker path monta el diagnóstico SOLO con `!opciones.simular` (L1528); canvas path SOLO con `acta.fuente !== "SIMULACION"` (L2116) → SIM no genera diagnóstico → sin `tiempos` → sin campos nuevos. Chips congelados sin vía de cambio (ninguna línea de gate/score/envío editada) |
| Recarga/IDB (por lectura) | Los 4 campos van DENTRO de `DiagnosticoActa.tiempos`, que ya persiste dentro del registro (IDB `e14-masiva-v1`): decodeMs/detectMs nacen en el diagnóstico del bridge → write 1; envioMs se parchea antes de `registroListo` → write 1; persistMs viaja en el re-save de instrumento (§4-T3) |
| Desenlace intacto (por lectura) | CERO cambios en score/status/gate/envío/marcarFila: el diff del runner solo AÑADE medición + parches aditivos del diagnóstico. La ventana de persistencia conserva el orden EXACTO del FIX M14 (write principal → liviano), y el re-save de instrumento es un try/catch propio, fuera de ese desenlace |
| Lote real MASIVA (1 HEIC + 1 JPG) | **PENDIENTE DEL DUEÑO** — §6 |
| Informe TXT byte-idéntico en líneas antiguas con lote real | **PENDIENTE DEL DUEÑO** — §6 (por lectura: las líneas previas de `renderTxt` no se tocaron; la nueva va al final de TOTALES) |

### 5.1 — CI del PR DRAFT #47 (head `3c08b17`, consultada vía API al momento del reporte)

| Check | Resultado |
|---|---|
| `checks` (Quality Gate: tsc + lint + build) | ✅ success |
| `Vercel` (deploy preview) + `Vercel Preview Comments` | ✅ success ×2 |
| `parity` (worker-parity ×2) | ❌ failure ×2 — **ROJO HEREDADO, NO introducido por D61**: este PR tiene `git diff origin/main -- public/` VACÍO (0 toques a `public/scanner/detection-worker.js`); el workflow diffea el worker contra `web-scanner` main, y desde D57 el lab NO ha espejado las 5 líneas `willReadFrequently` (documentado en D57/worklog y su REPORTE §9 — ruta A del dueño: espejarlas en el lab → verde sin tocar esta rama). Sin fixes de CI fuera de alcance (mandato del kit) |

Commits: `5e1bfe9` (código) · `3c08b17` (docs) · commit docs-CI (este).

## 6. PENDIENTE DEL DUEÑO (procedimiento exacto — NO inventado, no corrido)

El sandbox NO tiene las fotos del dueño (lote 15:04) ni HEIC, y la validación
de navegador MASIVA no puede correr aquí:

1. `git fetch && git checkout feat/e14-tiempos-ocultos-v1` (o el PR DRAFT) →
   `bun install` (ojo: puede re-escribir `bun.lock` — no commitear) →
   `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` →
   `bun run tools/serve-coop-coep.js 8123` → abrir con `out/` servido en la raíz.
2. **MASIVA con 1 HEIC + 1 JPG reales** (del lote 15:04 o del banco):
   - Consola del pipeline: `decode=` del HEIC > 0 (conversión visible) y el
     JPG con decode pequeño; `detect=` > 0.
   - Al terminar: fila LISTA/ENVIADA → abrir el acta → ficha →
     `diagnostico.tiempos` debe traer `decodeMs`, `detectMs`, `persistMs`
     (y `envioMs` solo si ENVIADA online).
3. **INFORME ↓** → `informe.txt` debe terminar TOTALES con la línea nueva
   `CONVERSION/PERSISTENCIA (solo actas con dato): decode medio …ms · detect
   medio …ms · persistencia media …ms · envio medio …ms` (campos sin datos →
   `-`), y las líneas anteriores byte-idénticas a un informe pre-D61 del mismo
   contenido. `informe.json` → `totales.tiemposMediosMs` con las 4 medias nuevas
   (null si ninguna acta trae el dato) y `actas[].tiempos` con los campos
   por-acta.
4. **Recarga (F5)** → volver a generar el informe: los campos del lote recién
   procesado deben seguir presentes (IDB). Actas de sesiones previas a D61 van
   sin los campos (honesto — se excluyen de las medias, no se inventan).
5. **SIM** → chips 8.2/7.0/4.3 exactos, cero trazas nuevas, sin campos nuevos
   en ninguna ficha.
6. Decidir con los números: cuánto del «resto ~5%» del lote 15:04 era decode y
   detect; cuánto cuesta la persistencia real (~15 MB/acta) en SU hardware; y
   si el envío síncrono es ruido o señal.

## 7. Observaciones colaterales (preexistentes en main — SIN tocar, fuera de scope)

Al leer los docs de `main` (`6bbd464`) aparecieron **artefactos de merge del
PR #46** (no los introduje, no los arreglé — fuera del alcance de este kit):
- `AGENTS.md` L69: línea huérfana `feat/e14-pdf-masiva-v1` · L71: `=======`
  (separador de conflicto residual) · L72 (última línea, D59): truncada
  («…e14-info-acta-filas-vmain», sin salto final).
- `docs/DECISIONS.md` L60: línea huérfana `feat/e14-pdf-masiva-v1` · L62:
  `=======` · L64: línea huérfana `main`.
- `docs/ROADMAP.md`: cola truncada en su última línea (byte UTF-8 roto).

Recomendación: limpiarlos en un PR de docs del dueño (no en este).

## 8. NOTA DE CONTINUIDAD DE SESIÓN

- **Clon local:** `/home/z/digielect14-d61` (rama `feat/e14-tiempos-ocultos-v1`,
  tracking `origin/main`).
- **Base de la rama:** `origin/main` = `6bbd464` (merge PR #46 — contiene
  `330c080`; ver §2). Identity git del clon: `Jg-Stevan <julistevan02@gmail.com>`.
- **Kit:** `/home/z/my-project/upload/AGENTE-1-D61-tiempos-ocultos.md`
  (contrato de alcance cerrado). El kit paralelo D62
  (`/home/z/my-project/upload/AGENTE-2-D62-probe-adaptativo.md`) trabaja
  `orientacion.ts` + `rapidocr.ts` — CERO solapamiento con las zonas de este
  kit (verificado por diff).
- **Token:** lo entrega el dueño EN EL CHAT (jamás en archivos ni en el cuerpo
  de commits; REVOCAR al cerrar la sesión — quedó expuesto en el chat).
- **Pendientes del dueño:** validación de navegador §6 (1 HEIC + 1 JPG por
  MASIVA + informe + recarga + SIM) · revisión y merge del PR DRAFT (el agente
  NUNCA mergea) · decisión sobre los artefactos de merge de §7 · REVOCAR token.
- **Pendiente permanente:** REVOCAR el token del agente al cerrar.
