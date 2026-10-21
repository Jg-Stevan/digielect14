# REPORTE-e14-f1 — corrida mixta de evidencia (lote 26, informe 200613)

**Task ID F1** · ejecutado por Z.ai Code · informe de la corrida: `e14-informe-20261020-200613.zip` (generado `2026-10-21T01:06:13.740Z`) · baseline de referencia: corrida **162728** (zip pendiente de entrega — el detalle score-a-score queda marcado donde aplica).

**Veredicto del A/B (arquitecto + este análisis): 24 OK · 2 divergencias → NO-GO por la letra.** La decisión revert/aceptar es del **DUEÑO** — este reporte no ejecuta ni propone revert. Si el dueño acepta las divergencias documentadas, el siguiente es D63-A2 (lo escribe el arquitecto con la tabla §4). Si ordena revert, lo ejecuta el dueño.

---

## 1. Fingerprint post-D67 y desviación documentada

**Desviación (aceptada por el arquitecto):** la corrida se lanzó en preview URL (`https://digielect14-gnaxmw4do-j-d85a.vercel.app/`), **sin** `rastreador-sesion-e14-v1` (el archivo no está en la máquina) y **sin** firma de build pre-vuelo antes de procesar.

**Compensación — fingerprint POST-corrida verificado (esto agent-run):**

| Canal | bytes | sha256 |
|---|---|---|
| GH Pages (`jg-stevan.github.io/digielect14/`) | 1,422,380 | `7af5eb8472ac3776a7d828c7b9cf0bb275d287ef1b1d0b49936f3b6f5245fa00` |
| Vercel PROD (`digielect14.vercel.app/digielect14/`) | 1,422,380 | `7af5eb8472ac3776a7d828c7b9cf0bb275d287ef1b1d0b49936f3b6f5245fa00` |
| **Preview de la corrida** (`digielect14-gnaxmw4do-j-d85a.vercel.app`) | 1,422,380 | `7af5eb8472ac3776a7d828c7b9cf0bb275d287ef1b1d0b49936f3b6f5245fa00` |

- La firma D67 `intento=${t}` + traza `[e14] decode-maestro fila=${m.id} intento=${t} ms=${l} origen=${i.origenDecode} precalentada=${1===t&&!!p}` + campos D65 (`etapaAlMorir`, `dedupDistancia`) y D66 (`precalentada`, `origenDecode`, `precalorMs`) están presentes en el bundle de la preview.
- **El JSON del informe ES la firma de la corrida**: trae `decodeMs`/`origenDecode`/`precalentada`/`precalorMs` + línea «Decodificacion: … precalentadas 23 (precalor medio 1.3s)» + «Outliers procesoMs >6s: 5» (D66), `dedup:"v2"`+`dedupDistancia` (D65) y `colgadas.porEtapa` (watchdog D65) — campos que **solo existen en el bundle D67**. La corrida misma corrió sobre el binario verificado.
- Limitación honesta: la firma se verificó DESPUÉS de la corrida (no pre-vuelo). El idéntico sha256 en los 3 canales y los campos estructurales del JSON reducen el riesgo a residual, pero no lo eliminan.

**Entorno de la corrida:** Windows NT 10.0 · Chrome 155 · es-419 · **4 núcleos · 8 GB** · `crossOriginIsolated: true`.

## 2. Corrección del kit: el lote SIEMPRE fue 26

Kit decía 24 — imprecisión documental corregida por el arquitecto, confirmada por el informe: **26 archivos**, mismos en ambas corridas.

- **8 escaneos-PDF** (D60): `delegados el cairo-P1/P2.jpg` · `E14_XXX_X_88_355_003_08_000_X_XXX-P1/P2.jpg` · `E14_XXX_X_88_495_010_02_000_X_XXX-P1/P2.jpg` · `transmision el cairo-P1/P2.jpg`
- **16 fotos** 20261019 (8 heic + 8 jpg): `170755, 171125, 171446, 171454, 171500, 171506, 171512, 171518`
- **2 WhatsApp**: `IMG-20260621-WA0000.jpg` + `IMG-20260621-WA0000 (2).jpg`

## 3. Totales F1 (informe 200613)

