# `ui/` — capa React vendorizada

Copia local del visor que antes llegaba como paquete npm
`@jg-stevan/scanner-ui`. **Es código propio, no una dependencia.**

## Procedencia

| | |
|---|---|
| Origen | `github.com/Jg-Stevan/web-scanner` · `packages/scanner-ui/src` |
| Commit | `feba267cb9c01a896f0135ed2e406b7567bec663` (2026-10-25) |
| Versión | 0.1.0 — la misma que estaba instalada al vendorizar |
| Licencia | MIT · texto en `LICENSE-scanner-ui.md` (conservado sin cambios) |

Vive acá **un solo componente**: `ZoomableVisor.tsx` (modal fullscreen y modo
`card` inline; pinza anclada, pan con clamps, doble toque 2.5×, rueda
no-pasiva, comparación por pulsación larga y swipe de carrusel). Es puro —
props y callbacks, cero store, cero red, cero lógica de motor. El panel
`supervision-e14` **no** lo importa: su visor es propio, así que este árbol no
entra en el contrato de paridad del motor (`core/LEEME.md`).

## Por qué se copió y no se dejó en npm

Era el último trozo del dominio que venía de afuera. Con `scanner-core` ya
vendorizado (D81), el paquete solo lo sostenía a él como dependencia declarada:
sacarlo cerró `@jg-stevan/*` del lockfile. Y la regla del motor aplica igual —
ajustar un gesto del visor era publicar una versión de paquete por cada cambio
de producto, con un `dist` sin `src` ni sourcemaps.

## Regla para editarlo

`ui/CONTRATO.json` fija el md5 (contenido en LF) de cada archivo del árbol y lo
valida el chequeo 6 de `scripts/qa-core-vendorizado.ts`, que corre en el
Quality Gate de CI; el mismo harness exige además que ningún import vuelva a
apuntar al paquete y que la licencia y la procedencia sigan en su sitio.
Ritual: editar → `bun scripts/qa-core-vendorizado.ts --generar` →
`bun run verificar`.

Dos cosas que el componente necesita y no son suyas:

- **Tailwind v4** genera las clases del visor desde el build del consumidor: la
  línea `@source` de `src/app/globals.css` apunta a este directorio. Si el árbol
  se mueve, se mueve con él (sin esa línea el visor queda sin estilos y el
  fallo es silencioso).
- **Peers**: `react` y `framer-motion`, ya dependencias directas del repo.
