# REPORTE — e14-info-acta-filas-v1 (D59)

**Fecha:** 2026-10-20 · **Agente:** AGENTE-1 (Z.ai Code) · **Prioridad:** P1
**Rama:** `feat/e14-info-acta-filas-v1` (base `origin/main` @ `f82faff` — la mínima exigida por el kit)
**PR:** DRAFT hacia `main` (el agente NUNCA mergea)
**Diff:** 4 archivos, +124/−3 — `git diff --name-only main` = EXACTAMENTE las 4 zonas del kit §1

---

## 0. Resumen

La fila MASIVA muestra, ENCIMA del nombre de archivo, la **info reconocida del acta**
(idea del dueño, mockup Stitch corregido):

```
88 CONSULADOS - EL CAIRO - CONSULADO - TRANSMISION - MESA 001 - PÁG 1 DE 2
acta-mesa001.jpg
[ENVIADA AUTO]   8.5  1/2  [AUTO]  [ABRIR] [QUITAR]
```

**Cero pipeline nuevo**: `tituloDeActa()` compone el título con campos que YA
existen en `Acta.clasificacion` (`ClasificacionE14`) + fallbacks del propio acta.
La fila sin datos (null) queda **EXACTAMENTE como hoy** — cero regresión. Las filas
ERROR ganan el botón **REINTENTAR** del mockup (re-encolar, NO auto-procesa — D45).

## 1. Qué cambió (T1–T4)

### T1 — `src/lib/e14/masiva/tipos.ts` (+37)
- `infoTitulo?: string | null` en **FilaMasiva** Y en **RegistroMasiva** (persiste —
  misma desviación aditiva documentada de thumb).
- Helper **`tituloDeActa(acta)`** junto a `paginaDeActa` (mismo archivo, mismo
  patrón, cero imports nuevos): `departamento {codigo,nombre}` →
  `puesto.nombre` (fallback `acta.titulo`) → `tipo` → `MESA nnn` (zero-pad 3,
  fallback `ubicacion.mesa` numérica) → `PÁG n DE m` (fallback `acta.pagina`).
  `string|null`: **null = sin datos → la fila solo pinta el nombre** (honestidad,
  jamás inventar). Verificado contra los tipos reales: `clasificacion` es
  opcional (types.ts L206), `departamento/puesto/mesa/tipo/pagina` nullables
  (clasificador.ts L31-53) — el helper es total (nunca lanza).

### T2 — `src/lib/e14/masiva/runner.ts` (+19/−2)
Los 3 desenlaces alimentan el título:
1. **Dedup `reutilizarResultado`**: `registroListo` y `marcarFila` reciben
   `infoTitulo: tituloDeActa(actaCopia)` — la gemela ES el mismo acta → mismo
   título (honesto).
2. **Pipeline completo**: `registroListo` y `marcarFila` con
   `infoTitulo: tituloDeActa(actaFinal)`.
3. **Catch ERROR**: `marcarFila(..., { infoTitulo: null, ... })` — la fila ERROR
   **nunca** muestra título viejo.

### T3 — `src/lib/e14/masiva/store.ts` (+36)
- Mapping de `filaDeRegistro` (cargarFilas): `infoTitulo: r.infoTitulo ?? null`
  (junto a `thumb: r.thumb`) — **el título sobrevive la recarga** (IDB).
- Interfaz + implementación de **`reintentar(id)`** (junto a `procesarIgual`):
  - Guard: fila existe, `estado === "ERROR"`, no corriendo en ese id.
  - `leerRegistro(id)`: sin `registro.archivo` (File) → la fila **SIGUE en
    ERROR** con `error: "SIN_ARCHIVO_ORIGINAL"` (honesto — registros viejos o
    filas de formato) y return.
  - `patchFila(id, { estado: "PENDIENTE", error: null })` +
    `guardarRegistro({ ...registro, estado: "PENDIENTE", error: undefined })`.
  - **NO auto-procesa** (misma doctrina D45: extraer/re-encolar NO procesa; el
    dueño pulsa PROCESAR). Es la acción «REINTENTAR» del mockup.

