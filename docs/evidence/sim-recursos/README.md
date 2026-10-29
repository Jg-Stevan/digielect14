# EVIDENCIA — simulación de dispositivos de pocos recursos (sesión Z.ai)

Corridas headless del flujo COMPLETO (carga → cámara → captura → pipeline OCR →
revisión) sobre la build de la sesión, con perfiles controlados:

- `sim-normal.js` / `sim-normal-resultados.json` — perfil normal (throttle 1×, red 3G):
  boot cámara→telemetría 2 504 ms · pipeline hasta revisión 14 136 ms · 0 errores.
- `sim-lowend.js` / `sim-lowend-resultados.json` — gama baja simulada
  (throttle CPU **6×**, `deviceMemory` 2, `hardwareConcurrency` 4, red 3G, sin
  COOP/COEP → OCR **mono-hilo**): boot 7 920 ms · pipeline 125 809 ms · 0 errores ·
  `ANALIZANDO` visible 8 110 ms · `__cameraChoice` con lente/AF/resolución correctos.

Lectura: cero errores funcionales en gama baja — el coste es TIEMPO de OCR mono-hilo,
ya mitigado por el kit `e14-adaptacion-dispositivo-v1` (hilos OCR por tier). Detalle y
contexto del kit de cámara: `docs/REPORTE-fix-camara-principal-f-lens-v5.md` §4.

Los `.js` son los guiones de corrida (agent-browser contra la app servida en local);
los `.json` son los resultados crudos de esa corrida (artefactos inmutables).

---

## v2/v3 — re-verificación con guion parametrizado (`sim-lowend-v3.js`, rama `docs/sim-gama-baja-v2`)

Mismo perfil (CPU 6× · RAM 2 GB · 4 núcleos · 3G · mono-hilo) con tres añadidos:
vigilancia del rescate post-timeout e67 (ventana 120 s tras REVISIÓN), `Performance.enable`
antes de `Performance.getMetrics`, y rutas/presupuestos por entorno (sin `/home/z` fijo;
`CPU_RATE`/`POST_WATCH_MS`/`OUT_PATH`/`ACTA_PATH` por env).

- `sim-lowend-v3-resultados.json` — REPRODUCCIÓN del hallazgo v2: pipeline
  **124 535 ms** (> `TIMEOUT_MS` 120 000) → acta real **RECHAZADA 0.0/10 ·
  NO IDENTIFICADO · REPETIR FOTO**; sin auto-envío y SIN cambios de vista en los
  120 s de vigilancia (el rescate e67 no materializó). 0 errores JS · heap 10 MB.
  Detalle completo: `docs/REPORTE-sim-gama-baja-v2.md`.

Correcciones de higiene vs v2: `sim-normal.js` declaraba `cpuThrottle: "6x"` en su
resultado aunque corrió a `rate: 1` (cadena hardcodeada) — v3 registra el rate REAL
usado. Nota: los `.local.json`/PNG de re-corridas NO se suben (artefactos locales).
