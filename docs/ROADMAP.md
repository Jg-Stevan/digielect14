# ROADMAP — digitalizador-e14 (FASE GRÁFICA)

Leyenda: [ ] pendiente · [~] en progreso · [x] hecho

- [x] G0 — Scaffold de la app en el monorepo + copiar zip v2 a docs/design/ + docs base + commit
- [x] G1 — Tokens del tema (globals.css §5) + fuentes (Hanken Grotesk, JetBrains Mono) + primitivas
- [x] G2 — Shell: TopBar + BottomNav (estilo activo v2 §8) + router de vistas (zustand) + safe-area
- [x] G3 — Dominio completo (§6) + seed mock (§6.4) + bridge mock
- [x] G4 — ESCANEAR: placeholder visor + botón disparo + panel de simulación (forzar estados)
- [x] G5 — ANALIZANDO: anillo + % + línea de escaneo + 4 barras de paso + footer
- [x] G6 — REVISIÓN: documento (§7.3) + 4 estados (§7.4) + banner rico rechazada (§7.5) + flotantes
- [x] G7 — ACTAS: CONTROL ACTAS E-14 con acordeón de mesas (§7.6)
- [x] G8 — RESUMEN: dashboard de trabajo (§7.7)
- [x] G9 — GitHub Pages: basePath + workflow parametrizado + verificación en /web-scanner/ (luego supersedido por Pages dual — ver D13)
- [x] G10 — DoD completa (§10) + revisión visual lado a lado con screen.png + QA externa (FIXES-e14-qa.md: 2 fixes aplicados y verificados)

## FASE LÓGICA (SPEC-fase-logica.md §8)

