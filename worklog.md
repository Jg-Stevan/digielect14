# Worklog — Sesión de mejora digielect14 (sandbox)

> Log compartido de todos los agentes en esta sesión. El repo real es
> github.com/Jg-Stevan/digielect14 (rama base: `main` @ `b8b3e12`).
> Este archivo es del ENTORNO SANDBOX (no se commitea al repo real).
> El registro que sí va al repo vive en `docs/worklog.md` (convención upstream).

---
Task ID: 1
Agent: orquestador (Z.ai Code)
Task: Montar digielect14 en el sandbox de desarrollo (puerto 3000, preview visible para el dueño)

Work Log:
- Clonado y leído a fondo: digielect14 (código completo: store, bridge, pipeline, screens, masiva) + vault proyecto-electoral-e14-vault (AGENTS.md, como-trabajo, reglas, lecciones, backlog) + web-scanner (lab: sw.js, update-banner, PwaRegister, pwa.ts del core).
- Reemplazado el scaffold del sandbox por el árbol completo de digielect14 @ b8b3e12 (rsync sin .git/node_modules).
- Git surgery: repo local reconectado a la historia real (fetch desde /tmp/digielect14, rama `feat/e14-pwa-persistencia-y-mejoras` basada en main b8b3e12).
- package.json: único diff intencional vs upstream = dev script `next dev -p 3000 2>&1 | tee dev.log` (requerimiento del sandbox; en el PR final se decide si se mantiene).
- Sandbox-only en .git/info/exclude: .zscripts/, Caddyfile, examples/, mini-services/, tests/, upload/, tool-results/, logs, .env.
- `bun install` OK (183 paquetes, @jg-stevan/scanner-core@0.4.1 desde npm).
- Dev server levantado vía .zscripts/dev.sh → puerto 3000, HTTP 200.
- Verificado con agent-browser (sesión e14-dev): render de ESCANEAR sin errores de consola; flujo dorado completo chip ÓPTIMA → ANALIZANDO → pipeline real (RapidOCR det/cls/rec ONNX, 9 s) → clasif AUTO 88·120·15·02·012 · cod 710007453010102 · score 8.2 · lectura FUERTE anclas 9 → ENVIADA, ACTAS 0→1.

Stage Summary:
- Entorno operativo: app corriendo en :3000 con pipeline OCR real funcionando end-to-end en el navegador headless.
- Decisiones del dueño en esta sesión: (1) SIN transmisión real por ahora (módulo supervisión no existe, diferido); (2) completar PWA SÍ; (3) votos NO por ahora; (4) foco en bugs + completar + optimizar; (5) subir a git solo al terminar o con aprobación (token después).
- Fuentes de verdad identificadas: lab (sw.js/update-banner/PwaRegister) para PWA; cola MASIVA vanilla-IDB para persistencia L6; doctrina del score/evaluarGate intocable.

---
Task ID: 2-a/2-b/2-c
Agent: 3 subagentes auditores (general-purpose)
Task: Auditoría profunda de bugs — core (2-a) + UI (2-b) + MASIVA/informe (2-c)

Work Log:
- 2-a core: store, bridge, scanner-core-bridge, clasificador, divipol, seed, completitud, integridad, marcadores, senal-lectura, diagnostico, image-utils, kits, types — leídos línea por línea + cruzados contra doctrina del vault.
- 2-b UI: 13 archivos (~5.500 líneas) — screens, QuadEditor, PanelClasificacion, TopBar/BottomNav/primitives, page/layout.
- 2-c MASIVA: cola, runner, mini-store, archivos, tipos, informe + integración en store principal + MasivaView.

