# AGENTS.md — Reglas para agentes IA en digitalizador-e14

## AL INICIAR CUALQUIER SESIÓN (obligatorio, en este orden)
1. Lee `docs/worklog.md` — al menos las últimas 3 entradas.
2. Lee `docs/ROADMAP.md` — identifica la primera tarea NO completada.
3. Lee `docs/DECISIONS.md` — respeta las decisiones; no las reviertas sin registrar por qué.
4. NO asumas que el código "ya funciona": verifica (`bun run dev:e14` + revisa).

## AL TERMINAR CADA SESIÓN (obligatorio, antes de cerrar)
1. Añade UNA entrada a `docs/worklog.md` (plantilla abajo). APPEND al final; NUNCA
   sobrescribas ni edites entradas de otros.
2. Actualiza los checkboxes de `docs/ROADMAP.md` según lo real.
3. Si tomaste una decisión de arquitectura/diseño, regístrala en `docs/DECISIONS.md`.
4. Commit con Conventional Commits (`feat(e14): …`, `fix(e14): …`, `docs(e14): …`).
5. Si el contexto se está acabando o te piden parar: añade además una entrada `[HANDOFF]`.

## Plantilla de entrada de worklog
### [YYYY-MM-DD hh:mm] — <fase/tarea> — <agente o "sesión manual">
- **Hecho:** <lista concreta>
- **Archivos:** <rutas tocadas>
- **Commits:** <hashes cortos>
- **Cómo probar:** <comandos + qué debería verse>
- **Pendiente/Bloqueado:** <siguiente paso exacto, con detalle suficiente para retomar>

## Campos extra de [HANDOFF]
- **Estado del servidor:** <corriendo o no, puerto>
- **Última acción a medias:** <qué estaba pasando exactamente>
- **Primer paso de la siguiente sesión:** <instrucción precisa>

## Reglas técnicas
- No toques `apps/scanner-lab` ni `packages/scanner-core` sin necesidad explícita.
- Si necesitas un cambio en el core: NO lo hagas aquí; regístralo como `[REQUIERE-CORE]`.
- Commit pequeño y frecuente > commit gigante.
- Fase gráfica: prohibido añadir dependencias de cámara/procesado.

