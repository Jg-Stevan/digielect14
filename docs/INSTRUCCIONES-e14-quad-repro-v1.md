# KIT e14-quad-repro-v1 — laboratorio: reproducir y diagnosticar el quad sub-detectado

> Delegación para el agente. Base: **main @ `f38a6aa`** (o el main del momento). SOLO `lab/` —
> **cero cambios de producción en este kit** (si el diagnóstico apunta a un fix, se PROPONE en
> el README y el dueño aprueba el kit de fix aparte — protocolo FILTROS-1: rig → evidencia →
> decisión). Prioridad: MEDIA (el rechazo de campo fue CORRECTO; esto es robustez del quad).

---

## 0. Decisión del dueño (literal)

- El dueño (2026-10-17, tras revisar los ZIPs de campo): **«genera los 3 kits completos para
  delegarlos al agente»** — esta es la **T-C**, propuesta textual:
  > «**T-C · Reproducir el quad sub-detectado del zip2:** con `original.jpg` del ZIP 2 como
  > fixture — el quad quedó en rect perfecto y=0.333→0.601 con el papel visible hasta el borde
  > del frame. Baja prioridad (el rechazo fue correcto), pero es el mismo tema de robustez del
  > quad que ya teníamos anotado.»

---

## 1. Evidencia de campo (lo que hay que reproducir)

### `e14-diag-mesa-002-115822-i2.zip` (intento 2) — EL CASO OBJETIVO

- `captura.quad` = `[0.362,0.333  0.694,0.333  0.694,0.601  0.362,0.601]` — **rectángulo
  perfecto alineado a ejes** (sospechoso: un acta real foto­grafiada nunca da 4 lados exactos;
  huele a fallback de `refineQuadFromLines` o a un contorno parcial).
- `captura.crop` = 1062×1144 → ratio h/w ≈ **1.08** — un E-14 P1 completo mide ≈ **2.9**
  (zip1: 887×2586). El crop se quedó con la MITAD SUPERIOR del acta.
- La FOTO (`original.jpg`) muestra el papel visible **hasta el borde inferior del frame**
  (y≈0.97): candidatos 1 y 2, VOTOS EN BLANCO/NULOS/NO MARCADOS y SUMA TOTAL están EN el
  encuadre, pero FUERA del quad. Solo el pie (KIT) quedó fuera del frame.
- Consecuencia: OCR cortado en «TOTAL VOTOS INCINERADOS» → RECHAZADA INCOMPLETA 6.4
  (**correcto** — el pie no estaba en el frame) — pero el crop desperdició ~40% del papel que
  SÍ estaba en el encuadre.

### `e14-diag-mesa-001-115643-i1.zip` (intento 1) — EL CONTROL

- `captura.quad` = `[0.383,0.262  0.633,0.280  0.610,0.863  0.357,0.868]` — trapecio real con
  tilt (detección sana), crop 887×2586 (ratio 2.92 ✓). Misma acta, mismo puesto, misma mesa:
  **la detección SÍ funciona con esta captura** — el fallo del zip2 es intermitente/de
  condición, no sistemático del modelo de acta.

### Hipótesis a rankear (el lab debe discriminar con evidencia, no adivinar)

- **H1** — `refineQuadFromLines` (worker L216) cayó en `fallback` en 2+ lados y devolvió el
  rect del fallback (los `fellBack[i]` están instrumentables).
- **H2** — `selectQuad` (L386) eligió un contorno parcial: el quad termina justo en la banda
  negra «CANDIDATO/AGRUPACIÓN/VOTACIÓN» (y≈0.60 en el frame) — la banda oscura + los paneles
  de fotos pueden partir la región blanca y el contorno ganador (área×aspect+whiteness) se
  quedó con el bloque superior.
- **H3** — `collectQuadCandidates` (L1222) nunca generó un candidato que llegara al fondo
  (edge map/umbral cortó el papel inferior por la sombra del frame o el brillante del pupitre).