Stage Summary (hallazgos priorizados):
CRÍTICOS 🔴:
  C1 clasificador.ts:533-539 paginaVerPag usa grupo [1] (Ver) en vez de [2] (Pág) → pág 2 archivada en hueco P1 cuando el código 1D no se lee + VERPAG_CODIGO_DISCREPAN espurio.
  C2 store.ts:381-393 archivarHueco: hueco duplicado conserva previa.huecos → RESCANEO jamás sube a OK (AC-RC5 rota, mesa EN_PROCESO eterna).
  C3 ReviewView.tsx:747 defaultQuad() factory nueva por render → QuadEditor effect deps [quadInicial] re-tween → recorte manual del usuario se BORRA en re-render (errorRecorte/revelando).
  C4 masiva/store.ts:290 sincronizarAlVolver compara actaActual.id (acta-*) vs origenAbierto (masiva-*) → NUNCA coincide → código muerto: ediciones REVISIÓN jamás sincronizan → doble envío posible.
  C5 masiva/store.ts:347 enviarLote sin flag enviando → doble clic = doble envío lote.
  C6 cola.ts:120 listarRegistros materializa cola COMPLETA (actas con dataURLs 7-14MB c/u) en cargarFilas/ResumenView/informe → OOM en jornada real (100+ actas).
MEDIOS 🟡 (selección):
  M1 registrarEnvio aplica paginaObjetivo stale en envíos MASIVA (comentario miente) → guion contaminado.
  M2 repetirFoto excede maxIntentos → "INTENTO 5 DE 4" + historial duplicado.
  M3 dispararEscaneo catch mudo (cero log/feedback).
  M4 IMPORTAR sin guard durante captura → 2 pipelines concurrentes.
  M5 guards asimétricos aplicarRecorte/cambiarFiltro (revelando/recortando) + cambiarFiltro sin re-validación de identidad → recorte sobrescrito.
  M6 sondas de cámara siguen tras desmontar (no checan cancelado en el loop).
  M7 mejorarFotoActa OPTIMA fuerza vista revision ~15s después (teletransporte).
  M8 runner envía ANTES del guard de fila quitada; catch re-persiste ERROR sin guard (zombie).
  M9 agregarLote: quota → diagnóstico falso "navegador no soporta".
  M10 SIM OFF deja progreso falso quemado en mesas (efecto compuesto) — se resuelve con derivación de mesas en L6.
  M11 informe: leerRegistro para TODAS las filas (incluidas sin carpeta) + todas las imágenes en RAM a la vez.
  M12 runner no se pausa al disparar escaneo individual (solo al abrir acta).
  M13 filas temp: QUITAR/VACIAR durante copia → huérfanos.
  M14 guardarRegistro falla tras envío → fila ERROR + registro PENDIENTE → reproceso + doble envío.
MENORES 🟢: conRampa interval leak, historial id colisionable, canvas ganador sin liberar, ToolbarBtn sin disabled real, role=button sin onClick, TopBar botón conexión muerto para teclado, QuadEditor spinner infinito si decode falla, PROCESAR habilitado con solo temps, unrar fetch fail → PROTEGIDO_O_CORRUPTO falso, throttle traga último evento, backdrop selector de modo no cubre dock, sheets sin Esc.
FALSOS POSITIVOS INTENCIONALES (NO tocar): hashMock, timeout MASIVA 120s vs individual 15s (D48 documentado — se consulta al dueño), SIM comparte mesas (D6), score AUTO=10 (D-1), copias del lab con // Fuente:.
Veredicto salud: módulos SANO en arquitectura; bugs son regresiones sutiles de kits propios. Fixes C1-C6 primero.

---
Task ID: 3 (a-d)
Agent: orquestador (Z.ai Code)
Task: Corregir los bugs de la auditoría (batches 1-4)

