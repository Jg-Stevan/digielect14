# REPORTE e63m — CAPA 0 IDENTIDAD-QR PRE-OCR (v1)

**Repo:** Jg-Stevan/digielect14 · **Rama:** `feat/e63m-capa0-qr-identidad-v1` · **Base:** `main @ c0e7707` (#72 banco QR mergeado)
**Kit:** `INSTRUCCIONES-e63m-capa0-qr-identidad-v1.md` · **GO medido:** FASE 0 del dueño — 88.2% decode, 0 colisiones, re-encodes dhash 8-33 agrupan por payload EXACTO.

---

## §1 — Qué se construyó (§-por-§ del kit)

### §1.1 Módulo `identidad-qr` (nuevo, puro, testeable) — `src/lib/e14/masiva/identidad-qr.ts`

- **jsQR vendido:** `src/lib/e14/masiva/vendor/jsQR.js` — copia **BYTE-IDÉNTICA** (verificada `cmp` + sha256 `bc40c8a15196236b…`) del vendido en #72 (`tools/bench-qr-identidad/jsQR.js`, jsQR@1.4.0 UMD webpack, MIT). `package.json` y `bun.lock` INTOCADOS-CERO (jsQR NO entra por npm). BarcodeDetector nativo: **ausente** (QA lo verifica — determinismo).
- **`vendor/jsQR.d.ts` (nuevo):** solo los tipos que el bundler necesita para `import jsQR from "./vendor/jsQR.js"` (el UMD hace `module.exports = factory()["default"]`). El `.js` no se toca.
- **API:** `decodificarQrDeCapture(dataUrl): Promise<{ payload: string } | null>` — render del capture a canvas de trabajo lado largo **≤ 2048** (receta EXACTA del `canvasDeTrabajo` del banco) → **UN** `getImageData` → ladder sobre píxeles.
- **Ladder EXACTO del banco:** A (completa) → B (0-45% × 0-25%) → C (8-38% × 5-20%) → C×1.5, `{inversionAttempts: "attemptBoth"}`, **early-exit** al primer payload. Fracciones/rounding byte-idénticos a `bench.html INTENTOS`.
- **Tier rotación SOLO si el base falla:** A@90° → A@180° → A@270° (evidencia §0.3 del kit — durazno1 solo decodifica con A@90°; el QR cambia de esquina al rotar, la banda fina sobre el rotado no sirve). Rotación = permutación EXACTA de píxeles (equivalente al `canvasRotado` del banco para múltiplos de 90°, sin interpolación).
- **JAMÁS throw:** el wrapper entero va en try/catch → `null` (fallback limpio). QA: la imagen sin QR devuelve null y el proceso sigue vivo.
- **Constantes NUEVAS (módulo, separadas de las existentes):** `QR_LADO_LARGO = 2048` · `QR_INTENTOS_BASE = ["A","B","C","C1.5"]` · `QR_ROTACIONES = [90,180,270]` · `QR_ESPERA_INTERVALO_MS = 1_500` · `QR_ESPERA_INTENTOS = 10` (techo efectivo 15 s — SOLO el caso «original en vuelo»).
- **Núcleo puro exportado** (`ladderQrDePixeles`, `esperarDesenlaceQr`, `qrCorto`): testeable headless (bun) — el QA lo ejercita con matrices QR reales (ver §2).

**Presupuesto honesto (kit §1.1):** típico 0.7-2.2 s/archivo (capture + ladder); peor caso (ilegible) ~2-4 s. Medición del QA headless: 6 decodes de ladder en ~1.3 s (matrices 296×296). En campo el costo lo manda `fileToCaptureDataUrl` (215 ms foto 12MP – ~674 ms HEIC full — §0.5 del kit).

### §1.2 Wiring en la cola masiva (pre-OCR) — `runner.ts` (punto ÚNICO)

Ancla por SÍMBOLO (las líneas del kit corrieron tras #68..#72): el bloque vive en `procesarUno`, **después** de `archivoIntento` (capture/datos listos) y **antes** del bucle del watchdog (det/cls/rec y dhash visual río abajo). El QA verifica la posición por anclas.

1. Capture de la entrada vía `fileToCaptureDataUrl(archivo)` (la MISMA vía de producción que midió el banco) → `decodificarQrDeCapture`. El costo del capture se paga UNA vez por fila pipeline (las DUPLICADAS visuales salen ANTES — su reutilización de capa 1 no paga ni capture ni OCR).
2. `payload === null` → traza `capa0-qr sin-payload` y **pipeline normal intacto** (dhash + OCR + capa 2 e63k byte-idénticos).
3. `payload` nuevo → `registrarQrPayload` (Map del lote en `store.ts`, junto a `cadenaDedup`) → **sigue el pipeline normal** (el ORIGINAL paga el OCR). Traza `capa0-qr original <p8…>`.
4. `payload` YA VISTO → por el estado del original (resuelto contra `filas`):
   - **Desenlace final (LISTA/DUPLICADA)** → `reutilizarResultado` con la maquinaria EXACTA (fila viaja como DUPLICADA con `dupOf`, desenlace clonado, sin doble envío, comparten hash). Token aditivo **`dedup=qr`** estampado POST-write (honesto: si el fallback salta, la traza nunca mintió). **OCR jamás se paga.** Traza `capa0-qr reutiliza <p8…>`.
   - **En vuelo (PROCESANDO)** → **APLAZADA `capa0=qr`**: `esperarDesenlaceQr` — re-chequeo SOLO-LECTURA del estado cada `QR_ESPERA_INTERVALO_MS`, tope `QR_ESPERA_INTENTOS` (15 s), sin timers globales, `DEDUP_CINTA_CIERTA=2` intacto. Aterriza LISTA/DUPLICADA → reutiliza (ídem arriba). Techo vencido → **reproceso completo honesto**. Trazas `capa0-qr aplazada` / `capa0-qr techo-vencido reprocesa-completo`.
   - **PENDIENTE/ERROR/quitada** → reproceso completo honesto (la gemela paga SU OCR — como hoy).
   - **Fallback sagrado:** `reutilizarResultado → false` → pipeline completo (traza `capa0-qr fallback … reprocesa-completo`). **Dedup jamás inventa: falso-positivo = NO-GO.**
5. `qrPayload` (string, base64 de 32 bytes, **llave OPACA** — NO se parsea, NO se invierte, NO se compara por prefijos) se guarda en el registro del lote en los writes LISTA / DUPLICADA-e63k / ERROR (3 spreads aditivos al final — contrato D57; QA verifica EXACTAMENTE 3).

**Guards honestos añadidos (fuera del vocabulario mínimo del kit, declarados):**
- `forzarDedupOff` (PROCESAR IGUAL del dueño) manda sobre la capa 0 — misma doctrina e63k (red line 5). Traza propia `capa0-qr reprocesa-completo … forzarDedupOff`.
- **Auto-hit:** una fila jamás reutiliza SU propio payload registrado en una pasada previa (REINTENTAR de una fila ERROR que ya carryaba payload) — guard `idOriginalQr !== fila.id`.
- Entrada muerta del mapa (original quitada) → la fila actual se RE-APUNTA como original del payload (carrier vivo manda — el mapa es de la sesión del lote).

### §1.3 Export (§2.5 del e63h absorbida) — `informe.ts`

- `informe.json` (`actaLivianaJson`): `qrPayload` por registro + `dedupHash` (hex-16 de `reg.hashDedup`) — **campos AUSENTES si el registro no los trae** (misma receta de spreads condicionales de D57; informes previos no cambian de forma). **EXPORT-ONLY:** `filaLiviana` copia los campos TAL CUAL — el exportador no importa el módulo QR ni recalcula hashes (QA lo verifica por source-scan).
- `informe.txt`: columna **`dedupQr`** AL FINAL de cada línea ACTAS (aditiva — jamás reordenar): `dedupQr 7UfaHJKb…` (8 chars + «…») o `dedupQr —` si null (kit §1.3 LITERAL).
- **Post-mortem de gemelas por fin posible:** línea nueva `DEDUP-CAPAS: capa0-qr N - capa1-dhash-marcada N - capa2-identidad N` (solo si el instrumento corrió — patrón CLASIF-DEBIL: sin trazas el txt queda byte-idéntico) + `resumenDedup()` gana `qr: number` + el JSON `dedup` gana `qr` (aditivo al final).

### §1.4 Trazas (D51, solo-aditivas)

`console.info` SIEMPRE, también en los caminos de fallo: `capa0-qr sin-payload | original | reutiliza | aplazada | techo-vencido reprocesa-completo` (+ `fallback` y `reprocesa-completo forzarDedupOff` declarados arriba). Cero cambios a trazas existentes.

---

## §2 — QA y gates

**`scripts/qa-qr-identidad.ts` — 48/48 OK** (bun headless, mismo patrón qa-watchdog: funciones puras + source-scan):

| caso kit §2 | verificación |
|---|---|
| 1. payload exacto agrupa | fixture QR del corpus (payload G1 real del banco) decodifica EXACTO + wiring: `reutilizarResultado` + `dedup:"qr"` + `return` (OCR no se paga) |
| 2. prefijo común, payload distinto | par estilo G2/G4 decodificado: mismos 21 chars, payload distinto → la igualdad EXACTA del Map NO agrupa (sin fuzzy) |
| 3. imagen sin QR → null | ruido → `null` (análogo puro del wrapper DOM; el wrapper jamás throw por construcción try/catch) |
| 4. original en vuelo → APLAZADA → techo | `esperarDesenlaceQr` con timers cortos: aterriza LISTA al 3.er chequeo → `reutiliza`; PROCESANDO siempre → techo tras 10 (proceso vivo, <5 s); ERROR/PENDIENTE/AUSENTE → techo temprano; DUPLICADA → `reutiliza` |
| 5. rotación 90° → payload idéntico | fixture rotado 90/180/270 (rotación INDEPENDIENTE de la del módulo) → MISMO payload — invariancia VERIFICADA, no asumida |
| 6. `reutilizarResultado→false` → pipeline completo | source-scan: rama fallback con traza y SIN `return` |
| 7. export trae `qrPayload` y NO recalcula | runtime `filaLiviana`/`actaLivianaJson` (con dato / ausente) + source-scan: el exportador no importa identidad-qr ni dhash |

**Gates:** `tsc` 0 · `lint` 0 (con la entrada vendor declarada) · `qa-qr-identidad.ts` 48/48 · QA autoenvío **33/33** · escaneo **24/24** · identidad **30/30** · watchdog-relectura **34/34** — todo verde.

---

## §3 — Red lines (verificación)

1. Umbrales 0.82 / 0.6 / 0.55 / 8 / 6.5 — byte-idénticos (QA source-scan). ✅
2. `HAMMING_MAX=6` byte-idéntico; `DEDUP_CINTA_CIERTA=2` intacto; capa 2 e63k intacta (su único cambio: el valor `"qr"` se añade AL FINAL de la unión `dedup` — contrato D57). ✅
3. `WATCHDOG_MS=75_000 / INTENTOS=2 / GRACIA=5_000` byte-idénticos; `RELECTURA_TOPE_MS=45_000` intacto; la relectura JAMÁS reintenta. ✅
4. `proxy=true` en ocr/rapidocr.ts intocable. ✅
5. Dedup jamás inventa: llave QR = igualdad EXACTA (Map por payload completo — QA verifica cero `atob`/`JSON.parse`/comparaciones de prefijo); fallback `reutilizarResultado→false→pipeline completo` intacto; PROCESAR IGUAL manda. ✅
6. Espera acotada: solo-lectura, techo fijo 1_500×10, sin timers globales (QA: sin `setInterval` en el bloque). ✅
7. Export-only: el exportador no recalcula (source-scan). ✅
8. Trazas solo-aditivas; commit Conventional; merge de 2 padres; worklog append; REPORTE en docs/. ✅
9. jsQR vendido byte-idéntico (sha256 vs #72); package.json y bun.lock intocados (`bun install --frozen-lockfile`). ✅
10. `qrPayload` llave opaca: NO parsear/invertir/prefijos (el prefijo de 21 chars es observación del banco, jamás lógica). ✅

**Diff total:** `identidad-qr.ts` (nuevo) + `vendor/jsQR.js`+`jsQR.d.ts` (nuevos) + wiring mínimo (`runner.ts` 1 import re-escrito + 1 bloque + 3 spreads; `store.ts` mapa; `tipos.ts` campo+unión) + export (`informe.ts`) + QA + REPORTE + 1 entrada eslint. **Cero cambios en:** cadena autoenvío, clasificador, watchdog, ocr/rapidocr, PWA, banco #72.

---

## §4 — Desviaciones declaradas (todas menores, sin efecto funcional)

1. **`src/lib/e14/masiva/vendor/jsQR.d.ts` (nuevo):** el kit pide copiar el `.js` byte-idéntico (+1 entrada eslint); para que `import jsQR from "./vendor/jsQR.js"` compile hace falta la declaración de tipos (el UMD no la trae). El `.js` queda byte-idéntico (sha256 verificado); el d.ts es archivo SEPARADO — no muta el vendor.
2. **Remuestreo del intento C×1.5:** el banco sub-escala con `drawImage` del navegador (bilinear de Skia); el núcleo puro de producción usa bilinear propio (misma intención, mismo redondeo de bandas). Diferencia potencialmente sub-pixel SOLO en el 4.º intento del ladder; A/B/C son copia 1:1 EXACTA y el floor del tier de rotación es A a escala 1 (exacto). Todo lo que midió el GO (ganadores A/B, payloads exactos, invariancia A@rot) es bit-idéntico.
3. **Trazas extra declaradas:** `capa0-qr fallback …` (fallback sagrado — kit lo exige como comportamiento, la traza lo hace visible) y `capa0-qr reprocesa-completo … forzarDedupOff` (PROCESAR IGUAL). Solo-aditivas del propio kit (D51).
4. **`informe.txt` línea `DEDUP-CAPAS` (nueva):** materializa el post-mortem §1.3 por capas en el txt (el kit lo pide como contenido del export; la línea es la forma aditiva estándar del repo — patrón CLASIF-DEBIL).
5. **El wrapper DOM no corre en el QA headless:** su núcleo (`ladderQrDePixeles` — el MISMO código que consume) sí, con matrices QR reales; el wrapper completo (render ≤2048) fue validado en navegador por el banco #72 con la misma receta y queda para la mini-Fase D del dueño (kit §4).
6. **APLAZADA en producción:** con el runner SECUENCIAL (D45) el original rara vez está PROCESANDO cuando la gemela arranca (la gemela se procesa después); la rama es DEFENSIVA (kit §1.2.4 la manda) y el QA la ejercita con readers inyectados. No bloquea: techo 15 s → reproceso honesto.

---

## §5 — Validación del dueño (mini-Fase D, kit §4 — combinable con la del e63g)

1. Gemela de archivo → consola `capa0-qr reutiliza` + reutilización en ~1-2 s (NO 24-39 s) — el OCR no se paga.
2. Gemela con original en vuelo → `capa0-qr aplazada` → reutiliza al concluir el original (o `techo-vencido reprocesa-completo` honesto).
3. Durazno3 (QR ilegible) → `sin-payload` → pipeline completo normal.
4. Informe trae `qrPayload` / `dedupQr` por registro (+ línea DEDUP-CAPAS).
5. **14/14 ENVIADA se mantiene** · regla de oro: si algo que HOY se autoenvía deja de hacerlo → NO-GO, revertir.
6. (Misma corrida) validación e63g: soltar fotos con la cola viva → arrancan solas; la cola TERMINA SIEMPRE.

## §6 — Impacto esperado (kit §6, honesto)

Lote 26 con gemelas: hoy (post-e63k) ~10.3 min → tras e63m ~7.5-8 min (−25-30%): gemelas reutilizan sin pagar OCR; coste nuevo +0.7-2.2 s por archivo de ladder QR. El 11.8% de QR ilegibles (durazno3) pagan igual que hoy — cero regresión (fallback = pipeline completo intacto).
