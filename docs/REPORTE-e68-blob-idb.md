# REPORTE — e68-blob-idb-v1

**Kit:** plan del dueño «P5 — memoria» (precalor/decode degradándose por presión de memoria: precalorMs +195 %, decodeMs +307 %, procesoMs +53 % entre lotes — causa: base64 inflado en IDB + fotos retenidas sin necesidad).
**Base:** `main @ e041324` (e67 mergeado, PR #83) — EXACTA contra el remoto. **No se mergeará hasta que P6 esté en main y verificado (mandato del plan).**
**Rama:** `feat/e68-blob-idb-v1`.
**Gates finales:** tsc 0 · lint 0 · **7/7 suites SIN adendas**: historico-enviadas 49/49 · dedup-enviadas 42/42 · qr-identidad 68/68 · autoenvío 33/33 · escaneo-ya-recortado 24/24 · identidad-acta 32/32 · watchdog-relectura 34/34. `package.json`/`bun.lock` INTACTOS.

---

## 1. Resumen ejecutivo

Las fotos del acta MASIVA dormían en IndexedDB como **dataURLs base64** dentro del acta persistida (`acta.fotoOriginal`, `acta.fotoProcesada`): un JPEG de 12 MP infla +33 % al serializarse como string, y cada write/read de registro pagaba la conversión. Ahora:

1. **Las fotos duermen como Blobs NATIVOS** en el registro (`fotoOriginalBlob`/`fotoProcesadaBlob` — structured clone sin inflación, deserialización transparente).
2. **El acta persistida viaja SIN dataURLs** — `leerRegistro` las MATERIALIZA al vuelo (contrato `Acta` en RAM INTACTO: REVISIÓN, recorte manual, UI y ZIP consumen dataURLs como siempre).
3. **Cleanup post-envío (§3 del plan):** `ENVIADA`/`DUPLICADA` → `fotoOriginalBlob` FUERA (2.4–16.9 MB por acta); `fotoProcesadaBlob` y `thumb` SE CONSERVAN (REVISIÓN/UI — plan literal: «No borrar fotoProcesada»).
4. **Compatibilidad (§2.1):** registros previos a e68 (base64 dentro del acta) pasan tal cual al leer y se compactan en su PRÓXIMO write — sin reescritura en caliente.
5. **Observabilidad (§4):** log `[e14] memoria fila` (bytes reales por foto) en cada write con fotos + `totales.almacenamientoMB` (navigator.storage.estimate) en el informe.

## 2. Recon (M-e68-0 — nombres reales vs plan)

| El plan decía | La realidad en el repo | Consecuencia |
| --- | --- | --- |
| `fotoOriginal: base64 JPEG 2.4–16.9 MB` en IDB | El ARCHIVO ORIGINAL ya es **Blob** (`RegistroMasiva.archivo?: Blob` — «queda en IDB, no en RAM»). La inflación vive en **`acta.fotoOriginal`/`acta.fotoProcesada`** (dataURLs del acta persistida — el master decodificado y el warp+realce) | El hoist a Blob apunta a los campos del ACTA, no al archivo |
| Migrar a `fotoOriginal: blob` en el struct | El `Acta` es un contrato COMPARTIDO (flujo individual, UI, bridge, PDF/ZIP — dataURLs en todas partes); cambiar su tipo rompería el 100 % de los consumidores | **Transformación en la FRONTERA IDB** (`guardarRegistro`/`leerRegistro` en cola.ts): Blob en disco, dataURL en RAM — cero cambios en consumidores |
| `normalizeBlob(v)` al leer (base64 → Blob para el pipeline) | El pipeline NUNCA consume fotos desde IDB (el desenlace nace fresco del bridge; reutilizarResultado materializa y re-compacta) | La normalización real es la inversa: `dataUrlABlob` al escribir + `blobADataUrl` al leer (FileReader, determinista) |
| Cleanup en la transición a ENVIADA/DUPLICADA (runner) | TODOS los writes de desenlace pasan por `guardarRegistro` (runner 1238/1253, reutilizar 470, identidad 1067, sincronizarAlVolver store 974, zombis...) | Cleanup EN `guardarRegistro` (punto único) — cero riesgo para P2: el estado (`statusActa`/`dedup`) no se toca, solo la foto |
| `thumb: base64` a migrar | thumb = dataURL de ~20–40 KB → ahorro ≈ 13 KB/acta | **M-e68-2:** thumb NO se migra (no justifica tocar la bandeja/`FilaMasiva`/hacerThumb) |
| `almacenamientoMB` en informe | `generarInformeZip` ya es async; `usageDetails` no está en el lib.dom de este TS | Acceso tipado local (Record<string,number>) + `null` honesto si el navegador no lo expone |

**Punto único verificado:** los 3 mappers de `listarMapeados` son livianos (filaDeRegistro/filaLiviana/zombis — sin fotos); `informe.ts` lee los registros del ZIP UNO A LA VEZ vía `leerRegistro` (materializado → `dataUrlABytes` sigue funcionando).

## 3. Implementación

### 3.1 Tipos (`masiva/tipos.ts` — ADITIVOS AL FINAL, contrato D57)

- `RegistroMasiva.fotoOriginalBlob?: Blob` — la foto original como Blob (ausente = registro previo a e68 o cleanup post-envío).
- `RegistroMasiva.fotoProcesadaBlob?: Blob` — la procesada (SE CONSERVA siempre tras el envío).

### 3.2 Frontera IDB (`masiva/cola.ts`)

**`dataUrlABlob(dataUrl)`** — parseo `data:mime;base64,payload` → `atob` → `Uint8Array` → `Blob`. Fallo → null (el string SE QUEDA en el acta — jamás perder una foto por un parseo).

**`blobADataUrl(blob)`** — FileReader del navegador (determinista: mismos bytes + MIME ⇒ mismo dataURL — el hash de envío re-materializado es idéntico). Fallo → null (el campo queda ausente; los guards existentes degradan honesto).

**`compactarRegistro(registro)`** (en TODO `guardarRegistro`):
- String presente → convierte a Blob y SALE de la copia del acta.
- Sin string pero Blob previo → Blob se conserva (writes que re-persisten registros crudos del cursor).
- `ENVIADA`/`DUPLICADA` → `fotoOriginalBlob` fuera (cleanup §3). El ZIP jamás exportó carpetas de estos status (`ESTADOS_CARPETA = RECHAZADA/ADVERTENCIA/EN_REVISION_HUMANA`) — cero impacto en el informe.
- Log `[e14] memoria fila { registroId, estado, statusActa, fotoOriginalBytes, fotoProcesadaBytes, thumbBytes }`.
- Registros sin acta (PENDIENTE/ERROR de cola) → sin cambios. El INPUT jamás se muta (copias).

**`materializarFotos(registro)`** (en TODO `leerRegistro`):
- Reconstruye `acta.fotoOriginal`/`acta.fotoProcesada` desde los Blobs SOLO cuando el acta no trae el string.
- Registros previos a e68 (base64 dentro del acta) pasan tal cual (compat §2.1 — migración aparte si el dueño la pide).

### 3.3 Informe (`masiva/informe.ts`)

- `filaLiviana.pesoImagenes`: suma los bytes REALES de los Blobs (registros e68) además de dataURL×3/4 (registros previos) — sin doble conteo (los dos mundos no coexisten en el mismo campo).
- `totales.almacenamientoMB` (ADITIVO AL FINAL): `navigator.storage.estimate().usageDetails.indexedDB` en MB (1 decimal); `null` = no expuesto (jamás inventar). Base de comparación del criterio «IDB ~40 % menos».

## 4. Por qué esto recupera lo que P4 perdió (cadena causal del plan)

- El lote ya no serializa 80–150 MB de base64 a IDB (33 % menos por foto + cleanup de la original tras el envío) → menos presión de GC entre actas → el precalor (`maestroDeImagen`/`createImageBitmap`) y el decode compiten por menos memoria → `precalorMs`/`decodeMs` vuelven a su baseline.
- La original limpiada post-envío también reduce el coste de los re-put del runner (persistMs re-save, zombis) — cada write mueve menos bytes.

## 5. Criterios de aceptación (§Paso 5 del plan)

| # | Criterio | Estado |
| --- | --- | --- |
| 1 | Prueba estática: tsc 0 · lint 0 · QA completo | ✅ 0 · 0 · 7/7 (282 checks, SIN adendas) |
| 2 | Regresión funcional: lote con duplicados sigue marcando DUPLICADA (P2) e informe con matches multi-capa (P3) | ✅ cero toques en estado/dedup — solo la foto viaja distinta; suites de regresión verdes |
| 3 | Rendimiento: precalorMs ≤3 s · decodeMs ≤1.5 s · totalMs ≤30 s (monótonamente mejor que el baseline 37.5 s) | ⏳ medición del dueño en dispositivo (§6) |
| 4 | Espacio IDB ~40 % menos | ⏳ `totales.almacenamientoMB` antes/después con el MISMO lote |
| 5 | Compatibilidad: base con actas base64 viejas se procesa igual | ✅ por diseño (materializarFotos pasa strings; compactación en el próximo write) |

## 6. Cómo probar (procedimiento del dueño)

1. **Regresión:** lote de 7 con gemelas → azules DUPLICADA (e64v), informe multi-capa (e66) — todo como siempre.
2. **Observabilidad:** consola por cada write con fotos: `[e14] memoria fila ... fotoOriginalBytes=… fotoProcesadaBytes=…`; informe.json → `totales.almacenamientoMB` con valor real.
3. **Cleanup:** acta ENVIADA → registro sin `fotoOriginalBlob` (IDB) — la REVISIÓN muestra la PROCESADA; el recorte de una ENVIADA avisa honesto (guard existente `SIN FOTO ORIGINAL PARA RECORTAR`).
4. **Rendimiento:** MISMO lote de 7 antes/después → `precalorMs`/`decodeMs`/`totalMs` en consola + informe (criterio: monótonamente mejor que 37.5 s).
5. **Compatibilidad:** base vieja (base64) → abrir acta en REVISIÓN (foto visible), recortar, exportar ZIP (original.jpg/procesada.jpg presentes).

## 7. Desviaciones (M-e68-*)

- **M-e68-0 — nombres reales vs plan:** el archivo original ya era Blob (`registro.archivo`); la inflación vivía en `acta.fotoOriginal/fotoProcesada` (dataURLs dentro del acta persistida). La migración es una transformación en la FRONTERA IDB (cola.ts), no un cambio de tipo del struct — el contrato `Acta` (dataURLs en RAM) queda intacto para los ~20 archivos que lo consumen.
- **M-e68-1 — normalizeBlob invertido:** el plan normalizaba base64→Blob al leer para un pipeline consumidor de Blobs; aquí el pipeline jamás lee fotos de IDB → la normalización real es dataURL→Blob al ESCRIBIR (compactarRegistro) + Blob→dataURL al LEER (materializarFotos, FileReader determinista).
- **M-e68-2 — thumb NO se migra:** ~20–40 KB/acta (ahorro ≈ 13 KB) vs tocar `FilaMasiva`/bandeja/`hacerThumb`. Se reportan sus bytes en el log de memoria.
- **M-e68-3 — cleanup EN el punto de persistencia:** el plan lo pedía en la transición de estado (runner); hacerlo en `guardarRegistro` cubre TODOS los writers (desenlace, re-save persistMs, reutilización, identidad, sincronización, zombis) con UN punto y cero riesgo para P2.
- **M-e68-4 — usoDetails tipado local:** el lib.dom de este TS no trae `usageDetails` en `StorageEstimate` — acceso tipado local con null honesto.

## 8. Fuera de alcance (follow-ups)

- Migración en caliente de registros viejos (job aparte si el dueño la pide — hoy se compactan al siguiente write).
- Migración del thumb a Blob (M-e68-2).
- Cancelación real con `AbortController` (follow-up de e67).