Work Log:
- C1 clasificador.ts: paginaVerPag ahora usa el grupo [2] (Pág) — era [1] (Ver=01 siempre). Pág 2 sin código 1D ya no se archiva en hueco P1.
- C2 store.ts archivarHueco: hueco duplicado ahora REEMPLAZA estado (map) — RESCANEO sube a OK con re-escaneo ÓPTIMO (AC-RC5).
- C3 ReviewView: quadInicialEditor memoizado [status, quadDetectado] — el quad del usuario ya no se borra en re-renders (errorRecorte/recortando/revelando).
- C4 masiva/store sincronizarAlVolver: identidad via registro.acta.id === actaActual.id (antes comparaba fila vs acta → código muerto). Ediciones de REVISIÓN ahora sincronizan a bandeja+IDB.
- C5 masiva/store enviarLote: flag enviandoLote (early-return + finally) + botón disabled/ENVIANDO… en MasivaView.
- C6 cola.ts: listarMapeados(mapper) con cursor que NO retiene registros + contarRegistros() con count() nativo. Callers actualizados: cargarFilas (mapper filaDeRegistro), recuperarCola (solo zombis), ResumenView (count), informe (mapper filaLiviana).
- M1 registrarEnvio: paginaObjetivo solo aplica en flujo normal (!actaEnvio) — MASIVA ya no marca OK páginas no transmitidas.
- M2 repetirFoto: semántica de ciclo §7 — ADVERTENCIA/ENVIADA/cerrados → intento 1 (ciclo nuevo); RECHAZADA/RH-bajo-tope → intento+1 con CAP maxIntentos (adiós «INTENTO 5 DE 4»).
- M3 dispararEscaneo: catch con console.error (antes mudo).
- M4 guard in-flight en dispararEscaneo (vista === "analizando" → return) + guards tempranos con aviso en alElegirArchivo/alElegirFotoCamara.
- M5 aplicarRecorte: guard revelando añadido; cambiarFiltro: re-validación de identidad post-await (patrón mejorarFotoActa).
- M6 ScanView sondas de cámara: cancelado chequeado dentro del loop de sondas y del loop de apertura.
- M7 mejorarFotoActa OPTIMA: ya no fuerza vista "revision" (sin key vista — no teletransporte).
- M8 runner: guard de fila quitada ANTES del envío + mismo guard en el catch (no re-persistencia de zombies).
- M9 masiva/store agregarFiles: QuotaExceededError → avisoCola específico («ALMACENAMIENTO LLENO…») y colaDisponible SIGUE true; solo fallo real de IDB degrada. Aviso se limpia en éxito/VACIAR.
- M10 (SIM OFF deja mesas falsas): diferido al Task 5 — se resuelve derivando mesas de archivadas/puestoActual en la persistencia L6.
- M11 informe.ts: leerRegistro SOLO para filas con carpeta (antes deserializaba todas).
- M12 dispararEscaneo: auto-pausa del runner MASIVA (import dinámico para evitar ciclo store→runner→store).
- M13 agregarFiles: el swap temp→real borra de IDB los ids cuyas temps fueron quitadas/vaciadas durante la copia (0 huérfanos).
- M14 runner: persistencia post-envío con reintento mínimo (LISTA sin acta) — jamás queda registro PENDIENTE de un acta ya enviada.
- Menores: conRampa autolímite de ticks (leak si hang); timeout de recorte pone clasificacion undefined (invariante del gate); idHistorial() con contador (keys React); canvas ganador del burst liberado; ToolbarBtn disabled real (visual+aria+tab); Rotar 90° gate fotoProcesada en barra de 5; tarjetas role=button con onClick; TopBar nube = botón real (aria-pressed, teclado); QuadEditor estado falloDecode con mensaje honesto; unrar fetch falla → WASM_NO_CARGO (no PROTEGIDO_O_CORRUPTO); backdrop del selector de modo FIXED (cubre footer); QUITAR disabled en fila PROCESANDO; pendientes excluye masiva-temp-.
- SKIP documentado: unzipSync → unzip async (riesgo CSP/workers en despliegue estático; no es hot path).

Stage Summary:
- Gates: tsc 0 · lint 0 · dev server compila y sirve 200.
- 6 críticos + 14 medios + 12 menores corregidos. Doctrine intacta: evaluarGate/pisos/techos/telemetría sin tocar; hashMock y timeout MASIVA 120s (D48) intactos por decisión del dueño.

---
Task ID: 4-5-7
Agent: orquestador (Z.ai Code)
Task: PWA completa (H6) + Persistencia L6 + verificación E2E con foto real del dueño

