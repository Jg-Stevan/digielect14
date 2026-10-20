# REPORTE — KIT e14-decode-unico-precalor-v1 (D66)

**Fecha:** 2026-10-20 · **Agente:** AGENTE-3 (Z.ai Code, sesión IM web-798d45c6) · **Rama:** `feat/e14-decode-unico-precalor-v1`
**Base:** `origin/main` = `2483c42` (merge PR #55) — posterior a `cfbe4fe` como pide la nota del arquitecto.
**⚠️ DESVIACIÓN DE BASE DOCUMENTADA:** el kit exige «D65 YA MERGEADO», pero **D65 no existe en el repo** (0 commits/ramas/PRs con D64/D65; verificado 2026-10-20). El kit es AUTOCONTENIDO (T1-T4 no consumen campos de D65), así que se ejecutó sobre `2483c42` respetando: el bloque D63-B (`preProcesoEscaneo`, presente ✓) y el mandato de aditividad de trazas (las futuras líneas del watchdog de D65 encontrarán las de D66 append-only al final — contrato D57). Riesgo de conflicto con un D65 futuro en `runner.ts`/`MasivaView.tsx` mitigado: las regiones D66 son estrechas y están marcadas con comentarios KIT D66.

## 1. Veredicto

**GO con gate del dueño.** T1-T4 implementados y verificados en sandbox (humo end-to-end en navegador + informe verificado byte a byte con las funciones puras). El desenlace cambia de RUTA (el pipeline consume un master JPEG re-encodeado q0.90 en vez del original) — **el criterio de aceptación 1 (16/16 veredictos idénticos ±0.3 del lote 20261019, corrida 162728) es del DUEÑO** y manda el merge.

## 2. Entrega por tarea (zonas del kit, diff exacto)

`git diff --name-status origin/main` = `archivos.ts` · `runner.ts` · `store.ts` · `tipos.ts` · `MasivaView.tsx` · `informe.ts` · `package.json`+`bun.lock` · `precalor.ts` (NUEVO). Prohibidos SIN tocar: bridge/scanner-core-bridge (0 diff), next.config.ts, `public/**`, `src/assets/**`, packages/**, scanner-lab, SIM, chips congelados.

- **T1 — master único (`archivos.ts` + `runner.ts`):** `maestroDeImagen(blob)` — UN decodificado a la escala de trabajo con `createImageBitmap(..., {imageOrientation:"from-image", resizeQuality:"high"})` → canvas → `toBlob(jpeg, 0.90)` → `File`. El runner alimenta el bridge con el master (fallback HONESTO: original si no hay master). `origen` (D63-A) y `preProcesoEscaneo` (D63-B) siguen corriendo sobre el ORIGINAL (EXIF/márgenes viven ahí — el master es re-encode sin EXIF). Liberación: el bitmap se `close()` en `finally` y el master reposa como BLOB (nunca bitmap vivo).
- **T2 — HEIC nativo primero (`archivos.ts`):** feature-detect con try/catch + validación de dimensiones sanas → `origenDecode:"nativo"`; si el navegador no decodifica HEIC → reserva wasm `heic2any` (`origenDecode:"wasm"` — **el MISMO motor 0.0.4 que el F-HEIC del core**, import DEFERIDO D47, añadido explícito a package.json — ya venía hoisted como dep del core). El fallback JAMÁS se borra ni se asume disponible. Un no-HEIC que falló el nativo NO paga wasm (blob roto → ruta de siempre).
- **T3 — precalor (`precalor.ts` NUEVO + `store.ts` cableado + chip `MasivaView.tsx`):** suscripción al mini-store (zustand `subscribe` — sin tocar `agregarFiles`/`cargarFilas`/render de filas). Con la cola OCIOSA (ni `corriendo`, ni `progreso`, ni `origenAbierto`, ni `enviandoLote`) llena una ventana de `PRECALOR_COLA=3` masters FIFO; flag transitorio `precalentada` en la fila (SOLO memoria — jamás IDB); chip `PREPARADA` (brand-green, mono 9px) junto a la píldora; cancelación por QUITAR/VACIAR/pasar-a-DUPLICADA (señal entre etapas + descarte por suscripción); pausa durante lote (los en-vuelo se abortan) con EXCEPCIÓN del prefetch (ver §4.1); D45 INTACTO — sin OCR/veredicto/score, la fila no procesa sola (verificado: 5+ s de espera sin PROCESAR = filas siguen PENDIENTE).
- **T4 — trazas + informe (`tipos.ts` + `runner.ts` + `informe.ts`):** en `RegistroMasiva` (persisten): `decodeMs` (0 si precalentada), `origenDecode`, `precalentada` (provenance del desenlace), `precalorMs`. En el informe: 2 líneas ADITIVAS al final del bloque de TIEMPOS (tras CONVERSION/PERSISTENCIA, formato literal del kit) + campos por-acta en `informe.json` y `ficha.json` (spread condicional — AUSENTES sin master; registros previos no cambian de forma).

## 3. Escala de trabajo (T1.1 — documentada, R4: SIN CAMBIO)

La constante que define el tamaño del acta procesada/OCR de fotos en el core es **`IMPORT_MAX_LONG_SIDE = 4032`** (`@jg-stevan/scanner-core` 0.4.0, image-processor.js L140) — idéntica a `PROCESSED_MAX_LONG_SIDE` (L35): 4032×3024 ≈ 12.2 MP. El master nace a ESA escala (`MAESTRO_LADO_MAYOR = 4032` en `archivos.ts`, comentado): los píxeles que llegan a detección/warp/OCR conservan el cap de siempre; la única delta de píxeles es UNA re-encode intermedia q0.90 (el F-IMPORT del core re-encodea a q0.92 — el master añade un ciclo, no cambia la escala). La escala de ENTRADA del OCR (DET_CAP_PROD 1920 / RAPIDO 1280, interno del motor) NO se toca (Fase 2 excluida).

## 4. Desviaciones honestas (todas documentadas en código)

1. **Prefetch D61 re-apuntado (`runner.ts`):** el prefetch de N+1 ya no calienta la memo del original (`precargarDecodeArchivo` sin consumidor — el pipeline recibe el master) sino que asegura el MASTER de N+1 vía `asegurarMaestro` con `ignorarOciosidad` (el decode de N+1 se esconde tras el OCR de N — AC-P1 intacto; el trazo `masiva-prefetch` es sustituido por `precalor ... listo/consumido`). El slot D61 desaparece: el mapa del precalor ES el slot ahora.
2. **Quad de detección del precalor → warm-up:** el bridge no acepta un quad precomputado (`escanearActa` corre su propia detección; inyectarlo tocaría el core — AJENA) — un quad del precalor sería trabajo muerto. El precalor hace en su lugar `warmUpScannerWorker()` (el mecanismo del core que el bridge ya usa) UNA vez por sesión. **thumb («la que ya exista»):** el precalor NO genera thumbs — la fila conserva el suyo y el desenlace hornea el fresco (hacerThumb del runner intacto).
3. **Peso del master:** el kit estima «~1 MB»; a la escala de trabajo 4032 el master pesa ~1.5-4 MB (q0.90). La escala manda (R4) — el tamaño es consecuencia.
4. **Master desde el ORIGINAL (no desde `archivoCorregido`):** hoy la salida corregida de D63-B NO llega al pipeline (`const archivoCorregido` en `runner.ts` L251 es **variable muerta** — observación PRE-EXISTENTE heredada de la integración D63-B, reportada al dueño, NO tocada: activarla cambiaría veredictos de escaneos y no es mandato de este kit). El master se hornea desde el mismo archivo que el pipeline consume hoy.
5. **`store.ts` cablea el precalor:** el kit concedía store.ts para «flag + cola de precalor»; la suscripción vive ahí DESPUÉS de `create()` (un `cablearPrecalor()` a nivel de módulo de precalor.ts sería TDZ por el ciclo runner↔precalor↔store — falló el build y se corrigió así). `agregarFiles`/`cargarFilas`/render de filas INTACTOS.
6. **Campos D66 ausentes sin master:** fallback original (decode imposible), filas ERROR y registros previos NO traen `decodeMs/origenDecode/precalentada/precalorMs` (jamás inventar).

## 5. Validación (sandbox)

**Gates:** `tsc --noEmit` 0 · `eslint` 0 · build estático (`BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14`) OK (tras corregir el TDZ de §4.5).

**Humo navegador end-to-end** (build estático + `tools/serve-coop-coep.js` 8123 + agent-browser, 3 actas sintéticas 4032×3024/2016×1512 con anclas E-14):
- **Precalor en la espera:** `[e14] precalor fila=… listo ms=229/143/37 origen=nativo 4032x3024|2016x1512` — 3 masters FIFO, chips PREPARADA ×3, filas siguen PENDIENTE >5 s (D45 ✓).
- **Consumo T3.3:** `[e14] precalor … consumido precalorMs=229 origen=nativo` → **`[e14] decode-maestro fila=… ms=0 origen=nativo precalentada=true 4032x3024`** (aceptación 3 literal) → pipeline completo sobre el master (`crop=3964x2896`), desenlaces normales, `decode` del bridge = **342/130/36 ms** (el decode pesado quedó en la espera).
- **Fallback honesto:** la fila DUPLICADA reprocesada (original sin resultado utilizable) horneó master inline `ms=128 precalentada=false` — sin master precalorado porque el precalor lo DESCARTÓ al pasar la fila a DUPLICADA (mejora T3.4 verificada en vivo: `dedup … marcada hamming=4` → master fuera).
- **Cancelación T3.4:** QUITAR de una fila PREPARADA → 0 errores, master descartado.
- **SIM intacto:** acta óptima → score 8.2 → ENVIADA (ACTAS (1)), pipeline SIMULACION sin master ni cambios (consola sin errores en toda la sesión).
- **360 px:** chip PREPARADA junto a PENDIENTE sin romper la fila (captura verificada); convive con DUPLICADA/PROCESAR IGUAL/RECHAZADA.
- **Informe T4 (funciones puras, byte a byte):** `Decodificacion: media 0.9s - nativo 2 / wasm 1 - precalentadas 1 (precalor medio 0.2s)` + `Outliers procesoMs >6s: 1` — orden intacto (Tiempos medios → Espera → CONVERSION/PERSISTENCIA → Decodificacion → Outliers); JSON por-acta con campos SOLO cuando hay master; registro pre-D66 ⇒ informe sin campos nuevos (forma estable).

## 6. Criterio de aceptación — reparto agente/dueño

| # | Criterio | Estado |
|---|---|---|
| 1 | Veredictos 16/16 idénticos (lote 20261019, corrida 162728, ±0.3) | **DUEÑO** (fotos reales; A/B main vs D66; divergencia = NO-GO y revertir) |
| 2 | Tiempos: JPG iPhone procesoMs ≤2.5s · HEIC ≤1.5s nativo / ≤3.5s wasm · cero outliers >6s | **DUEÑO** (sandbox sin HEIC real ni su hardware; el mecanismo está: decode=0-36ms en precalentadas del humo) |
| 3 | Precalor: PREPARADA máx 3 · PROCESAR arranca en OCR con decodeMs≈0 · NUNCA LISTA sola (D45) | **VERIFICADO** en sandbox (falta su hardware/HEIC real) |
| 4 | Memoria: 26 actas con precalor sin crash (masters son blobs) | **DUEÑO** (sandbox con 6; los blobs ~1.5-4 MB y el tope 3 acotan) |
| 5 | Informe aditivo; líneas previas intactas y en orden | **VERIFICADO** byte a byte (§5) |
| 6 | lint OK · 360 px · SIM/chips intactos · `public/**` sin cambios · wasm diferido | **VERIFICADO** (§5; `heic2any` import DEFERIDO D47 dentro de `maestroDeImagen`) |

## 7. CI esperada

checks (tsc/lint/build) ✅ · Vercel ✅ · parity ❌ **HEREDADA** de D57 (el gate diffea el worker contra main sin willReadFrequently — este PR no toca `public/**`; main también la falla).

## 8. Continuidad

- DECISIONS.md fila **D66** · ROADMAP sección DECODE-UNICO-PRECALOR · worklog · línea AGENTS.md.
- Rama `feat/e14-decode-unico-precalor-v1`, PR DRAFT hacia main. **El agente NUNCA mergea.**
- Pendiente del dueño: A/B 16/16 (gate §6.1) · tiempos reales con HEIC (registrar qué máquinas dan nativo — T2.4) · 26 actas de memoria · decidir la activación de `archivoCorregido` de D63-B (variable muerta, §4.4) · reparar marcadores de conflicto PR #46 · REVOCAR el token.