- Filas: **LISTA 26/26 · ERROR 0** · colgadas 0 (`salvadasPorReintento 0`, watchdog D65 sin intervención).
- Actas: ENVIADA 17 · OPTIMA 0 · ADVERTENCIA 1 · RECHAZADA 7 · EN_REVISION_HUMANA 1.
- Tiempos medios: total 27,256 ms · proceso 4,117 ms · calidad 284 ms · **OCR 13,427 ms** (watch item §8) · espera en cola 352,048 ms (p50 291,039 — `totalMs` NO incluye la espera).
- Decodificación: nativo 23 / wasm 0 · **precalentadas 23** (precalor medio 1.3 s) · persistencia 41 ms · envío 0 ms · outliers procesoMs>6s: 5 (ninguno colgado).
- Detección (quadOrigen): worker 23 · sobel 3 · null 0. ORIGEN: foto 16 · null 10 (§6).

## 4. Tabla A/B — 26 filas, cruce por nombre

Lado 162728 reconstruido de: (a) A/B oficial del arquitecto (24 OK + 2 divergencias con veredictos confirmados); (b) worklog del repo (`docs/worklog.md`, rev.2 D63-A: «16/16 fotos ENVIADAS», línea ORIGEN 162728 `null: borde-no-blanco 8 · sin-bitmap 2`). El cruce fino score-a-score por fila queda **PENDIENTE del zip 162728** — marcado en cada fila como `(per A/B oficial)`.

| # | Archivo | F1 200613 | 162728 (baseline) | Δ | Marca |
|---|---|---|---|---|---|
| 1 | 20261019_170755.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 2 | 20261019_170755.jpg | ENVIADA 8.5 AUTO (dedup v2 d2 → reuse) | ENVIADA (per A/B oficial) | — | OK |
| 3 | 20261019_171125.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 4 | 20261019_171125.jpg | ENVIADA 8.5 AUTO (dedup v2 d0 → reuse) | ENVIADA (per A/B oficial) | — | OK |
| 5 | 20261019_171446.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 6 | **20261019_171446.jpg** | **EN_REVISION_HUMANA 8.5 SUGERIDA** | **ENVIADA 8.5** (arquitecto, confirmado) | **Δscore 0.0 · estado ≠** | **DIVERGENCIA 1** |
| 7 | 20261019_171454.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 8 | 20261019_171454.jpg | ENVIADA 10 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 9 | 20261019_171500.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 10 | 20261019_171500.jpg | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 11 | 20261019_171506.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 12 | 20261019_171506.jpg | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 13 | 20261019_171512.heic | ENVIADA 10 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 14 | 20261019_171512.jpg | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 15 | 20261019_171518.heic | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 16 | 20261019_171518.jpg | ENVIADA 8.5 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 17 | E14_…_355_003_08_000_X_XXX-P1.jpg | RECHAZADA BAJO 4.9 | RECHAZADA BAJO (per A/B oficial) | — | OK |
| 18 | E14_…_355_003_08_000_X_XXX-P2.jpg | RECHAZADA BAJO 4.9 | RECHAZADA BAJO (per A/B oficial) | — | OK |
| 19 | **E14_…_495_010_02_000_X_XXX-P1.jpg** | **RECHAZADA INCOMPLETA 6.4** | **RECHAZADA BAJO 4.9** (arquitecto, confirmado) | **Δscore +1.5 · motivo ≠, macro idéntico** | **DIVERGENCIA 2** |
| 20 | E14_…_495_010_02_000_X_XXX-P2.jpg | RECHAZADA BAJO 4.9 | RECHAZADA BAJO (per A/B oficial) | — | OK |
| 21 | delegados el cairo-P1.jpg | RECHAZADA INCOMPLETA 6.4 | RECHAZADA INCOMPLETA (per A/B oficial) | — | OK |
| 22 | delegados el cairo-P2.jpg | RECHAZADA BAJO 4.9 | RECHAZADA BAJO (per A/B oficial) | — | OK |
| 23 | IMG-20260621-WA0000 (2).jpg | ENVIADA 10 AUTO | ENVIADA (per A/B oficial) | — | OK |
| 24 | IMG-20260621-WA0000.jpg | ENVIADA 10 AUTO (dedup v2 d0 → reuse de la (2)) | ENVIADA (per A/B oficial) | — | OK |
| 25 | transmision el cairo-P1.jpg | RECHAZADA INCOMPLETA 6.4 | RECHAZADA INCOMPLETA (per A/B oficial) | — | OK |
| 26 | transmision el cairo-P2.jpg | ADVERTENCIA 7.9 AUTO (dedup v2 d6, **sin reuse**) | ADVERTENCIA (per A/B oficial) | — | OK |

Resumen: **24 OK · 2 divergencias** (filas 6 y 19) — coincide con el A/B oficial del arquitecto.

## 5. Las 2 divergencias (análisis con el código en main e8c98de)

