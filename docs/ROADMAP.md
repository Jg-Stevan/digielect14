# ROADMAP — digielect14

Trabajo pendiente, ordenado por impacto. La **historia** de lo ya hecho no está
aquí: vive en `docs/DECISIONS.md` (decisiones `D1…D76`), en los
`docs/REPORTE-*.md` (evidencia de cada medición) y en `git log`.

## 1. Paridad de resultado con `supervision-e14` (prioridad alta)

Ambos repos comparten mantenedor, dominio y motor de npm. El objetivo es que **un
mismo acta produzca la misma salida** en el digitalizador móvil y en el
supervisor masivo, no que el móvil cargue con la cola masiva.

- [x] **Test de contrato cross-repo** — cerrado el 2026-11-04 (D80) en la capa
      que los dos repos comparten de verdad: `src/lib/e14/__fixtures__/contrato-motor.json`
      (21 cabeceras SINTÉTICAS + su salida exacta + sus derivados + la escalera
      `score→status`) lo valida cada repo contra SU propia copia del motor
      (`contrato-motor.test.ts`; aquí vitest, allá `bun:test`) y
      `scripts/qa-paridad-motor.ts` coteja los dos checkouts cuando el hermano
      está en el disco. **No cubre `quad` ni `ocrTexto` sobre píxeles ni la
      `EntradaPuente`** — el primer par necesita navegador+wasm (no corre en un
      test de repo) y el segundo no existe en el hermano (allá el resultado va
      a su propia base, no a un hub). Lo que sí queda fijado: la misma entrada
      de texto produce el mismo veredicto de negocio en los dos productos.
- [x] **Revisar `divipol.ts` / `clasificador.ts` / `completitud.ts`** — cerrado
      el 2026-11-04 (D80): los cuatro son literalmente el mismo código (delta
      declarado: dos `export` que el hermano necesita en sus tests y el
      `PUBLIC_BASE` de `@/shared/env`), y ahora hay un test que lo exige, no una
      nota. Se extendió a `kits.ts`, `integridad.ts`, `diagnostico.ts`,
      `senal-lectura.ts` y `marcadores.ts`.
- [ ] **Propagar el golden cuando cambie el negocio** (procedimiento en
      `AGENTS.md` § Paridad): regenerar aquí, revisar el descriptor a descriptor
      y copiar el archivo al hermano. El mecanismo grita si se olvida — pero el
      olvido es posible mientras los dos repos tengan CIs separados.
- [ ] **Costo del clasificador en el camino fuzzy** (medido en PC, bun 1.4.2,
      3 corridas): las cabeceras que resuelven puesto por NOMBRE con poco match
      tardan **130-360 ms** por acta (`cairo-lugar-ilegible-sin-kit` 198-330,
      `berlin-lugar-de-otra-ciudad` 140-200, `ruta-sin-pais` 154-208) contra
      **0.1-0.3 ms** de las que resuelven por código. Son 2-4 llamadas por acta,
      así que hoy no come el presupuesto de D77 (120-480 s); si al medir en
      celular BAJO se vuelve ruido, la salida es memoizar `normalizarNombreLugar`
      + trigramas en `similitud()` — cambio de rendimiento, cubierto por el
      golden (no puede alterar una clasificación).
- [x] **Portar la mejora de orientación `probe-mini768`** — cerrado el
      2026-11-04 (D79): el lado de la miniatura del sondeo pasó a ser el flag
      `probeMiniLado` (default 1280, clamp [320, 1280], doble whitelist) sin
      tocar los umbrales del fallo seguro ni el presupuesto por tier de D56/D77.
- [ ] **Medir el port en celular** (es lo único que falta para cerrarlo con
      evidencia propia): A/B `{"probeMiniLado":320}` vs default sobre las mismas
      actas, por tier, mirando `escala=` en la traza `[e14] orientacion` (si
      sigue apareciendo el lado real de la fuente, la miniatura no decide y el
      cambio no paga). La evidencia actual es del repo hermano, en PC.