### T4 — `src/components/e14/screens/MasivaView.tsx` (+32/−1)
- Línea de título ENCIMA del nombre, kit-literal, paleta del repo:
  `font-mono text-[11px] font-bold uppercase tracking-wider text-brand-green
  truncate` + `title={f.infoTitulo}` (tooltip con el texto completo).
- Nombre de archivo: `text-red-300` si `estado === "ERROR"`, `text-white` resto
  (fila sin infoTitulo NO-ERROR queda byte-idéntica a hoy).
- Botón **REINTENTAR** en filas ERROR (antes de QUITAR):
  `border-red-500/40 text-red-300`, `onClick={() => void reintentar(f.id)}` +
  `aria-label="Reintentar <nombre>: re-encolar para procesar"`, min-h 44px.
- **NO tocado**: filtros, contadores, barra de progreso, dropzone, `accept`,
  HEIC aviso, píldoras, `agregarFiles` (zona del kit D60 en paralelo).

## 2. Errores del mockup NO replicados (decisiones del kit, verificadas)

1. **Columna % (100%/50%/0%)** — no existe dato real por fila → OMITIDA; la fila
   muestra `pagina` "1/2" + chip `nivel` (el dato honesto).
2. **«PROCESANDO 15/15» + «COLA QUIETA»** simultáneos — contradictorio; la barra
   real ya es coherente. NO se tocó.
3. **«ERROR CARGA» con score 0.0** — la fila ERROR no tiene score; muestra el
   MOTIVO (ya existía) y ahora gana REINTENTAR. Sin score inventado.
4. **«335 EGIPTO» pintado siempre** — solo se pinta si hay datos
   (`infoTitulo != null`); sin clasificación ni título → sin línea (null).
5. **Thumb gris** — la app real pinta thumbnails reales. NO se tocó.
6. **VACIAR sin confirmación** — la real tiene confirmación de 2 toques. NO se tocó.

## 3. Validación (T5) — todo verde antes del PR

**Gates** (en la rama, sandbox 2 cores):
- `bunx tsc --noEmit` → **0 errores**.
- `bun run lint` (eslint .) → **0 errores**.
- `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` → **OK**
  (compilado en 5.9 s, 3/3 páginas estáticas).

**Navegador** (agent-browser sobre `bun run dev` :3001; lote REAL — las fotos de
la jornada del dueño ya presentes en el sandbox: mesa001/mesa002/sana + gemela
byte-idéntica + casos límite fabricados):

| # | Caso | Resultado |
|---|---|---|
| 1 | Acta real CON clasificación (mesa001 → 8.5 AUTO ENVIADA) | Título verde completo `88 CONSULADOS - EL CAIRO - CONSULADO - TRANSMISION - MESA 001 - PÁG 1 DE 2`, truncate ellipsis + `title` attr verificados por computed style |
| 2 | DUPLICADAS (gemela byte-idéntica hamming=0; sana.jpg hamming=1) | `reutilizarResultado` copió el título: AMBAS muestran el MISMO título que su original |
| 3 | Acta sin clasificación (RECHAZADA 2.4/4.8 BAJO) | Título por fallback del acta (`ROMA - CONSULADO - MESA 001 - PÁG 1 DE 2` — véase §4-B); **nunca string vacío** |
| 4 | Fila ERROR con archivo (`basura.jpg`, bytes aleatorios) | Nombre rojizo `text-red-300` + REINTENTAR → **PENDIENTE** (error fuera) → PROCESAR la procesó → ERROR determinista de nuevo (ciclo completo) |
| 5 | Fila ERROR sin archivo (`notas.txt` → FORMATO_NO_SOPORTADO) | REINTENTAR → **SIGUE en ERROR con `SIN_ARCHIVO_ORIGINAL`** (honesto; al recargar repinta el motivo persistido original) |
| 6 | Recarga de la página | **El título SOBREVIVE** (IDB → `filaDeRegistro`): las 7 filas repintaron su título/motivo |
| 7 | Desktop 1280×800 + móvil 390×844 | Sin overflow horizontal (`scrollWidth ≤ 390`), título en 1 línea truncada (17 px), botones ≥44 px |
| 8 | Consola | **0 errores de página** en todo el flujo (trazas `[e14]` normales: dedup marcada hamming=0/1, orientacion cortes=sana/vacio, pipeline, ocr-escalonado) |

