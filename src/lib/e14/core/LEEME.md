# `core/` — motor de escaneo vendorizado

Copia local del motor que antes llegaba como paquete npm
`@jg-stevan/scanner-core`. **Es código propio, no una dependencia**: se edita
aquí y el cambio es inmediato en la app.

## Procedencia

| | |
|---|---|
| Origen | `github.com/Jg-Stevan/web-scanner` · `packages/scanner-core/src` |
| Commit | `feba267cb9c01a896f0135ed2e406b7567bec663` (2026-10-25) |
| Versión | 0.4.1 — la misma que estaba instalada al vendorizar |
| Licencia | MIT · texto en `LICENSE-scanner-core.md` (conservado sin cambios) |

Se tomaron **solo los módulos que esta app importa de verdad** (cierre de
dependencias desde los 9 subpaths que usaba el paquete). El paquete publicaba
únicamente `dist/` — sin `src/` ni sourcemaps —, así que el `src` real se sacó
del repo de origen.

## Por qué se copió en vez de seguir con npm

- El paquete estaba **incompleto para el producto**: el camino HEIC convierte
  a resolución nativa (`convertHeicToJpegBlob`) y en un HEIC de 50 MP nunca
  termina — lo mata el *watchdog* de 120 s. Arreglarlo por npm implicaba
  publicar versiones por cada ajuste del móvil.
- `digielect14` es un digitalizador individual por puesto: no necesita el
  almacén de documentos ni el store de páginas del motor genérico.

## Regla de paridad con `supervision-e14`

Los archivos que existen en **los dos repos** deben ser **byte a byte
idénticos**. Lo verifican dos artefactos:

- `core/CONTRATO.json` — el md5 de cada módulo de este árbol. Lo valida
  `src/lib/e14/core/__tests__/contrato-core.test.ts` **en cada CI por separado**
  (no necesita el otro checkout): si editas el motor sin regenerarlo, el test se
  pone rojo.
- `bun scripts/qa-core-vendorizado.ts` — 17 chequeos: compara byte a byte contra
  el hermano cuando los dos checkouts están en disco, comprueba que el cierre
  interno del árbol esté completo, que ningún import vuelva a apuntar al paquete
  npm, y que los dos `CONTRATO.json` coincidan donde se solapan.

Los md5 se calculan sobre el contenido con los saltos de línea en LF, no sobre
los bytes crudos: `.gitattributes` fija `eol=lf`, así que el CI clonaba en LF un
árbol que en Windows pudo regrabarse en CRLF, y el contrato se cortaba por algo
que no cambia cómo lee el acta un puesto. Un `git diff` del motor solo debe
mostrar cambios de código.

Ritual para un arreglo del motor: editar el archivo **en los dos repos** en el
mismo commit → `bun scripts/qa-core-vendorizado.ts --generar` en cada uno →
`bun run verificar`. Si el cambio toca la lectura de un acta (umbral, recorte,
normalización), pasar además el golden `contrato-motor.json`.

Un módulo exclusivo del móvil (cámara, calidad, perfil de sensor, PDF, PWA) vive
solo aquí y no entra en el contrato del hermano.

## Qué se podó al copiar (y por qué)

Dos cosas del `src` del origen NO se trajeron, y no por olvido:

- `format.ts`, `index.ts`, `mock-data.ts`, `page-store.ts`, `store.ts`,
  `tags.ts`, `text-export.ts`: el almacén de documentos y el store de páginas
  del motor genérico. Esta app guarda el acta en IndexedDB (`src/lib/e14/store.ts`).
- `demo-page.ts` y la clase `SyntheticCamera` (estaba al final de
  `frame-loop.ts`): una cámara falsa para la demo del laboratorio, con factura
  generada en memoria y `captureStream(12)`. En un digitalizador de puesto no
  hay demo que correr — nadie importa `SyntheticCamera` acá, y el QA real se
  hace con la foto de un acta de verdad. Si algún día hace falta (probar el
  pipeline sin cámara en una CI de escritorio), se vuelve a traer del origen,
  no se reinventa.

Después de la poda quedan 12 módulos; `CONTRATO.json` los lista.

## Actualizar desde el origen

`web-scanner` sigue siendo el repo del motor genérico. Si se vuelve a tomar
código de allá: `git -C <web-scanner> log -1` para anotar el commit aquí, copiar
el archivo, y correr `bun run verificar`. No hay sync automático a propósito:
cada importación es una decisión revisable.

## Tests del motor

`core/__tests__/` trae los tests propios del motor
(`types` · `quality` · `image-modes-parity` · `parity-worker-filters` ·
`pdf-export`), copiados de `web-scanner/packages/scanner-core/tests` con tres
ajustes mecánicos: `from "bun:test"` → `from "vitest"`, `../src/x` → `../x`, y
fuera un import de tipo que el upstream dejaba sin usar (el lint de acá sí lo
correría).
Son tests PUROS sobre `Uint8ClampedArray` — no necesitan DOM, por eso corren en
el entorno `node` de vitest. Lo que el propio upstream dejara fuera (decode,
canvas, jsPDF en runtime) sigue fuera: no se trajo ni un polyfill.

`contrato-core.test.ts`, en cambio, es de la casa: es el que exige que
`CONTRATO.json` siga describiendo el árbol.