- [ ] **Mantener UN solo motor OCR determinista.** La cascada actual
      (Tesseract best-PSM4 → gate → RapidOCR PP-OCRv4 escalonado) da el mismo
      resultado en todos los dispositivos. El router por hardware del repo
      hermano (PP-OCRv5 en gama alta + sidecar nativo) **no** se porta: en un
      celular BAJO/MEDIO ese router termina en el mismo motor que ya fija este
      repo, y portarlo añadiría 12,7 MB de modelos y ~487 MB de RAM pico.

## 2. QA de contrato en CI

- [x] `scripts/qa-aa-quickwins.ts` 11/11 — cerrado el 2026-11-04: tres
      microcopias del panel de desarrollador (`text-slate-500` → `text-slate-400`).
- [x] `scripts/qa-obs-ui.ts` 8/8 — cerrado el 2026-11-04: el ancla pedía
      «modo de diagnóstico» y el mantenedor lo renombró a «modo desarrollador»; se
      recalibró el harness, no la UI.
- [x] Correr `scripts/qa-*.ts` dentro de `.github/workflows/quality.yml` —
      cerrado el 2026-11-04. CI ahora valida tipos + lint + vitest + build +
      los 2 smoke de worker + los harnesses (7 con `qa-paridad-motor.ts`, que en
      CI sale «omitido» porque el checkout hermano no existe: la paridad en CI
      la sostiene `contrato-motor.test.ts` con el golden commiteado), y `bun`
      quedó **fijo en 1.4.2** en `quality.yml` y `deploy-pages.yml` (el smoke
      compara el artefacto commiteado byte a byte y el minificador de bun cambia
      entre versiones).
- [x] Recalibrar los contadores que citaban cifras viejas: la cabecera de
      `scripts/check-quality.sh` ya no habla de 162 tests ni del baseline de
      `knip`, y remite a `docs/DEUDA.md` para los falsos positivos.
- [ ] Medir en la primera corrida de CI con los pasos nuevos: el workflow
      todavía no se ha ejecutado con esta forma (los smokes se validaron a mano
      contra un `BUILD_STATIC=1 bunx next build` local).

## 3. Entrada de imágenes

- [ ] Decidir si el puesto puede seleccionar **varias fotos de una vez**. Hoy el
      picker acepta un archivo por selección
      (`ScanView.tsx:594` y `:602`, sin atributo `multiple`), coherente con
      «un acta a la vez», pero molesto cuando hay que corregir la página 2.
- [ ] Decidir si entran **PDF** (escaneados de acta). El repo hermano los acepta;
      este no: `pareceImagen()` los rechaza y no hay decodificador de PDF en el
      pipeline. El texto de ayuda ya no lo promete.

## 4. Decisiones del mantenedor que frenan la salida a público

- [ ] **Licencia**: sin `LICENSE`, «público» equivale a todos los derechos
      reservados.
- [ ] **`src/assets/acta-e14-real.jpg`** es foto real de un acta y se empaqueta
      como fixture SIM; se reemplaza por las sintéticas o se justifica.
- [ ] **Siete ramas remotas ya mergeadas**: borrarlas (acción remota).
- [ ] **Peso del historial** (`.git` ≈55 MB de blobs ML): solo se reduce
      reescribiendo historia, prohibido por las reglas del repo salvo orden
      expresa.

## 5. Higiene pendiente (bajo riesgo)

- [x] `docs/evidence/sim-recursos/` (≈76 KB de scripts y JSON de corridas
      históricas): movido a `docs/archivo/sim-recursos/` (2026-11-12) — se
      conserva por trazabilidad y sigue citable como evidencia histórica.
- [ ] Exports de `src/lib/e14/obs/` que `knip` no ve: valorar marcarlos con
      `/** @public */` en vez de documentarlos en `docs/DEUDA.md`.
- [ ] Duplicado `blobADataUrl` (`jornada.ts` / `puente/mapear.ts`): fusionar solo
      si aparece un tercer consumidor o si se movió a una hoja de utilidades que
      no arrastre el core.
- [ ] Los 46 comentarios que citan `apps/scanner-lab/…` con números de línea del
      lab: son trazabilidad del port, pero envejecen. Reescribirlos a
      «movido del lab (web-scanner)» al tocar cada archivo, no en un commit
      masivo.
