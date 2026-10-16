# REPORTE — KIT e14-visor-accion-y-score-v1 (Task ID 117)

**Rama:** `feat/visor-accion-score` · **Base:** `main` @ `cf8e06c` · **PR:** #6 (ABIERTO, SIN merge — regla fija)
**Commits:** `e82a6d1` (FASES A/B — ReviewView) · `488284e` (FASE S — bridge) · docs (este reporte + worklog + AGENTS.md)
**Gates:** lint 0 · tsc 0 · build estático 3/3 · `packages/`/npm/`divipol.json`/store/ScanView SIN TOCAR (git diff: solo ReviewView.tsx + scanner-core-bridge.ts)

---

## §0 Resumen

QA del dueño (16-oct, captura real `EL CAIRO - CONSULADO`): un acta PERFECTA salió
**7.7/10 ADVERTENCIA con chip LUMINOSIDAD**. Diagnóstico cerrado (§S.0): el score
se calculaba sobre la FOTO COMPLETA — la mesa oscura alrededor hunde el brillo
global. Tres fases ejecutadas en la misma rama: **A** (botón «Pantalla completa»
fuera), **B** (acciones fijas abajo + visor grande), **S** (score del RECORTE).

## §S.0 Diagnóstico (reproducido y calibrado)

`evaluateQuality` del core (paquete INTOCABLE) baja a W=120 y mide TODO el
encuadre: el acta vertical (~0.34 de ancho) deja el papel en ~25-40% del cuadro
→ `brightness` global = luma de la MESA → peor métrica → chip LUMINOSIDAD y
score 7.0-7.7 en actas perfectas.

**Reproducción** (harness Node + jpeg-js FUERA del repo, `/home/z/e14-visor/calib`;
fórmulas byte a byte: baja a W=120, brightness=media luma, contrast=std×1.4,
sharpness=std(Laplaciano)×2.2, pesos 0.299/0.587/0.114; scoreDeCalidad replica
con piso §X=80 y techos fair 7.9/poor 6.4). Foto fabricada: acta E-14 sintética
(95% del alto, papel tenue 115, tinta 35, óptica base r=1) sobre mesa oscura:

| escenario | sharp | bright | contr | score | estado |
|---|---|---|---|---|---|
| acta 95%, mesa oscura — ANTES (frame completo) | 101 | 37 | 59 | **7.6** | ADVERTENCIA · LUMINOSIDAD (bright = peor métrica) |
| mesa más clara (20) — ANTES | 100 | 43 | 54 | 7.7 | ADVERTENCIA |
| **la MISMA acta — DESPUÉS (crop del quad +3%)** | 104 | 85 | 57→piso 80 | **9.1** | ≥8.0 → OPTIMA (auto-envío) |
| la MISMA acta SIN FONDO (referencia del kit) | 145 | 93 | 47 | — | bright 93 ≈ 88 del kit ✓ |

La tabla reproduce la del kit §S.0 (7.7 → 9.0): la fabricación es fiel al caso.

## FASE A — «Pantalla completa» fuera ✓

- Los 2 `ToolbarBtn` borrados (rama OPTIMA y rama resto). `StitchFullscreenIcon`
  quedó sin usos → retirado del import (el icono en `QuadEditor` NO se toca).
- Quedan: OPTIMA → Recortar · Rotar 90° · Filtros · Imagen · Texto (5);
  resto → **una sola fila de 3** (la 4ª celda que forzaba segunda fila murió).
- El modal fullscreen NO se toca (L817-837): mismo visor, nuevo punto de entrada.

## FASE B — 2 zonas + tarjeta 56vh ✓

- Root reestructurado (`ReviewView` L408): `flex-1 min-h-0 flex flex-col` con
  **ZONA SCROLL** (`flex-1 min-h-0 overflow-y-auto max-w-md mx-auto w-full px-4
  py-3 space-y-3` — banner + chips + tarjeta + nota + ENVIADO + panel, MISMO
  orden) y **ZONA FIJA** (`shrink-0 max-w-md mx-auto w-full px-4 pb-1 pt-2` —
  la fila de acciones, NUNCA scrollea). Único `overflow-y-auto` (sin scroll
  doble). Shell `page.tsx` INTOCABLE. ADAPTACIÓN: la zona scroll es el MISMO
  contenedor max-w-md de siempre (clases fusionadas) — cero re-indentación y el
  centrado no baile; `filaAcciones` es un `const` calculado fuera del flujo
  (mismo JSX, mismos handlers) montado solo si ≠ null (ENVIADA → no se monta).
- Los 2 wrappers G8: `h-[420px] max-h-[60vh]` → **`h-[56vh] min-h-[340px]
  max-h-[640px]`** (mismo valor en ambos). INVARIANTE G8 intacto: altura
  definida en px/vh, JAMÁS derivada del aspecto — ROTAR no mueve el marco.

## FASE S — score del RECORTE ✓

- Helper `calidadDeActa` (junto a `scoreDeCalidad`): decodifica `fotoOriginal`,
  bbox = min/max del QUAD (misma convención 0-1 de `processImage`/
  `verificarCompletitud` — sin conversión nueva) + **3% del propio bbox por
  lado** (clamp [0,1]), canvas con **cap 2000 px el lado largo (nunca
  upscalar)** y `evaluateQuality(canvas)` (ImageSource acepta HTMLCanvasElement
  — core L319 confirmado en el d.ts).
