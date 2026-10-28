# KIT e14-orientacion-qr-v1 — QR-BRÚJULA de orientación (el cuadrante del QR manda)

## §0. Origen (evidencia — bench v8.3 del dueño, 26/10)

Bench de consola v8.3 sobre el worker REAL de producción (`/scanner/detection-worker.js`),
4 fotos de campo reales (2 JPG 8MP Galaxy A56 — papel arrugado / impresión blotchy —
+ 2 HEIC; tira consular: El Cairo KIT 399 mesa 001 + Frankfurt KIT 745 mesa 012 p1/p2):

| Intento | Resultado |
|---|---|
| jsQR sobre warp (1600→1100→750+inv) | **0/4** — QR ~110 px; papel arrugado ≠ homografía |
| RESCATE hi-res (re-decode ≤6000px + crops paralelogramo por QUAD + ×1.5/×2 + binarizadores G/L + θ ±10°, ZXing tryHarder) | **4/4** — incluidas la arrugada y la blotchy |
| Rotación por cuadrante del QR (TL→0 · TR→270 · BR→180 · BL→90) | **4/4 correctas** (`rotFuente: qr-hr` ×8 filas) |
| RapidOCR GT (consulado/país/zona/puesto/mesa/kit/pag) | 12/12 filas en 7/7 |

Bonus medido: **mismo payload = misma página de acta** (160922 ≡ durazno4, kit 745 pag 2/2)
→ identidad/dedupe gratis (red line 10 respetada: payload OPACA).
Costo: 1.3–5.1 s SOLO cuando jsQR falla; **el premio** es que cuando la brújula decide,
el sondeo OCR del probe (budget 12 s, D56) **no corre**.

## §1. Qué cambia

Pipeline escanearActa (bridge): ANTES del sondeo OCR de orientación corre la
QR-BRÚJULA (`brujulaQrOrientacion`, módulo nuevo `src/lib/e14/orientacion-qr.ts`):

1. **PASO 1 — warp (barato)**: cascada jsQR sobre el warp SIN rotar
   (1600 → 1100 → 750+inv, copia gris con estiramiento p5–p95 — receta v8.2).
   El centro de la `location` del hit da el CUADRANTE → rotación.
2. **PASO 2 — rescate hi-res (solo si el warp no leyó)**: re-decode de
   `fotoOriginal` a ≤6000 px (degrada 4800 → 3600 con prueba de memoria) y
   crops PARALELOGRAMO de cada esquina del QUAD (`cropParal`, port verbatim
   del bench; GEO {back:0.04, ss:0.40, sl:0.20}) con ensamble round-robin:
   - RONDA 1: {×1.5 G, ×2 G} por esquina (los 4 ganadores del bench viven aquí)
   - RONDA 2: {×1.5 L, ×2 L, jsQR@2, θ ±10° @2G/@1.5G} por esquina
   - Orden de esquinas: el ANILLO D62 (`ganadorPersistente`) manda la esquina
     de la rotación ganadora reciente (lección del bench: el orden fijo por
     forma del warp erró 4/4). Sin anillo: TL → BR → TR → BL.
3. Si la brújula decide rot≠0: se giran `fotoOcr` + `fotoProcesada` igual que
   el probe (T-A2 §2.1 paso 4, re-encode q0.92). Si rot=0: no rota (pero el
   payload viaja). Si NO decide: el sondeo OCR de SIEMPRE corre byte a byte.

## §2. Contratos respetados (D51/D57 — solo AÑADIR)

- **Traza nueva en línea PROPIA** (la del probe `[e14] orientacion …` NO cambia):
  `[e14] orientacion-qr via=jsQR-warp|zxing-hr cuadrante=Q rot=R aplicado=0|1 ms=N intentos=N payload=<qrCorto>`
  · y en fallo: `[e14] orientacion-qr sin-payload (cae al sondeo OCR de siempre) ms=N intentos=N …`
- **Kill-switch**: flag nuevo `qrBrujulaOrientacion` (default **true**; OFF =
  pipeline byte-idéntico a hoy — la brújula ni se instancia). Whitelist en
  `sanearFlags` + override localStorage/flags.json del dueño.
- **Jamás throw** (e64 §7-4): cualquier fallo = null = cae al sondeo de siempre.
- **Payload OPACA** (red line 10): solo guard de longitud ≥ 8; no se parsea ni
  se compara por prefijos.
- **jsQR vendido INTOCABLE** (red line 9): la `location` se lee con cast local
  (el .d.ts del vendor no la declara; el .js no se toca).
- **SIM intacta** (chips 8.2/7.0/4.3): guard `!opciones.simular` (§2.2).
- **sinRecorte**: sin warp/quad real → sin brújula (SIM-only en esta base).
- **MASIVA**: la capa 0 del runner manda — la brújula NO toca `parcial.qrCam`
  allí (guard `!esMasiva`). En cámara/individual, si la capa base no leyó y la
  brújula sí, el payload viaja como `qrCam` (mismo contrato de construirActa).
- **Anillo D62**: rot≠0 de la brújula se registra igual que un aplicado=1 del
  sondeo (mismo contrato T1.4) — alimenta el orden del sondeo Y de las esquinas.
- **Cero dependencias nuevas**: zxing-wasm 3.1.6 ya está en el repo (e63n/e64,
  wasm local en `public/wasm/` — el loader `moduloZxingDe` de identidad-qr se
  EXPORTA aditivo y se reutiliza; MISMA instancia en caché).

## §3. Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/e14/orientacion-qr.ts` | **NUEVO** — la brújula (warp + rescate hi-res + traza) |
| `src/lib/e14/scanner-core-bridge.ts` | wiring: brújula primero, sondeo = red de seguridad (`brujula === null &&` en ambas ramas) |
| `src/lib/e14/obs/tipos.ts` | campo `qrBrujulaOrientacion` AL FINAL de FlagsApp (D57) |
| `src/lib/e14/flags.ts` | default `true` + whitelist en `sanearFlags` |
| `src/lib/e14/flags.test.ts` | test del `toEqual` de defaults + whitelist del flag nuevo (patrón e73) |
| `src/lib/e14/orientacion.ts` | `ganadorPersistente` + `anilloGanadorRegistrar` EXPORTADOS (aditivo) |
| `src/lib/e14/masiva/identidad-qr.ts` | `moduloZxingDe` EXPORTADO (aditivo) |

## §4. Cómo apagarlo (kill switch del dueño)

```js
localStorage.setItem("e14-flags-override", JSON.stringify({ qrBrujulaOrientacion: false }));
```
(o `public/flags.json` con `{"qrBrujulaOrientacion": false}` — misma cadena de
prioridad DEFAULTS ← flags.json ← overrides de siempre).

## §5. QA esperado

- SIM (chips): sin línea `orientacion-qr` (guard) — chips byte-idénticos.
- Fotos planas que ya leían: la brújula puede DECIDIR por `jsQR-warp` (barato)
  y el sondeo se omite — resultado final igual (rot correcta) pero más rápido.
- Fotos arrugadas/blotchy (tira 16:09): `via=zxing-hr` — antes caían al sondeo
  (4–13 s); ahora rot correcta en ~1–5 s y sin recorrer el OCR de probes.
- QR ilegible total: línea `sin-payload` y el pipeline sigue byte a byte.
