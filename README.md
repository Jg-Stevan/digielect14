# digielect14

Digitalizador de **actas E-14** (voto exterior colombiano) que corre **en el
navegador del celular**. Una persona por puesto electoral enfoca o importa el
acta; la app la endereza, la lee, la clasifica contra el catálogo DIVIPOLA y la
envía al hub de supervision. No hay servidor de procesado: el pipeline entero
(QR, warp, OCR, gate) ocurre en el dispositivo.

> **Alcance del producto:** digitaliza e identifica actas. **No lee votos.** La
> app comprueba si la zona de votos tiene tinta (marcador obligatorio, D41),
> nunca interpreta números ni totales. Un total inventado en un acta electoral
> sería un fallo de integridad, no de interfaz.

## Cómo funciona (30 segundos)

```
captura (cámara | archivo)
  → capa 0 QR (worker) ─┐
  → detección de bordes ┴→ quad + rotación (brújula QR / probe orientado)
  → warp + realce (scanner-core)  → foto procesada
  → OCR (cascada: Tesseract best-PSM4 → gate → RapidOCR PP-OCRv4 escalonado)
  → clasificación cabecera vs DIVIPOLA + completitud
  → gate de score (AUTO / ÓPTIMA / ADVERTENCIA / RECHAZADA)
  → revisión humana si hace falta → POST {hub}/actas (cola offline-first)
```

Todo el detalle, por módulo, en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Stack

| pieza | qué usa |
|---|---|
| Framework | Next.js 16 · React 19 · TypeScript · Tailwind 4 · zustand |
| Motor de escaneo | `@jg-stevan/scanner-core` (npm; repo [web-scanner](https://github.com/Jg-Stevan/web-scanner)) — detección de bordes, warp, realce, export |
| OCR | Tesseract.js 5.1.1 (español `spa` best, PSM 4) como intento 1 y RapidOCR **PP-OCRv4** sobre `onnxruntime-web` 1.30 (EP wasm) como intento 2 |
| QR/1D | `zxing-wasm` 3.1.6 + jsQR 1.4.0 vendorizado, con capa 0 en worker |
| Estado/flags | cadena `DEFAULTS ← public/flags.json ← overrides de localStorage` (kill-switch del dueño) |
| Gestor | **bun** (`bun.lock`) — no usar npm ni pnpm |

Los modelos y runtimes que se sirven en runtime viven en `public/`
(`models/rapidocr` ≈16 MB, `models/tess/spa.traineddata.gz` ≈12 MB,
`vendor/onnxruntime` ≈14 MB, `vendor/tesseract` ≈14 MB, `vendor/opencv` ≈8 MB).
No son basura: el OCR y la detección los cargan por red desde ahí, y el
service worker los guarda en caché para operar sin señal.

## Desarrollo

```bash
bun install
bun run dev            # http://localhost:3000 (modo simple, un hilo de OCR)
bun run verificar      # typecheck + lint + test — la puerta de salida
```

`bun run verificar` es obligatorio antes de dar por terminado cualquier cambio.
Para medir OCR/QR con multihilo real (`crossOriginIsolated`), `next dev` no
sirve: construye y sirve con el servidor COOP/COEP.

```bash
bun run build && bun run scripts/serve-coop-coep.mjs 8123 out
```

## Deploy

Demo estática: <https://jg-stevan.github.io/digielect14/> (GitHub Pages, sin
cross-origin isolation). Multihilo: <https://digielect14.pages.dev> (Cloudflare
Pages con cabeceras COOP/COEP). Instrucciones: [docs/DEPLOY.md](docs/DEPLOY.md).

## Documentación

| archivo | para qué |
|---|---|
| [AGENTS.md](AGENTS.md) | reglas para agentes IA y personas que editan el repo |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | mapa del pipeline y de los módulos |
| [docs/DECISIONS.md](docs/DECISIONS.md) | catálogo de decisiones D1…D7x (la autoridad) |
| [docs/DEUDA.md](docs/DEUDA.md) | lo que falta, lo bloqueado y lo que NO se debe tocar |
| [docs/ROADMAP.md](docs/ROADMAP.md) | trabajo pendiente, ordenado |
| [docs/REPORTE-*.md](docs/) | evidencia de mediciones de cada kit |
| [SECURITY.md](SECURITY.md) | privacidad de datos electorales y divulgación |

Convención de lectura: los comentarios del código citan **kits** (`e14-*`),
**decisiones** (`D<n>`) y **secciones de spec**. Las decisiones están en
`docs/DECISIONS.md`; los kits y las specs son artefactos de sesiones de
desarrollo y no viajan en el repo, así que una mención sin archivo no es un
enlace roto. Cuando un comentario dice `apps/scanner-lab/…` se refiere al app de
laboratorio del repo del motor
([Jg-Stevan/web-scanner](https://github.com/Jg-Stevan/web-scanner)), de donde
vienen las copias iniciales de la UI y del worker de detección
(lo verifica `.github/workflows/worker-parity.yml`).