### D1 — `20261019_171446.jpg`: ENVIADA → EN_REVISION_HUMANA (Δscore 0.0, 8.5 → 8.5)

- El nivel de clasificación **NO lo decide el score** (`clasificador.ts:928-934`): `AUTO` exige dep+mun+puesto resueltos + mesa válida leída + tipo leído; con algo resuelto pero no todo → `SUGERIDA`. Δscore 0.0 es consistente: el score mide legibilidad, no completitud de cabecera.
- La ficha F1 trae los parciales leídos (display-only, `clasificador.ts:949-952`): CONSULADOS/EGIPTO, zona 05, puesto 02, mesa 001, tipo SENADO — pero el OCR de cabecera salió con ruido (`CONSULADO:B&-CONSULADOS`, `PAIS:335-EGIPTO`, `ELECCIONPRESDENCIAY`). Sin resolución divipol completa → `SUGERIDA` → en MASIVA (fuente ARCHIVO, intento 1/4) el acta viaja `EN_REVISION_HUMANA` «repetir-primero» (`scanner-core-bridge.ts:2320-2323`).
- Contexto: su gemela heic (fila 5) sí fue AUTO en F1 y la misma jpg fue AUTO (ENVIADA) en 162728 — **ruido estocástico del OCR de cabecera en la frontera** (una corrida con suerte, otra sin ella). Comportamiento conservador CORRECTO del sistema (§D.4: prohibido asumir), no bug del D67: nada del D65/D66/D67 toca la lectura de cabecera.
- Causa raíz exacta pendiente (el informe MASIVA no persiste los avisos de clasificación — p. ej. `MESA_REGISTRO_DISCREPAN` — ni qué campo faltó): requeriría reproducir con consola o ampliar el informe. Para D63-A2.

### D2 — `E14_XXX_X_88_495_010_02_000_X_XXX-P1.jpg`: RECHAZADA → RECHAZADA, pero BAJO 4.9 → INCOMPLETA 6.4

- **Macro-veredicto idéntico (RECHAZADA)**; divergen motivo y score.
- F1: la ficha trae `recortada: true, recorteLado: "sup-izq"` — el recorte se detectó, gate de marco incompleto (`gateCompleta: false`), lectura MEDIA, OCR 201 chars → motivo `INCOMPLETA` («EL ACTA ESTÁ CORTADA EN EL ENCUADRE»). En 162728 la señal no apareció (sin recorte detectado y/o lectura DEBIL) → motivo `BAJO` («NO SE RECONOCE INFORMACIÓN»).
- Los scores de rechazo son **bandas fijas por motivo**, no medidas continuas: en F1 TODAS las INCOMPLETA = 6.4 y TODAS las BAJO = 4.9. El Δ+1.5 es el salto de banda, no una medición distinta del acta.
- Señal del quad/OCR no determinista entre corridas con la misma imagen (worker vs sobel ya varía entre gemelas en F1). Misma familia de variabilidad estocástica que D1, manifestada en el rechazo.

## 6. Los 10 null (origen)

Todas las 10 filas con `origen null` traen la **misma triple señal**: `sin-exif+borde-no-blanco+ratio-fuera` — las 8 páginas-PDF (sin EXIF de cámara; borde no parece de escáner; ratio fuera) + las 2 WhatsApp (sin EXIF — requemada por WhatsApp). Es la clasificación de fuente D63-A funcionando (origen null NO es error: caen al pipeline foto).

**Delta vs 162728** (línea ORIGEN citada en `docs/worklog.md`, rev.2 D63-A): en 162728 el conteo fue `null: borde-no-blanco 8 · sin-bitmap 2` — las 2 WhatsApp eran `sin-bitmap` (su decode **fallaba**); en F1 decodean nativo (gracias al master D66 + HEIC nativo primero) y su señal dominante pasó a `borde-no-blanco`. Los veredictos no cambiaron (ENVIADAS en ambas corridas). Mejora observable del D66, sin impacto en el A/B.

## 7. Dedup v2 — 4 matches, y el hallazgo transmision-P2 (hipótesis del arquitecto: VERIFICADA → REFUTADA)

Matches del informe: dedup v2 activo, 4 matches, distancia media 2.

