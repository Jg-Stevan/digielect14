# REPORTE — Simulación gama baja v2: herramientas del navegador, problemas y soluciones

**Fecha:** 2026-11 · **Rama:** `docs/sim-gama-baja-v2` · **Base:** main `65dedc6` (PR #117 mergeado)
**Petición del dueño:** «genera un informe de las herramientas del navegador usadas y los
problemas que encontraste y como lo solucionaste» · **Restricciones:** SIN VLM, SIN leer
los manuscritos (cumplidas — ver §5.3).

---

## 1 · Resumen ejecutivo

El flujo completo (carga → cámara → pipeline OCR real → revisión) se corrió **dos veces**
en perfiles de gama baja simulados (v2 y v3) y una vez en perfil normal, sobre la app
servida en local con el acta E-14 REAL incluida en el repo (`src/assets/acta-e14-real.jpg`,
la misma de D35 — nada inventado).

| Métrica | Normal (CPU 1×) | Gama baja (CPU 6× · 2 GB · 4 núcleos · 3G) |
|---|---|---|
| UI visible | 456 ms | 1 008 ms |
| Boot cámara → telemetría | 2 504 ms | 7 833 – 7 920 ms |
| Pipeline hasta REVISIÓN | **14 136 ms** | **124 535 – 125 809 ms** (2 corridas) |
| Desenlace con el acta real | **10.0/10 ÓPTIMA → ENVIADO AUTOMÁTICAMENTE** | **0.0/10 RECHAZADA · NO IDENTIFICADO → REPETIR FOTO** |
| Heap JS tras pipeline | 28 MB | 10 MB (límite 2 222 MB) |
| Errores JS (pageerror + console.error) | 0 | 0 |

**Hallazgo principal (P0, reproducido 2×):** en gama baja el pipeline real tarda
~125 s y `TIMEOUT_MS = 120_000` (e67) lo mata **justo antes de terminar**. El acta —
que en normal es 10/10 con auto-envío — termina `RECHAZADA 0.0/10 · NO IDENTIFICADO`,
el operador entra al ciclo de «OBLIGATORIO REPETIR FOTO (intento 1 de 4)» y cada
reintento vuelve a gastar ~2 min. **El objetivo del dueño («cumplir el score para
enviar automáticamente») falla por PRESUPUESTO DE TIEMPO, no por calidad de la foto,
no por memoria y no por crash**: 0 errores JS, heap a 10 MB, cámara con lente/AF
correctos. Además, el rescate post-timeout e67 **no materializó** ningún cambio de
vista en la ventana observada de +120 s (§4 P2).

**No es un problema de recursos si no de administración de presupuestos:** la
estructura ya es correcta (OCR en worker, detección en worker, heartbeat en worker,
ANALIZANDO event-driven) — lo que falta es que el **presupuesto de espera y el plan
de trabajo escalen con la velocidad REAL del dispositivo**, como YA hace el módulo
masiva (watchdog por tier: BAJO 105 s · MEDIO 90 s) pero NO hace el escaneo individual
(tiempo fijo 120 s para todos los tiers).

---

## 2 · Herramientas del navegador usadas (y su equivalente manual)

Todo corrió headless contra la app en `http://localhost:3100` (dev server), con
Playwright/Chromium + **CDP (Chrome DevTools Protocol)** — el mismo protocolo que usa
DevTools cuando lo usas a mano:

| Herramienta (CDP / Playwright) | Qué hace en la prueba | Equivalente a mano en DevTools |
|---|---|---|
| `Emulation.setCPUThrottlingRate {rate:6}` | CPU 6× más lenta (aproxima la velocidad efectiva de un A13 en núcleos pequeños al decodificar/wasm) | Performance panel → icono engranaje → **CPU: 6× slowdown** |
| `Network.emulateNetworkConditions` (1.6 Mbps ↓ · 750 Kbps ↑ · 150 ms) | 3G rural realista | Network panel → throttling **Slow 3G** (custom) |
| Contexto móvil: viewport 384×857 + `deviceScaleFactor` 2.8125 + `isMobile` + `hasTouch` + UA Android/Chrome | Pantalla ≈ **1080×2400 físico** (Galaxy A13 sm-a135m/ds 6.6") con gestos táctiles | Device toolbar (Ctrl+Shift+M) → dimensiones custom + DPR + «Show device frame» |
| `addInitScript` sobre `navigator.deviceMemory=2` y `hardwareConcurrency=4` | El **perfil que la app ve** — el kit adaptativo (§perfil.ts) clasifica por esto | Consola: `Object.defineProperty(navigator, 'deviceMemory', …)` (o extensión) |
| Flags `--use-fake-device-for-media-stream` + `grantPermissions(['camera'])` | `getUserMedia` sin hardware real; la app pasa por su cascada de sondas F-LENS completa | chrome://flags / emulación de webcam virtual (en pruebas de campo: el teléfono real) |
| Telemetría de la app `window.__cameraChoice` | Confirma lente/AF/resolución elegidos sin tocar el dispositivo | Consola del teléfono vía `chrome://inspect` (USB) |
| `performance.memory` (heap used / límite) | Presión de memoria tras el pipeline | Memory panel → heap snapshot |
| Listeners `pageerror` + `console.error` + capturas por etapa | Detección de crashes/errores funcionales por etapa | Console panel (conservar log) + screenshots |
| `Performance.enable` + `Performance.getMetrics` | Métricas agregadas del hilo (script/task/layout, Nodes, heap) | Performance panel → resumen inferior (v3 lo dejó cableado; la v2 no llamaba `Performance.enable` — lección registrada) |
| Polling del DOM cada 2 s (`waitForFunction`) | Mide cuándo la UI llegó a REVISIÓN sin bloquear la página | — |
| **Vigilancia de rescate (nuevo en v3)**: muestreo de la vista cada 10 s durante 120 s post-revisión | Verifica si el rescate e67 cambia el desenlace tras el timeout | Observación manual de la pantalla |

**Cómo replicar la prueba sin guion (verificación manual en el teléfono o Chrome):**
1. Chrome desktop → Device toolbar: 384×857, DPR 2.8125, touch.
2. CPU 6× slowdown + Slow 3G.
3. Abrir la app → ESCANEAR → CÁMARA → «como ARCHIVO» con `src/assets/acta-e14-real.jpg`.
4. Cronometrar: ANALIZANDO → REVISIÓN. Resultado esperado sin arreglos: RECHAZADA 0.0 a los ~2 min.
5. En el teléfono real: `chrome://inspect` por USB y repetir (perfil REAL, no simulado).

Perfil honesto: es una **aproximación** al sm-a135m/ds (Exynos 850, 8 núcleos A55,
3-4 GB). El throttling 6× de CDP aproxima la velocidad efectiva de sus núcleos para
wasm/JS; `deviceMemory` 2 y 4 núcleos son lo que un Android de 3 GB reporta. La
validación final de campo en el dispositivo físico sigue siendo del dueño (igual que
los kits previos).

---

## 3 · Corridas registradas (evidencia)

| Corrida | Guion | Resultado crudo | Resumen |
|---|---|---|---|
| v2 gama baja | `sim-lowend.js` | `sim-lowend-resultados.json` | pipeline 125 809 ms → RECHAZADA 0.0 · NO IDENTIFICADO · 0 errores |
| v2 normal | `sim-normal.js` | `sim-normal-resultados.json` | pipeline 14 136 ms → 10.0/10 ÓPTIMA · QR ✓ · TRANSMISIÓN MESA 003 PÁG 1/2 · ENVIADO AUTOMÁTICAMENTE · 0 errores |
| **v3 gama baja (re-verificación)** | `sim-lowend-v3.js` | `sim-lowend-v3-resultados.json` | pipeline **124 535 ms** → RECHAZADA 0.0 · NO IDENTIFICADO · **sin rescate en +120 s** · 0 errores |

El par v2/v3 demuestra **determinismo**: dos corridas independientes aterrizan en el
mismo desenlace con ±1 s de diferencia alrededor de los 120 s del timeout.

---

## 4 · Problemas encontrados

### P0 — El timeout del escaneo individual no escala con la gama (BLOQUEA el auto-envío)
- `scanner-core-bridge.ts`: `TIMEOUT_MS = 120_000` fijo (subido de 15 000 en e67) para
  TODOS los dispositivos. En gama baja mono-hilo el pipeline necesita ~125 s → el
  temporizador resuelve un acta `RECHAZADA · ILEGIBLE` con score 0.0 y clasificación
  NO IDENTIFICADO antes de que el OCR termine.
- El mismo bug de clase YA se resolvió en masiva (D48: «con multihilo el pipeline real
  ~21 s quedaba falsamente RECHAZADA a los 15 s») y el plan de `gama.ts` de masiva usa
  watchdog POR TIER (BAJO 105 s). El escaneo individual quedó rezagado.
- Impacto directo en el objetivo del dueño: el score nunca se calcula → jamás llega a
  ÓPTIMA → jamás auto-envía → el operador repite foto (4 intentos × ~2 min = 8 min
  tirados por acta que en realidad estaba perfecta).

### P1 — OCR mono-hilo según el hosting
- Sin COOP/COEP no hay `SharedArrayBuffer` → `numThreadsOcrEfectivos()` = 1 aunque el
  plan diga BAJO=2 hilos. GH Pages **no puede** enviar esas cabeceras; Cloudflare Pages
  **sí** (`public/_headers` ya las trae). El dev server (donde se simula) tampoco las
  envía → la simulación representa el PEOR caso (≈ GH Pages).

### P2 — El rescate post-timeout (e67) no materializó en la vista
- El mecanismo e67 (cambio B) existe para que el resultado tarde «llegue DESPUÉS del
  acta RECHAZADA de timeout». En la corrida v3, durante 120 s posteriores a REVISIÓN
  (~245 s totales tras subir el acta) la vista NO cambió: la acta siguió RECHAZADA 0.0.
  O el pipeline tardó más de 245 s, o el rescate no está conectado a actualizar la
  vista individual. Requiere verificación/arreglo propio (propuesta B en §5.2).

### P3 — Higiene de los guiones de evidencia (menor)
- `sim-normal.js` escribe `"cpuThrottle": "6x"` en su JSON aunque corrió a `rate: 1`
  (cadena copiada del lowend) — metadato engañoso, corregido en v3 (registra el rate real).
- Rutas absolutas `/home/z/digielect14/...` y salidas en `/home/z` — v3 parametriza todo.
- v2 no llamaba `Performance.enable` → `Performance.getMetrics` devolvía vacío — v3 lo cablea.

### P4 — Problemas históricos ya resueltos (contexto de cómo se han solucionado)

| Problema (síntoma del dueño/ campo) | Kit que lo resolvió | Evidencia |
|---|---|---|
| «Abrió la cámara FRONTAL y no se pudo hacer las pruebas» | F-LENS v5 (facing-primero, saneo de caché venenada, guard de apertura) — PR #117 | `docs/REPORTE-fix-camara-principal-f-lens-v5.md` |
| Foto de 50 MP revienta el decode en gama media/baja (~200 MB bitmap) | F-SENSOR-PROFILER 3 capas de tope (D34): decode 523→98 ms | DECISIONS D34 |
| UI congelada / «página no responde» | ANALIZANDO event-driven (D18) · detección y OCR en workers · heartbeat en worker aparte (obs) | kits obs + fase lógica |
| Colgadas en carga masiva | Watchdog D65 + relectura con tope e63g (`RELECTURA_TOPE_MS=45_000`) | `docs/REPORTE-e63g-watchdog-relectura-v1.md` |
| Rechazos falsos por timeout corto (masiva) | `TIMEOUT_MASIVA_MS=120_000` (D48) + watchdog por tier en `gama.ts` (BAJO 105 s) | worklog T4 |
| App no detecta sus propios recursos | Kit `e14-adaptacion-dispositivo-v1`: perfil profundo + plan por tier + informe IA descargable | `docs/REPORTE-adaptacion-dispositivo-v1.md` |

---

## 5 · Soluciones

### 5.1 Ya implementadas (en main)
Ver tabla P4. El estado de arte: la app SE ADAPTA (tier → hilos OCR), NO crashea con
fotos grandes, NO congela la UI (todo lo pesado corre en workers) y se observa a sí
misma (heartbeat/hang/breadcrumbs + informe descargable). En perfil normal el flujo
completo dura 14 s y auto-envía a 10/10.

### 5.2 Propuestas de HOY (pendientes del OK del dueño — todas SIN VLM y SIN leer manuscritos)

| # | Propuesta | Qué toca | Efecto esperado |
|---|---|---|---|
| **A** | **Presupuesto del escaneo individual por tier/velocidad REAL** — reutilizar el benchmark CPU de `adaptacion/perfil.ts`: `timeoutEfectivo = clamp(120 s × factor_cpu_medido, 120 s, 480 s)` (o plan por tier BAJO/MEDIO/ALTO, mismo patrón de `gama.ts` de masiva; override manual del dueño manda; kill-switch por flag) | `scanner-core-bridge.ts` (constante → función) + `adaptacion/plan.ts` (nuevo knob) | El acta REAL termina su OCR (~125 s) y el score SE CALCULA → con cabecera/QR correctos vuelve el auto-envío en gama baja |
| **B** | **Verificar/arreglar el rescate e67 en la vista individual** — si el pipeline termina tras el timeout, REVISIÓN debe actualizarse sola (hoy no lo hizo en +120 s) | `scanner-core-bridge.ts` + `ReviewView/store` (rescate ya resuelto → refrescar acta en vista) | Aunque venza el presupuesto, el resultado bueno llega después — sin obligar a repetir foto |
| **C** | **Desplegar producción en Cloudflare Pages** (las cabeceras COOP/COEP ya están en `public/_headers`) → OCR multihilo (BAJO=2 hilos) | Deploy config (cero código) | Tiempo de OCR se divide (≈2 hilos) → margen holgado bajo el presupuesto incluso sin A |
| **D** | **Higiene de evidencia** (ya incluida en ESTA rama): guion v3 parametrizado + resultados crudos + corrección del metadato de throttle | `docs/evidence/sim-recursos/` | Pruebas reproducibles sin rutas absolutas |

Orden recomendado: **D (hecho) → A → C → B**. A+C juntos convierten el caso
«RECHAZADA 0.0 a los 2 min» en «ÓPTIMA + auto-envío», que es exactamente el objetivo.

### 5.3 Aclaración VLM / manuscritos (petición explícita del dueño)
- **No hay VLM ni LLM en ningún repo.** Grep sobre `src/` de ambos: 0 usos de
  VLM/LLM/APIs de IA externas. Los comentarios «crítica VLM» en `ScanView/ReviewView`
  son anotaciones de QA visual del diseño (revisión de capturas), no llamadas a
  modelos. `adaptacion/informe-ia.ts` NO llama a ninguna IA: **genera un JSON** para
  que una IA (o el dueño) lo lea después.
- **El OCR no lee manuscritos**: el motor es RapidOCR PP-OCRv4 (det/cls/rec ONNX,
  100 % en el dispositivo vía onnxruntime-web). Se usa para la cabecera IMPRESA
  (E-14 / REGISTRADURÍA / divipola), la identidad por QR (zxing/jsQR) y marcadores
  impresos — los dígitos manuscritos de los votos NO se reconocen ni se usan.
- Las propuestas A–D **no añaden** VLM ni lectura de manuscritos: solo administran
  presupuestos de tiempo, hilos y rescates del pipeline OCR clásico que ya existe.

---

## 6 · Cómo reproducir

```bash
# servidor de la app (puerto libre, NO el 3000 si está ocupado)
cd digielect14 && bun install && bunx next dev -p 3100

# gama baja (perfil A13 aproximado) — desde la raíz del repo
APP_URL=http://localhost:3100 node docs/evidence/sim-recursos/sim-lowend-v3.js
#   CPU_RATE=6 (default) · POST_WATCH_MS=120000 (default)
#   salida: sim-lowend-v3-resultados.local.json + capturas PNG junto al JSON

# perfil normal (referencia)
CPU_RATE=1 APP_URL=http://localhost:3100 node docs/evidence/sim-recursos/sim-lowend-v3.js
```

Criterio de aceptación tras implementar A+C: en `CPU_RATE=6` la corrida debe terminar
en vista REVISIÓN con score >0 y clasificación identificada (cabecera/QR), y con C
activa el tiempo debe bajar del orden de 125 s mono-hilo.

---

## 7 · Cómo implementar los cambios al repo (flujo que ya usa este proyecto)

El repo ya opera con **rama por kit + Conventional Commits + PR** (último: PR #117
desde `fix/f-lens-v5-camara-principal`). El informe y la evidencia v3 están ya
commiteados en la rama `docs/sim-gama-baja-v2` de este clone local:

```bash
git checkout docs/sim-gama-baja-v2        # contiene el informe + guion v3 + resultados
git push -u origin docs/sim-gama-baja-v2  # (con tu credencial: gh auth login o token)
# → abrir PR a main (GitHub) → revisar → merge
```

Para los kits de código (A/B/C) el patrón sería:
```bash
git checkout main && git pull && git checkout -b fix/e14-presupuesto-escaneo-adaptativo
# … cambios + gates (bunx tsc --noEmit && bun run lint && bun run test) …
git commit -m "fix(e14): presupuesto de escaneo adaptativo por tier (P0 auto-envío gama baja)"
git push -u origin fix/e14-presupuesto-escaneo-adaptativo   # → PR
```

**Nota de credenciales:** este entorno puede clonar (repo público) pero NO tiene tus
credenciales de push — el push final lo hace el dueño (una vez con `gh auth login`
o HTTPS token); todo lo demás (ramas, commits, gates, informe) queda listo en local.

---

## 8 · Pendientes (dueño)
1. OK a las propuestas A/B/C (§5.2) para implementarlas como kits con sus gates.
2. Validación de campo en el sm-a135m/ds físico (la simulación es aproximación honesta).
3. Decidir hosting de producción (CF Pages recomendado — P1) — GH Pages queda como peor caso cubierto por A.
