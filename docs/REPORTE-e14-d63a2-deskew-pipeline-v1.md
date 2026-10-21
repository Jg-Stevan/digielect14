# REPORTE-e14-d63a2-deskew-pipeline-v1 — deskew→pipeline + calibración `pdf-render`

**Task ID D63-A2** · ejecutado por Z.ai Code · kit `AGENTE-D63-A2-deskew-pipeline-v1.md` · **rama `feat/e14-d63a2-deskew-pipeline-v1`** desde `origin/main @ 6095197` (merge del PR docs #62 — YA MERGEADO como exige el kit, one-off autorizado por el dueño).

**Estado: FASES A/B/C COMPLETAS — rev.2: bug T2 reportado por el dueño (preprocesoAplicado nunca asignado) CORREGIDO + humo de integración real 6/6 con control negativo (§4.1). Fase D es del DUEÑO (corrida formal en canal canónico). Fase E (A/B vs 200613) pendiente de esa corrida.**

---

## 0. Contexto aplicado (kit §0)

1. El deskew de D63-B estaba MUERTO por diseño accidental: el bloque de pre-proceso calcula `preProceso.archivo` (el corregido) pero el input del bridge quedó alimentado solo por el master D66 u el original. Hallazgo del worklog D65; el dueño ordenó despertarlo aquí.
2. El detector D63-A por señales JAMÁS dirá «escaneo» para los PDFs reales (E-14 impreso a sangre, sin borde blanco de escáner) — evidencia F1: `ORIGEN: escaneo 0 - foto 16 - null 10 (null: borde-no-blanco 10)`.
3. La calibración correcta es de CONSTRUCCIÓN: `extraerPdf` (D60) sabe por construcción qué filas nacen de un PDF → `viaPdf` → `origen="escaneo"` con las señales de píxel PRESERVADAS como prefijo `pdf-render+…`. Las 2 WhatsApp se quedan donde están (null honesto).
4. Decisión del dueño cerrada: las 2 divergencias F1 ACEPTADAS documentadas — el informe **200613 es la referencia de registro** del gate de este kit.

## 1. FASE A — Pre-vuelo (gates duros, en orden)

| Gate | Resultado |
|---|---|
| 1. `origin/main` contiene el merge de #62 | ✓ — `6095197` (merge #62; draft→ready vía GraphQL `markPullRequestReadyForReview` y merge `PUT /pulls/62/merge`, one-off autorizado por el dueño en la orden del turno) |
| 2. `tsc` 0 sobre main | ✓ — `bunx tsc --noEmit` exit 0 en el clon |
| 3. Re-verificación P1-P6 | ✓ — texto exacto, ver §2 |
| 4. Confirmaciones del dueño | (a) revocación del `ghp_` viejo: **sin confirmación explícita** — el token del archivo (`/home/z/tmp/gh-token`, chmod 600, fuera del repo, jamás impreso) sigue OPERATIVO (hizo el merge #62 y el push del PR) ⇒ **la deuda (a) sigue pendiente**; (b) token por file fuera del repo ✓ (cumple el mecanismo); (c) `rastreador-sesion-e14-v1.js` **NO está en la máquina** ⇒ **bloqueante de la Fase D** (firma pre-vuelo); (d) zip F1-200613 disponible ✓ (`upload/e14-informe-20261020-200613.zip`), 162728 lo tiene el arquitecto |
| 5. Vercel prod vivo con COOP/COEP | ✓ — `digielect14.vercel.app/digielect14/` → HTTP 200 + `cross-origin-opener-policy: same-origin` + `cross-origin-embedder-policy: require-corp` |

Los gates 1-3 (míos) pasaron; las condiciones 4(a)(c) son del dueño y quedan declaradas como requisitos de su Fase D — no bloquean las fases B/C.

## 2. Re-verificación de los puntos de inserción (texto exacto, main @ 6095197)

| # | Verificado | Texto real |
|---|---|---|
| P1 | ✓ | `archivo: maestro?.archivo ?? archivoIntento, // D66 — el master (fallback: original)` (runner.ts) |
| P2 | ✓ | maestro: `intento === 1 ? (entradaPrecalor?.maestro ?? await maestroDeImagen(archivoIntento, …)) : await maestroDeImagen(archivoIntento, …)` |
| P3 | ✓ | `veredictoOrigen = await clasificarOrigenDeArchivo(archivoIntento);` + console.info de origen/senales |
| P4 | ✓ | rama `else if (parecePdfMasiva(f))` → `const resultado = await extraerPdf(f); imagenes.push(...resultado.archivos);` |
| P5 | ✓ | `FilaMasiva` y `RegistroMasiva` sin `viaPdf` (aditivo en el borde de cada interfaz) |
| P6 | ✓ | `function filaDeRegistro(r: RegistroMasiva): FilaMasiva` reconstruye fila sin `viaPdf` |

Sin diferencias respecto al kit — los números de línea coinciden ±2 (documentados como texto, no como línea).

## 3. Implementación (T0-T2)

### T0 — Cablear el master corregido (`runner.ts`, bloque del maestro)
```ts
const fuenteMaestro: File = preProceso?.aplicado ? preProceso.archivo : archivoIntento;
const maestro: MaestroImagen | null =
  intento === 1 && !preProceso?.aplicado
    ? (entradaPrecalor?.maestro ?? (await maestroDeImagen(fuenteMaestro, { nombre: fila.nombre })))
    : await maestroDeImagen(fuenteMaestro, { nombre: fila.nombre });
```
- El `archivo:` del bridge SIGUE siendo `maestro?.archivo ?? archivoIntento` (SIN tocar — el master único D66 queda verdadero).
- **Disciplina de memoria**: `entradaPrecalor` es ahora `let`; cuando `preProceso?.aplicado && entradaPrecalor` → `descartarMaestro(fila.id)` (vía del precalor, idempotente) + `entradaPrecalor = null` (el blob muere YA, no al fin del scope) + traza `[e14] precalor fila=… descartado fuente=corregido precalorMs=…`. El precalor sigue decodificando el ORIGINAL en la espera (sin cambios).
- **Trazas aditivas**: consola decode-maestro gana `fuente=corregido` SOLO cuando aplica; el diagnóstico gana `maestroFuente: "corregido" | "original"` (presente en TODA fila MASIVA con diagnóstico — `preProceso` siempre existe, nulo para no-escaneos ⇒ "original"; el informe T2 lo consume). `decodeMs` reportado es el de lo que el bridge REALMENTE consume (con aplicado: medido — el precalentado descartado da `precalentada=false`, honesto).
- Reintentos: el bloque pre-proceso se re-ejecuta por intento (D65 ya lo garantiza) — nada cacheado.

### T1 — Calibración por construcción: `viaPdf` → escaneo
- `tipos.ts`: `viaPdf?: boolean` en `FilaMasiva` Y `RegistroMasiva` (aditivo D63-A2, borde de cada interfaz; persiste para sobrevivir recarga a mitad de corrida).
- `store.ts` (`agregarFiles`): `const paginasPdf = new Set<File>()` — la rama PDF hace `resultado.archivos.forEach(a => paginasPdf.add(a))` ANTES del push; las temps nacen con `...(paginasPdf.has(file) ? { viaPdf: true } : {})`; `agregarLote(imagenes, paginasPdf)` estampa el campo en el PRIMER write.
- `cola.ts` (`agregarLote`): 2.º parámetro opcional `pdfPages?: Set<File>` — el registro nace con `viaPdf: true` si el File está en el Set (ver desviación D-1).
- `filaDeRegistro`: `...(r.viaPdf ? { viaPdf: true } : {})` — restauración en recarga.
- `runner.ts` DESPUÉS de P3 (forma EXACTA del kit):
```ts
if (fila.viaPdf && veredictoOrigen.origen !== "escaneo") {
  veredictoOrigen = { origen: "escaneo", senales: `pdf-render+${veredictoOrigen.senales}` };
  console.info(`[e14] origen pdf-render → escaneo (señales píxel preservadas: ${veredictoOrigen.senales})`);
}
```
- **Prueba de lectura (fotos/WhatsApp jamás tocan `viaPdf`)**: el único write del Set es en la rama `parecePdfMasiva(f)` (store.ts); las fotos y WhatsApp pasan por `pareceImagenMasiva(f)` (MIME image/* o extensión — las WhatsApp son .jpg) y los ZIP/RAR por `extraerArchivo` — ninguna otra rama toca `paginasPdf` ni escribe `viaPdf`. SIM y captura individual no pasan por `agregarFiles` (campo de MASIVA) — imposible que lo traigan.

### T2 — Informe aditivo (`informe.ts`, SOLO añadir)
- `FilaInforme`: `preprocesoAplicado?: boolean` (presente SOLO si origen escaneo y el diagnóstico trae `maestroFuente`; ausente para fotos/WhatsApp/SIM/registros previos — jamás inventar; `false` ES dato = escaneo recto).
- `filaLiviana` (rev.2 — asignación REAL, el claim rev.1 «spread condicional desde `diag.maestroFuente === "corregido"`» era FALSO: el constructor rev.1 nunca asignaba el campo → siempre `undefined` → el JSON de cada acta moría sin él; tsc no lo pesca — optional sin asignar es legal): asignación condicional tras el bloque D63-D — presente SOLO si `diag.origen === "escaneo" && diag.maestroFuente != null`, valor `maestroFuente === "corregido"`; fotos/WhatsApp/SIM/registros previos y escaneos sin provenance → `undefined` (ausente; jamás inventar).
- `actaLivianaJson`: spread condicional al final (informes previos no cambian de forma — `JSON.stringify` omite undefined).
- La línea ORIGEN esperada del lote formal quedó verificada con humo puro: `ORIGEN: escaneo 8 - foto 16 - null 2 (null: borde-no-blanco 2)`; la línea ESCANEOS con deskew medio de corregidos YA EXISTÍA (D63-D rev.2, `informe.ts` «deskew medio Nms (k corregidos)») — se llena sola.

## 4. Desviaciones DECLARADAS (kit §7: se declaran, nunca se ocultan)

- **D-1 (`cola.ts`, 5.º archivo src)**: el tope del kit («4 archivos: runner.ts, store.ts, tipos.ts, y NADA más») es incompatible con el T1-persistencia: la construcción del `RegistroMasiva` vive en `agregarLote` (cola.ts). Alternativa descartada: un 2.º write post-`agregarLote` competiría con el write del hash de `cadenaDedup` (whole-object — riesgo real de pérdida de hash/traza). Solución: parámetro OPCIONAL aditivo + estampado en el primer write. El T2 también exige `informe.ts` («SOLO añadir»), que el propio título del §2 excluye — conteo textual del kit inconsistente con sus tareas; se siguió el espíritu (src mínimo aditivo): **6 archivos tocados: runner.ts, store.ts, tipos.ts, cola.ts (D-1), informe.ts (T2), types.ts (D-2)**.
- **D-2 (`types.ts`)**: el campo T0 `maestroFuente` viaja en el diagnóstico del acta → el tipo `DiagnosticoActa` vive en types.ts. Aditivo al final del contrato (tras `limpieza`).
- **D-3 (`as const` en el ternario de `maestroFuente`)**: TS exigía literal tipado para la inferencia del union (`"corregido" | "original"`) — sin cambio de semántica.
- **D-5 (rev.2, `export` de `filaLiviana`)**: el humo de integración REAL exige llamar al constructor — `RegistroMasiva → filaLiviana → actaLivianaJson`. rev.1 lo tenía privado y por eso el humo validó con una FilaInforme fabricada (exactamente el hueco que el dueño destapó). Un keyword `export`, cero cambio de semántica (patrón ya usado: `actaLivianaJson`/`renderTxt` exportados por la misma razón).

### 4.1 REV.2 — bug T2 reportado por el dueño, causa raíz y corrección

- **Reporte del dueño**: `FilaInforme.preprocesoAplicado` se declara y `actaLivianaJson` lo printa condicional, pero **nadie lo asigna** — el constructor `filaLiviana` nunca lo setea → siempre `undefined` → el JSON de cada acta muere sin el campo. El claim del §3-T2 rev.1 («`filaLiviana`: spread condicional») es FALSO.
- **Por qué se escapó**: (a) tsc no pesca un optional sin asignar (legal); (b) el humo rev.1 validó el spread de `actaLivianaJson` con una FilaInforme FABRICADA a mano (con el campo ya puesto) en vez de la integración real — el humo probó el eslabón de abajo, no el que estaba roto.
- **Corrección (rev.2, `informe.ts`)**: asignación condicional en `filaLiviana`, tras el bloque D63-D (`skewGrados`/`deskewMs`/`gateMarco`):
```ts
// D63-A2 (T2): presente SOLO si origen escaneo + provenance del master
// (fotos/WhatsApp/SIM/registros previos → ausente; jamás inventar).
// false ES dato (escaneo recto — maestroFuente "original").
preprocesoAplicado:
  diag?.origen === "escaneo" && diag.maestroFuente != null
    ? diag.maestroFuente === "corregido"
    : undefined,
```
- **Humo puro de INTEGRACIÓN REAL (bun, `/home/z/tmp/humo-d63a2-t2-rev2.ts` — desechable, fuera del repo): 6/6 OK** — recorre `RegistroMasiva → filaLiviana → actaLivianaJson → JSON.stringify`: (1) foto → AUSENTE (json y stringify); (2) escaneo recto (`maestroFuente:"original"`) → `false` PRESENTE; (3) escaneo torcido (`"corregido"`) → `true` PRESENTE; (4a) origen null (WhatsApp) → AUSENTE; (4b) escaneo con `maestroFuente:null` (pre-T0) → AUSENTE; (4c) sin diagnóstico (SIM) → AUSENTE; (5) trio literal del dueño en el JSON: foto→ausente · recto→false · torcido→true.
- **Control negativo (el que faltaba en rev.1)**: el humo rev.2 ejecutado sobre el código PRE-fix → FALLO (exit 1 — sin el export y con las aserciones de campo muertas). El humo SÍ detecta el hueco que rev.1 dejó pasar.
- Gates rev.2 re-emitidos: `tsc --noEmit` 0 · `bun run lint` limpio. Cero toques fuera de `informe.ts` (asignación + export + comentarios).

## 5. FASE B/C — Gates locales y humo

### Gates
- `tsc --noEmit` **0 errores** (tras D-1/D-2/D-3). `bun run lint` **limpio**.
- `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` **OK** (out/ emitido — misma receta del workflow de GH Pages).

### Humo puro rev.1 (bun, `/home/z/tmp/humo-d63a2.ts` — desechable, fuera del repo): **5/5 OK** — INVALIDADO en su base por el bug T2 (ver §4.1)
> ⚠️ Los puntos 1-2 corrían sobre una **FilaInforme FABRICADA** (con el campo ya puesto a mano) — no ejercían el constructor `filaLiviana`, donde estaba el hueco. El humo rev.1 NO podía detectar el bug. Puntos 3-5 (omite-undefined / renderTxt / línea ORIGEN) no dependían del constructor y siguen valiendo.
1. `actaLivianaJson` respeta `preprocesoAplicado=true` (escaneo) — ⚠️ sobre fila fabricada.
2. Foto → `preprocesoAplicado` AUSENTE — ⚠️ sobre fila fabricada.
3. `JSON.stringify` omite el campo ausente (informes previos sin cambio de forma).
4. `renderTxt` byte-idéntico con/sin el campo para no-escaneos (contrato D57).
5. **Línea ORIGEN del lote formal esperada**: `escaneo 8 - foto 16 - null 2 (null: borde-no-blanco 2)` — literal del kit.

### Humo puro rev.2 — INTEGRACIÓN REAL (bun, `/home/z/tmp/humo-d63a2-t2-rev2.ts`): **6/6 OK** + control negativo
- Ruta ejercida: `RegistroMasiva → filaLiviana → actaLivianaJson → JSON.stringify` — sin filas fabricadas. Detalle completo y control negativo (pre-fix → exit 1) en **§4.1**.

### Humo navegador (arnés COOP/COEP :3417, `crossOriginIsolated=true`, build estático del PR)
1. **SIM 8.2 VERDE**: captura sintética óptima → `[e14] pipeline SIMULACION/file total=11333ms … score=8.2 … sim=8.2 … nivel:AUTO` — chips del SIM intactos, autoenvío OK (`ACTAS (1)`). Los SIM no traen viaPdf/escaneo (prueba de lectura §3-T1): sin cambios esperados, sin cambios observados.
2. **PDF recto (2 páginas del lote F1)**: `extraerPdf` OK → 2 filas `viaPdf` → consola:
   - `[e14] origen=null senales=sin-exif+borde-no-blanco+ratio-fuera` (detector, como F1)
   - `[e14] origen pdf-render → escaneo (señales píxel preservadas: pdf-render+sin-exif+borde-no-blanco+ratio-fuera)` ← **T1 en vivo**
   - `[e14] preproceso skewGrados=0.2 deskewMs=null … aplicado=false decodeMs=13` ← **el bloque D63-B DESPIERTA** (antes jamás corría para PDFs); con |θ| < 0.3° no rota (deskew selectivo correcto)
   - precalor 64/27 ms nativo → consumido → `[e14] decode-maestro … ms=0 origen=nativo precalentada=true` (el precalentado SÍ se usa cuando no hay corrección)
   - P2: `origen=pagina-completa` (detectReintento=1) — **gate del marco D63-C activo por primera vez sobre escaneos** (riesgo 3 vigilado) → RECHAZADA INCOMPLETA 6.4; P1 (fixture recortada sup-izq) → REVISIÓN HUMANA 7.9 SUGERIDA con MESA_POR_KIT.
3. **PDF torcido (P1 rotada ~1.4°)**: **T0 completo en vivo** —
   - `[e14] preproceso skewGrados=1.6 deskewMs=92 … aplicado=true` ← el deskew detectó el ángulo REAL y corrigió
   - `[e14] precalor fila=… descartado fuente=corregido precalorMs=68` ← disciplina de memoria
   - `[e14] decode-maestro … ms=46 origen=nativo precalentada=false 920x2423 fuente=corregido` ← **el bridge consumió el master del CORREGIDO** (dimensiones del enderezado)
   - Desenlace de la P1 torcida: REVISIÓN HUMANA 7.9 (el fixture también está recortado sup-izq — el deskew endereza, no inventa contenido).

## 6. Riesgos vigilados (kit §3 — se vigilan, NO se arreglan)

1. **Gemelas falsas P1/P2 del mismo PDF** (hamming ≤ 6 entre páginas distintas): en el humo local las 2 páginas del PDF de prueba NO matchearon (una REVISIÓN HUMANA 7.9, otra RECHAZADA 6.4 — desenlaces distintos, sin marca DUPLICADA observada). En la corrida formal: cualquier match dedup entre páginas `-P1`/`-P2` del mismo base = sospecha → fila de atribución (zona gris dist-6, hallazgo transmision-P2 de F1). La tabla dedup del informe formal se citará con pares de nombres.
2. **Carrera cadenaDedup↔runner** (`store.ts:226`): sin reuse esperado cuando la fuente no esté PENDIENTE al instante del match — si reaparece, se documenta igual (patrón F1 rev.2).
3. **Primer despliegue real del gate del marco D63-C sobre escaneos**: YA VISIBLE en el humo (`origen=pagina-completa` en la P2 — con reintento de detección). Cambios de desenlace esperables y atribuibles en la Fase E; RED LINES: PDF → ENVIADA AUTO con cabecera sin resolver = BUG = STOP; RECHAZADA→ENVIADA exige triple verificación + vista del dueño; muerte de watchdog en PDFs = FAIL.

## 7. FASE D — corrida formal (del DUEÑO — el agente NO la ejecuta)

Requisitos declarados (pendientes del dueño):
1. **REVOCAR/ROTAR el `ghp_`** (deuda persistente del ciclo F1 — el token actual sigue operativo) y entregar el token nuevo one-off por el canal de siempre (file fuera del repo, jamás chat).
2. Cargar `rastreador-sesion-e14-v1.js` en la página (NO está en la máquina) — requisito de firma pre-vuelo.
3. Canal canónico `digielect14.vercel.app` (NUNCA preview) con el build del PR mergeado; **firma de build**: bundle sha256 del PR == desplegado + pre-vuelo con foto sintética `intento=1` + limpiar tracker.
4. Lote 20261019 COMPLETO (26: 8 escaneos-PDF + 16 fotos + 2 WhatsApp) en un solo pase, sin tocar nada + informe zip sin editar.
5. Si la firma del build no coincide → build viejo cacheado → STOP.

## 8. FASE E — gate de D63-A2 (armado, pendiente de la corrida)

Referencia: informe **200613** (F1, aceptado). A/B por nombre exacto, 26/26.
- **INVARIANCIA (18 no-PDF)**: 16 fotos + 2 WhatsApp — desenlace idéntico y Δscore ≤ 0.3; carve-out único `171446.jpg` (acepta ENVIADA o EN_REVISION_HUMANA — ruido 0.75<0.82 documentado en #62).
- **ESCANEOS (8 PDF)**: 8/8 `origen=escaneo` con señales `pdf-render+…`; trazas pre-proceso presentes (`skewGrados`/`aplicado`/`deskewMs` + corregidos en línea ESCANEOS + `preprocesoAplicado` en json); desenlace libre con atribución mecanística por fila (deskew enderezó X / gateMarco corrigió motivo / frontera de confianza OCR); RED LINES del §6.
- **Higiene**: tsc 0 · SIM 8.2 verde · contrato D57 (solo campos añadidos) · tabla dedup con pares de nombres · ORIGEN/ESCANEOS literales.

## 9. Diff resumido (6 archivos, src mínimo aditivo)

| Archivo | Cambio |
|---|---|
| `src/lib/e14/masiva/runner.ts` | T0 (`fuenteMaestro` + forma del maestro + disciplina de memoria + trazas `fuente=corregido`/`maestroFuente`) + T1 (override `viaPdf` tras P3) |
| `src/lib/e14/masiva/store.ts` | T1 (`paginasPdf` Set + temps con viaPdf + `agregarLote(imagenes, paginasPdf)` + `filaDeRegistro` restaura) |
| `src/lib/e14/masiva/tipos.ts` | T1 (`viaPdf` en `FilaMasiva` y `RegistroMasiva`, al borde/final del contrato) |
| `src/lib/e14/masiva/cola.ts` | D-1 (2.º parámetro opcional de `agregarLote` — estampado en el PRIMER write) |
| `src/lib/e14/informe.ts` | T2 (`preprocesoAplicado` en `FilaInforme` + `filaLiviana` + `actaLivianaJson` — SOLO añadir) |
| `src/lib/e14/types.ts` | D-2 (`maestroFuente` en `DiagnosticoActa`, aditivo al final) |

CONGELADOS respetados: `clasificador.ts`, `ocr/rapidocr.ts`, `orientacion.ts`, `marco-escaneo.ts`, `masiva/dedup.ts`, `scanner-core-bridge.ts` — sin un solo byte. Fuera de alcance no tocado: perfil OCR por origen, umbral hamming, carrera del dedup, §3.4, precalor sobre el corregido.

## 10. Pendientes

- **Del dueño (Fase D)**: revocación/rotación del `ghp_` + token nuevo one-off · rastreador en la página · merge del PR · deploy canónico + firma de build · lote 26 en un pase + informe zip sin editar.
- **Del agente (Fase E)**: cuando el dueño entregue el informe formal, análisis completo con tabla A/B 26 filas + atribución de escaneos + RED LINES (si saltan → STOP y reporte).
- **Del arquitecto**: revisión diff por diff ANTES del merge (este PR NO se mergea por el agente — NUNCA mergea salvo orden one-off explícita).
