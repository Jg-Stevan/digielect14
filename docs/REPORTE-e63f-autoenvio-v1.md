# REPORTE-e63f-autoenvio-v1 — que se envíe solo la mayoría, SIN bajar la integridad

**Task ID e63f** · ejecutado por Z.ai Code · kit `INSTRUCCIONES-e63f-autoenvio-v1.md` (dueño, 2026-10-21) · **rama `feat/e63f-autoenvio-v1`** desde `origin/main @ 3f759a3` (post-cola #61+#64+#65 — incluye e63d + hotfix e63d-rev2, como exige el kit).

**Estado: F0+F1+F2 IMPLEMENTADAS · gates verdes (tsc 0 · lint 0 · build OK) · QA headless `scripts/qa-autoenvio.ts` 33/33 OK con el caso REAL del informe 120553 como fixture fundacional. La validación de campo (Fase D: re-corrida del lote 20261019 sobre el preview del PR) es del DUEÑO.**

---

## 0. La verdad medida primero (kit §0 — la evidencia fundacional)

- El score NO es el cuello de botella: en el lote real (`20261021-120553`, 26 actas) **25/26 se autoenviaron (96%)**; la única no-enviada tenía score 8.5 y lectura FUERTE — cayó por **clasificación**, no por score.
- Causa exacta medida con las funciones REALES del repo: la verificación LUGAR (`clasificador.ts`, hoy L826-850) comparó el OCR `«LUGAR: EI Calro-Consulado»` contra `«El Cairo - Consulado»` con `normalizarNombre`+`similitud` → **0.471 < 0.55** → cap `confPuesto = 0.75` + `puestoResuelto = false` → SUGERIDA → revisión humana. El puesto YA estaba resuelto por código (02, zona 05, kit 399 del consenso corroborando en `REGISTRO_KITS`).
- Principio rector (kit §1, respetado literalmente): **ninguna barra de integridad baja** — se arregla la LECTURA que condena a datos correctos.

## 1. FASE 0 — Balde fino del «por qué no fue AUTO» (solo-aditivo, contrato D51)

| Pieza | Archivo | Qué se añadió |
|---|---|---|
| Campo `clasifDebil?: string \| null` | `clasificador.ts` (interfaz `ClasificacionE14` — vive AQUÍ, no en types.ts; el kit citaba types.ts por error, la intención es la misma) | opcional al final; pre-e63f lo traga sin error |
| Motivo calculado | `clasificarCabecera`, tras decidir el nivel | `puesto-lugar` (cap LUGAR disparó — flag nuevo `capLugarAplicado`) > `tipo` (sin tipo o confianzaTipo < 0.82) > `mesa-registro` (`MESA_REGISTRO_DISCREPAN` presente — la única señal MESA_* que bloquea AUTO) > `ruta` (`!(depResuelto && munResuelto && puestoResuelto)`). null si AUTO o nada aplica (el score NO es motivo de clasificación). Cero recomputo: todo sale de variables ya existentes |
| Traza | `scanner-core-bridge.ts` (líneas de log de AMBOS pipelines, token AL FINAL) | ` ClasifDebil=<motivo>` — patrón ` lazo=perdonado`, aditivo (D51) |
| Contador fino | `store.ts` `contarMotivoNoEnvioActa` | clave NUEVA `revision:clasif-<nivel>:<motivo>`; **las claves viejas quedan byte-idénticas y siguen contando** |
| Informe | `informe.ts` (`FilaInforme` + `filaLiviana` + `renderTxt`) | línea ADITIVA tras ESCANEOS: `CLASIF-DEBIL: puesto-lugar n · tipo n · mesa n · ruta n` — **solo si n > 0** (sin el balde, byte-idéntica). Censo por fila (una acta enviada a mano TAMBIÉN fue retirada del autoenvío) |

## 2. FASE 1a — Verificación LUGAR con normalización OCR-aware

- **`normalizarNombreLugar`** (export, junto a `normalizarNombre` — NO la reemplaza): hereda `normalizarNombre` (NFKD, sin diacríticos, MAYÚSCULAS, espacios colapsados) + puntuación/guiones/underscores → espacio + equivalencia **I ↔ L aplicada a AMBOS lados** (canónica simétrica).
- Usada **EXCLUSIVAMENTE** en la verificación LUGAR (`similitud(normalizarNombreLugar(lugarLeido), normalizarNombreLugar(puesto.nombre))`). `UMBRAL_VERIFICACION_LUGAR = 0.55` **intacto**; `normalizarNombre` **byte-idéntico** en todo lo demás (RED LINE 3 — probado por comportamiento en el QA: conserva guion y no aplica I→L).
- **Efecto medido (QA bloque 1)**: el par real del informe sube `0.471 → 1.000` (la canónica vuelve idénticas las dos lecturas del mismo puesto). El kit predecía 0.706 y su propio QA §5.1 manda «afirmar ≥ 0.55, no el valor exacto» — se registra el 1.000 medido con honestidad.

## 3. FASE 1b — Consenso del registro KIT como FRENO del downgrade (CAMBIO DE SEMÁNTICA DECLARADO)

**Aprobación del dueño: kit e63f §3b** («LA decisión de semántica — requiere visto bueno del dueño en el review»: este kit ES esa instrucción y su §6.4 pide citarlo aquí). El registro sigue **sin resolver NADA solo**: no otorga upgrade, SOLO frena este cap; la mesa sigue la regla D.6 (kit §3b.3).

- Regla implementada (en la verificación LUGAR, ANTES de capar): `puestoResuelto` venido **POR CÓDIGO** (flag nuevo `puestoPorCodigo` — las 3 vías de código; la desambiguación por nombre NO cuenta) ∧ `kitEnRegistro(mun, kit)` existe ∧ `registro.std === puesto.codigo` → **NO capar** + aviso display **`LUGAR-DESVIADO`** (la UI ya pinta avisos). Cualquier otra combinación → cap como hoy (byte-idéntico).
- Justificación (kit §3b.2): dos fuentes estructuradas de acuerdo (código divipol leído por OCR + kit del consenso 1D/PIE = la ruta en `REGISTRO_KITS`) contra UNA línea de texto libre con ruido.
- **Decisión de implementación declarada**: el check usa el kit del **consenso del código 1D con fallback al pie** (`consenso?.kit ?? mKitPie`), no el kit ARBITRADO final — porque el arbitraje corre DESPUÉS de la verificación LUGAR (necesita el municipio FINAL del rescate 4b, y mover la verificación cambiaría el comportamiento del rescate: NO se reordenó nada). En el `REGISTRO_KITS` actual el `std` es constante por municipio → la señal coincide con la del kit arbitrado; los estados de divergencia teórica caen en el lado conservador (cap). Guardas intactas: kit null / sin hit / otra ruta → cap.
- Riesgo vigilado: la canónica I↔L es simétrica y solo puede ACERCAR pares; un falso-perdón exigiría dos puestos del mismo municipio cuyos nombres difieran solo en posiciones I/L — no existe en la base hoy.

## 4. FASE 2 — Re-lectura interna antes de «repetir-primero»

- **Lógica pura nueva** en `masiva/relectura.ts` (módulo testeable headless; el kit pedía la lógica «en el runner» — se extrae el predicado/applier a archivo propio por testeabilidad, la orquestación SÍ vive en `runner.ts`; desviación de forma menor, cero cambio semántico):
  - `procedeRelecturaInterna(acta)`: EN_REVISION_HUMANA por SUGERIDA/MANUAL ∧ score ≥ 8 ∧ lectura FUERTE ∧ gate completa.
  - `desenlaceTrasRelectura(acta, textoRe, clasifRe)`: AUTO ∧ score ≥ 8 → OPTIMA (regla del gate); **cualquier otra cosa devuelve el acta ORIGINAL IDÉNTICA** (mismo objeto — jamás empeora, jamás retoca score).
- **Orquestación** (`runner.ts`, tras el guard anti-zombi y antes del desenlace): `getBridge().reconocerTexto(acta)` — re-warp con el quad HORNEADO **sin re-detección** (e63d F2 identidad intacta) + rapidocr a cap fino `DET_CAP_PROD` (1920, la pasada-2 del escalonado) → `clasificarCabecera` → aplicar. UNA pasada MÁXIMA (RED LINE 5). Si la re-lectura da AUTO, el desenlace completo (clasificación nueva incluida) sigue la vía normal de envío (`actaDesenlace` — el spread del envío usa el desenlace post-re-lectura).
- **Intento de LECTURA ≠ intento de captura**: en MASIVA no hay re-captura; el «repetir-primero» físico del flujo individual NO cambia. Flag aditivo `relectura?: boolean` en `FilaMasiva` + token de traza ` RelecturaInterna=auto|sin-cambio` (línea propia `[e14] relectura-interna …`, D51).
- **NUNCA aplica a** (QA bloque 4 lo afirma): RECHAZADAS por calidad (score < 6.5 — re-escanear SÍ ayuda), ADVERTENCIA (6.5-8, red line), gate incompleta, lectura MEDIA. Falla interna (runtime OCR/base) → desenlace de siempre.
- Nota honesta: el caso real `171446.jpg` (TRANSMISION 0.75 < 0.82) NO lo arregla F2 (su re-lectura reproduciría el mismo SUGERIDA si la lectura sigue igual) — lo arregla F1a/F1b si el código+kit están presentes (están). F2 cubre el caso SUGERIDA/MANUAL transitorio donde una segunda lectura fina sí resuelve.

## 5. QA headless — `scripts/qa-autoenvio.ts` (33/33 OK)

- **Bloque 1 (F1a)**: caso real ≥ 0.55 (medido 1.000) · control Frankfurt≠Berlin < 0.55 · RED LINE 3 por comportamiento (normalizarNombre intacto).
- **Bloque 2 (F1a+F1b vía `clasificarCabecera` con la base divipol REAL del repo)**: El Cairo «EI Calro-Consulado» → AUTO sin cap, confianza 1.0, sin aviso · LUGAR ilegible + kit 399 → sin cap + `LUGAR-DESVIADO` · sin kit → cap como hoy · control Frankfurt-vs-Berlin cap intacto.
- **Bloque 3 (F0)**: prioridad puesto-lugar > tipo · «tipo» · «mesa-registro» (MESA 005 vs registro 745=12 — la red line NUNCA-AUTO intacta) · «ruta» · AUTO → null.
- **Bloque 4 (F2)**: 7 casos del predicate (procede SUGERIDA/MANUAL; NO procede score 7.9/ADVERTENCIA/RECHAZADA/incompleta/MEDIA) + applier (AUTO→OPTIMA con texto re-leído y score intacto; no-AUTO→acta IDÉNTICA por referencia).
- **Bloque 5 (source-scan)**: umbrales 0.82/0.6/0.55 y OPTIMA=8/ADVERTENCIA=6.5 byte-idénticos · claves viejas del store + clave fina nueva · `REGISTRO_KITS` intacto · ESCANEOS prefijo intacto + CLASIF-DEBIL aditiva.
- Fixtures: textos OCR sintéticos + `public/e14/divipol.json` (dato público del repo) + códigos 1D ya citados en el propio `clasificador.ts` — cero actas reales (RED LINE 7).

## 6. Qué NO toco (red lines verificadas)

- **Umbrales byte-idénticos**: `UMBRAL_AUTO=0.82` · `UMBRAL_SUGERIDA=0.6` · `UMBRAL_VERIFICACION_LUGAR=0.55` · OPTIMA=8 · ADVERTENCIA/RECHAZADA 6.5 — QA bloque 5. No se «tuneó» nada con el lote (RED LINE 2).
- `normalizarNombre` y el mapa de confusión de `clasificador.ts` byte-idénticos (QA bloque 1). `REGISTRO_KITS`/`kits.ts` intactos (QA bloque 5) — el registro no resuelve nada solo.
- Mesa↔registro discrepancia sigue **NUNCA AUTO** (QA: motivo mesa-registro con SUGERIDA). ADVERTENCIA/MANUAL/mesa-discrepante siguen sin autoenvío. RECHAZADA por calidad → 4 intentos → revisión, intocado (`evaluarGate` sin tocar).
- Chips SIM 8.2/7.0/4.3 intocables (SIM jamás trae origen ni corre la verificación LUGAR con capturas — `opciones.simular` intacto), `@jg-stevan/scanner-core` intocable, pistas de traza solo-aditivas (D51), cero actas reales al repo.

## 7. Archivos tocados

| Archivo | Cambio |
|---|---|
| `src/lib/e14/clasificador.ts` | F1a (`normalizarNombreLugar`) + F1b (freno del cap + `puestoPorCodigo`) + F0 (`clasifDebil` + flags) |
| `src/lib/e14/store.ts` | F0: clave fina `revision:clasif-<nivel>:<motivo>` (claves viejas intactas) |
| `src/lib/e14/informe.ts` | F0: `FilaInforme.clasifDebil` + mapeo + línea `CLASIF-DEBIL:` (solo si n > 0) |
| `src/lib/e14/scanner-core-bridge.ts` | F0: token ` ClasifDebil=` al final de las 2 líneas de log (aditivo) |
| `src/lib/e14/masiva/relectura.ts` | NUEVO — F2 puro (predicate + applier) |
| `src/lib/e14/masiva/runner.ts` | F2: orquestación de la re-lectura + `actaDesenlace` + flag fila + traza |
| `src/lib/e14/masiva/tipos.ts` | F2: `FilaMasiva.relectura?: boolean` (aditivo) |
| `scripts/qa-autoenvio.ts` | NUEVO — QA headless 33/33 |
| `docs/` (REPORTE + worklog) | esta documentación |

## 8. Pendiente del dueño (Fase D)

1. **Re-corrida del lote 20261019 (26 actas) sobre el preview del PR** → esperado: **26/26 ENVIADA** (la TRANSMISION El Cairo pasa por F1a: 1.000 ≥ 0.55, sin cap) · **0 RECHAZADAS nuevas** · línea nueva `CLASIF-DEBIL:` visible en el informe · SIM 8.2 intacto por humo. **Si alguna acta que HOY se autoenvía deja de hacerlo → NO-GO, atribuir antes de merge.**
2. **Review del cambio de semántica F1b** (kit §3b — el visto bueno del dueño; este REPORTE §3 lo declara con su justificación y las guardas).
3. Si en campo quedara algún SUGERIDA con LUGAR ruidoso sin kit (F0 lo dirá por el balde fino): la palanca siguiente es la re-lectura dirigida de la línea LUGAR (kit §3c — NO implementada: YAGNI, sin evidencia de campo que la pida).