## Registro de kits (una línea por kit — detalle en docs/worklog.md y docs/REPORTE-*.md)
- `2026-10-16` **gate-v2** (PR #3, MERGEADO `2383820`): marcadores obligatorios SIN_VOTOS + flujo post-recorte normal.
- `2026-10-15` **actas-resumen-puesto-v2** (PR #4, MERGEADO `e777535`): ACTAS muestra el puesto REAL (última clasificación archivada) con countTable DIVIPOL + MODO SIMULACIÓN (toggle «SIM», overlay de vista) + RESUMEN espeja el puesto; alerta «MESAS INCOMPLETAS» y seed demo FUERA de ACTAS.
- `2026-10-16` **camara-visor-v1** (PR #5, MERGEADO `49a323d`): paquete cámara/visor del lab — láser fuera, preview por plataforma (540p Android), FOTO_LADDER + upgrade silencioso full-res, gate CAN_TAKEPHOTO, ring ≤1280, apertura rápida cacheada, medidor pill, visor del editor con marco FIJO + botón «Imagen».
- `2026-10-16` **visor-accion-score-v1** (PR #6, MERGEADO `2063443`): REVISIÓN — botón «Pantalla completa» fuera (la foto es táctil), barra de acciones FIJA abajo + tarjeta 56vh (invariante G8 intacto) y el SCORE mide el RECORTE del acta (`calidadDeActa`, bbox del quad +3%) NO la mesa del fondo — fin del falso «LUMINOSIDAD» del caso EL CAIRO.
- `2026-10-16` **actas-vivas-paginas-v1** (ESTA rama `feat/actas-vivas-paginas`, PR ABIERTO, SIN merge): ACTAS con SIM VIVO (un acta «sube» cada 5 s, guion en el store, PUESTO COMPLETADO ✓, D6 intacto) · la página del papel es DATO — desconocida ≠ P1 (hueco al primer libre, chip «PÁG - DE -», historial «PÁG ?») · huecos con estado OK/RESCANEO (chip ⚠ vivo, re-escaneo lo sube a ✓) · acta RECORTADA por OCR de secciones (techo 7.9 + pill; gate de votos SOLO P1).
- `2026-10-16` **actas-vivas-paginas-v1** (PR #7, MERGEADO `74b12d2` — rebase docs en unión sobre el STOP del 120): SIM VIVO (acta cada 5 s) · página DATO (desconocida ≠ P1) · huecos OK/RESCANEO · RECORTADA por OCR de secciones (techo 7.9; votos SOLO P1).
- `2026-10-16` **identificacion-codigo-v1** (ESTA rama `feat/identificacion-codigo`, PR ABIERTO, SIN merge): el acta trae SU cédula — gramática COMPLETA del código 1D impreso `codigoUnicoE14` (7100|KIT|TIPO|VER|PAG|TOT, 12/12 actas oficiales + 3 negativos, script `scripts/qa-codigo-unico.ts`) · CONSENSO multi-candidato + cruces en `clasificarCabecera` (banda↔d9 → conf 0.75; VerPag↔código → gana el código; kit del código si el pie falla — fin de SINKIT; MESA del registro `kits.ts` si la cabecera no la leyó — NUNCA AUTO) · esquinas fiduciales `integridad.ts` (4/4 = completa; falta una → canal 118 con el LADO «ACTA RECORTADA · SUP-IZQ»; en SIM no mide — chips intactos) · QR FUERA (blob opaco, documentado).
- `2026-10-16` **consenso-frankfurt-v1** (ESTA rama `feat/consenso-frankfurt`, PR NUEVO ABIERTO, SIN merge — ramificada desde PR #8 `feat/identificacion-codigo`): los 4 falsos positivos del dueño corregidos con evidencia medida — `marcasEsquina` adaptativa (integral + ventana ~3%W en las posiciones medidas; <80×120 → null) y los fiduciales PERDONAN al guard geométrico (4/4 → no condena tinta al filo) · `candidatosCodigo1D` (el «7» impreso como «/» — Frankfurt `/1000/453010202`) · KIT arbitrado pie/código/registro (`PIE_CODIGO_DISCREPAN`, `KIT_CODIGO_CORREGIDO`, `kitFuente`) · `MESA_FUERA_RANGO` (p.t divipol) + `MESA_REGISTRO_DISCREPAN` con baja AUTO→SUGERIDA · `ocrBanda` (sello blanco-sobre-negro: crop invertido ×2, una pasada) · chips honestos en REVISIÓN (tipo `---` sin señal; línea de ID `KIT ### · T · 1/2 · PIE|CÓDIGO|REGISTRO`) · QA `scripts/qa-consenso.ts` 29/29.
- `2026-10-17` **filtros-1** (ESTA rama `lab/filtros-1`, PR ABIERTO, SIN merge): laboratorio FILTROS-1 construido y validado en HUMO (rig 2 motores × 3 filtros con los filtros del app replicados 1:1 del worker + GT Apéndice B + láminas/galería/ZIP) — PASO OFICIAL DETENIDO: faltan las 4 fotos reales del dueño (perdidas con el reinicio del sandbox; ver `lab/README.md` §Bloqueante).
- `2026-10-17` **ocr-lee-original-v1 (PROD-1)** (ESTA rama `feat/ocr-lee-original`, desde `feat/informe-telemetria-ocr` @ `8443ff4` — PR #10 ABIERTO; PR NUEVO ABIERTO, SIN merge): TODO el OCR del producto lee el RECORTE SIN filtro (`processImage(quad, "original")`, crudo del warp — pipeline + rescate manual + re-OCR del editor; SIM as-is sin llamadas nuevas) y la IMAGEN mostrada/guardada sigue bw — trazas `ocrIn=` (original | original-as-is | bw-fallback) + `PipelineInfo.ocrInputFiltro` en el informe · fallback obligatorio: la variante nueva JAMÁS rechaza un acta · `ocrBanda` y matriz del informe INTACTOS.
- `2026-10-17` **score-lectura-v1** (ESTA rama `feat/score-lectura`, desde main `5feea02`; PR NUEVO ABIERTO, SIN merge): SCORE v2 «LA LECTURA MANDA» (A+B+C) — nitidez HI-RES (mediana de σ(Laplaciano) de 9 tiles a 1000px) + contraste de papel (p95−p5 del histograma) entran al bruto/level/contrasteEfectivo (piso §X QUEDA) + ajuste por LECTURA (módulo puro `senal-lectura.ts`: FUERTE mesa+4 anclas o ≥6 → piso 8.5 — vence al techo fair NUNCA al poor; DEBIL → techo 5.9; MEDIA no toca) en AMBOS pipelines ANTES de la inyección SIM y de los caps posteriores · trazas `lectura=/anclas=/piso=` · chips SIM 8.2/7.0/4.3 intactos · score de disparo en vivo FUERA de alcance (orden del dueño).
- `2026-10-17` **motor-rapidocr-v1 (PROD-2)** (ESTA rama `feat/motor-rapidocr`, desde `feat/ocr-lee-original` @ `609f324` — PR #12 ABIERTO; PR NUEVO ABIERTO, SIN merge): RapidOCR PP-OCRv4 es el ÚNICO motor de OCR de producción (escaneo + rescate + re-OCR del editor + banda del sello vía adaptador `reconocerRapidOcr` — sin fallback de motor) leyendo el recorte SIN filtro (regla PROD-1 intacta) · módulo `ocr/rapidocr.ts` COMPARTIDO producción/informe (singleton de sesión + pre-warm en background al importar el bridge) · progreso OCR real por lotes de rec · trazas `ocr=rapidocr conf/det/rec` + `PipelineInfo.ocrMotor/ocrConf` en el informe · matriz CONGELADA (solo import path + etiquetas «motor anterior») · requestOcr del core SOLO en motores.ts (instrumento).
- `2026-10-17` **quad-repro-v1 (T-C)** (ESTA rama `lab/quad-repro`, desde main `4aa2e06`; PR NUEVO ABIERTO, SIN merge — SOLO lab/+docs, cero producción): laboratorio del quad sub-detectado del zip2 de campo (rect perfecto y=0.333→0.601 con papel visible hasta y≈0.97 — huele a fallback del refine o a contorno parcial en la banda) — RIG COMPLETO + sanidad end-to-end (protocolo FILTROS-1: rig → evidencia → decisión): harness `lab/quad-repro.html`+`js` (protocolo REAL del worker §3 + crop estimado con el mismo cálculo bbox del bridge + ratio vs 2.9 + warp con quad de 8 fracciones + panel en vivo) · copia INSTRUMENTADA `lab/worker-copy/` (trazas `[quad-repro]` parseables: selectQuad cands/ganador → H2/H3, refine fellBack por lado → H1, detect corners/contourCount; cero cambios de lógica; sha del original en el header) · `lab/vendor` symlink → public/vendor (la copia carga el MISMO opencv self-hosted — el CDN 403 en sandbox; ruta ya prevista por opencvCandidateUrls) · `lab/fixtures/README.md` (procedencia + quads de referencia) — **PASO OFICIAL DETENIDO: los 2 ZIPs NO llegaron al sandbox** (kit: NO se ejecuta con fixtures inventados; §5 Fases 1-3 + láminas de fixtures pendientes de re-subida del dueño) · sanidad con el acta del repo: quad sano ratio 2.89, cascada trazada, warp 701×2171 (lámina commiteada) · CI: parity ×2 rojo EXTERNO (web-scanner/main avanzó lote 8 — sync del worker es decisión del dueño; REPORTE §6).
