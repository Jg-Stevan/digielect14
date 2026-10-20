# REPORTE — KIT e14-probe-adaptativo-v1 (D62)

**Fecha:** 2026-10-20 · **Agente:** AGENTE-2 (probe-adaptativo) · **Base:** `origin/main` al momento de ramificar = `6bbd464ac2790458698f572cc095fa941e23257a` (ver §7 — main avanzó de `330c080` a `6bbd464` durante la sesión; avance lineal sin force-push, zonas y anclas intactas, autorizado por el orquestador) · **Rama:** `feat/e14-probe-adaptativo-v1` · **PR:** DRAFT hacia `main` (NUNCA mergeado por el agente).

---

## 1. Contexto — cifras CITADAS del kit (lote real 15:04 — 13 actas, 4 núcleos)

Todas las cifras de esta sección son **citas literales del kit** (`AGENTE-2-D62-probe-adaptativo.md` §0) — NO mediciones propias (el sandbox no tiene las fotos del dueño):

- El probe de orientación costó **media 6.0 s por acta** (rango 4.0–10.4 s, total ~78 s del lote = ~25% del pipeline).
- Firma del lote: **8 actas** con probe 4.0–4.9 s (1 pasada: rot 0 sana o ganador en 2ª) · **4 actas** con 6.6–9.0 s (2-3 pasadas: 0 falla → prueba rotaciones) · **1 acta** con 10.4 s (3 pasadas).
- El orden actual prueba `0 → 90 → 270 → 180`; el patrón del escáner/fotógrafo del dueño es consistente (**CCW → ganador `rot=270`**): con 270 probado ANTES que 90, cada acta rotada se ahorra una pasada completa (~2-4 s).
- Cuando el probe NO aplica rotación (`aplicado=0`), el det a 1280 del probe y el det a 1280 de la pasada-1 del OCR corren sobre el MISMO bitmap — el segundo es gratis si se memoiza.
- **Ahorro estimado honesto (kit): ~25 s de probe (5 actas × 1 pasada) + ~1.2 s × 13 actas de det-reuso ≈ 35-40 s ≈ 12% del lote.** Riesgo bajo: todo con fallback al comportamiento actual y traza de cada decisión.
- Presupuesto D56 intacto: `PROBE_BUDGET_MS=12000`; el atajo T1 de lectura-sana y `cortes=` NO cambian de semántica.

## 2. Qué implementó este kit (zonas — contrato de exclusividad con D61)

**Solo 2 archivos de código** (verificado con `git diff --name-status origin/main`):

1. `src/lib/e14/orientacion.ts` (240 → 344 líneas) — T1: ganador persistente + orden adaptativo + traza aditiva.
2. `src/lib/e14/ocr/rapidocr.ts` (960 → 1021 líneas) — T2: memo del det por identidad de bitmap + traza aditiva.

PROHIBIDOS y INTACTOS (verificado por diff vacío): `scanner-core-bridge.ts`, `types.ts`, `informe.ts`, `masiva/runner.ts`, `masiva/tipos.ts`, `MasivaView.tsx`, `masiva/archivos.ts`, `public/**`, SIM. `PROBE_BUDGET_MS`, `MARGEN_ORIENTACION`, atajo T1, `cortes=`, `DET_CAP_PROD`/`DET_CAP_RAPIDO`, umbrales DB/DEBIL: **sin tocar** (diff vacío sobre esas líneas).

### 2.1 T1 — `orientacion.ts`

- **Anillo persistente** (nuevo bloque module-level entre marcadores `[D62-anillo-inicio]`/`[D62-anillo-fin]`): clave `e14-probe-ganador-v1` en localStorage; guarda un array JSON de los **últimos 10 desenlaces con `aplicado=1`** (cada uno `{"rot":90|180|270,"ts":<epoch>}`); expulsa el más viejo al insertar el 11.º. El **ganador se DERIVA al leer**: la rot más frecuente; empate ⇒ la de posición más reciente en el anillo. Todas las funciones con **try/catch total** — modo privado / cuota / SSR / JSON corrupto / entradas basura ⇒ sin ganador ⇒ **comportamiento de hoy byte a byte**, jamás lanza (§5: el probe no tumba el pipeline).
- **Orden de sondeo adaptativo** (única edición en el bucle del probe): `0` SIEMPRE primero (el atajo T1 de lectura-sana y el baseline del MARGEN dependen de él — intacto). Con ganador `g` ⇒ `[0, g, ...base minus (0,g)]`; sin ganador ⇒ `base` = el orden de hoy sin cambio (`h > w ? [0,180,90,270] : [0,90,270,180]` — rama vertical respetada). Ejemplo con ganador 270 en horizontal: `[0, 270, 90, 180]`.
- **Traza aditiva AL FINAL** de la línea del probe (tras `cortes=`, contrato D51 — nada nuevo antes de `cortes=`): `… cortes=completo orden=0,270,90,180 gan=270` · `gan=-` cuando no hay ganador persistente. La variante de vacío (línea `cortes=vacio`) NO se toca (el probe ni siquiera sondeó).
- **Escritura del anillo SOLO con `aplicado=1`**: `if (aplicado) anilloGanadorRegistrar(rot);` — un fallo del probe (catch → null), el caso vacío y `aplicado=0` NUNCA escriben.