- **Fallback:** bbox degenerado (NaN/∞ o lado < 8 px reales) o fallo de
  decode/canvas → `evaluateQuality(fotoOriginal)` como hoy.
- EXACTAMENTE 2 llamadas reemplazadas (escaneo y recorte). **ADAPTACIÓN
  documentada:** la firma del kit `Promise<PageQuality>` se conserva y el bbox
  real usado para el log llega por un **out-param opcional `info`** (patrón
  existente del archivo: el acumulador `parcial`) — el kit exige la firma Y el
  `crop={WxH}` en los logs; ambas cosas a la vez exigen comunicar el bbox.
  Fallback → `crop=full` en el log.
- Logs de auditoría (escaneo y recorte): `crop=WxH` añadido antes de
  `metricas=`. NADA MÁS: `scoreDeCalidad`, chip, escudo D10, marcadores, OCR,
  completitud, `evaluarGate` — INTACTOS.

## ACs — tabla real

| AC | Resultado | Evidencia |
|---|---|---|
| A1 | ✓ | ADVERTENCIA: 3 botones en UNA fila (todos y=658, grid h=44px) |
| A2 | ✓ | Tocar la foto (ENVIADA y ADVERTENCIA) abre el modal fullscreen (click real Playwright sobre la imagen del ZoomableVisor); tarjeta ENVIADA táctil intacta |
| A3 | ✓ | ESC cierra el modal (probado 2×) + hint «Toca o ESC para cerrar» intacto |
| B1 | ✓ | Viewport 412×850: fila de acciones bottom=702 → CTA «REPETIR FOTO» top=710 (8 px = padding del kit, pegado; antes flotaba en medio con hueco muerto) |
| B2 | ✓ | Tarjeta mide **476 px = 56% de 850** exacto (antes 420 px fijos) — +56 px de foto y hasta 640 en pantallas altas |
| B3 | ✓ | Rotar 90°: wrapper 476 → 476 px (marco invariante G8) |
| B4 | ✓ | ENVIADA: 0 botones de toolbar (contador DOM), bloque «✓ ENVIADO…» visible, tarjeta táctil |
| B5 | ✓ | EN_RH AGOTADA (flujo real: 4 capturas chip bajo): barra fija Recortar·Rotar·Imagen + CTA «VOLVER AL ESCÁNER». PanelClasificacion no apareció (la borrosa no clasifica) → prueba MECÁNICA del mecanismo: tarjeta estirada temporal a 160vh vía DOM → la zona scrolleó y la barra quedó INMÓVIL (y=641 antes/después) |
| S1 | ✓ | ANTES 7.6-7.7 LUMINOSIDAD → DESPUÉS **9.1** ≥ 8.0 (tabla §S.0 de este reporte). Log real del dueño (óptima SIM, acta real 1715×2287): `crop=782x2261` · `metricas={sharpness:100 brightness:62 contrast:87}` — las métricas ahora describen EL ACTA |
| S2 | ✓ | Chips SIM intactos: logs `score=8.2` · `score=7` · `score=4.3` (inyección §D3 no se toca) |
| S3 | ✓ | Blur real: crop de la borrosa → sharpness 28 → score 6.1 ≤ 6.4 (NO rescatado) |
| S4 | ✓ | Quad NaN → null · Infinity → null · 2×3 px → null (fallback); quad identidad → frame completo (980x2112 en el log del as-is) |
| S5 | ✓ | Subexposición ×0.4: crop → score 3.5 (sin OCR) / 5.1 (con piso 80) vs 9.1 normal — el gate NO queda ciego |
| S6 | ✓ | `calidad=` en TODOS los logs: **41 · 16 · 15 · 15 ms** < 100 ms |
| Globales | ✓ | lint 0 · tsc 0 · build 3/3 · intocables intactos (0 archivos) |

## Verificación en navegador (headless, dev :3001, cero errores de consola)

- Chip óptimo → auto-envío (ENVIADA) → tarjeta 56vh táctil → fullscreen → ESC ✓
- Chip intermedio → ADVERTENCIA «LUMINOSIDAD» (captura del lab real EL CAIRO):
  fila única fija abajo pegada al CTA, tarjeta grande, rotación invariante ✓
- Chip bajo ×4 → RECHAZADA ×3 → EN_RH AGOTADA con barra fija ✓
- Screenshots del lab: `captura-advertencia.png` / `captura-fullscreen.png`
  (fuera del repo; viewport de prueba 412×850 — Chrome Android del dueño).

## §8 Pendiente del dueño

- QA visual en Vercel preview (alturas de tarjeta en su Chrome Android real).
- La rama OPTIMA (5 botones en 2 filas de grid-cols-3: 3+2) es inalcanzable en
  REVISIÓN (auto-envío G4) — verificada por código, no por UI.
- Decisiones previas abiertas (reportes anteriores): C4 vs RECHAZADA, copy del
  chip «10.0» obsoleto, re-calibración del umbral de votos con capturas reales.
