# REPORTE — e69-blob-jornada-v1

**Kit:** P5B — extender P5 (e68) al flujo INDIVIDUAL: el slot `e14-jornada-v1/acta` persistía el acta en REVISIÓN con `fotoOriginal` como String base64 (~2.6 MB verificado en runtime con el monitor de IDB del dueño — +33 % sobre los bytes reales). Aplicar la misma transformación (compactar/materializar/cleanup) al writer del flujo individual.
**Base:** `main @ c957faf` (e68 mergeado, PR #84) — EXACTA contra el remoto.
**Rama:** `feat/e69-blob-jornada-v1`.
**Gates finales:** tsc 0 · lint 0 · **7/7 suites SIN adendas**: historico-enviadas 49/49 · dedup-enviadas 42/42 · qr-identidad 68/68 · autoenvío 33/33 · escaneo-ya-recortado 24/24 · identidad-acta 32/32 · watchdog-relectura 34/34. `package.json`/`bun.lock` INTACTOS.

---

## 1. Resumen ejecutivo

El flujo INDIVIDUAL persistía el slot del acta en REVISIÓN con las fotos como dataURLs base64. Ahora (mismo patrón e68):

1. **Las fotos duermen como Blobs NATIVOS** — el registro del slot es un envoltorio `{ acta (sin dataURLs), fotoOriginalBlob?, fotoProcesadaBlob? }`; el structured clone ya no infla +33 % ni serializa ~7-14 MB de texto base64 por write.
2. **El contrato `Acta` en RAM queda INTACTO** — `leerActaEnRevision` MATERIALIZA las dataURLs al vuelo (FileReader determinista); los consumidores (REVISIÓN, recorte manual, QuadEditor) no cambian.
3. **Cleanup de desenlace (§3):** `ENVIADA` (y `DUPLICADA`, defensiva) → `fotoOriginal` FUERA (blob Y string — libera ~2.6 MB/acta); `fotoProcesada` SE CONSERVA (REVISIÓN muestra la enviada).
4. **Compat pre-e69:** registros con el Acta CRUDO (Strings base64) se detectan por ausencia de la llave `acta` y pasan TAL CUAL al leer; se compactan en su próximo write (suscriptor del store re-persiste por referencia — auto-migración en el arranque si el slot se restaura).
5. **Observabilidad (§4):** log `[e14] memoria acta` con bytes REALES (`Blob.size` — el monitor del dueño deja de reportar len×4/3). `almacenamientoMB` del informe (e68) ya es origin-wide (`navigator.storage.estimate`) — refleja este slot sin tocar informe.ts.

## 2. Recon (M-e69-0 — nombres reales vs plan)

| El plan decía | La realidad en el repo | Consecuencia |
| --- | --- | --- |
| Buscar en `src/lib/e14/jornada/` (carpeta) | Es UN archivo: **`src/lib/e14/jornada.ts`** | Sin desviación estructural — todo el patrón vive ahí |
| `put` en `e14-jornada-v1/acta` con dataURLs | `guardarActaEnRevision` (L136) — put del Acta crudo bajo la key `en-revision` | Compactar DENTRO de esta función (punto único) |
| `get/getAll` correspondiente | `leerActaEnRevision` (L151) — get único (el slot guarda UN acta) | Materializar DENTRO de esta función |
| Write con cleanup en «guardarActa o similar» | El write real lo dispara el **suscriptor zustand** (`store.ts` L1446-1455) por IDENTIDAD de referencia: `s.actaActual !== ultimaActaPersistida` → `guardarActaEnRevision(persistible)` | La transformación en `guardarActaEnRevision` cubre TODOS los writers (captura→análisis→recorte→envío→rescate post-timeout de e67 pasa por `set({actaActual})` → suscriptor) — cero toques al store |
| Cleanup en ENVIADA/DUPLICADA | DUPLICADA es concepto del runner MASIVA (reutilizarResultado) y el suscriptor ya excluye `masivaOrigen` (guard L1448-1452) — **DUPLICADA es inalcanzable en este slot hoy** | Se deja en el guard por simetría con el plan (defensiva); el cleanup real dispara con ENVIADA |
| `normalizeBlob` al leer (compat) | El flujo individual jamás lee fotos de IDB para el pipeline (el desenlace nace fresco del bridge); el slot solo se restaura tras crash/recarga | Misma inversión que e68 (M-e68-1): `dataUrlABlob` al ESCRIBIR + `blobADataUrl` al LEER |
| Helpers `compactarRegistro/materializarFotos/dataUrlABlob` de masiva | Viven PRIVADOS en `masiva/cola.ts`; los QA del repo escanean literales de código ahí (precedentes M-e65b-9/M-e66-1) | **Helpers duplicados** en jornada.ts con cross-reference — `cola.ts` queda byte a byte (mandato: «No tocar masiva») |

**Verificaciones de seguridad del recon:** ningún script `scripts/qa-*.ts` escanea `jornada.ts` (0 matches — cero riesgo de adenda); el único lector del slot es `arrancarJornada` (store L1356) y los únicos writers son el suscriptor (L1454) y `reiniciarJornada` (L1404, `null` intacto); `archivadas`/`historial` son LIVIANOS (sin fotos — no hay duplicación de memoria al archivar).

## 3. Implementación (`jornada.ts` — un solo archivo)

### 3.1 Envoltorio del slot (`SlotActa`)

- `{ acta: Acta; fotoOriginalBlob?: Blob; fotoProcesadaBlob?: Blob }` — el acta DUERME sin dataURLs; las fotos al lado como Blobs nativos (espejo del shape `RegistroMasiva` de e68).
- Detección de formato: `esSlotActa` (llave `acta` presente y objeto — el `Acta` jamás tiene un campo `acta`).

### 3.2 Write — `compactarActa` (en TODO put)

- String presente → `dataUrlABlob` (atob → Uint8Array → Blob con MIME) y SALE de la copia del acta; fallo de parseo → el string SE QUEDA (jamás perder una foto).
- **Cleanup §3:** `desenlaceSinOriginal(acta)` (ENVIADA/DUPLICADA) → `fotoOriginal` FUERA — blob Y string («fotoOriginal = null» literal del plan; **M-e69-1**: masiva solo baja el Blob y conservaría un string residual si el parseo fallara; aquí el cleanup es el único punto donde soltar el string es seguro y explícito). `fotoProcesada` SE CONSERVA.
- El INPUT jamás se muta (copias — el acta en RAM conserva sus dataURLs para los consumidores).
- Log `[e14] memoria acta { statusActa, fuente, fotoOriginalBytes, fotoProcesadaBytes, originalLiberada }` — solo con foto presente (bytes reales, criterio «no ×4/3» del monitor).

### 3.3 Read — `materializarActa` (en TODO get)

- Reconstruye `acta.fotoOriginal`/`acta.fotoProcesada` desde los Blobs SOLO cuando el acta no trae el string (FileReader determinista: mismos bytes + MIME ⇒ mismo dataURL).
- Fallo del FileReader → el campo queda ausente (guards existentes degradan honesto — jamás inventar).
- Registro pre-e69 (Acta crudo con Strings) → pasa TAL CUAL (compat §2.1; compactación en su próximo write — el suscriptor re-persiste el acta restaurada en el arranque).

### 3.4 Sin cambios

- `guardarActaEnRevision(null)` sigue putteando `null` (byte a byte — reiniciarJornada intacto).
- `DB_VERSION`/stores intactos (el cambio es de FORMA del valor, no de esquema).
- `almacenamientoMB` del informe (e68) — ya es origin-wide; no se toca.
- P4 (scanner-core-bridge orientation), P6 (watchdog/rescate), MASIVA (cola.ts) — byte a byte.

## 4. Criterios de aceptación

| # | Criterio | Estado |
| --- | --- | --- |
| 1 | Tras importar 1 acta individual, IDB `acta.fotoOriginal` es Blob (no String) | ✅ por diseño — el slot es `{ acta sin dataURLs, fotoOriginalBlob: Blob }` (verificación runtime del dueño §6) |
| 2 | `fotoOriginalLen` del monitor = tamaño binario real (no ×4/3) | ✅ `Blob.size` en IDB + log `[e14] memoria acta` con bytes reales |
| 3 | `almacenamientoMB` del informe ↓ ~40 % vs baseline | ⏳ medición del dueño antes/después con la MISMA acta (métrica origin-wide ya existente de e68) |
| 4 | Flujo individual sin regresiones (P6 intacto) | ✅ rescate e67 pasa por `analisisCompletado` → `set({actaActual})` → suscriptor → slot compactado; tsc/lint/7 suites verdes |
| 5 | `qa-*` sin regresiones | ✅ 7/7 suites SIN adendas (jornada.ts no era escaneado por ningún QA) |
| 6 | Compat: registros viejos con String base64 pasan tal cual y se compactan en su próximo write | ✅ `esSlotActa` → passthrough; el suscriptor re-persiste la acta restaurada → auto-migración |

## 5. Cómo probar (procedimiento del dueño)

1. **Blob en IDB:** importar 1 acta (CÁMARA o ARCHIVO) → DevTools › Application › IndexedDB › `e14-jornada-v1` › `acta` › `en-revision` → el registro tiene `acta.fotoOriginal` AUSENTE y `fotoOriginalBlob: Blob` (~2.6 MB).
2. **Bytes reales:** consola por cada write con fotos: `[e14] memoria acta ... fotoOriginalBytes=2650000` (≈ el tamaño del JPEG, no len×4/3).
3. **Restauración:** recargar la página con el acta a mitad de REVISIÓN → la REVISIÓN se restaura con foto visible (materializada al vuelo), recorte y envío manual intactos.
4. **Cleanup:** enviar la acta (ENVIADA) → próximo write del slot → `originalLiberada: true` en consola y el registro pierde la original (la REVISIÓN sigue mostrando la PROCESADA).
5. **Compat:** con una base vieja (slot pre-e69 con String) → recargar: la acta se restaura con foto (string tal cual) y su próximo write la compacta a Blob.
6. **almacenamientoMB:** generar informe → `totales.almacenamientoMB` antes/después con la misma acta (~40 % menos esperado en el slot).

## 6. Desviaciones (M-e69-*)

- **M-e69-0 — nombres reales vs plan:** `src/lib/e14/jornada/` es un ARCHIVO (`jornada.ts`), no una carpeta; el write real lo dispara el suscriptor zustand del store (por identidad de referencia), no una llamada directa — la transformación vive en `guardarActaEnRevision`/`leerActaEnRevision` (puntos únicos que cubren todos los writers/lectores).
- **M-e69-1 — cleanup baja blob Y string:** el plan pedía «fotoOriginal = null»; masiva (e68) solo baja el Blob (un string residual de parseo fallido sobreviviría). Aquí el string también sale en el cleanup — punto único donde soltarlo es seguro y explícito.
- **M-e69-2 — helpers duplicados, no extraídos:** extraer `dataUrlABlob`/`blobADataUrl` a un módulo compartido tocaría `cola.ts` (los QA escanean literales ahí — precedentes M-e65b-9/M-e66-1) y el mandato dice «No tocar masiva». ~30 líneas duplicadas con cross-reference; patrón byte-igual.
- **M-e69-3 — DUPLICADA defensiva:** inalcanzable hoy en este slot (concepto masiva + guard `!s.masivaOrigen`); incluida por simetría con el plan §3 — un status futuro no rompería el cleanup.
- **M-e69-4 — envoltorio en vez de campos en el Acta:** el plan sugería compactar el acta en el put; el Blobs viven en un envoltorio `SlotActa` (espejo de `RegistroMasiva` e68) para NO añadir campos Blob al contrato `Acta` compartido (D57: aditivos solo al final y con mandato).

## 7. Fuera de alcance (follow-ups)

- Migración en caliente del slot viejo (hoy: auto-migración en el próximo write / arranque).
- Cleanup equivalente para el thumb masiva (M-e68-2, ya declarado).
- Cancelación real con `AbortController` (follow-up de e67, intacto).