- **H4** — factor de captura en vivo (frame de video con motion blur/autoscan distinto al
  archivo) — se descarta/queda en pie según Fase 1 (§5).

---

## 2. Alcance

### CAMBIA (todo bajo `lab/`)

1. `lab/fixtures/` NUEVO: los 2 `original.jpg` de los ZIPs de campo + `README.md` de
   procedencia (§4-A). **Se committean** (evidencia real de campo — misma política que
   `src/assets/acta-e14-real.jpg`; ajustar `lab/.gitignore` si hace falta para NO ignorar
   `fixtures/` — hoy ignora `fotos/`).
2. `lab/quad-repro.html` NUEVO: harness de detección aislado que habla el protocolo REAL del
   worker (§4-B) y dibuja el quad sobre la foto.
3. `lab/worker-copy/detection-worker.js` NUEVO: **copia instrumentada** del worker (console
   traza de candidatos y fallbacks) — se instrumenta la COPIA, nunca el original de
   `public/` (§4-C).
4. `lab/resultados/quad-repro-*.json` + láminas PNG + `lab/README.md` §Quad-repro con la
   conclusión rankeada (§6).

### NO CAMBIA

- `public/scanner/detection-worker.js` — INTACTO (el CI `parity` compara byte a byte contra
  web-scanner; tocarlo rompe el build).
- `src/**`, `@jg-stevan/scanner-core` (npm), el app: NADA.
- La decisión del gate: aunque el lab mejore el entendimiento, RECHAZADA del zip2 sigue siendo
  el desenlace correcto de campo (el pie nunca entró al frame).

---

## 3. Protocolo del worker (verificado en `public/scanner/detection-worker.js` L1677-1710 y en
`node_modules/@jg-stevan/scanner-core/dist/detector-client.js`)

- `new Worker(url)` → responde `{type:"ready", probe, opencvUrl}` cuando carga opencv.js
  (el worker la carga solo vía `loadOpenCv()` — verificar en el código si la URL es local o
  CDN y asegurar que el harness la tenga alcanzable).
- `{type:"config", docProfile?, maxWarpLongSide?}` — configuración previa (opcional).
- `{type:"detect", bitmap, ts}` con `[bitmap]` transferido → resultado con el quad
  normalizado 0-1 (mismas unidades que `captura.quad` del diagnóstico). Posibles respuestas:
  `{type:"busy", ts}` (worker ocupado — esperar) y `{type:"error", message}`.
- `{type:"warp", bitmap, quad, ts, manual}` — para validar el warp con un quad forzado
  (útil para láminas «¿cómo se vería el crop con el quad correcto?»).

## 4. Spec por archivo

### 4-A `lab/fixtures/`

- `mesa-001-original.jpg` (1.5 MB) y `mesa-002-original.jpg` (1.6 MB) — copiar de los ZIPs de
  diagnóstico del dueño (`e14-diag-mesa-001-115643-i1.zip` / `e14-diag-mesa-002-115822-i2.zip`,
  carpeta `download/` de la sesión). Son los bytes EXACTOS que el pipeline vio en campo (el
  ZIP se empaqueta STORE sin re-encode — kit PROD-3 §3) → la detección debe ser determinista.
- `lab/fixtures/README.md`: procedencia (CONSULADO 88 · EGIPTO · ZONA 05 PUESTO 02 · mesas
  001/002 · Frankfurt KIT 399 · 2026-10-17), qué representa cada uno (control / objetivo) y
  los quads esperados del §1 (para comparar de un vistazo).

### 4-B `lab/quad-repro.html` + `lab/quad-repro.js`

Harness mínimo (vanilla, sin build):

1. Selector de fixture (o drag&drop) → `createImageBitmap(file)`.
2. `new Worker("./worker-copy/detection-worker.js?v=7")` (ruta relativa a `lab/`) → esperar
   `ready`.