### 2.2 T2 — `rapidocr.ts`

- **Memo module-level del det** (`detMemo`, `Map`, **tope 2 entradas**): clave = el **propio string dataURL de entrada** (identidad exacta — sin copias: rotar ⇒ re-encode ⇒ string distinto ⇒ miss natural, cero ramas especiales) + **cap** guardado EN el valor (lookup `map.get(dataUrl)` + comparación `entrada.cap === cap` — evita concatenar strings de ~MB). Valor = `{ cap, boxesFuente, msDet, nBoxes }` (nBoxes incluido para reconstruir la `DetSalida` completa e idéntica).
- **Ubicación: nivel `inferDet`** — 4.º parámetro opcional `claveOrigen?: string` (los 2 únicos callers pasan su dataUrl: `rapidOcrReconocer` pasada-1 con `opts?.detCap` y `rapidOcrCropsOrientacion` del probe a `DET_CAP_RAPIDO`). HIT ⇒ return temprano con el memo **antes de `preDet`/tensor** (no se emiten las trazas `det run` — no corrió). MISS ⇒ computa normal y ALIMENTA el memo; insertar desplaza la entrada más vieja (Map insertion-order).
- **Guard honesto**: el memo JAMÁS decide score/gate — devuelve el MISMO resultado que computaría det (determinismo wasm: mismo bitmap + mismo cap ⇒ mismo `boxesFuente`/`msDet`; misma referencia). En producción (cap 1920) la clave no matchea la del probe (1280) ⇒ sin cambio de comportamiento. `aplicado=1` ⇒ el string cambia ⇒ miss natural.
- **Traza aditiva AL FINAL de la traza de OCR existente** (`[e14-rapidocr] celda: …`, prefijo intacto, nada nuevo antes de los campos existentes): `… · 1234ms detMemo=hit msAhorrado=1183` en HIT · `… 1234ms detMemo=miss` en MISS. `msAhorrado` = el msDet del probe que esta llamada no pagó. En HIT la línea muestra `det=<ms del probe>ms` — el det SÍ costó eso, pero lo pagó el probe (ms antes), no esta llamada; el campo `detMemo=hit` lo explicita.

## 3. Validación corrida en sandbox (T5) — todo lo ejecutable sin las fotos del dueño

| Check | Resultado |
|---|---|
| `bun run lint` | **0 errores** (exit 0) |
| `bunx tsc --noEmit` | **0 errores** (exit 0) |
| `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` (receta `vercel.json`) | **OK** (exit 0, 3/3 páginas estáticas) |
| `git diff --name-status origin/main` | **SOLO** `src/lib/e14/ocr/rapidocr.ts` + `src/lib/e14/orientacion.ts` (+ docs en el commit de docs) — whitelist exacta |
| Anillo localStorage (parse/agregación/frecuencia/empate/tope/inválidos/modo privado) | **18/18 OK** — prueba headless EFÍMERA (bun, `/tmp/d62-test/`, **NO commiteada**) que extrae el bloque REAL de `orientacion.ts` entre los marcadores `[D62-anillo-inicio]`/`[D62-anillo-fin]` y lo evalúa con un localStorage mock: storage vacío → null · un desenlace → ese rot · frecuencia 2×90 > 1×270 → 90 · empates → el más reciente (por posición, ver §4) · tope 10 expulsa los 2 más viejos (90×5,270×7 → anillo 10, ganador 270) · JSON inválido → null sin crash · basura mezclada filtrada · storage que LANZA (modo privado) → leer=null, registrar no escribe y no lanza · JSON lleno = 311 bytes · clave exacta `e14-probe-ganador-v1` |
| Atajo T1 lectura-sana intacto (por LECTURA del diff) | `0` primero en TODAS las derivaciones del orden; el bloque `if (rot === 0) { … senalDeLectura(texto).nivel !== "DEBIL" → corte="sana"; break; }` y el corte de presupuesto `rot !== 0 && performance.now() - t0 > PROBE_BUDGET_MS` **sin tocar** (diff vacío sobre esas líneas); `PROBE_BUDGET_MS = 12000` intacto; traza `cortes=vacio` intacta |
| Constantes/umbrales intactos (por diff) | `DET_CAP_PROD=1920`, `DET_CAP_RAPIDO=1280`, `DB_*`, `TEXT_SCORE` y toda la pasada-2/re-OCR de `rapidocr.ts`: **diff vacío** |
| SIM | El probe NO corre en SIM (guard del bridge, documentado en orientacion.ts §2.2) ⇒ en SIM el memo no recibe claves del probe. Si la pasada de OCR de SIM (a 1920, escalonado omitido — D53) alimenta el memo, es **inofensivo**: devuelve lo mismo que computaría det (guard honesto). Nota: la línea `celda:` de SIM gana el campo aditivo ` detMemo=miss` al final — chips 8.2/7.0/4.3 y desenlace byte-idénticos (el campo va al FINAL de la línea, contrato solo-AÑADIR) |

