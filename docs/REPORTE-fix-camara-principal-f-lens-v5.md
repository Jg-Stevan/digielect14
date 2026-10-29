# REPORTE — KIT fix-camara-principal (F-LENS v5)

**Fecha:** 2026-11 · **Rama:** `fix/f-lens-v5-camara-principal` · **Base:** main `36a7e77`
**Bug de campo del dueño:** «en un dispositivo abrió la cámara FRONTAL y no se pudo
hacer las pruebas» — con recarga incluida (persistió).

## 1 · Diagnóstico (3 vectores confirmados en `useSesionCamara.ts`)

| # | Vector | Evidencia en código (base) | Consecuencia |
|---|---|---|---|
| A | **Sondas ciegas al facing** | `probeCamera` leía caps de `focusMode`/`torch`/`width`/`height` pero **deshechaba `track.getSettings().facingMode`** — la señal más confiable del oriente físico. `chooseMainProbe` clasificaba SOLO por label (`BACK_CAMERA_RE`): con labels genéricos/localizados («Camera 0.0», «Cámara 1») ningún probe era «trasera» y el pool de respaldo era **TODAS** las cámaras | La frontal podía **ganar** el pool por AF/resolución (las frontales reportan `focusMode: continuous` con frecuencia) |
| B | **Caché venenada sin cura** | `e14-main-camera-v1` solo se invalidaba por **fallo de apertura** (`NotFound/NotReadable/permiso`) — y abrir la frontal **nunca falla** | Una vez elegida la frontal por (A), el dispositivo quedaba **pegado a la frontal para siempre** (vía rápida abría la deviceId cacheada antes de sondear) — exactamente «no se pudo hacer las pruebas» |
| C | **Apertura sin verificación** | El stream ganador (y el fallback `{video:true}`) se aceptaba sin leer el facing real del track abierto | Ninguna última línea de defensa: lo que abría, se quedaba |

## 2 · Remediación (F-LENS v5 — un solo archivo, `useSesionCamara.ts`)

1. **`probeCamera` captura el facing real** — `getSettings().facingMode` manda,
   `getCapabilities().facingMode` de respaldo → `CameraProbeResult.facingMode`.
2. **`chooseMainProbe` clasifica facing-primero** (`esSondaTrasera`/`esSondaFrontal`):
   `environment` = trasera aunque el label sea genérico; `user` = frontal aunque el
   label no lo diga; sin facing decide el regex E4. Pool: traseras → desconocidas
   **excluyendo frontales** → todas (solo si el dispositivo no tiene otra).
3. **Caché saneada al leerla** (`readMainCameraCache`): entrada frontal por facing o
   label se **borra** y fuerza re-sondeo — cura a los dispositivos ya venenados
   (el del dueño) sin acción manual. `writeMainCameraCache` jamás persiste una frontal.
4. **Guard de apertura** (`leerFacingDeStream`): stream con facing `user` en la vía
   rápida de caché o en los intentos de la ganadora → se **cierra** y cae a la
   cascada, cuyo primer intento es `facingMode: { exact: "environment" }` (señal
   fuerte). Dispositivos **solo-frontales** quedan cubiertos por la cascada
   (environment ideal es best-effort; su `{video:true}` final acepta la única cámara).
5. **Telemetría de QA**: `window.__cameraChoice` ahora trae `facing` (lo abierto) y
   `sondas[].facing` — depuración remota del bug sin acceso al dispositivo.

LO QUE NO SE TOCA: orden de sondas, timeouts (`PROBE_TIMEOUT_MS`), regla D3/D6 de
AF/resolución, cascada, FOTO_LADDER, linterna, captura, pipeline/gates/scores.

## 3 · Verificación

- `bunx tsc --noEmit` — **0** · `bun run lint` — **0 err / 0 warn** (de paso se corrigió
  el error PRE-EXISTENTE en main `react-hooks/preserve-manual-memoization` en
  `SeccionRastreo.tsx`: `exportar` a función plana — solo se usa en `onClick`, nunca en
  arrays de deps; comportamiento byte-idéntico).
- `bun run test` — **233/233**.
- QA harnesses (`scripts/qa-*.ts`): mismos resultados que main — **2 fallos PRE-EXISTENTES**
  no tocados por este kit (deuda del dueño): `qa-aa-quickwins` 10/11 (C1 gris 500/600 +
  texto ≤12px) y `qa-obs-ui` 7/8 (aria-label del modo diagnóstico). Antes/después del
  parche: idénticos.
- Validación de campo pendiente del dueño: reabrir la app en el dispositivo afectado —
  la caché venenada se sana sola en el primer arranque y `__cameraChoice.facing` debe
  decir `environment`.

## 4 · Evidencia de la simulación en dispositivos de pocos recursos

Corridas headless (mismo navegador, perfiles controlados) — `docs/evidence/sim-recursos/`:

| Escenario | Boot cámara→telemetría | Pipeline hasta revisión | Notas |
|---|---|---|---|
| Normal (throttle 1×, red 3G) | 2 504 ms | 14.1 s | 0 errores |
| Gama baja (throttle CPU 6×, deviceMemory 2, red 3G, sin COOP/COEP → OCR mono-hilo) | 7 920 ms | 125.8 s | 0 errores, UI viva (`ANALIZANDO` visible 8.1 s) |

Lectura: la app **funciona de punta a punta en gama baja** (sin errores, desenlace
correcto); el coste es tiempo puro del pipeline OCR mono-hilo — ya mitigado a nivel de
app por el kit `e14-adaptacion-dispositivo-v1` (hilos OCR por tier BAJO/MEDIO/ALTO).
La sonda de cámara (`__cameraChoice`) registró lente + AF + resolución correctos en ambos
perfiles; con este kit además registra `facing`.

## 5 · Pendientes (dueño)

- Validación de campo en el dispositivo que abrió la frontal (curación de caché
  automática; verificar `__cameraChoice.facing === "environment"`).
- Las 2 deudas QA pre-existentes (quickwins C1, aria-label A3-C4) requieren kit propio.