3. `postMessage({type:"detect", bitmap, ts:Date.now()}, [bitmap])` → pintar el quad devuelto
   SOBRE la foto en un canvas (líneas por lado, esquinas numeradas TL-TR-BR-BL) + imprimir el
   quad normalizado, el crop estimado (mismo cálculo bbox→px de `calidadDeActa`, bridge L479)
   y el ratio h/w con la referencia 2.9.
4. Botón «warp con quad devuelto» (usa `{type:"warp"}`) → miniatura del crop resultante al
   lado del fixture (comparativa visual del desperdicio).
5. Todo corre sirviendo la raíz del repo con un estático cualquiera (`bunx serve .` →
   abrir `http://localhost:8xxx/lab/quad-repro.html`) — sin tocar el dev server del app ni
   `next build`.

### 4-C `lab/worker-copy/detection-worker.js` — copia instrumentada

Partir del archivo EXACTO de `public/scanner/detection-worker.js` (mismo commit) y añadir
SOLO trazas:

- En `selectQuad`: por cada candidato top-N → `{area, ratioAspect, whiteness, validateOk,
  scoreFinal, orden}"` y cuál ganó; si la lista viene vacía → traza explícita (H3).
- En `refineQuadFromLines`: por cada lado → línea usada vs `fallback[i]` (H1); traza del quad
  final y de cuántos lados cayeron en fallback.
- En el handler `detect`: traza final `{quad, frameW, frameH}`.
- Formato: `console.info("[quad-repro] …")` — un JSON por línea (parseable).
- La copia lleva un header de 5 líneas: «COPIA INSTRUMENTADA de public/scanner/
  detection-worker.js@<sha> — SOLO lab; la producción es el original (parity CI)».

### 4-D `lab/resultados/` + `lab/README.md` §Quad-repro

- `quad-repro-mesa-001.{json,png}` y `quad-repro-mesa-002.{json,png}`: quad(s) detectado(s),
  trazas de candidatos, lámina con el quad dibujado + el crop warp.
- En el README: la tabla hipótesis (H1-H4) × evidencia (traza) × veredicto, y la propuesta de
  fix rankeada (solo PROPUESTA — sin implementar).

---

## 5. Procedimiento (3 fases)

1. **Fase 1 — repro mínimo (0 código nuevo):** cargar los 2 fixtures por la vía de archivo
   del app en dev (fuente archivo) y leer `captura.quad` del diagnóstico/log. Criterio:
   - zip1 → quad tipo trapecio ~[0.36-0.63 × 0.26-0.87] (control sano).
   - zip2 → SI reproduce el rect corto (y_bottom ≤ 0.65) → el fallo es determinista de la
     detección sobre esta imagen (H1-H3 vivos). SI NO reproduce → el frame de VIVO difiere del
     archivo (H4) → documentarlo y pasar a Fase 2 igual (el harness permite reproducir con el
     archivo de todas formas; el fix contemplaría ambas vías).
2. **Fase 2 — instrumentación:** repetir con la copia instrumentada en el harness → clasificar
   H1-H3 con las trazas (qué candidato ganó, con qué score, cuántos lados en fallback, qué
   contornos existían).
3. **Fase 3 — contra-evidencia:** con el harness, forzar `{type:"warp"}` con un quad «ideal»
   (dibujado a mano sobre el papel visible del zip2) → lámina del crop que SE PERDIÓ (evidencia
   del impacto) + medir el score del candidato ideal en las trazas (¿existía y perdió? ¿ni
   existió?) — esto decide si el fix futuro es de SCORING de candidatos o de GENERACIÓN.

---

## 6. Criterios de aceptación

1. Repro determinista del zip2 documentado (o la demostración de que la vía archivo no
   reproduce → H4 con evidencia).
2. La causa raíz identificada a nivel `función:línea` de la copia instrumentada (no «el
   detector falló» genérico).