1. `IMG-…WA0000 (2).jpg` (id -17) procesó completa (sin-match) y `IMG-…WA0000.jpg` (id -18) matcheó dist 0 → marcada DUPLICADA de la (2) → **reutilizó su desenlace** (proc/ocr idénticos 2,484/12,597 ms; decodeMs/precalorMs ausentes — no decodificó). El orden FIFO hace "original" a la subida PRIMERA, aunque su nombre sea la "(2)" — comportamiento por diseño.
2. `170755.heic` → `170755.jpg` dist 2 → jpg DUPLICADA, reutilizó (proc/ocr idénticos 6,133/25,026).
3. `171125.heic` → `171125.jpg` dist 0 → jpg DUPLICADA, reutilizó (proc/ocr idénticos 5,911/8,849).
4. `transmision-P1` (RECHAZADA) → `transmision-P2` dist 6 → **match sin marca ni reuse**: P2 procesó completa y salió con su propio desenlace (ADVERTENCIA 7.9).

**La hipótesis del arquitecto («no se reutiliza desenlace de fuente RECHAZADA») queda REFUTADA por el código:**

- `cadenaDedup` (`masiva/store.ts:202-226`) matchea por contenido dhash **sin mirar el status** del desenlace de la candidata (solo filtra filas `estado !== "ERROR"`).
- `reutilizarResultado` (`masiva/runner.ts:312-356`) copia el desenlace **sin condición de status** — una DUPLICADA de una RECHAZADA heredaría RECHAZADA/score/motivo tal cual.
- **La regla real:** la marca DUPLICADA exige que la fila esté `PENDIENTE` **en el instante del match** (`store.ts:226`). transmision-P2 ya había sido levantada por el runner cuando su hash llegó → la marca se salta, la fila procesa normal. La traza `dedup:"v2"`+`dedupDistancia` se escribe en el MISMO write del hash (T2.3) **aunque la marca no ocurra** — por eso el informe muestra el match sin reuse. Es una **carrera `cadenaDedup` ↔ runner**, no una regla de status.

**Riesgo documentado para D63-A2 (HIPÓTESIS, no propuesta):** con páginas consecutivas del mismo escaneo el dhash cae en zona gris — dist 6 es EXACTAMENTE el umbral (`DEDUP_HAMMING_MAX=6`, inclusivo). Si la carrera hubiera girado al revés, transmision-P2 (página DIFERENTE de P1, no gemela real) habría heredado RECHAZADA 6.4. Aquí jugó a favor del dueño; no es garantía estructural. Además el humo D67 de fixtures mostró gemela EXIF-rotada cayendo DUPLICADA hamming=6 — el mismo borde.

## 8. Watch item — OCR 13.4 s vs 7.1 s

`ocrMs` medio F1 = **13,427 ms** vs ~7.1 s en 162728 (+89%). Outliers: 22.3–25.0 s (`355_003-P2`, `170755` heic+jpg, `171454.heic`).

- **No es regresión de código**: el motor OCR no cambió D65→D67 (los kits tocaron dedup/watchdog/decode-precalor, no OCR).
- HIPÓTESIS principal (verificar con el zip): **contención de CPU** — máquina del dueño con 4 núcleos, lote de 26 vs 16, cola escalonada (espera media en cola 352 s ⇒ el lote convivió con la corrida ~10 min). Las gemelas reutilizadas no aportan OCR propio (el informe copia el valor).
- A/B de `ocrMs` por fila pendiente del zip 162728 (subconjunto común: 16 fotos).

## 9. Salud del stack

| Señal | Valor | Lectura |
|---|---|---|
| crossOriginIsolated | true | COOP/COEP vivos en preview |
| Decode | nativo 23 / wasm 0 | HEIC nativo primero (D66) funcionando |
| Precalentadas | 23 (precalor medio 1.3 s) | precalor D66 activo en cola real |
| Persistencia / envío | 41 ms / 0 ms | IDB sano |
| ERROR de fila | 0 | lote íntegro |
| Colgadas (watchdog D65) | 0 · salvadas 0 | sin intervención |
| quadOrigen | worker 23 / sobel 3 / null 0 | detector vivo, sin nulls |
| dedup v2 | 4 matches, dist media 2 | gemelas heic/jpg cerradas (objetivo D65) |
| Outliers procesoMs>6s | 5 | OCR pesado, ninguno colgado |

## 10. Pendientes

- **Del dueño:** (1) zip `e14-informe-20261020-162728.zip` → cerrar el A/B score-a-score 26/26 y el watch OCR por fila; (2) decisión sobre las 2 divergencias (aceptar documentado → D63-A2 lo escribe el arquitecto con la tabla §4; revert → lo ejecuta el dueño); (3) REVOCAR/ROTAR el `ghp_` expuesto en chat (deuda persistente).
- **Del agente (siguiente kit):** nada en vuelo. `rastreador-sesion-e14-v1.js` sigue sin estar en la máquina — para futuras corridas con firma pre-vuelo.
