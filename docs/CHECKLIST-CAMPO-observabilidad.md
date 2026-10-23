# CHECKLIST DE CAMPO — Observabilidad v1 (`e14-observabilidad-v1`)

> Kit AGENTE 3 (A3-C6) · Los 9 ítems de la §6 del plan madre (`PLAN-observabilidad-modo-dev-v1.md`),
> adaptados al contrato de `README-KITS.md` §4. **Estado FASE 0**: plantilla congelada al contrato;
> validarla en campo cuando `feat/obs-nucleo-v1` (agente 1) y `feat/obs-modo-dev-v1` (agente 2) estén integrados.
>
> Regla transversal (regla de oro 4): **el rastreo jamás puede romper la app.** Si cualquier ítem de
> esta checklist muestra un fallo de la app (no del rastreo), STOP y reportar al dueño.

---

## 1 · Modo dev OFF = cero timers

**Objetivo:** sin modo dev la app no corre NINGÚN timer de rastreo (D4: salud solo con dev ON; D1: transporte apagado por defecto).

**Pasos:**
1. Borrar storage del origen (DevTools → Application → Storage → Clear site data) y recargar.
2. Usar la app normal 2–3 min (escanear 1 acta SIM, revisar MASIVA).
3. Ir a DevTools → **Application → Local Storage**: NO debe existir `e14-dev-mode`.
4. DevTools → **Sources → Event Listener Breakpoints → Timer** (o `performance`): sin `setInterval` de salud (5 min) ni batcher de transporte (10 min).
5. DevTools → **Network**: cero requests hacia `endpointReportes` (no existe aún — flags default).

**Esperado:** captura/procesamiento idénticos al pre-kit; cero timers de observabilidad; IndexedDB `e14-obs` puede existir (buffer del contrato) pero sin muestreo de salud activo.

## 2 · Activación del modo dev + badge

**Objetivo:** la puerta del modo diagnóstico funciona y es visible.

**Pasos:**
1. Pulsar el control con `aria-label="Abrir modo de diagnóstico"` (TopBar/panel).
2. Activar el modo dev dentro del PanelDev.
3. Verificar badge **DEV** en `TopBar`.
4. DevTools → Application → Local Storage → `e14-dev-mode` = `"on"`.

**Esperado:** badge visible siempre que esté ON; al desactivar, badge desaparece y `e14-dev-mode` = `"off"`; el timer de salud (5 min) SOLO aparece con dev ON + `politica.saludEnVivo`.

## 3 · 3 actas → perf visible

**Objetivo:** el rendimiento por acta llega al panel sin PII.

**Pasos:**
1. Con modo dev ON, procesar **3 actas** en MASIVA (SIM sirve).
2. Abrir PanelDev → sección **perf**.
3. Verificar por acta: `status`, `intento`, tiempos (preparando/detección/OCR), `scoreVisual`, `scoreFinal`, `gate`, `ocrValido`.
4. DevTools → Application → IndexedDB → `e14-obs` → store `eventos`: los eventos `perf` llevan `datos.actaIdHash` (8 hex) — **JAMÁS** el id plano del acta.

**Esperado:** 3 eventos perf agrupados por sesión; identificador de acta siempre hasheado (FNV-1a 8 hex).

## 4 · Error provocado → agrupado con breadcrumbs

**Objetivo:** un error real queda agrupado por digest y con contexto sin contenido de actas.

**Pasos:**
1. Con modo dev ON, provocar un error controlado (p. ej. cargar una foto corrupta/truncada en MASIVA o bloquear `public/wasm/zxing_reader.wasm` en Network para forzar la traza de degradación).
2. Abrir PanelDev → sección **errores agrupados**.
3. Verificar: `mensaje` truncado (≤500), `tipo` del constructor, `archivo` (primer frame dentro de `src/`), `digest` (agrupa repeticiones), `veces`/`primera`/`ultima`, y **breadcrumbs** del evento más reciente (≤30, tipo click/vista/cola/store/red — sin texto de actas).
4. Repetir el mismo fallo → `veces` incrementa en el MISMO `digest`.

**Esperado:** agrupación estable por digest; breadcrumbs presentes; cero `console.*` del módulo obs (solo `logger`).

## 5 · Toggles on/off → export con/sin muestras

**Objetivo:** la política de datos (D4) se respeta en el export.