3. Control zip1 saneando el rig (quad correcto en el harness — si el harness marca mal el
   control, el rig está mal, no el detector).
4. Láminas legibles (quad dibujado + crop warp) commiteadas en `lab/resultados/`.
5. CI del PR en verde (solo toca `lab/` + docs — parity/checks intactos por construcción).

## 7. QA del dueño (2 min)

Abrir las 2 láminas del PR: en la del zip2 se debe VER a simple vista el quad corto sobre la
foto (el papel sigue debajo) y en la comparativa «warp ideal» el contenido que se perdió
(candidatos + SUMA TOTAL). Eso es todo — la decisión de fix se toma con el README.

## 8. Rama base y orden

- Rama: **`lab/quad-repro`** desde main. Independiente de T-A y T-B — puede mergearse en
  cualquier momento (solo `lab/` + docs; sin conflicto posible con los otros dos kits).
- El fix de detección (si el README lo propone y el dueño lo aprueba) será un kit PROD aparte
  — NO se anticipa aquí.

## 9. Pitfalls (10)

1. **NUNCA editar `public/scanner/detection-worker.js`** — el CI `parity` hace diff byte a
   byte contra web-scanner; un byte de más = build rojo (ya lo vivimos en #11/#13).
2. **Instrumentar la COPIA (lab/worker-copy/)** — y anotar el sha del commit del original en
   el header de la copia, para que la evidencia sea reproducible.
3. **El bitmap se TRANSFIERE** (`[bitmap]` en postMessage) — tras el transfer el caller pierde
   el ownership; re-crear el bitmap por cada intento (dos `detect` seguidos con el mismo bitmap
   → `busy`/`closed`).
4. **`busy` es una respuesta normal** — el harness debe esperar/reintentar (el worker es
   single-flight por diseño A-04/A-05).
5. **El quad del diagnóstico está NORMALIZADO 0-1** (fracciones del frame) — para dibujar hay
   que multiplicar por el tamaño del canvas; el crop px se deriva con el MISMO cálculo bbox del
   bridge (L479), no con otro inventado.
6. **El fixture es la foto ORIGINAL sin recortar** — la detección de campo corrió sobre ESE
   bitmap (el ZIP es STORE sin re-encode); si el browser re-decodifica con otra rotación
   EXIF, el repro desincroniza (los fixtures no traen EXIF de cámara — verificable).
7. **ratio 2.9 es referencia, no ley** — P2 (constancias) y actas con doblez miden distinto;
   usarlo como señal de diagnóstico, NUNCA como guard de producción en este kit.
8. **Sin dependencias nuevas en package.json** — el harness es vanilla JS; el lab Python de
   FILTROS-1 no entra aquí (la detección es JS del worker).
9. **Los fixtures son actas de campo reales** — mismos cuidados del repo: no re-distribuir
   fuera del repo privado, y anotar procedencia en el README (kit FILTROS-1 §fotos).
10. **Si la Fase 1 no reproduce, NO forzar conclusiones** — H4 (diferencia vivo/archivo) es un
    hallazgo legítimo y deja el rig listo para cuando el dueño capture un caso nuevo con el
    ZIP completo.

---

### Contrato de entrega del agente

- PR `lab/quad-repro` → main, CI verde.
- `lab/fixtures/` (2 JPGs + README), `lab/quad-repro.html`+`js`, `lab/worker-copy/` con trazas,
  `lab/resultados/` con JSON+PNG de ambos fixtures, `lab/README.md` §Quad-repro con la tabla
  H1-H4 × evidencia × veredicto y la propuesta de fix rankeada.
- worklog + AGENTS.md actualizados.
- Si el dueño no adjuntó los ZIPs al agente: pedirlos (están en `download/` de la sesión del
  dueño: `e14-diag-mesa-001-115643-i1.zip` / `e14-diag-mesa-002-115822-i2.zip`) — el kit NO
  se ejecuta con fixtures inventados.
