# REPORTE — kit e14-consenso-frankfurt-v1 (Task 122)

Rama `feat/consenso-frankfurt` **desde `feat/identificacion-codigo` (PR #8 @ `00d12c3`)** — §1 CUMPLIDO: PR #8 sigue ABIERTO (no mergeado) y el kit manda ramificar DESDE esa rama («Si PR #8 ya fue mergeado a main, basea desde main» — no aplica). **PR NUEVO ABIERTO SIN MERGE** (regla fija). main sigue en `74b12d2` (merge del kit 118).

Insumo: `INSTRUCCIONES-e14-consenso-frankfurt-v1.md` (§0 con la evidencia medida del diagnóstico Task 121 — F1..F5). Evidencia cruda fuera del repo (`research/repro_marcas.py` + capturas del dueño).

---

## 1. FASE 1 — `marcasEsquina` adaptativa (integridad.ts)

Reemplazo completo del cuerpo (misma firma, **retorno ahora `EsquinasActa | null`** — los 2 callers ya manejan null):

- **Canvas < 80×120 → `null`** (antes devolvía todo-false = condena sistemática — contradecía la política «sin señal honesta no se condena» del propio archivo).
- Una sola pasada `getImageData` (pesos 0.2126/0.7152/0.0722 como hoy) → **imagen integral (W+1)×(H+1) Uint32** → media de cualquier rectángulo O(1). ADAPTACIÓN documentada en el código: la luminancia se **cuantiza a 6 bits (0-63)** antes de acumular — sin cuantizar, la suma integral desborda Uint32 en capturas de alta resolución (>16.8M px). Error por píxel ≤ 0.008 → ≈0.001 en la media de una ventana (≥23² px), despreciable frente a las holguras.
- Búsqueda por esquina en regiones con margen 2× sobre las posiciones MEDIDAS del dueño (§0-F1: y 2.2-5.2% sup · 97.6-97.9% inf · x 3.8-8% · 97.2%): sup y∈[0,10%H] · inf y∈[90%H,H] · izq x∈[0,14%W] · der x∈[86%W,W].
- Ventana CUADRADA de lado s ∈ {2.5%W, 3.2%W, 4.2%W}, paso 2px (la marca real mide ~3%W: 27px/908 Frankfurt · 30px/995 Cairo — 3 tamaños = tolerancia de escala). Candidato: **núcleo media(s×s) < 0.30** Y **anillo media(3s×3s, incluye el núcleo) > 0.75**; gana el núcleo más oscuro que cumpla AMBOS. Umbrales con `// Fuente:` (núcleo real 0.05-0.14 → holgura >2×; anillo real ≈0.89 → holgura 0.14; barcode a y≥6%H da anillo ~0.5-0.6 → rechazado).
- `ladoEsquinaFaltante` / `trazaEsquinas` / `ESQUINAS_OK` **SIN CAMBIOS**. Prohibidos respetados: sin connected-components, sin umbrales por esquina, sin dependencias.
- **Presupuesto medido**: integral+búsqueda 908×2859 = **22.1 ms** (mín de 3 pasadas en bun; el navegador añade solo el memcpy del `getImageData`) — dentro del <30 ms del kit.

## 2. FASE 2 — los fiduciales perdonan al guard geométrico (completitud.ts + bridge)

- `verificarCompletitud(quad, fotoProcesada, esquinas?: EsquinasActa | null)` — 3er parámetro opcional (import type de integridad.ts, sin ciclo). Helper ÚNICO `perdonadaSiPapelEntero` aplicado a AMBOS desenlaces (tinta medida y warp no-medible §7): **4/4 marcas → `completa=true`** aunque haya tinta al filo; `sospecha`/`tintaFilo`/`densidades`/`fondo` se conservan para el log (el escudo D10/techo 7.9 sigue activo en el bridge: `completa && fondo` → techo). `esquinas` null o con faltantes → comportamiento EXACTO de hoy.
- Bridge AMBOS pipelines: cálculo de esquinas movido ANTES de `verificarCompletitud` (una sola medición, helper único `esquinasDeActa`), y el resultado va al guard. SIM intacto: `esquinas=ESQUINAS_OK` + guard omitido (mismo patrón kit 120).

## 3. FASE 3 — consenso de identificación (clasificador.ts)

### 3.1 `candidatosCodigo1D(texto)` (§4.1, verbatim del kit)
Extracción tolerante al «7» impreso como «/» y a espacios: ventanas de 15 sobre secuencias pegadas de `[\d/ ]` con `«/»→«7»`. `ANCLA_CODIGO_1D` queda **byte a byte** (§7). La lista del consenso (`codigos1D`) pasa a ser la UNIÓN ANCLA + candidatos (Set, primero los puros). El consenso D.1 (todos acuerdan) SIN CAMBIO.

LÍMITE documentado (QA): 15 caracteres crudos con 1 espacio pegan a 14 → sin candidato (no cabe ventana de 15 y **no se inventan dígitos**); el caso real Frankfurt (`/1000/453010202`, 15 crudos con los 2 «/») sí parsea.

### 3.2 Kit arbitrado por el registro (§4.2)
Bloque movido DESPUÉS de la resolución de municipio (cascada + rescate 4b — necesita el municipio FINAL para consultar el registro; nota: el rescate 4b corre antes, igual que el bloque D.6 del kit 120). Reglas: pie vs código difieren → gana el que esté en registro; ambos o ninguno → gana el pie + `PIE_CODIGO_DISCREPAN`. Fuzzy honesto: código fuera de registro con vecino del mismo municipio a «distancia de edición 1» → gana el registro SOLO si el pie lo confirma o si no hay pie + `KIT_CODIGO_CORREGIDO`. Sin fuentes → null (SINKIT como hoy). Nuevo campo display `ClasificacionE14.kitFuente?: "PIE" | "CODIGO" | "REGISTRO" | null`.

**ADAPTACIÓN documentada — «distancia de edición 1»**: el ejemplo del kit (300↔399) difiere en DOS dígitos (los dos 9 del kit leídos 0 — §0-F3). Implementado como **UNA sustitución constante leído→real** (un par único; el caso de 1 dígito es el mínimo): `300→399` es una edición; `300→398` (dos pares) o longitudes distintas → null; 2+ kits candidatos → null (no se inventa). Helper local ~20 líneas, sin levenshtein ni dependencias.

### 3.3 Mesa: guard de rango + cruce con registro (§4.3)
- **`MESA_FUERA_RANGO`** (nuevo): mesa leída > p.t (o < 1) con ruta completa → aviso + lectura a null (la lectura es IMPOSIBLE — §0-F5: El Cairo t=1, MESA 004). `parciales.mesa` ya no muestra la lectura imposible. Rescate: el registro puede dar la mesa (canal `MESA_POR_KIT` del kit 120, guardas `KIT_OTRA_RUTA`/`KIT_MESA_FUERA_RANGO` intactas). Sin ruta completa no hay p.t → el guard no aplica.
- **`MESA_REGISTRO_DISCREPAN`** (reemplaza a `MESA_KIT_DISCREPAN` del kit 120 — mismo disparador, renombrado por §4.3.2 + mejora): mesa leída válida EN RANGO pero ≠ registro → aviso + **si el nivel era AUTO baja a SUGERIDA** (conflicto de fuentes jamás en silencio ni en AUTO; el panel muestra ambas).
- **La consulta del registro para la mesa usa el KIT ARBITRADO** (`kit`, no `consenso.kit`): con código 300 + pie 399, el registro del 399 rescata la mesa que el código errado no encontraría (AC3 caso 1).
- El respaldo d9 del TIPO (regex puros de ANCLA) queda byte a byte — §7: se añaden candidatos, no se relajan reglas.

## 4. FASE 4 — banda dirigida (bridge + clasificador)

- `tipoDeBanda(texto)` EXTRAÍDA (export; TRANSMISIÓN primero, DELEGADOS después — regexes byte a byte) y `clasificarCabecera` la consume.
- `ocrBanda(fotoProcesada)` (bridge, helper único para AMBOS pipelines): crop x∈[22%,88%] y∈[3%,13%], **INVERTIDO (255-lum)** y ×2 → `toDataURL("image/jpeg", 0.9)` → `requestOcr()` del core. Corre UNA vez SOLO cuando `tipoDeBanda(texto) === null`, ANTES de `clasificarCabecera`; try/catch → "" (nunca condena); NO re-OCR del acta completa; el tiempo se suma a `ms.ocr`. **SIM: omitido** (guard `opciones.simular` — AC6). Presupuesto ~1-3 s dentro del TIMEOUT_MS del core (15 s).

## 5. FASE 5 — chips honestos (ReviewView.tsx)

- **Chip de tipo (§6.1)**: `paginaObjetivo?.tipo` PROHIBIDO y su selector RETIRADO de la pantalla (el store no se toca — otras pantallas siguen con su selector). Sin `clasifAuto` → `tipoDeBanda(acta.ocrTexto)`; tampoco → `---` (mismo estilo que MESA ---). Fin del «DELEGADOS» falso del hueco.
- **Línea de ID (§6.2)**: `KIT ### · TRANSMISION · 1/2 · fuente` — kit FINAL del arbitraje §4.2 + tipo leído + página + procedencia real (`· PIE` / `· CÓDIGO` / `· REGISTRO`). Sin kit → `KIT ---`. Renderiza SIEMPRE (honesto en vez de ausente). La página va amarrada al MISMO predicado del chip PÁG (`paginaIdentificada`): sin clasificación se muestra `-/-` — la `acta.pagina` es el HUECO asignado, no la lectura (misma mentira que §6.1 prohíbe; detectado y corregido en la verificación en vivo).
- **MESA · POR KIT** y todo lo demás (PARCIAL, PÁG - DE -, pill, REPETIR/REVISIÓN HUMANA) SIN CAMBIO (§6.3).

## 6. Trazas

`[e14] pipeline …` ya imprime `esquinas=`/`lado=` (kit 120) y `av:` vía `fmtClasif` — los avisos nuevos aparecen solos: `av:PIE_CODIGO_DISCREPAN+KIT_CODIGO_CORREGIDO+MESA_FUERA_RANGO+MESA_REGISTRO_DISCREPAN+VERPAG_CODIGO_DISCREPAN+BANDA_CODIGO_DISCREPAN…`. El tiempo de `ocrBanda` se suma a `ocr=`.

## 7. QUÉ NO CAMBIÓ (§7 — verificado)

`packages/npm` 0 diffs · `package.json`/`bun.lock` 0 · `public/e14/divipol.json` 0 · detection-worker 0 · `evaluarGate` y sus techos 0 · `faltaSeccionInferior` y el canal del 118 intactos · copys de rechazo intactos · contingencia C4 intacta · invariante G8 intacta · D6 (archivadas/historial) intacto · `codigoUnicoE14` + `ANCLA_CODIGO_1D` byte a byte · registro `kits.ts` SIN tocar datos (745→Frankfurt 012 correcto; la inconsistencia pie 746/código 745 es de la forma oficial — §0-F4).

---

## 8. Verificación (gates §8)

- `bunx tsc --noEmit` → **0** · `bun run lint` → **0** · build estático → **3/3** · npm diff → **0 archivos**.
- **`scripts/qa-consenso.ts` (NUEVO, `bun scripts/qa-consenso.ts`) → 29/29 OK**:
  - AC1 (6): `/1000/453010202` y `71000/453010202` → `710007453010202`; glue de espacio (16 crudos → 15); límite 15-crudos-con-espacio (sin candidato, no inventa); puros no duplican; `codigoUnicoE14("710007453010202")` → kit 745 · d9 3 · pág 2/2.
  - AC2 (4): pie 399 + código 300 + mun 335 → 399 + PIE_CODIGO_DISCREPAN + KIT_CODIGO_CORREGIDO (fuente REGISTRO); pie ausente + 300 → 399 + KIT_CODIGO_CORREGIDO; kit 512 fuera de registro sin pie → 512 sin inventar. (divipol REAL `public/e14/divipol.json`).
  - AC3 (5): MESA 004 con t=1 → MESA_FUERA_RANGO + mesa por registro 1 + parciales null + SUGERIDA (nunca AUTO); MESA 001 = registro → sin avisos + **AUTO intacto**; MESA 001 en rango ≠ registro 8 (Berlín t=9) → MESA_REGISTRO_DISCREPAN + **AUTO baja a SUGERIDA**.
  - Frankfurt 746 (3): consenso del slash → kit 745 · PÁG 2/2 · mesa 12 por kit; pie oficial 746 ≠ código → PIE_CODIGO_DISCREPAN; `tipoDeBanda` (T primero, D después, null sin banda).
  - AC4 (7): 60×90 → null; Frankfurt 908×2859 con marcas ~3%W en posiciones medidas → 4/4; Cairo 995×3127 (30px) → 4/4; sin marcas → 0/4 (todo-false, no null); banda tipo barcode sin anillo → 0/4; **12/12 páginas** (y-sup 2-6%H, x-izq 3.8-8%W) → 4/4; presupuesto 22.1 ms ≤ 30.
  - AC5 (4): 4 fiduciales + tinta ~30% → `completa=true` conservando sospecha/densidades/tintaFilo; esquinas null → `completa=false` (hoy); esquinas con faltante → `false` (conservador); quad sano → completa sin análisis (D4).
  - **Harness documentado en el script**: bun no tiene DOM — canvas duck-typed + stubs de `document`/`Image` con imagen sintética de ~30% tinta (misma cadena real `motorTinta`/`medirTintaAlFilo`). Los PDFs del visor NO están en el repo (AppSync privado — §0-F5): las 12 «páginas» son sintéticas con la geometría MEDIDA del dueño (§0-F1); el chequeo con capturas reales es el re-QA del dueño (AC7-AC10).
- **Regresión**: `scripts/qa-codigo-unico.ts` → **15/15** (12 fixtures + 3 negativos — intacto).
- **Navegador (dev :3001, 412×850, 0 errores de página/consola)**:
  - **SIM (AC6)**: chips 8.2 (ÓPTIMA auto-enviada) y 4.3 (RECHAZADA) con `esquinas=sim`, `ocrBanda` omitido, guion 5 s vivo (mesa 12 EN PROCESO, P1 ✓) — chips SIM intactos. Chips de REVISIÓN honestos en acta sin clasificar: `--- · MESA --- · PÁG - DE - · KIT --- · --- · 1/2 · ---`.
  - **Acta Frankfurt completa (fabricada, quad al filo + tinta cortada + 4 marcas + código slash + pie KIT 746 + MESA 012)**: `esquinas=OK` + `completa=true` (el PERDÓN de FASE 2 con tinta al filo en vivo) + `clasif={…,mesa:012,pag:2/2,tipo:T,nivel:AUTO,cod:710007453010202,av:VERPAG_CODIGO_DISCREPAN+PIE_CODIGO_DISCREPAN}` + `score=9.3` → **ÓPTIMA auto-enviada**; REVISIÓN: `TRANSMISIÓN · MESA 012 · PÁG 2 DE 2 · KIT 745 · TRANSMISIÓN · 2/2 · CÓDIGO` (equiv. AC7/AC8).
  - **Acta SIN marcas** (canal 118): `esquinas=FALTA_tl+tr+bl+br` + `recortada=1 lado=sup-izq` + SIN_VOTOS intacto → RECHAZADA (equiv. AC9 — los recortes reales siguen atrapados).
  - **Acta con «FIRMA DELEGADOS» + sello B/N**: `BANDA_CODIGO_DISCREPAN` → SUGERIDA, SIN auto-envío (el cruce D.3 protege contra la banda falsa — conservador).
  - **Acta con sello blanco-sobre-negro y sin banda legible en el OCR completo**: `ocrBanda` DISPARÓ (una pasada) → `tipo:T` + `MESA_POR_KIT mesa 012` → REVISIÓN con `TRANSMISIÓN · MESA 012 · PÁG 2 DE 2 · KIT 745 · TRANSMISIÓN · 2/2 · CÓDIGO · MESA 012 · POR KIT` (equiv. AC7 — nivel SUGERIDA: la mesa por registro NUNCA da AUTO, inmutable del 120 intacta).

## 9. Decisiones y adaptaciones (resumen)

1. **Distancia de edición 1** = una sustitución constante (par único) — el ejemplo del kit 300↔399 exige tolerar el 9→0 repetido; 2+ pares o ambigüedad → null.
2. **`MESA_KIT_DISCREPAN` → `MESA_REGISTRO_DISCREPAN`** (§4.3.2) + baja AUTO→SUGERIDA vía `mesaValidaLeida=false`.
3. **Registro de mesa con el kit ARBITRADO** (no `consenso.kit`) — requerido por el rescate del AC3-1.
4. **Cuantización 6 bits** de la luminancia en la integral Uint32 (desborde) — error ~0.001 en medias de ventana.
5. **Línea de ID siempre visible** (§6.2 «sin kit → KIT ---»), con página amarrada a `paginaIdentificada` (hueco ≠ lectura).
6. **`mesaLeida` imposible → null en TODOS los consumidores** (nivel, parciales, algoResuelto) — la lectura imposible no alimenta nada.
7. QA con stubs de canvas en bun (documentados) — los PDFs del visor no están en el repo.

## 10. Pendiente del dueño

- **Re-QA con SUS capturas** (AC7-AC10 reales): Frankfurt 746 completa (sin pill, sin 6.4, chips T · MESA 012 · PÁG 2 DE 2, kit 745 con aviso del pie), El Cairo (KIT 399 no 300), captura SINKIT real (sigue condenada), encuadre al filo repetido (ya no REPETIR FOTO con 4 marcas).
- Auditoría de ESTE PR (regla dura: sin merge sin orden).
- Decisiones abiertas de reportes anteriores (C4, copy chip «10.0», umbral votos) — sin cambio.
