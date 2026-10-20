# Banco B7 — tolerancia dedup heic/jpg (KIT e14-bancos-b5-b7-pagnull-v1 — SOLO EVIDENCIA)

- Fecha: 2026-10-20T13:42:59.633Z
- dhash: copia congelada de `src/lib/e14/masiva/dedup.ts` (canvas 9×8, gradiente horizontal, hex 16) sobre la vía del pipeline (`fileToCaptureDataUrl` del core de producción → `hacerThumb` 320 → dhash)
- Umbral vigente: `HAMMING_MAX = 6`

## Sintético — Hamming intra-par (gemelas POR CONSTRUCCIÓN: mismo píxel-set, png / jpg-q92 / jpg-q50)

| par | a | b | hamming | ≤ 6 (el dedup la atraparía)? |
|---|---|---|---|---|
| sintetica-1 | png | jpg-q92 | 0 | SÍ |
| sintetica-1 | png | jpg-q50 | 2 | SÍ |
| sintetica-1 | jpg-q92 | jpg-q50 | 2 | SÍ |
| sintetica-2 | png | jpg-q92 | 0 | SÍ |
| sintetica-2 | png | jpg-q50 | 1 | SÍ |
| sintetica-2 | jpg-q92 | jpg-q50 | 1 | SÍ |
| sintetica-3 | png | jpg-q92 | 0 | SÍ |
| sintetica-3 | png | jpg-q50 | 5 | SÍ |
| sintetica-3 | jpg-q92 | jpg-q50 | 5 | SÍ |

- maxHammingIntraPar: **5** · minHammingEntreActas: **4** · mecanismoAtrapaGemelas: True

## Sensibilidad al color (hipótesis HEIC→RGB ≠ JPG→RGB — sospecha del informe 20/10)

| δ canal R | hamming vs base | ≤ 6? |
|---|---|---|
| +1 | 2 | sí |
| +2 | 2 | sí |
| +3 | 2 | sí |
| +5 | 2 | sí |
| +8 | 2 | sí |
| +12 | 3 | sí |

**Lectura:** shifts de color de hasta +12/8/4 por canal SOLO mueven el hamming 2-3 bits — el dhash es robusto al color (los gradientes sobreviven). La hipótesis «el decode HEIC→RGB difiere en gamma/color y por eso el hash se escapó» queda **DEBILITADA** por esta evidencia; quedaría una HEIC→RGB estructuralmente distinta (demosaica/crop/rotación EXIF) por descartar con las fotos reales.

## Hallazgo colateral (observación para D61)

minHammingEntreActas = 4 **< umbral 6** en el sintético: actas con el MISMO layout (plantilla E-14, misma fuente/grilla) y datos distintos pueden caer DENTRO del umbral → riesgo de FALSO POSITIVO del dedup (marcaría una acta distinta como gemela y copiaría el resultado de la otra). El corpus REAL del dueño decide la tasa real; el cambio de umbral/forma es OTRO kit (D61).

## Hipótesis ORDEN (kit T2 — alternativa al hash)

Si las gemelas reales NO se marcaron (sin traza 'marcada'), es hash/color; si se marcaron y luego cayó 'sin-original reprocesa-completo', es ORDEN (runner llegó antes de que la original tuviera acta — runner.ts L128/L188, store.ts L174-175). Trazas a buscar en capturas del dueño.

Trazas:
```
[e14] dedup fila=<id> marcada hamming=<d> dupOf=<origen> hash=<hex>
[e14] dedup fila=<id> dupOf=<origen> reutiliza score=<s> ms=<ms>
[e14] dedup fila=<id> sin-original reprocesa-completo
```