**Pasos:**
1. PanelDev → política de datos: dejar defaults (`metadatos` ON · `textoOcr` OFF · `miniaturas` OFF).
2. Exportar reporte JSON → NO debe incluir texto OCR ni rutas de miniaturas; sí metadatos y contadores.
3. Activar `textoOcr` ON → repetir export → ahora SÍ incluye las muestras de texto OCR de las actas procesadas.
4. Activar `miniaturas` ON → repetir → incluye la ruta de miniaturas (gated por el chequeo de política en `export.ts`).
5. Volver a OFF ambos → export sin muestras.

**Esperado:** cada toggle cambia el export de inmediato; defaults siempre OFF para `textoOcr`/`miniaturas` (verificación en `scripts/qa-obs-contract.ts` Bloque 3).

## 6 · Export + vaciado

**Objetivo:** el ciclo export→vaciar deja el buffer limpio sin perder lo descargado.

**Pasos:**
1. Con eventos acumulados (3 actas + 1 error), exportar ZIP con «vaciar después» activado.
2. Verificar el archivo: `meta` (appVersion, generado, deviceId, sesion, politica), `dispositivo`, `erroresAgrupados`, `perfResumen`, `saludMuestras`, `uso`.
3. DevTools → Application → IndexedDB → `e14-obs`: buffer vacío tras el vaciado (contarEventos = 0).
4. Vencidos: un evento con ts > 30 días (TTL) no aparece en el export (purge FIFO, tope 500).

**Esperado:** `{nombre, bytes}` devueltos por `descargarReporte()`; el ZIP abre; el buffer queda purgado.

## 7 · Kill switch → tanda masiva sigue

**Objetivo:** los overrides manuales de flags nunca rompen el flujo (D6: la app no cambia reglas sola; el dueño sí).

**Pasos:**
1. PanelDev → kill switch/overrides: fijar `poolWorkers: 1` (y opcionalmente `thumbsOn: false`).
2. Verificar persistencia: `e14-flags-overrides` en localStorage — escrito por `guardarOverridesFlags` (jamás directo desde la UI — lo congela `scripts/qa-obs-ui.ts` Bloque f).
3. Encolar una tanda MASIVA (5–10 fotos SIM) y procesar.
4. Restaurar overrides a default (limpiar override).

**Esperado:** la tanda procesa completa con el override aplicado (pool 1 = más lento pero estable); sin errores nuevos; al limpiar, vuelve el default (2).

## 8 · Modo avión → captura sigue y envía al recuperar

**Objetivo:** sin red NADA se rompe; al volver, el outbox entrega (D1).

**Pasos (requiere endpoint de prueba — ver `docs/ENDPOINT-REPORTES.md` §Prueba rápida):**
1. Configurar `endpointReportes` (flags.json o override) apuntando al receptor local.
2. DevTools → Network → **Offline**.
3. Procesar 2–3 actas y provocar 1 error.
4. Application → IndexedDB → `e14-obs-outbox` → store `lotes`: lote(s) con `intentos: 0` esperando.
5. DevTools → Network → **Online**: ver el `POST` con `{loteId, deviceId, appVersion, eventos[]}` → 2xx → el lote se BORRA del outbox.
6. Repetir con el receptor APAGADO: 3 fallos seguidos → el transporte se auto-detiene (`estadoTransporte().activo === false`, `fallosSeguidos = 3`) y el outbox queda INTACTO; reactivar reiniciando la app o desde `iniciarTransporte()`.

**Esperado:** captura/procesamiento local 100 % funcionales offline; envío diferido al recuperar red; kill local documentado tras 3 fallos.

## 9 · Batería <20 % → tier BAJO reportado

**Objetivo:** el tier se detecta y SE REPORTA — jamás cambia comportamiento (D6).

**Pasos:**
1. Con modo dev ON, poner el dispositivo con batería <20 % **sin cargar** (o `navigator.getBattery()` inspeccionado en consola).
2. Abrir PanelDev → sección **salud**: `bateria.nivel < 0.2`, `bateria.cargando = false`.
3. Verificar `tier: "BAJO"` (regla §4.4: batería <20 % sin cargar ⇒ BAJO).
4. En iOS (sin Battery API): `tierInferido: true` y el tier inferido por cores/heap/UA.
5. Confirmar que NINGÚN comportamiento de la app cambió solo (pool sigue 2, OCR igual — solo el reporte lo refleja).

**Esperado:** `SaludSnapshot` con `tier: "BAJO"`; la app no altera reglas (solo detecta y reporta — D6).
