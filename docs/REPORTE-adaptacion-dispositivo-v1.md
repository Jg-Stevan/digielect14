# REPORTE — KIT e14-adaptacion-dispositivo-v1

**Fecha:** 2026-11 · **Rama:** `feat/adaptacion-dispositivo-v1` · **Base:** main `ed15a1a`
**Petición del dueño:** «que identifique en qué dispositivo está trabajando para saber con qué
recursos se cuenta (exprimir al máximo los recursos) y que la app se adapte sola (gama baja,
media o alta) + un informe descargable que una IA pueda interpretar fácilmente».

## 1 · Diseño

El tier detectado (obs/dispositivo §4.4 — BAJO/MEDIO/ALTO) pasaba de solo-reportarse (D6 v1)
a **consumir presupuestos de recursos**. Heredero del espíritu del kit e14-gama-adaptativa-v1
(D74, retirado con el módulo masiva en la limpieza) — ahora a nivel de APP COMPLETA.

Tres módulos nuevos en `src/lib/e14/adaptacion/`:

| Módulo | Responsabilidad |
|---|---|
| `perfil.ts` | Perfil PROFUNDO: GPU real (WEBGL_debug_renderer_info), capacidades de plataforma (WASM-SIMD, hilos wasm vía SAB+COOP/COEP, WebGPU, OffscreenCanvas, serviceWorker), pantalla (px físicos + DPR), cámaras (enumerateDevices), 2 micro-benchmarks (CPU ops/ms + canvas ms) y puntuación 0-100 por dimensión (CPU 30% · RAM 30% · GPU 15% · red 10% · storage 15%, renormalizada con lo presente — nulls HONESTOS). Benchmarks corren UNA vez por carga (forzar re-mide). |
| `plan.ts` | PLAN de knobs (SYNC, barato — usa `tierRapido()`, sin async ni benchmarks): hoy `ocrHilos`. Prioridad D6 por knob: **override MANUAL del dueño > plan por tier (BAJO 2 · MEDIO 3 · ALTO 6) > default 4**, SIEMPRE capado por hardwareConcurrency y exigido por SAB+crossOriginIsolated (1 hilo sin ellos — condición idéntica a la histórica). |
| `informe-ia.ts` | INFORME del dispositivo para IA: JSON auto-descriptivo (`_como_interpretar` + leyenda de tiers + interpretación por medición + recomendaciones accionables + plan aplicado con fuente). Descarga `informe-dispositivo-YYYYMMDD-HHmm.json` (patrón descargarBlob de obs/export.ts — cero deps). PRIVACIDAD: solo metadatos, ids truncados a 8 hex, sin actas/OCR, descarga manual (D1). |

## 2 · Flag del dueño

`adaptacionDispositivo` — **default TRUE** (petición explícita del dueño: «que se adapte
automáticamente»). Kill switch único:
- Override manual `{"adaptacionDispositivo": false}` (localStorage `e14-flags-overrides` o
  PanelDev §6 «ADAPTACIÓN AUTOMÁTICA») ⇒ knobs byte-idénticos al histórico.
- DOBLE whitelist (lección de los kits previos): `sanearFlags` (flags.ts) +
  `leerOverridesFlags` (politica.ts). Campo AL FINAL en `FlagsApp` (contrato D57).

## 3 · Consumo real (knobs de PERFORMANCE — jamás negocio)

| Knob | Antes | Ahora (adaptación ON) |
|---|---|---|
| Hilos OCR (rapidocr `numThreads`) | `min(flagDueño, cores)` — flag default 4 | override manual presente ⇒ `min(override, cores)`; si no ⇒ `min(HILOS_POR_TIER[tier], cores)` = BAJO 2 · MEDIO 3 · ALTO 6; adaptación OFF ⇒ histórico exacto |

LO QUE NO SE TOCA (reglas de negocio — D6): DET_CAP (1920/1280), FOTO_LADDER, constraints
de cámara, scores, gates, umbrales, desenlaces. El plan queda listo para SUMAR knobs de
recursos futuros (thumbnails de RAM, precacheo condicionado) sin volver a abrir contratos.

## 4 · Informe IA (contrato del artefacto)

```jsonc
{
  "$informe": "digielect14/perfil-dispositivo",
  "$version": 1,
  "_como_interpretar": ["8 instrucciones explícitas para la IA que lee el archivo"],
  "resumen_ejecutivo": { "clasificacion": "GAMA ALTA", "tier": "ALTO", "tier_inferido": false,
    "puntuacion_global": 87, "desglose_puntuacion": {cpu,ram,gpu,red,storage},
    "veredicto": "prosa 1-párrafo", "recomendaciones": ["acciones concretas"],
    "plan_aplicado": { "adaptado": true, "ocr_hilos": 6, "ocr_hilos_fuente": "plan-adaptativo",
      "hilos_wasm_disponibles": true, "explicacion": "…" } },
  "dispositivo": { os, nucleos_cpu, ram_gb, heap_limit_mb, memoria_js_usada_mb,
    pantalla{ancho,alto,dpr,mp}, gpu{renderer,vendor,webgl}, camaras_video,
    red{tipo,downlink,ahorro_datos}, bateria{nivel,cargando}, almacenamiento_libre_mb,
    capacidades_web{wasm,simd,multihilo,webgpu,offscreen,sw} },
  "benchmarks": { "cpu_ops_ms": …, "canvas_ms": …, "·interpretación con rangos de referencia" },
  "leyenda": { tiers, escala_puntuacion, nulls },
  "contexto": { app, app_version, generado_iso, id_dispositivo(trunc), id_sesion(trunc), ua, nota_privacidad }
}
```

Una IA lo consume SIN ver el repo: cada bloque se explica a sí mismo y las recomendaciones
van priorizadas (multihilo/SIMD ausente, storage bajo, batería, saveData…).

## 5 · UI (PanelDev — sección 8 + kill switch §6)

- **§8 Perfil · adaptación**: badge TIER + puntuación global, chips de capacidades
  (SIMD · HILOS · WEBGPU · OFFSCREEN · PWA), 5 barras de sub-score (verde ≥70 · ámbar ≥40 ·
  rojo <40 · «—» si null), plan aplicado (hilos + FUENTE + GPU + cámaras) y botón
  **⬇ INFORME PARA IA (JSON)** + REPETIR BENCH (re-mide benchmarks).
- **§6 kill switch**: SwitchFila «ADAPTACIÓN AUTOMÁTICA» (estado = flag efectiva; el toggle
  escribe el override completo — semántica de reemplazo del puente, intacta).

## 6 · Verificación

- `bunx tsc --noEmit` — 0 · `bun run lint` — 0/0 · `bun run test` — 233/233
  (flags.test.ts: aserción de defaults actualizada por contrato — campo AL FINAL, protocolo #3).
- Humo de navegador: PanelDev §8 renderiza con perfil REAL (benchmarks ~300 ms), informe
  descarga JSON válido, kill-switch revierte a histórico (verificado con agent-browser — §7 del worklog).

## 7 · Pendientes (dueño)

- Validación de campo con dispositivos de gama baja REAL (el plan de hilos BAJO=2 es
  conservador por diseño; revocable por override).
- Knobs futuros candidatos (requieren kit propio): cap det por tier (mueve scores),
  resolución de captura por tier (mueve calidad), precacheo condicionado de modelos.