- [x] L0 — Andamiaje: dep workspace `@jg-stevan/scanner-core` + transpilePackages + assets worker/opencv en public/ + bun.lock
- [x] L1 — Contrato async (mock intacto): tipos §3 + CompositeBridge (D19) + store async con progresoAnalisis + ANALIZANDO event-driven con piso escénico (D18) — regresión cero en SIMULACIÓN
- [x] L2 — Fuente ARCHIVO real: RealCoreBridge (pipeline §5 + mapeo §4 + gate ILEGIBLE §4.2 + timeout 15 s) + chips de fuente en ScanView + ReviewView "VER FOTO" (D20–D23)
- [x] L3 — Fuente CÁMARA real + interfaz de escaneo del lab COMPLETA: CameraFrameLoop + HUD + BUSCANDO ACTA… + quad en vivo + IA·AUTO (OFF default, D24) + flash F-FLASH v3 + ZSL best-shot + ruta iOS + destello (D25-D27)
- [x] L4 — EXPORTAR PDF: adaptador §6 + CTA en REVISIÓN (solo actas reales)
- [x] L5 — Editor de recorte: COPIAR subsistema CROP de scanner-lab/EditorView.tsx (§7.5) + toolbar real de REVISIÓN (D28–D31)
- [x] L6 — Persistencia de jornada: IndexedDB vanilla `e14-jornada-v1` (estado liviano + slot del acta en revisión con fotos) + «REINICIAR JORNADA» (2 toques) + mesas reales derivadas (SIM OFF no quema progreso) — kit e14-pwa-persistencia-v1 (PR #38)
- [ ] L7 — (opcional) Cámara sintética en SIMULACIÓN (SyntheticCamera del core)

## FIDELIDAD AL LAB (SPEC-auditoria-copias.md — fix/e14-fidelidad-lab)

- [x] H1 — F-LENS v4 completo: sondas secuenciales + chooseMainProbe + fix zoom + telemetría `__cameraChoice` (D33)
- [x] H2 — F-SENSOR-PROFILER: perfilado del track + takePhotoBlob (capas 1-2) + capa 3 decode único/tope por GAMA cubriendo CÁMARA e IMPORTAR (D34)
- [x] H3 — captureSmart: snapA ANTES del disparo (§5.4 del lab)
- [x] H4 — TORCH_HINT verbatim completo (diagnóstico de campo para el operador)
- [x] H5 — IMPORTAR: accept `.heic/.heif` en ambos inputs + guard F-IMPORT/HEIC del lab
- [x] H6 — PWA instalable + offline: SW network-first del lab + cache del MOTOR OCR al primer uso (~30 MB) + banner de actualización consentido (E-04) — kit e14-pwa-persistencia-v1 (PR #38)

## UX REAL (SPEC-ux-real-bn-editor.md — fix/e14-ux-real)

- [x] R0 — AGENTS.md en la RAÍZ con la REGLA DE ORO #0 (el lab es la fuente de verdad) + enlace al tope de README.md
- [x] F1 — SIMULACIÓN = pipeline real sobre el acta E-14 REAL incluida (D35): mock retirado, chips de forzado obsoletos, gates esReal por foto
- [x] F3 — VER FOTO y papel sintético eliminados: la foto real es el visor único (ActaDocument borrado)
- [x] F5 — barra de controles FIJA en la parte inferior del editor de revisión (D38)
- [x] F2 — filtro «B/N adaptativo» por defecto + selector de filtros (copia del lab, D36)
- [x] F4 — QuadEditor con ROTAR 90° y DETECCIÓN AUTOMÁTICA (copia del lab, D37)

**Estado:** PR #8 MERGEADO a `main` (merge commit `eda6714`, 2026-10-10) · CI Pages verde · smoke test de producción OK (golden path + editor + filtros + barra fija al píxel + h-dvh móvil + lab sin regresión — ver worklog 14:40). **En producción:** https://jg-stevan.github.io/web-scanner/

## F-OCR — BOTÓN «TEXTO» (SPEC-texto-ocr-editor.md — feat/e14-texto-ocr)

- [x] B1 — ToolbarBtn.active (re-vestido ToolItem L2208) + barra grid-cols-5 con TEXTO en 4ª posición, `active={hayTexto}` (D39)
- [x] B2 — bridge.reconocerTexto (requestOcr sobre fotoProcesada) + store.reconocerTextoActa con toasts del lab (D39)
- [x] B3+B4+B6 — sheet «Texto reconocido» 3 estados + contadores + «Reconocer de nuevo»/«Copiar texto» (patrón del sheet de filtros, sin vaul) (D39)
- [x] B5 — OcrHighlightedText completo (mark #ffd60a literal, query={null} hoy) (D39)
- [ ] F-FIND — barra de coincidencias del lab (L2347-2366 + pendingFindQuery): EXCLUIDA de esta copia — su único punto de entrada es la búsqueda de la biblioteca del lab; e14 no tiene biblioteca. `OcrHighlightedText` YA queda listo (solo faltará pasarle la query cuando exista un buscador).

**Estado:** PR #9 MERGEADO a `main` (merge commit `83e5838`, 2026-10-10) · CI Pages verde (run `38012198805`) · smoke test de producción OK (TEXTO con el OCR real del pipeline: 170 palabras | 745 caracteres idénticos al QA dev · Reconocer de nuevo · Copiar texto + toast · botón active · barra fija al píxel con 5 columnas · h-dvh · lab sin regresión — ver worklog 16:15). **En producción:** https://jg-stevan.github.io/web-scanner/

## F-CLASIF — CLASIFICACIÓN DE CABECERA contra DIVIPOL oficial (SPEC-e14-cabecera-clasificacion.md — feat/e14-clasificacion-cabecera)

- [x] §1 — base DIVIPOL del visor oficial (34 deps · 1.189 mun · 3.013 zonas · 14.438 puestos — validada 1:1 con Cairo/Frankfurt/Bremen) + bundle compacto `public/e14/divipol.json` (620 KB) + `scripts/gen-divipol.mjs` con guard de conteos
- [x] §2 — `divipol.ts`: carga fetch local (basePath, caché, estado, NUNCA falla) + índices + trigramas/Dice sin deps
- [x] §3 — `clasificador.ts`: anclas VERBATIM §3.2 + normalización NFKD + fuzzy Dice + estrategia §3.3 + veredicto AUTO/SUGERIDA/MANUAL (PATRON_CABECERA nunca es pase libre)
- [x] §4 — gate REVISADO (evaluarGate único para escaneo y recorte): RECHAZADA solo por CALIDAD · AUTO → status por score · SUGERIDA/MANUAL → EN_REVISION_HUMANA (PROHIBIDO rechazar por cabecera) · log `clasif={...}` (§4.6)
- [x] §5 — PanelClasificacion: cascada Dep→Mun→Zona→Puesto→Mesa + tipo + páginas, precarga de la sugerencia, GUARDAR UBICACIÓN + REPETIR FOTO, texto libre sin base, max-h-96, touch 44 px
- [x] §6 — Fase B: archivadas por clave de mesa (ceros) + huecos DELEGADOS|TRANSMISIÓN × 1/2, duplicado → reemplaza y avisa (§G.4.1), ACTAS «MESAS CLASIFICADAS» antes del seed, export `E14_{KIT}_{...}_{TIPO}-{pag}.pdf` (§G.4.5)

**Estado:** **PR #11 MERGEADO a `main`** (merge commit `e8f76ff`, 2026-10-10, método merge contra main@153e303) · CI Pages verde (run `38057755908`) · smoke test de producción OK (móvil + desktop): la acta Frankfurt real se **auto-clasifica AUTO 88·120·15·02·012 y se envía sola** (log `clasif={...}` §4.6 exacto en prod) · ACTAS «Frankfurt Consulado · MESA 12» · `divipol.json` 200 (635 KB, 34 deps) · h-dvh 844/800 exactos · lab sin regresión (ver worklog 18:40). Auditoría del dueño cerrada: el bloqueante «L95/L128» resultó **FALSO POSITIVO** — artefacto del display del sandbox que elimina «`[m`» del texto mostrado por Bash (blob `ea4f390` byte a byte correcto; ver worklog 18:10). **En producción:** https://jg-stevan.github.io/web-scanner/

### Fuera de alcance (decisión del dueño, §0/§8)
- [ ] Manuscritos G.2/G.3 (votos/firmas/cédulas) — cubiertos por la revisión humana existente
- [ ] Consulta viva AppSync (§G.4.6, fase futura)
- [x] H6 PWA — decisión del autor (hecha en e14-pwa-persistencia-v1, PR #38)

## F-INFO — TÍTULO/UBICACIÓN REALES + TIPO HONESTO + dígito 9 del 1D (SPEC-e14-titulo-ubicacion-clasificada.md — feat/e14-info-clasificada)

- [x] S1 (§1) — pass-through de la clasificación al acta: helper ÚNICO `tituloYUbicacionDe` (AUTO con ruta → standName uppercase + ubicación por NOMBRE/CÓDIGO/mesa 3 dígitos; resto → null = seed) aplicado en los 3 puntos de entrada: `construirActa` (gate del escaneo) · `pipelineRecorte` (rescate L5) · `store.guardarUbicacion` (panel §5)
- [x] S2 (§2) — `detalleUbicacion` (ReviewView): clasificación REAL a cualquier nivel con PAÍS/MUNICIPIO + `MESA ${padStart(3)}` canónica, «—» en lo no leído; `ruta` ahora con `acta.clasificacion` (antes solo AUTO)
- [x] S3 (§3) — `BANDA_DELEGADOS = /EMBAJADOR|DELEGADOS/` (el `C[OÓ]NSUL` suelto matcheaba la caja «CONSULADO: 88» de TODAS las copias → DELEGADOS falso en la TRANSMISIÓN de El Cairo del dueño) + ancla `ANCLA_CODIGO_1D` (15 dígitos impresos, §D.2/§F 8/8) con d9 como RESPALDO del tipo (3=T/2=D, conf 0.9, solo sin banda; contradictorios → null) y d12-15 como respaldo de PÁGINA (solo código único y aritmética válida)

**Estado:** **MERGEADO ✅** (PR #13 → main `7a0502d`, merged_at 2026-10-10T16:47:41Z, merged_by Jg-Stevan vía API con candado sha `664f4eb` — merge commit, NO squash: `cf1cd09`+`664f4eb` íntegros). Re-auditoría del merge: dry-run local 0 conflictos + gates re-verificados (lint 0 · tsc 0 · unitario verde · lab/packages intactos). CI del merge: Actions run `38069100083` success (~60 s, deploy Pages). Smoke test prod: `/`, `divipol.json`, `/lab/` 200 + código F-INFO confirmado en el bundle (`PUESTO SIN NOMBRE` de `cf1cd09` en chunk 371lkmupx98ru.js). QA completo en worklog 10:45: unitario 22/22 (AC3/AC4/S3-regresión/helpers/guardas/mandos) · navegador 390×844 dev :3001 todo verde (AC1 Frankfurt `CONSULADOS > ALEMANIA > … MESA 012 …` exacto · AC2 «EL CAIRO - CONSULADO» + detalle EGIPTO completo · AC3 d9=3 `tipo:T` AUTO sin palabra de banda y CERO «DELEGADOS» · AC4 banda → `tipo:D` · AC5 borrosa 5.7 RECHAZADA + seed ITALIA + formato historial · AC6 `%PDF` + nombre `E14_SINKIT_88_335_05_02_001_TRANSMISION-1.pdf` + /Title «EL CAIRO - CONSULADO — MESA 001» + visor Esc) · AC7 lint/tsc/build EXIT=0 + `diff apps/scanner-lab packages` VACÍO + 0 errores consola. Registro del merge: worklog 11:47.

## F-SCORE-LEGIBLE — EL OCR/IDENTIFICACIÓN MANDA SOBRE LAS MÉTRICAS DEL CRUDO (SPEC-e14-score-legible.md — feat/e14-score-legible)

- [x] C1 (§1) — `contrasteEfectivoDe` + `scoreDeCalidad(q, señales)`: piso de contraste efectivo 80 con OCR válido (recalcula el `level` con la fórmula del core duplicada `// Fuente:` — packages intocable) + piso de score 8.2 para clasificación AUTO (después de los techos — la identificación manda; SUGERIDA/MANUAL sin piso)
- [x] C2 (§2) — clasificación ANTES del score en AMBOS pipelines (escaneo y recorte): `evaluarGate` síncrono que recibe la clasificación ya calculada, misma tabla de decisión; logs con `contEff` en `metricas={...}` (trazabilidad §4.6)

**Estado:** **MERGEADO ✅** (PR #16 → main `306c937`, merged_at 2026-10-10T22:15:12Z, merged_by Jg-Stevan vía API con candado sha `bd09edf` — merge commit, NO squash). QA navegador 390×844 build estático (worklog 17:15 Bogotá): AC1 caso del dueño `score=8.5` (antes 6.7 MODERADA) + `contrast:22 contEff:80` + auto-ENVIADA TRANSMISIÓN P1 ✓ · AC2 max puro nunca reduce, SIM `contEff:100=contrast` (matiz: SIM 8.2 por piso §X.2 AUTO per §3; ac3-v5 9.1 — su contrast real 70 con OCR válido → contEff 80) · AC3 blur-14 real `ocrValido=false` → `contEff:15` SIN piso → `3.7` RECHAZADA + INTENTO 1 DE 2 · AC4 nítida sin E-14 `9.3` con panel (sin piso §X.2 en MANUAL) · AC5 negra ruido `2.6` RECHAZADA (el piso no fabrica calidad) · AC6 contEff difiere solo cuando actuó + 0 errores consola · AC7 lint/tsc/build 0 + lab/packages VACÍO. CI 306c937 success; prod: `contEff` + `PUESTO SIN NOMBRE` confirmados en el bundle.

## F-SCORE-10-IDENTIFICADA — ACTA IDENTIFICADA AUTO = 10/10 ÓPTIMA (SPEC-e14-score-10-identificada.md — feat/e14-score-10)

- [x] P1 (§1) — `PISO_IDENTIFICADA` 8.2→10 (2 bloques EXACTOS en scanner-core-bridge.ts, bytes verificados con node fs): una acta identificada AUTO (jerarquía divipol + mesa + tipo) puntúa 10/10 ÓPTIMA — el score describe la CERTEZA de la digitalización, no el crudo; `Math.max` conservado (piso que nunca reduce) · SUGERIDA/MANUAL sin piso (JAMÁS un MANUAL muestra 10) · `PISO_CONTRASTE_LEGIBLE=80` y techos fair 7.9/poor 6.4 intactos
- [x] P2 — registro CHANGES.md sección 0-quin (petición literal del dueño: «¿cómo podemos establecer para subir el score al 10/10, que no se quede en 8?»)

**Estado:** **MERGEADO ✅** (PR #17 → main `ec7e94f`, merged_at 2026-10-10T23:37:18Z, merged_by Jg-Stevan vía API con candado sha `41b0b59` — merge commit, NO squash). Diff: SOLO scanner-core-bridge.ts + CHANGES.md (+21/−1), 0 líneas en scanner-lab y packages. QA navegador 390×844 build estático (worklog 18:37 Bogotá): AC1 caso del dueño `score=10` (antes 8.5) contrast:22 contEff:80 + «✓ 10.0/10 ÓPTIMA · ENVIADO CORRECTAMENTE · ✓ ENVIADO AUTOMÁTICAMENTE» · AC2 SIM 10 contEff:100 ALEMANIA · AC3 panel honesto 9.3 MANUAL sin 10 · AC4 blur14 `3.7` + negra-ruido `2.6` RECHAZADAS · AC5 recorte sobre RECHAZADA 5.6 SIGUE RECHAZADA + recorte sobre AUTO vía rescate D20 `10` nivel:AUTO · AC6 PDF 18.019 bytes %PDF-1.3 + CERO errores consola · AC7 lint/tsc/build 0. CI ec7e94f success (run `38095664226`); prod: `/` y `divipol.json` 200 + `Math.max(n,10)` confirmado en el chunk `0wa8jkhhu8yio.js` que contiene `contEff` — piso 10 en producción, el 8.2 ya no existe en el bundle.

## F-REDISEÑO-REVISIÓN-AUTOMATIZADA — ADVERTENCIA AL MOCK + FLUJO DE RECHAZOS AUTOMATIZADO (SPEC-e14-rediseno-revision-automatizada.md — feat/e14-rediseno-revision)

- [x] P1 (D1–D6) — TopBar dinámica `[● ⚠ 7.8/10 ADVERTENCIA · TÍTULO]` (score real + palabra por estado —enmienda: «ADVERTENCIA» ámbar— + título truncado + fallback «REVISIÓN DE ACTA») · TarjetaRica de ADVERTENCIA ELIMINADA (info redistribuida) · chips [TRANSMISIÓN][MESA 001][PÁG 1 DE 2] · banner «REVISIÓN REQUERIDA (LEVE DESFOQUE|CONTRASTE|LUMINOSIDAD)» por métrica más baja (display-only) · toolbar de 3 (Filtros/Texto solo RECHAZADA/OPTIMA) · CTAs en pila: verde «✓ CONFIRMAR Y ENVIAR DE TODOS MODOS» (h-13) + «REPETIR CAPTURA (FOTO MÁS NÍTIDA)»
- [x] P2 (§7) — maxIntentos 2→4, el conteo cuenta CAPTURAS: SUGERIDA/MANUAL con calidad OK → «repetir-primero» (banner CLASIFICACIÓN PENDIENTE, panel oculto) hasta agotar → CONTINGENCIA (panel + toast «ENVIADA A CONTINGENCIA» + historial + VOLVER AL ESCÁNER) · score<6.5 → SOLO «OBLIGATORIO REPETIR FOTO (INTENTO X DE 4)» (botón manual ELIMINADO, enviarRevisionHumana borrada rg=0) · contingencia automática C4 al agotar · recorte NO consume intento · `evaluarGate(score, ocr, clasif, intento, maxIntentos)` en ambos pipelines
- [x] P3 (D8) — badge rojo en ACTAS con las contingencias del turno (historial REVISION_HUMANA), oculto en 0, aria-label «Contingencias pendientes»

**Estado:** **MERGEADO ✅** (PR #20 → main `5eefe01`, merged_at 2026-10-11T01:12:05Z, merged_by Jg-Stevan vía API con candado sha `4de430c` — merge commit, NO squash; rebase previo sobre `6a99ddf` por PRs #18/#19 paralelos del lab, conflicto CHANGES.md resuelto en orden cronológico). Diff: TopBar/ReviewView/BottomNav/store/bridge/types + CHANGES.md 0-sexto, 0 líneas en scanner-lab y packages. QA navegador 390×844 build estático (worklog 20:12 Bogotá): AC1 ADVERTENCIA=mock completo vía panel→GUARDAR (7.1/10) · AC2 CONFIRMAR→ENVIADA intacta + REPETIR armado · AC3 borrosa 4º intento→contingencia automática+badge 1 · AC4 repetir-primero panel oculto→al 4º contingencia+badge 2 · AC5 score real · AC6 owner 10.0/10 + GENERICO intacta + recorte sin intento · AC7 badge 0→1→2→3 · AC8 lint/tsc/build 0 + rg=0 + CERO errores consola. CI 5eefe01 success (run `38101029343`); prod: literales del rediseño confirmados en el bundle y «ENVIAR A REVISIÓN HUMANA» (botón manual) 0 matches.

## F-REDISÑO-REVISIÓN-R2 — TOOLBAR UNIFICADA DE 3 EN TODOS LOS ESTADOS DE CORRECCIÓN (SPEC-e14-rediseno-revision-automatizada Rev. 2 — feat/e14-rediseno-revision-r2)

- [x] P1 (D5 Rev. 2) — toolbar UNIFICADA `grid-cols-3` (Recortar·Rotar 90°·Pantalla completa) en ADVERTENCIA · RECHAZADA · EN_REVISION_HUMANA (repetir-primero Y contingencia) — Filtros y Texto SALEN de los tres (sheets sobreviven SOLO en OPTIMA-rescate, `grid-cols-5` EXACTO)
- [x] P2 (AC4b) — RECORTAR re-evalúa sin consumir intento en reintento/contingencia: recorte que produce AUTO + score ≥ 8 → pantalla OPTIMA de rescate (D20); si no → misma fase. Mecanismo verificado: OCR del recorte a resolución nativa (≤1600px) lee la cabecera que el escaneo full-image no leía (reducción ×0.4) — la cura del «quad mal detectado por el sistema»

**Estado:** **MERGEADO ✅** (PR #22 → main `acb778a`, merged_at 2026-10-11T02:49:00Z, merged_by Jg-Stevan vía API con candado sha `3d94d7e` — merge commit, NO squash). Diff: ReviewView.tsx + CHANGES.md 0-septimo (+38/−10), 0 líneas en scanner-lab y packages. QA navegador 390×844 build estático (worklog 21:49 Bogotá): AC1 ADVERTENCIA=mock (7.7) · AC2 ambos CTAs · AC3 RECHAZADA con toolbar de 3 + contingencia automática · AC4 reintento/contingencia con toolbar de 3 · **AC4b ambas ramas: «permanece» (log recorte re-corrió, INTENTO 1 DE 4 intacto) y «OPTIMA» (recorte de cabecera → clasif AUTO → 10.0/10 ÓPTIMA con toolbar de 5)** · AC5-AC8 ✓ + toast contingencia capturado + badge 0→5. CI acb778a success (run `38106368533`); prod: condición unificada `"ADVERTENCIA"||"RECHAZADA"||"EN_REVISION_HUMANA"`→grid-cols-3 confirmada en el bundle, patrón Rev. 1 eliminado (0 matches).

## F-REDISÑO-ENVIADA-R2 — PANTALLA ENVIADA AL MOCK DEL DUEÑO + FLUJO PDF ELIMINADO (SPEC-e14-rediseno-enviada Rev. 2 — feat/e14-rediseno-enviada)

- [x] E1 (D2) — Pill flotante «✓ score/10 ÓPTIMA • Enviado correctamente» de ENVIADA ELIMINADA (la info vive en la TopBar D1 del PR #20 y en la fila de estado E3); pills OPTIMA/GENERICO y banner EN_REVISION_HUMANA intactos
- [x] E2 (D3) — Tarjeta héroe limpia y tocable SOLO en ENVIADA: `<button aria-label="Ver acta a pantalla completa">` → overlay existente; `bg-white p-1.5 border border-line rounded-xl` SIN brackets (la imagen B/N llega al borde, como el papel del mock)
- [x] E3 (D4+D5) — chips `[TRANSMISIÓN][MESA 001][PÁG 1 DE 2]` (mesa canónica de 3 dígitos del pipeline) + fila de estado `data-testid="fila-estado"` justify-between: «✓ ENVIADO AUTOMÁTICAMENTE» … hora a la derecha + SHA-256 micro-caption (evidencia de transmisión conservada)
- [x] E4 (D6) — CTA único «SEGUIR ESCANEANDO» (h-13, verde): el branch `esReal` de 2 botones desaparece
- [x] E5 (D7) — Flujo de exportación a PDF eliminado de la cadena COMPLETA (botón→`exportarPdfActa` store→contrato bridge→método real + import `pdf-export`); `packages/scanner-core/pdf-export` INTACTO (scanner-lab lo usa — regla de oro) · specifiers de import con usos únicos dentro del método también retirados (higiene) · el PDF NUNCA fue parte del payload de transmisión

**Estado:** **MERGEADO ✅** (PR #24 → main `1b94d2c`, merged_at 2026-10-11T12:52:52Z, merged_by Jg-Stevan vía API con candado sha `7552790` — merge commit, NO squash, 2 padres; **tras aprobación explícita del dueño** — política nueva: PR abierto para prueba en Vercel Preview antes del merge). Diff: ReviewView.tsx + bridge.ts + scanner-core-bridge.ts + store.ts + CHANGES.md 0-noveno (+123/−170), 0 líneas en scanner-lab y packages. QA navegador 390×844 build estático (subagente; worklog 07:58 Bogotá): AC1-AC8 ✓ (héroe blanca tocable sin brackets, breadcrumb divipol real, fila-estado con hora HH:MM:SS + SHA-256, CTA único 52px, `__pdfAttempts=0` con hook anti-descarga, 360×780 sin overflow, 0 errores de consola). Gates del merge re-corridos: lint 0 · tsc 0 · build estático 3/3 · scope confinado · rg vaciado=0. CI `1b94d2c` success (run `38140960522`); **prod: INVERSIÓN del fingerprint verificada** — «EXPORTAR PDF»/«exportarPdfActa»/«PDF GENERADO» **0 matches** en los 8 chunks de la homepage (chunk pre-merge `2p9ebpspmi5f8.js` → 404); «SEGUIR ESCANEANDO»/«fila-estado» VIVOS en el chunk per-ruta `3cf3ylkbge3wl.js` con chips TRANSMISIÓN ×17 · MESA ×20 · PÁG ×4 · SHA-256; piso score-10 intacto (`identificada&&(r=Math.max(r,10))`). PRs paralelos #23/#25 siguen abiertos.

## FIX — e14-recorte-manual-v1 (2026-10-18): el recorte manual dice la verdad

- [x] T1 — Presupuesto propio del recorte (30 s) + patrón `parcial`: el timeout RECHAZA pero MUESTRA el recorte ya horneado (nunca la foto vieja). Escaneo intocable.
- [x] T2 — El fallo del recorte deja de ser silencioso: `errorRecorte` + píldora en REVISIÓN + `aplicarRecorte` booleano; el editor NO se cierra en error duro (D42).
- [x] T3 — Recorte manual sin tinta → aviso honesto «TU RECORTE SE APLICÓ — …» (swap §D4 intacto, umbral de tinta intacto).

## CHORE — e14-fuera-informes-v1 (2026-10-18): fuera los informes automáticos

- [x] R-1 — INFORME-TELEMETRÍA v1 fuera completo (informe/ ×7 + InformeDescarga + hook B2 + try-block B8 + evento() de rapidocr) (D43).
- [x] R-2 — Auto-descarga del ZIP de diagnóstico fuera (consumers B1/B3/B4/B5; diagnostico.ts recortado a construirDiagnostico; fflate fuera de deps).
- [x] R-3 — Botón manual «Diagnóstico» fuera; barra de REVISIÓN grid-cols-3 fijo.
- [x] R-4 — `acta.diagnostico` dormante verificado (traza diag=1 intacta).

## PERF — e14-optimizacion-v1 (2026-10-18): velocidad + higiene + contador de motivos

- [x] T1 — Memo de decodificación FIFO tope 2 (`loadImageMemo`): la misma dataURL del acta en vuelo se decodifica UNA vez (bridge ×4 + completitud + image-utils); rapidocr intacto.
- [x] T2 — ORT `proxy=true`: det/cls/rec al worker interno — el progreso deja de congelarse 10-14 s (misma fidelidad, revertible 1 línea).
- [x] T3 — Fuera `ort-wasm-simd-threaded.jsep.{wasm,mjs}` (−28.3 MB de repo; runtime jamás los pide).
- [x] T4 — Higiene: `notaWebgpu` + 13 iconos sin uso fuera.
- [x] T5 — Contador de sesión «POR QUÉ NO SE ENVIO» (D44): medir antes de calibrar; gate intocable.
- [ ] T6 — EXPERIMENTO det 1920→1280: espera aprobación del dueño en el PR + validación con ZIPs de campo en su equipo (commit separado revertible).
- [ ] Plan de carga masiva (AUDITORIA §8.4): con el código limpio y medido — módulo nuevo de orquestación, cero dependencias.

## MASIVA — e14-carga-masiva-v1 (2026-10-19): cola de fotos desktop-first (AUDITORIA §8.4)

- [x] T1 — Tipos + cola persistente IndexedDB VANILLA (DB `e14-masiva-v1`; File+acta en IDB, filas livianas en RAM; `recuperarCola` anti-zombis).
- [x] T2 — Runner SECUENCIAL singleton (1 foto a la vez; MISMO `escanearActa`; progreso throttled; thumb 320; auto-pausa al abrir acta) + mini-store zustand MASIVA.
- [x] T3 — Integración mínima aditiva al store principal: Vista+"masiva" · T5 extraído a `contarMotivoNoEnvioActa` (byte-idéntico) · `registrarEnvioMasiva` (registrarEnvio real) · `abrirActaMasiva`+`masivaOrigen`.
- [x] T4 — MasivaView (dropzone drag&drop, bandeja con filtros/estados, VACIAR 2 toques, ENVIAR ADVERTENCIAS en lote) + ítem MASIVA en nav (StitchStackIcon) + regla de origen.
- [x] Identidad de desenlace §7.2 verificada: misma foto → mismo desenlace por IMPORTAR y por MASIVA (8.5/7.9/4.6 exactos).
- [ ] FUERA DE ALCANCE v1 (kit §9): export ZIP/CSV · concurrencia >1 · re-intentos automáticos de RECHAZADAS · OCR por zona · cola en la nube.

## VERCEL-PERF — e14-vercel-perf-v1 (2026-10-19): demo multihilo en Vercel (D46)

- [x] T1 — `vercel.json`: build estático con `NEXT_PUBLIC_BASE_PATH=/digielect14` (paridad GH Pages) + headers `COOP: same-origin` / `COEP: require-corp` en `/(.*)` — activa `crossOriginIsolated` → `numThreads = min(4, cores)` de rapidocr (T2 del kit optimizacion) SIN tocar código. Deploy manual conservado.
- [x] T2 — Verificación local: lint 0 · tsc 0 · build estático OK · servidor con headers exactos → `crossOriginIsolated=true`, 0 bloqueos COEP, pipeline completo con desenlace idéntico (8.2 ÓPTIMA auto-envío, cod 710007453010102).
- [x] T3 — Docs: REPORTE + D46 + esta entrada + worklog + AGENTS.
- [x] T4 — PR DRAFT (merge solo con orden del dueño).
- [ ] Post-merge (dueño, PLAN §6): deploy en Vercel (dashboard o `bunx vercel deploy --prod`) → inspector (`E14.informe()`) sobre las 2-3 actas de la línea base → comparar vs GH Pages (34-68 s / rec 23-34 s, mono-hilo).
- [ ] Opción pendiente de decisión: fase 2 Electron/nativo (solo si la demo web no alcanza).

## MASIVA-UX — e14-masiva-ux-v1 (2026-10-19): detección al importar + formatos + estados de envío

- [x] T1 — Detección al importar espera el worker OpenCV (tope 5 s, mecanismo warmUp/waitReady del core) + 1 reintento si el quad vino de Sobel; log `detectOrigen=`/`detectReintento=1` (solo añadidos al final). Editor manual y SIM intocados.
- [x] T2 — Masiva acepta ZIP/RAR/HEIC: fflate + node-unrar-js con import DIFERIDO (D47 — bundle eager +0.41 %) · guards PROTEGIDO_O_CORRUPTO / SIN_IMAGENES_DENTRO / ARCHIVO_ANIDADO / LIMITE_500_POR_COMPRIMIDO / FORMATO_NO_SOPORTADO como filas ERROR · aviso «CONVIRTIENDO HEIC…» · accept ampliado.
- [x] T3 — Estado de envío por fila: «EN COLA» (offline, hashSha256 kit-literal) / «ENVIADA AUTO» / «ENVIADA» + contadores `ENVIADAS · EN COLA · PENDIENTES · ERRORES` + drenaje al reconectar (y al montar — reconciliación idempotente).
- [x] T4 — `timeoutMs?` en escanearActa (default 15 s individual INTACTO) · masiva 120 s (D48): con multihilo el pipeline real ~21 s ya no vence a los 15 s con resultado descartado; secuencial estricto D45.
- [ ] Del dueño: RAR con imágenes (aquí no hay `rar`) · HEIC real de iPhone · lote lento ~21 s en SU PC (T4 real) · offline real (avión).

## INFORME — e14-informe-analisis-v1 (2026-10-20): informe de análisis de rechazos en ZIP local (D49)

- [x] T1 — `src/lib/e14/informe.ts` (puro): `generarInformeZip()` — informe.json (sin dataURLs) + informe.txt + carpetas actas/ con original/procesada byte-idénticos + ficha.json completa; secuencial uno-a-la-vez; tope 250 MB/50 actas; `COLA_VACIA` descriptivo.
- [x] T2 — Botón «INFORME ↓» en RESUMEN (hueco del retirado EXPORTAR REPORTE): disabled con cola vacía (chequeo al montar), GENERANDO… + píldora status, LISTO ✓ 1.5 s, alert ≤48 en fallo — sin toasts (D2), 44px, import diferido (D49).
- [x] T3 — Docs: REPORTE + D49 + esta entrada + worklog + AGENTS.
- [x] T4 — PR DRAFT (merge solo con orden del dueño).
- [ ] Del dueño: merge · prueba con jornada real completa (100+ fotos) · validar el tope de 250 MB si la jornada es muy pesada.

## PROWARM-OCR — e14-prowarm-ocr-v1 (2026-10-19): pre-warm REAL de RapidOCR (cero frío en la 1.ª acta)

- [x] T1 — `rapidOcrPrecalentar()` (rapidocr.ts): UNA inferencia dummy sobre canvas SINTÉTICO 640×480 por det+cls+rec sobre el singleton `rapidOcrInit()`, resultado DESCARTADO (§0.2 — nunca `reconecerRapidOcr` del bridge, `ultimoOcr*` intocables); flag de módulo = 1× por carga; fallo → log + `false` (frío como hoy, init reintentable).
- [x] T2/T2b — Disparo al montar MASIVA (fire-and-forget, sin UI §0.7) + diferido 2 s en ScanView con clearTimeout (idempotente entre ambos por el flag).
- [x] V — lint 0-0 · tsc 0 · build OK · SIM 8.2/7.0/4.3 exactos · traza del pipeline intacta (mismo quad/cod/score 8.5, pre-warm NO sumado) · 1 sola traza `[e14-prowarm]` por carga · fallo controlado (onnx bloqueado → fallback honesto + recuperación del pipeline) · bundle +830 B en chunk existente (main chunk idéntico) · heap +8.5 MB movidos a antes de la 1.ª acta.
- [x] T3 — Docs: REPORTE + D50 + esta entrada + worklog + AGENTS.
- [x] T4 — PR DRAFT (merge solo con orden del dueño).
- [ ] Del dueño: merge · redeploy manual en Vercel (`docs/DEPLOY-vercel.md` §2) + Ctrl+Shift+R · validar la eliminación del frío en SU entorno: `[e14-prowarm] listo` al montar MASIVA y 1.ª acta real SIN el pico de 35.9 s (comparable a caliente 8.3 s).
## BENCH-REC-INT8 — e14-bench-rec-int8-v1 (2026-10-19): banco int8 del rec (SOLO evidencia, cero producción)

- [x] T1 — `tools/bench-rec-int8/cuantizar.py`: cuantización dinámica del rec (QUInt8 — fallback §3-T2.7 tras salida degenerada de QInt8, hallazgo doble-verificado CPU EP + wasm EP) con paso previo oficial de ORT (`quant_pre_process` skip_symbolic_shape); artifact local ignorado por `.gitignore` (`tools/bench-rec-int8/*.onnx`).
- [x] T2 — `tools/bench-rec-int8/bench.html` standalone (sin build): EP wasm idéntico a producción (wasmPaths vendido byte-idéntico, SIMD, numThreads COI), corpus sintético determinista de 60 líneas estilo acta, pre/post réplica exacta de `rapidocr.ts` (lote 6 por ratio, W=floor(48·max(320/48,r)), NCHW BGR (x/255−0.5)/0.5, CTC greedy), protocolo caliente+medida, tabla + «DESCARGAR JSON» manual.
- [x] T3 — `tools/bench-rec-int8/README.md` (reproducción exacta + umbrales GO/NO-GO).
- [x] Evidencia (2 núcleos, HeadlessChrome 155, numThreads=2): peso −73.5% (10.35→2.75 MiB) · speedup 0.96× (❌ ≥1.3×) · texto idéntico 10% (❌ ≥99%) · Δconf 13.198 pts (❌ ≤0.5) → **VEREDICTO NO-GO (3/3 criterios)** — int8 pierde dígitos de acta (809→89, 2004→26θ4, 48:08→4:08). Determinismo: 2 corridas con texto EXACTO y ms ±10%.
- [x] Docs: REPORTE + esta entrada + worklog + AGENTS (DECISIONS.md INTACTO por diseño del kit).
- [x] PR DRAFT (merge solo con orden del dueño; `tools/` no entra en el build — lint/tsc/build OK y diff de producción VACÍO verificado).
- [ ] Del dueño: correr el banco en SU máquina (4 núcleos/8 GB/Chrome 155) y decidir si archiva la idea int8 del rec o pide otro kit con otra variante (fp16/modelo menor — fuera de alcance aquí).

## ORIENTACION-AUTO — e14-orientacion-auto-v1 (2026-10-19): probe de orientación por confianza de rec (D51)

**Problema:** las 12 RECHAZADAS del informe 19/10 (tira Consulado de Egipto KIT 399) están físicamente rotadas 90°/180° en la foto — el OCR lee de lado → sin anclas → rechazo y reproceso humano (volver a fotografiar).

**Solución:** `probeOrientacion()` en `src/lib/e14/orientacion.ts` (NUEVO) — det (el MISMO singleton) + K=8 crops (3 líneas más largas + 5 repartidas) + rec CRUDO por rotación candidata; `score(r)=anclas·2+conf·(chars/40)`, guard absoluto (no inventar), MARGEN 1.5 sobre score(0), atajos por forma de tira, budget 4000 ms, SIM omitido. Al aplicar: girar `fotoOcr`+`fotoProcesada` (q0.92) ANTES del OCR/esquinas/gate. Traza propia `[e14] orientacion …`.

**Verificado (sandbox, tira real KIT 399):** sana → `aplicado=0` e 8.5 idéntico · girada 90/180/270 → `aplicado=1` (score probe 8.60/8.58/8.37, anclas=3) → **8.5 AUTO las tres** · SIM 8.2/7.0/4.3 exactos con 0 trazas · lint/tsc/build limpios · zona prohibida VACÍA.

**Pendiente:** AC-2 del dueño (las 6 fotos del informe en su equipo) — bloqueante para merge final, no para el PR. Los otros 2 kits del mega-kit (tiempos: B1-B5) van por los Agentes 2/3 en paralelo.
## BENCH-TIEMPOS — e14-bench-tiempos-v1 (2026-10-19, AGENTE 3): 3 bancos GO/NO-GO para las palancas de tiempo (CERO producción)

- [x] T1 — `tools/bench-lote12/` (B2): rec/cls lote 6 vs 12 — corpus del kit bench-rec-int8 (seed 0xe14be6c5), réplica rapidocr.ts (W=floor(48·max(320/48,r)), NCHW BGR, CTC greedy; cls flags) → **NO-GO rec** (0.99×, 1/60 líneas degrada O→0) / **GO cls** (1.25-1.30×, flags 100%) — decisión global NO-GO, sub-palanca cls para el dueño.
- [x] T2 — `tools/bench-det1280/` (B3): det 1280 vs 1920 con corpus acta-like sintético (4 págs × 30 votos manuscritos, seed 0xe14de7a2) + senal-lectura congelada → **GO DURO**: 0 votos perdidos, FUERTE/anclas/cajas idénticas, det −56.4% (ratio 0.436 ≈ teoría), ahorro escalonado ~9% del OCR en corpus (más en actas reales: det share 19-21%).
- [x] T3 — `tools/bench-ep-webgpu/` (B4): 3 brazos (webgpu+jsep / wasm-jsep control / wasm-producción ancla) → **BLOQUEADA-entorno** (requestAdapter null en headless — NO es NO-GO del EP); paridad jsep↔producción EXACTA (calibración del banco).
- [x] T4 — Determinismo ×2-×3 (texto EXACTO, ms ±10% salvo 1 outlier documentado), «DESCARGAR JSON» manual, window.__benchJson programático.
- [x] T5 — Docs: REPORTE (3 veredictos + evidencia + repro) + esta entrada + worklog + AGENTS (DECISIONS.md INTACTO por diseño del kit).
- [x] T6 — PR DRAFT (diff de producción VACÍO — solo tools/ + docs; JAMÁS merge — el dueño mergea).
- [ ] Del dueño: correr los 3 bancos en SU máquina (4 núcleos/Chrome 155/Windows) · decidir B2 (archivar rec / kit cls-solo) · validar B3 con las fotos reales del informe (16 actas) · correr B4 en SU Chrome con GPU → si GO preliminar, kit de activación (flag gradual + fallback wasm) con su decisión en DECISIONS.md.
## PWA-PERSISTENCIA — e14-pwa-persistencia-v1 (2026-10-20): auditoría integral + H6 offline + L6 jornada

- [x] A — AUDITORÍA (3 pases core/UI/MASIVA contra doctrina del vault): 6 bugs CRÍTICOS corregidos (C1 `paginaVerPag` grupo Ver→Pág — pág 2 en hueco P1 · C2 hueco duplicado jamás actualizaba estado (RESCANEO eterno) · C3 quad del usuario borrado en re-render (QuadEditor) · C4 `sincronizarAlVolver` código muerto → ediciones MASIVA jamás sincronizaban · C5 `enviarLote` re-entrante (doble envío) · C6 `listarRegistros` materializaba la cola COMPLETA en RAM — OOM en jornadas de 100+) + 14 medios (M1-M14) + 12 menores. Doctrina INTACTA: `evaluarGate`/pisos/techos/telemetría/`hashMock`/D48/chips SIM sin tocar.
- [x] B — L6 PERSISTENCIA: `jornada.ts` IDB vanilla `e14-jornada-v1` — estado liviano (archivadas, puesto, historial tope 200, contadores, motivos) + slot del acta en revisión CON fotos (solo CÁMARA/ARCHIVO; MASIVA tiene su IDB D45) · `arrancarJornada`/`reiniciarJornada` · persister por suscripción (comparación JSON — el tick SIM no escribe) · mesas REALES derivadas de archivadas+puesto (fix M10: SIM OFF restaura el guion real) · gate multi-pestaña (`persisterActivo`) · REINICIAR JORNADA (2 toques, patrón VACIAR) en RESUMEN.
- [x] C — H6 PWA: `sw.js` del lab (`escaner-v7`→`e14-v1`) — navigate network-first · `_next/static` cache-first · resto SWR tope 80 · **MOTOR cache-on-first-use** (`/models/rapidocr/` + `/vendor/onnxruntime/` ~30 MB → primer escaneo online = offline para siempre) · precache best-effort opencv+worker · E-04 sin `skipWaiting` incondicional (banner consentido) · limpieza de cachés viejas · iconos (192/512/maskable/apple-touch) · manifest completo · `PwaRegister` (adaptación declarada: sin warm-up — D50 existe).
- [x] V — E2E con foto REAL del dueño (Galaxy A56): OCR 94% · AUTO `88·120·15·02·012` · score 8.5 · ÓPTIMA auto-enviada · RECARGA restaura jornada+acta ENVIADA con fotos · REINICIAR fresco · MASIVA OK · 0 errores consola · lint 0 · tsc 0.
- [x] T — Docs: REPORTE + D54/D55 + esta entrada + docs/worklog + AGENTS. (Arreglos de auditoría del PR: `package.json` dev restaurado byte a byte + worklog de sandbox fuera del repo.)
- [ ] Del dueño: auditar/mergeear PR #38 · decidir D48 (timeout MASIVA 120 s) · probar instalación PWA + offline en SU teléfono (SW exige https) · `unzipSync`→async si el despliegue lo exige.
