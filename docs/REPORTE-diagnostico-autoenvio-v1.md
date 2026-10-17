# REPORTE — kit e14-diagnostico-autoenvio-v1 «POR QUÉ NO SE ENVIÓ»

Rama: `feat/diagnostico-autoenvio` (bifurcada de **main @ `8a8c351`** — la cadena
mergeada del dueño: #10 informe → #12 PROD-1 → #14 PROD-2) · PR ABIERTO SIN MERGE.
Fecha: 2026-10-17 · Ejecución: agente (Z.ai Code) · Kit: verbatim md5 `d376e3c8ce0eeab39ca2785bbbc02dd3` (docs/).

---

## §1 — Hecho (C1-C6, alcance exacto del kit)

| Cambio | Dónde | Evidencia |
|---|---|---|
| **C1** DiagnosticoActa adjunto por el bridge (2 sitios) | `types.ts` (interface §3-A + `Acta.diagnostico?`) · `scanner-core-bridge.ts` (sitio pipeline ~L1013 y sitio recorte ~L1471) | el registro nace JUSTO donde hoy se escribe el log de auditoría (UNA sola fuente de verdad §9.6) · `diag=1` en AMBOS logs cuando se adjuntó · SIM nunca (guard `!opciones.simular` / `acta.fuente !== "SIMULACION"` — §9.2 doble guard con el store) |
| **C2** Módulo `diagnostico.ts` NUEVO (puro, sin React) | `src/lib/e14/diagnostico.ts` | `causaPrincipal` (§4 reglas deterministas EN ORDEN) · `construirDiagnostico` (helper C1) · `descargarPaqueteDiagnostico` (ZIP §3) · `registrarDesenlace` (localStorage `e14-diag-v1` cap 500 evict FIFO + fallback memoria §9.4) · `reporteComportamiento` (agregados §5 + TXT/JSON) · `exportarReporteComportamientoZip` (C5) |
| **C3** Trigger en el store | `store.ts` `analisisCompletado` (OPTIMA → registro SIN ZIP §7.3; no-OPTIMA → registro + ZIP) y `aplicarRecorte` (OPTIMA → registro; else → registro + ZIP) | trigger = el DESENLACE (status ≠ OPTIMA), pre-decisión humana (§1) — no `enviadoAutomaticamente` |
| **C4** Botón «DIAGNÓSTICO ↓» en REVISIÓN | `ReviewView.tsx` fila de acciones (4ª celda compacta, grid-cols-4) | visible solo `acta.diagnostico && status !== "ENVIADA"` — red de seguridad §9.1 probada (re-descarga idéntica) |
| **C5** Card COMPORTAMIENTO en RESUMEN | `ResumenView.tsx` (section nueva tras las tarjetas de estadística) | tasa grande + 3 causas top con barra proporcional + «EXPORTAR REPORTE» (ZIP JSON+TXT) — re-cálculo en montaje (ligero §6-F) |
| **C6** Dependencia | `package.json` + `bun.lock` | `fflate@0.8.3` — ZIP STORE (`level: 0`, sin recomprimir §3) |

**Intocables §2 (verificados):** diff vs main = 6 archivos del kit + bun.lock (1 línea) —
pipeline/gate/score/techos/marcadores/completitud/score-v2/PROD-1/PROD-2 byte a byte ·
`packages/` 0 toques · ScanView intocable · matriz del informe intocable.

---

## §2 — Evidencia de la validación §7 (headless + navegador, clone :3001, viewport 412×850)

Gates: `bunx tsc --noEmit` → 0 · `bun run lint` → 0 · `bun run build` → OK (rutas estáticas).

1. **SIM §7.2 — los 3 chips (8.2/7.0/4.3):** descargas capturadas = SOLO los informes
   de telemetría pre-existentes (`informe-e14-*.txt/json`) — **0 ZIP de diagnóstico** ·
   `localStorage["e14-diag-v1"]` = AUSENTE (0 entradas) · **0 ocurrencias de `diag=1`** en
   consola (el bridge no adjunta en SIM — doble guard §9.2 verificado).
2. **Import Frankfurt P1 real §7.3:** `[e14] pipeline ARCHIVO/file total=7374ms … score=8.5 … clasif={…,nivel:AUTO,cod:710007453010102} … diag=1`
   → **OPTIMA → auto-envío (SEGUIR ESCANEANDO) · 0 ZIP** · acumulador: **1 entrada
   `autoEnviada:true`** (`{status:"OPTIMA", techos:[], causa:"—"}`).
3. **No-acta (contrato de escritorio generado) §7.4:** `[e14] pipeline ARCHIVO … sin señal … score=4.9 … diag=1`
   → **RECHAZADA/BAJO → ZIP descargado** `e14-diag-mesa-002-160445-i1.zip` (175.895 B).
   Contenido REAL extraído y verificado:
   ```
   original.jpg      106.900 B  1600×1200 — la foto CRUDA importada SIN recortar (byte a byte del dataURL §9.3)
   final.jpg          64.339 B  1360×1001 — la PROCESADA (warp del crop 1454×1073)
   diagnostico.json    1.586 B  registro §3-A completo (techos ["sin-senal:4.9","recortada:7.9"] en ORDEN)
   diagnostico.txt     1.594 B  «Causa principal: sin señal del acta (no se leyó cabecera/mesa/tipo)» §4.3 arriba + desglose
   ocr.txt               303 B  texto OCR crudo
   comportamiento.txt    541 B  TASA 50% (auto 1 de 2) — la tasa 1/2 que pide §7.4 + causas top + p50/p95 + lectura × auto + por intento
   ```
   causaPrincipal coherente con el status (BAJO → regla §4.3) · ZIP STORE (level 0).
4. **Recorte manual §7.5:** `[e14] recorte ARCHIVO total=5800ms … diag=1` → **2º paquete**
   `e14-diag-mesa-002-160613-i1.zip` + 3ª entrada RECHAZADA. NOTA: el paquete sale con
   **i1** porque el recorte NO consume intento (L5/D20 del bridge: «el rescate NO es una
   captura nueva») — los i2…i4 nacen de REPETIR FOTO (§9.10).
5. **RESUMEN §7.6:** card COMPORTAMIENTO = **3 desenlaces · 33% auto-envío (1/3) · causa
   top «sin señal del acta…» ×2** — MISMA fuente que localStorage (verificado con el DOM).
6. **C4 probado:** click «DIAGNÓSTICO ↓» → 2º ZIP idéntico (`diag=8ms bytes=175895`) ·
   **EXPORTAR REPORTE** → `e14-comportamiento-160638.zip` (3.009 B, JSON+TXT).

**§9.9 sin jank:** zipSync medido **4-13 ms** (≪300 ms) — no hace falta worker.

---

## §3 — Adaptaciones documentadas (todas en el espíritu del kit)

1. **«Toast» del C3** — este app NO tiene sistema de toasts: redesign-stitch D2 los
   eliminó («El feedback vive en la UI persistente») y el store solo los menciona en
   comentarios heredados del lab. Feedback entregado por: traza grep-able
   `[e14] diag=<ms>ms bytes=<n> zip=<nombre> causa="…"` + feedback en el botón C4
   («Descargado ✓» 2.5 s) + el botón mismo (persistente — red de seguridad §9.1).
2. **`registrarDesenlace` también en OPTIMA** — el §5 define `tasa = autoEnviadas/total`
   y §7.3 exige «1 entrada `autoEnviada:true`»: el denominador necesita los desenlaces
   auto-enviados. El ZIP sigue siendo SOLO no-OPTIMA (trigger §1 intocado).
3. **`actaId` del sitio escaneo se parcha post-hoc** — el id nace en `construirActa`
   (después del log); el registro se monta ANTES del log (para `diag=1`) y el id se
   completa al adjuntar al acta. Una sola fuente de verdad intacta (§9.6).
4. **Campos aditivos §8** — score-lectura (PR #13) NO está mergeada en main: `sharpnessHi`
   y `contrastPapel` viajan `null` y `lectura = {nivel:"—", anclas:0, chars:<real>}`.
   Las reglas §4 de `lectura-DEBIL` ya están implementadas (inertes hasta el merge) y
   la línea del log admitirá `lectura=/anclas=/piso=` sin conflicto de tokens (las
   familias `ocrIn=`/`ocr=rapidocr`/`diag=` son independientes).
5. **Return temprano del timeout (15 s)** — sin log de auditoría no adjunta diagnóstico
   (el kit define 2 sitios: los 2 logs). El acta de timeout no genera paquete.
6. **localStorage sonda + try/catch** con fallback a memoria (§9.4): el reporte de la
   sesión sobrevive en privado/Safari, el persistente no — honesto.
7. **fflate con `Zippable`** (typing del propio paquete) — `zipSync(contenido, {level:0})`.

---

## §4 — Cómo probar (QA del dueño en dispositivo)

1. `bun run lint` (0) · captura real → si es OPTIMA: auto-envío normal, SIN ZIP, la tasa
   del RESUMEN sube el numerador Y el denominador.
2. Captura que NO sea OPTIMA (reflejo/borrosa/fondo) → ZIP automático
   `e14-diag-mesa-XXX-HHMMSS-iN.zip` en Descargas → abrir: original vs final +
   diagnostico.txt (causa arriba) + comportamiento.txt pegado.
3. Si el navegador bloquea la descarga automática: REVISIÓN → «DIAGNÓSTICO ↓» (4ª celda).
4. RESUMEN → card COMPORTAMIENTO: tasa + causas top + «EXPORTAR REPORTE».
5. localStorage `e14-diag-v1` cap 500 (evict FIFO) — no crece infinito (§9.8).

Pendiente del dueño: QA física §7 (dispositivo, ZIP con 12MP ~5-8 MB) + auditoría de
este PR. **SIN merge por cuenta propia — regla fija §8.**