## 4. Decisiones en zonas ambiguas y desviaciones honestas (todas documentadas, ninguna de desenlace)

1. **Formato del anillo**: el kit pedía «valor JSON `{rot, ts, n}` … anillo de los últimos 10 … máx ~100 bytes». Un agregado `{rot,ts,n}` NO puede implementar la ventana de 10 (no sabe qué rot expulsar al llegar el 11.º desenlace) ni el empate por recencia; el anillo completo de 10 entradas mide **311 bytes** (medido), sobre la guía de ~100. Se implementó el ANILLO (semántica completa del kit) y se documenta la desviación de tamaño; el ganador `{rot, ts, n}` queda derivable exactamente con la regla del kit (frecuencia; empate ⇒ más reciente).
2. **Empate «más reciente» = posición en el anillo**, no comparación de `ts`: dos desenlaces pueden caer en el mismo ms (`Date.now()`) y el ts empataría — la posición (índice en el array, que sobrevive el round-trip JSON) es la recencia real. Hallado por la prueba headless (3 fallos → fix → 18/18).
3. **Traza `detMemo=miss` también se emite** (el kit textual solo definía `hit msAhorrado=N`): el §3 de validación del kit pide observar «`detMemo=hit` presente en actas no rotadas; `miss` en rotadas» — sin el campo miss no era observable. Aditivo al final de la línea `celda:`, prefijo intacto.
4. **Traza del orden**: el kit escribía `orden=g0,270,…` y la orden de reanudación del dueño ` orden=0,270,90,180 gan=270` — se usó la del dueño (lista simple de rotaciones, sin el `g`).
5. **Clave del memo SIN concatenar** el dataURL con el cap (evita copiar strings de MB): el cap viaja dentro del valor y se compara en el lookup. Identidad exacta preservada (kit: «clave = el propio string dataURL + cap»).
6. **`nBoxes` también se memoiza** (el kit listaba valor `{boxesFuente, msDet}`): `DetSalida` lo lleva y `rects.length` ≠ `boxesFuente.length` (filtro de coords negativas) — sin él el HIT no podría reconstruir el MISMO resultado.
7. **HIT ⇒ `det=<ms del probe>ms` en la línea celda**: es el mismo det que YA se pagó (ms antes, en el probe); no es tiempo de esta llamada. `detMemo=hit msAhorrado=N` lo explicita.
8. **Hallazgo colateral PRE-EXISTENTE (fuera de alcance, no tocado — para el dueño)**: en `main` `6bbd464` (merge del PR #46/D60) quedaron **marcadores de conflicto sin resolver** en 2 docs: `docs/DECISIONS.md` (líneas sueltas `feat/e14-pdf-masiva-v1`, `=======`, `main`) y `AGENTS.md` (ídem + la línea D59 truncada terminando en `…filas-vmain`). Las filas D59/D60 y las entradas de kit están completas en ambos archivos; el daño es cosmético. Este PR NO las repara (append-only + D61 en vuelo sobre los mismos docs) — reparación propuesta para el dueño tras merge de D61/D62.

## 5. Tabla ANTES/DESPUÉS — PLANTILLA (el dueño medirá; jamás inventar)

Requiere las fotos reales del lote 15:04 (13 actas) — NO están en el sandbox. Valores `—` = por medir en SU equipo (4 núcleos).

| # | Acta (informe 15:04) | Tipo esperado (firma del kit) | Probe ANTES (ms) | Probe DESPUÉS (ms) | `cortes=` DESPUÉS | `orden=` / `gan=` DESPUÉS | `detMemo=` pasada-1 | status/score/aplicado ANTES | status/score/aplicado DESPUÉS |
|---|---|---|---|---|---|---|---|---|---|
| 1 | — | sana (probe 4.0-4.9 s) | — | — | sana (1.ª opción) | `orden=0,90,270,180 gan=-` (1.ª del lote) | hit (aplicado=0) | — | — |
| 2 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 3 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 4 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 5 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 6 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 7 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 8 | — | sana | — | — | sana | `orden=… gan=-` | hit | — | — |
| 9 | — | rotada CCW (6.6-9.0 s) | — | — | completo/presupuesto | `orden=0,90,270,180 gan=-` (1.ª rotada: aún sin ganador) | miss (aplicado=1 ⇒ string cambia) | — | — |
| 10 | — | rotada CCW | — | — | completo | `orden=0,270,90,180 gan=270` (ganador ya persistido) | miss | — | — |
| 11 | — | rotada CCW | — | — | completo | `orden=0,270,90,180 gan=270` | miss | — | — |
| 12 | — | rotada CCW | — | — | completo | `orden=0,270,90,180 gan=270` | miss | — | — |
| 13 | — | la de 10.4 s (3 pasadas) | — | — | — | — | — | — | — |

Criterios de GO del kit (§3): 2.ª acta rotada en adelante ⇒ ganador en 2ª pasada (probe ≤ ~5.5 s donde antes ~8-10 s) · `detMemo=hit` en no rotadas · paridad 13/13 (abajo).

## 6. PENDIENTE DEL DUEÑO — paridad de desenlace (VETO del kit) — procedimiento A/B exacto

**NO ejecutada por el agente** (las 13 fotos del informe 15:04 no están en el sandbox; decisión final al dueño — patrón B5/B7). Procedimiento:

1. En SU equipo (4 núcleos), con el build de `main` actual (ANTES): procesar las 13 fotos del informe 15:04 por MASIVA, una corrida limpia (cola vacía, motor caliente con el pre-warm). Guardar: consola completa (trazas `[e14] orientacion`, `[e14-rapidocr] celda`, pipeline) + informe.
2. checkout de esta rama `feat/e14-probe-adaptativo-v1` (DESPUÉS), build estático (`BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` + `bun run tools/serve-coop-coep.js`), **limpiar localStorage + IndexedDB** (cola y anillo empiezan vacíos) y repetir la MISMA corrida con las MISMAS fotos en el MISMO orden.
3. Comparar acta por acta: `status` / `score` / `aplicado` / `cortes=` / clasificación y código — **13/13 idénticos**. Además: `orden=`/`gan=`/`detMemo=` presentes como en §5, y 2.ª acta rotada en adelante con ganador en 2ª pasada.
4. **Cualquier divergencia en 1 sola acta = NO-GO del kit**: revertir esta rama (no mergea) y registrar en `docs/DECISIONS.md` la foto y la divergencia exacta. El ahorro NO justifica cambiar un desenlace.
5. NOTA de orden: en la corrida DESPUÉS la 1.ª acta del lote va sin ganador (`gan=-`, orden de hoy) — el ganador solo existe DESPUÉS del 1.º `aplicado=1`; con el lote 15:04 completo en orden original el patrón CCW de las rotadas activa `gan=270` desde la 2.ª rotada.

Resto de pendientes del dueño: medir la tabla §5 (probe medio antes/después, hits/misses) · decidir GO/merge · reparar los marcadores de conflicto pre-existentes de DECISIONS.md/AGENTS.md (§4.8) · **REVOCAR/ROTAR el token entregado en el chat** (queda expuesto — pendiente permanente ya documentado en worklogs previos).

## 7. NOTA DE CONTINUIDAD DE SESIÓN

- **Clon:** `/home/z/digielect14-d62` (rama `feat/e14-probe-adaptativo-v1`).
- **Base del PR:** `6bbd464ac2790458698f572cc095fa941e23257a` — el kit exigía `330c080` como gate duro; al clonar `origin/main` ya era `6bbd464` (merge del PR #46/D60 `feat/e14-pdf-masiva-v1`, 2 min después de `330c080`). El agente PARÓ y reportó (1.ª pasada de la sesión, append en el worklog local), y el **orquestador AUTORIZÓ ramificar sobre `6bbd464`**: el kit dice textualmente «Base: `origin/main` al momento de ramificar»; avance lineal sin force-push; delta `330c080..6bbd464` NO toca las zonas D62 ni las de D61; anclas del kit verificadas intactas en `6bbd464`; el AGENTE-1 (D61, PR #47) también ramificó sobre `6bbd464`.
- **Kit:** `/home/z/my-project/upload/AGENTE-2-D62-probe-adaptativo.md` (contrato de alcance cerrado). Zonas prohibidas leídas de `/home/z/my-project/upload/AGENTE-1-D61-tiempos-ocultos.md`.
- **Token:** lo entrega el dueño en el chat (NUNCA en archivos ni commits; usar SOLO en la URL del remote/curl). **REVOCAR al cerrar la sesión.**
- **Prueba del anillo:** efímera en `/tmp/d62-test/` (NO commiteada) — regenerable con el procedimiento del §3.
- **Pendientes:** §6 (paridad 13/13 + tabla §5) — bloqueantes solo para el merge, decisión del dueño.
