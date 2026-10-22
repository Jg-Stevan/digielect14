# REPORTE — e66-duplicadas-informe-orientacion-v1

**Kit:** plan quirúrgico del dueño «Plan de Implementación para el Agente» (P2 estado duplicados · P3 generador de informe · P4 orientacionProbe).
**Base:** `main @ 2d20901` (e64p mergeado, PR #80) — EXACTA contra el remoto, sin desviación.
**Rama:** `feat/e66-duplicadas-informe-orientacion-v1` — commits `ca8d8f1` (P2) · `86fd7f1` (P3) · `cfa0113` (P4) · fix `DEDUP-CAPAS` + docs.
**Gates finales:** tsc 0 · lint 0 · **7/7 suites**: historico-enviadas 49/49 · dedup-enviadas 42/42 · qr-identidad 68/68 · autoenvío 33/33 · escaneo-ya-recortado 24/24 · identidad-acta 32/32 · watchdog-relectura 34/34. `package.json`/`bun.lock` INTACTOS.

---

## 1. Resumen ejecutivo

El plan del dueño corrige tres problemas confirmados con datos de sus pruebas (informe 094214 — 27 gemelas):

1. **P2 — estado incorrecto de duplicados:** las gemelas reutilizadas heredaban `statusActa: 'ENVIADA'` y `diagnostico.status: 'OPTIMA'` de la original → corrompían `porStatusActa`, los conteos de envío y alimentaban el ledger con no-envíos. Ahora el desenlace de la gemela es **`DUPLICADA`** (valor NUEVO al FINAL de `ActaStatus`).
2. **P3 — informe con métricas erróneas:** `dedup.matches` solo contaba la capa `v2`; `esperaMs` de la gemela heredaba la espera de la original (doble conteo en la media); el vocabulario de `porStatusActa` no tenía `DUPLICADA`.
3. **P4 — `orientacionProbe` ineficiente:** para fotos con EXIF de cámara (`origenSenales === 'exif-camara'`) el sondeo de rotaciones devolvía `aplicado=0` SIEMPRE (4–10 s por acta de desperdicio puro). Ahora se OMITE con traza honesta.

## 2. Adaptación a la estructura real (M-e66-0 — desviación de ubicación)

El plan del dueño nombraba archivos que NO contienen la lógica en este repo (análisis contra una estructura imaginada). Ubicación REAL, verificada:

| El plan decía | La lógica REAL vive en | Evidencia |
| --- | --- | --- |
| `masiva/cola.ts` = orquestador | **`masiva/runner.ts`** (`reutilizarResultado` L425) — cola.ts es SOLO persistencia IndexedDB (INTACTO) | runner.ts:425-491 |
| `masiva/dedup.ts` = decide match | **`masiva/store.ts`** (`cadenaDedup`) + runner capa 0/2 — dedup.ts SOLO computa hashes (INTACTO) | store.ts:537-544 |
| `e14/diagnostico.ts` = generador de informe | **`e14/informe.ts`** (`resumenDedup`, `porStatusActa`, `totales.yaEnviadas`) — diagnostico.ts es el builder per-acta (INTACTO) | informe.ts:423/911/927 |
| `masiva/deskew.ts` = orientación | **`e14/scanner-core-bridge.ts`** + `e14/orientacion.ts` (`probeOrientacion`) — deskew.ts es el pre-proceso de escaneos (INTACTO) | bridge:1348-1356 |

**El contrato `{ esDuplicado, tipo, dupOf }` que el plan pedía en dedup.ts YA EXISTE de facto:** `RegistroMasiva.dedup` (token de capa: `v2 | identidad | qr | ya-enviada | visual-aplazada | sin-match`) + `RegistroMasiva.dupOf` + `dedupDistancia` — la marca llega al informe por `FilaInforme`. No se añadió ninguna función nueva: la bifurcación del plan (`if (esDuplicado)`) se implementó en el PUNTO ÚNICO real (`reutilizarResultado`), por donde pasa el 100 % de las confirmaciones de gemela (rama DUPLICADA del runner, capa 0 QR y capa de reutilización del e65b).

## 3. P2 — estado DUPLICADA (`ca8d8f1`)

**Punto único** en `runner.ts reutilizarResultado` (M-e66-5 — el plan estampaba en la fila; la estampada real va en el ACTA copiada para que TODO derive coherente):

```ts
actaCopia.status = "DUPLICADA";                 // ActaStatus += "DUPLICADA" (AL FINAL)
actaCopia.diagnostico.status = "DUPLICADA";     // plan P2 literal
actaCopia.enviadoAutomaticamente = null;        // plan P2 literal (campo ahora string | null)
```

- **Derivados automáticos:** `fila.statusActa` (= `actaCopia.status`), `enviadaAuto` → `false` explícito, `informe.json actas[].statusActa` (leía `acta?.status` — informe.ts:283), `porStatusActa`, píldoras de MasivaView/TopBar (switch de `estiloTopBar` sin default exigía el caso nuevo).
- **`enviadoAutomaticamente?: string | null`** (types.ts): `null` = «el envío no es suyo» (explícito, plan P2); `undefined` = sin envío aún. Consumidores auditados (ReviewView muestra `--:--:--`, store solo hace `!!` → falsy, correcto).
- **UI:** píldora `DUPLICADA` en MasivaView (fondo azul de la FILA lo sigue pintando `esDuplicada` de e64v — intacto) + caso gris en `estiloTopBar`.
- **D-e66-2 — REVERSA de e65b T-3b:** la gemela ya NO alimenta el ledger (el plan P2 lo exige: «corrompe … el historial»). El hook `if (actaCopia.status === "ENVIADA")` quedó eliminado. **La protección de re-encolado sobrevive** vía la ENTRADA de la ORIGINAL: payload-QR exacto (capa 0) y dhash «cinta cierta» ≤ 6 (capa e65) matchean la gemela contra esa entrada → YA-ENVIADA igual, cero re-OCR.
- Traza del dedup con token aditivo: `reutiliza status=DUPLICADA ...`.

## 4. P3 — informe reparado (`86fd7f1`)

- **`resumenDedup` multi-capa (M-e66-2):** `matches = v2 + identidad + qr + ya-enviada` — revoca el criterio e63k F1.5 (solo-v2) por mandato del plan. `visual-aplazada` sigue NO siendo match (resolución pendiente) y `sin-match` tampoco. Desgloses ADITIVOS: `v2` (la cuenta que `matches` era antes — compatibilidad de parsers) y `yaEnviada`.
- **`distanciaMedia`:** solo filas con distancia presente (`v2`/`identidad` — `identidad` no la trae: mismo resultado, wording del plan). Sin datos → null (jamás inventar).
- **`porStatusActa` y `escPorStatus`:** `"DUPLICADA"` AL FINAL del vocabulario (claves fijas a 0 — JSON estable; D-e66-1). Las 27 gemelas del informe del dueño ya no inflan ENVIADA.
- **`esperaMs` propio de la gemela (P3.4):** `reutilizarResultado` estampa `diagnostico.tiempos.esperaMs = max(0, t0 − fila.agregadaEn)` — la media de espera del informe ya no cuenta la espera de la original DOS veces.
- **`totales.yaEnviadas` — semántica e65 PRESERVADA (M-e66-3):** el plan P3.2 pedía «solo las realmente enviadas»; YA-ENVIADA por definición lo es (matchea el ledger de enviados). El conteo de enviadas de la cola vive en `porStatusActa.ENVIADA` — que P2 limpió. Cambiar la clave habría destruido la métrica e65 T-8 (visibility de filas nacidas YA-ENVIADA, que no tienen statusActa).
- **`DEDUP-CAPAS` del txt (regresión detectada por batería):** `capa1-dhash-marcada` ahora lee `resumenDedup.v2` (matches pasó a ser multi-capa) y se añade `capa3-ya-enviada` AL FINAL (contrato D51: solo añadir).
- Adendas honestas: `qa-identidad-acta` Bloque 4 (30→32 checks) y `qa-qr-identidad` post-mortem §1.3 (M-e66-2).

## 5. P4 — probe de orientación omitido con EXIF de cámara (`cfa0113`)

- **`OpcionesEscaneo.origenSenales?: string | null`** (aditivo; SOLO MASIVA lo llena — mismo criterio D63-C de `origenActa`) — la señal auditable del detector D63-A viaja del runner al pipeline.
- **Guard en el probe del pipeline de ARCHIVO (bridge L1348):** `origenSenales === "exif-camara"` → sondeo OMITIDO + traza honesta en línea propia parseable:
  `[e14] orientacion omitida=exif-camara (EXIF de cámara — orientación ya horneada por el core; sondeo de rotaciones innecesario)`
- **`orientacionProbeMs` queda `null`** («no corrió» — jamás inventar `ms=0`): el plan pedía «cercano a 0»; null es el valor honesto del instrumento D57 para «no corrió» (idéntico al caso SIM). Verificación del dueño: filas exif-camara → campo null en `informe.json actas[]` + traza `omitida=exif-camara` + `totalMs` reducido 4–10 s.
- **SIM** sigue omitiéndolo; **flujos individual/video/recorte-manual** corren el probe de siempre (sus opciones nunca traen la señal).
- **M-e66-4:** el plan imaginaba separar `runDet`/`rotationProbe` reutilizando el det — en la estructura real el det del probe vive DENTRO de `probeOrientacion` (`rapidOcrCropsOrientacion`) y el pipeline hace SU PROPIO det después → omitir el probe COMPLETO ES el ahorro; no hay nada que reutilizar.
- **Alcance:** exacto `=== "exif-camara"` (el plan literal). `"heic"` sigue sondeando (fidelidad al plan; la conversión del core hornea orientación — relajar a `heic` es una línea futura si el dueño lo pide).

## 6. Cómo probar (dueño)

1. **Lote con gemelas:** procesar un lote que contenga fotos repetidas de un acta ya ENVIADA → la gemela queda azul (e64v) con píldora **DUPLICADA** (ya no «Ya enviada»/«ENVIADA AUTO»); `informe.json → totales.porStatusActa.DUPLICADA = n` y `ENVIADA` cuenta SOLO envíos reales.
2. **Informe:** `dedup.matches` = suma de capas (verificable contra `v2 + identidad + qr + yaEnviada`); `informe.txt → DEDUP-CAPAS: … - capa3-ya-enviada n`; `tiemposMediosMs.esperaMs` sin el doble conteo de gemelas.
3. **Orientación:** lote de fotos de cámara (con EXIF) → consola `[e14] orientacion omitida=exif-camara` por acta, `actas[].orientacionProbeMs = null`, `totalMs` ~4-10 s menor por acta. Escaneos y PDFs siguen sondeando (traza de siempre).
4. **Re-encolado (ledger):** tras vaciar (con `COLA_PERSISTENTE=true`), re-subir la foto de una gemela → **YA-ENVIADA** al instante (matchea la entrada de la ORIGINAL por dhash cinta cierta / payload-QR).

## 7. Files touched

| Archivo | Cambio |
| --- | --- |
| `src/lib/e14/types.ts` | `ActaStatus += "DUPLICADA"` (AL FINAL) · `enviadoAutomaticamente?: string \| null` |
| `src/lib/e14/masiva/runner.ts` | `reutilizarResultado`: estampada DUPLICADA + esperaMs propio + reversa hook e65b T-3b + `enviadaAuto: false` + traza `status=` + `origenSenales` en opcionesMasiva |
| `src/lib/e14/informe.ts` | `resumenDedup` multi-capa + desgloses `v2`/`yaEnviada` · vocab `DUPLICADA` en `porStatusActa`/`escPorStatus` · `DEDUP-CAPAS` capa1=v2 + capa3 · comentario M-e66-3 en `yaEnviadas` |
| `src/lib/e14/bridge.ts` | `OpcionesEscaneo.origenSenales` (aditivo) |
| `src/lib/e14/scanner-core-bridge.ts` | Guard del probe (exif-camara → omitido + traza) |
| `src/components/e14/screens/MasivaView.tsx` | Píldora DUPLICADA (LISTA) |
| `src/components/e14/TopBar.tsx` | Caso DUPLICADA en `estiloTopBar` (switch sin default) |
| `scripts/qa-historico-enviadas.ts` | Adenda M-e66-1 (T-3b reversado; catches ≥2→≥1) |
| `scripts/qa-identidad-acta.ts` | Adenda M-e66-2 (Bloque 4 — 32 checks) |
| `scripts/qa-qr-identidad.ts` | Adenda M-e66-2 (post-mortem §1.3) |

**INTACTOS por diseño:** `masiva/cola.ts` (persistencia), `masiva/dedup.ts` (hashes), `e14/diagnostico.ts` (builder per-acta), `masiva/deskew.ts` (pre-proceso escaneos), `masiva/store.ts` (cadenaDedup/capa 0/ledger), `masiva/origen.ts` (detector), `masiva/historico.ts`, `orientacion.ts` (el probe en sí).