Work Log:
- PWA (Task 4, kit H6):
  - public/sw.js — copia adaptada del lab (escaner-v7 → e14-v1) con // Fuente: navigate network-first, _next/static cache-first, resto SWR tope 80, MOTOR cache-on-first-use para /models/rapidocr/ + /vendor/onnxruntime/ (~30MB: primer escaneo online = offline para siempre), precache best-effort de opencv+detection-worker, E-04 sin skipWaiting incondicional + listener SKIP_WAITING + limpieza de cachés viejas en activate.
  - src/lib/e14/update-banner.ts — copia VERBATIM del lab (banner «Nueva versión lista» + Recargar con consentimiento).
  - src/components/e14/PwaRegister.tsx — montaje único (registerServiceWorker + setupPwaListeners + setupUpdateBanner del core /pwa); ADAPTACIÓN declarada: sin warm-up OCR (e14 ya tiene prowarm propio).
  - Iconos generados (PIL, paleta de marca #070A0D/#00E676): icon-192, icon-512, icon-512-maskable (zona segura), apple-touch-icon.
  - manifest.webmanifest completo (lang es-CO, scope, orientation, categories, maskable) + metadata icons/appleWebApp en layout.tsx.
- Persistencia L6 (Task 5):
  - src/lib/e14/jornada.ts NUEVO — IDB vanilla «e14-jornada-v1» (stores estado/acta): estado liviano de la jornada (archivadas, puestoActual, historial tope 200, contadores, motivosNoEnvio) + slot del acta en revisión (con fotos; solo fuentes CAMARA/ARCHIVO, jamás SIM/MASIVA). mesasRealesDe() derivación compartida (Fuente: ActasView L156-204).
  - store.ts: arrancarJornada (restaura + deriva mesas reales + restaura acta en revisión; guards de actividad temprana), reiniciarJornada (reset completo + slot + cola MASIVA vía imports dinámicos), persister por SUSCRIPCIÓN (estado por comparación JSON — el tick SIM no dispara; acta por identidad de referencia).
  - FIX M10 integrado: SIM OFF restaura el guion real derivado (antes quedaba quemado el progreso falso).
  - ResumenView: botón REINICIAR JORNADA (2 toques, patrón VACIAR, aria-labels).
- Bugs encontrados y corregidos DURANTE el E2E:
  - E2E#1: guardarJornada hacía put(estado) SIN clave en store sin keyPath → DataError síncrono tragado → jornada jamás se persistía. Fix: put(estado, KEY_ESTADO).
  - E2E#2: persister inicializaba ultimaActaPersistida=undefined → el primer set del arranque (actaActual null ≠ undefined) limpiaba el slot ANTES de que arrancarJornada lo leyera. Fix: inicializa en null.
  - E2E#3 (multi-instancia): arranque fresco de una 2ª pestaña sobrescribía la jornada persistida con el seed antes de restaurar. Fix: gate persisterActivo que solo abre en el finally de arrancarJornada. (Nota: las sesiones de agent-browser resultaron tener perfiles aislados — el fenómeno observado era entre perfiles, pero el gate protege el caso real de 2 pestañas.)
  - TDZ HMR: declaraciones let del persister movidas ANTES del create (unhandledRejection «arrancada is not defined» al re-evaluar el módulo).
- E2E con la FOTO REAL del dueño (Galaxy A56, 4000×3000, EXIF orientation=upper-right):
  - IMPORTAR → pipeline 11.5s → OCR conf 94% (44 cajas/41 líneas) → clasif AUTO 88·120·15·02·012 · cod 710007453010102 → lectura FUERTE anclas 9 → score 8.5 → ÓPTIMA auto-enviada → ACTAS: FRANKFURT CONSULADO, 12 mesas DIVIPOL, MESA 12 EN PROCESO.
  - Recarga → jornada restaurada (ACTAS count + historial + archivadas + puesto) + acta ENVIADA restaurada en REVISIÓN con fotos.
  - REINICIAR JORNADA → estado fresco verificado.
  - MASIVA con la misma foto → ENVIADA AUTO, contadores correctos.
  - Sesión de navegador limpia: 0 errores de consola (los «Export listarRegistros doesn't exist» eran log HMR de mitad de edición; carga fresca = limpia).
  - Assets PWA: manifest/sw.js/iconos todos 200.

Stage Summary:
- Gates finales: tsc 0 · lint 0 · dev 200.
- L6+H6 COMPLETOS y verificados E2E. 3 bugs adicionales del propio trabajo encontrados y corregidos en el camino.
- PENDIENTE para el dueño: (1) decidir sobre D48 timeout 120s MASIVA vs 15s individual (desenlace difiere en fotos lentas — documentado, no tocado); (2) unzipSync→unzip async diferido por riesgo CSP; (3) probar instalación PWA + offline en SU teléfono (https obligatorio para el SW — el sandbox http no registra).
