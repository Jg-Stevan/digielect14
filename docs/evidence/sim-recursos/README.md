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