**Pendiente del dueño (no replicable en sandbox):** el lote de las 13 actas del
informe 15:04 — las fotos reales NUNCA salen del equipo del dueño (tools/assets
.gitignore). Con la jornada disponible (mesa001/mesa002) las filas ENVIADAS ya
pintaron título con datos AUTO reales (caso 1).

## 4. Hallazgos colaterales (observaciones honestas — FUERA del kit, no se tocó código)

- **A) Dedup falso-positivo MANIFESTADO en fotos reales**: `sana.jpg` (foto real
  de la misma mesa/página que mesa001, jornada del dueño) fue marcada DUPLICADA
  con **hamming=1** — el riesgo documentado en D58 (B7: `minHammingEntreActas
  4 < 6`, layouts E-14 idénticos) OCURRIÓ en carne propia. Para D59 no afecta
  (misma acta → mismo título = honesto; y PROCESAR IGUAL fuerza el reproceso),
  pero refuerza la decisión pendiente D61 (hash vs ORDEN).
- **B) El fallback del helper refleja datos de PLANTILLA cuando no hay
  clasificación**: `bridge L2423 → titulo: titUbi?.titulo ?? ACTA_MOCK.titulo`
  — actas ARCHIVO sin clasificación llevan `titulo="ROMA - CONSULADO"`,
  `ubicacion.mesa="001"`, `pagina={1,2}` del mock. El helper (kit-literal) los
  usa como fallback → filas RECHAZADA sin-clasificar pintan
  `ROMA - CONSULADO - MESA 001 - PÁG 1 DE 2`. **No es una fuga nueva**: la
  columna PÁG ya pintaba «1/2» con el MISMO dato desde actas-vivas-paginas-v1.
  El helper es fiel al acta; si el dueño quiere títulos vacíos ahí, el ajuste es
  del BRIDGE (nular el fallback ACTA_MOCK para ARCHIVO sin clasificación) — D60+,
  jamás en este kit (zona ajena).
- **C) El catch ERROR del runner no persiste el motivo** (`guardarRegistro({
  ...registro, estado: "ERROR" })` sin `error`): tras recarga la fila ERROR con
  archivo muestra «ERROR DE COLA». Preexistente (auditorías anteriores no lo
  tocaron), fuera de las zonas del kit. Notado para el dueño.
- **D) Un JPEG truncado (primeros 2000 bytes) SÍ decodifica** parcialmente en
  Chromium (va al pipeline y sale RECHAZADA honesta); un archivo de bytes
  aleatorios con extensión .jpg sí cae a ERROR de decode. Util para pruebas.

## 5. Continuidad

- El agente NO mergea: PR DRAFT esperando revisión del dueño.
- Zonas del kit D60 (en paralelo) respetadas al 100%: `agregarFiles`, `accept`,
  hints del dropzone, `archivos.ts` — 0 diff.
- Tokens usados: ghp_ del dueño (la misma credencial de siempre — **seguirá
  expuesta hasta que la REVOCQUE**; 6.ª consecutiva) y el vcp_ de Vercel. Al
  cerrar esta tarea, borrar `/home/z/tmp/.gh_tok` y `/home/z/tmp/.vcp_tok` es
  deber del dueño (el agente no los persiste en el repo).
