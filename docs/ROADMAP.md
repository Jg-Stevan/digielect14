# ROADMAP — digielect14

Trabajo pendiente, ordenado por impacto. La **historia** de lo ya hecho no está
aquí: vive en `docs/DECISIONS.md` (decisiones `D1…D76`), en los
`docs/REPORTE-*.md` (evidencia de cada medición) y en `git log`.

## 1. Paridad de resultado con `supervision-e14` (prioridad alta)

Ambos repos comparten dueño, dominio y motor de npm. El objetivo es que **un
mismo acta produzca la misma salida** en el digitalizador móvil y en el
supervisor masivo, no que el móvil cargue con la cola masiva.

- [ ] **Test de contrato cross-repo.** Fijar una imagen (una de
      `src/assets/acta-sim-*.jpg`) y exigir que `quad`, `ocrTexto`,
      `clasificacion`, `score`, `status` y la `EntradaPuente` coincidan entre
      `digielect14` y `supervision-e14`. `supervision-e14` ya trae la semilla de
      harness de caracterización (`masiva/__tests__/caracterizacion.harness.ts`).
- [ ] **Portar la mejora de orientación `probe-mini768`** (sonda chica que llega
      en hardware lento) desde `supervision-e14/src/modules/digitalizador/lib/e14/orientacion.ts`
      al `src/lib/e14/orientacion.ts` de este repo, **reconciliándola** con el
      presupuesto por tier que ya existe aquí (D56) — no sustituirlo.
- [ ] **Mantener UN solo motor OCR determinista.** La cascada actual
      (Tesseract best-PSM4 → gate → RapidOCR PP-OCRv4 escalonado) da el mismo
      resultado en todos los dispositivos. El router por hardware del repo
      hermano (PP-OCRv5 en gama alta + sidecar nativo) **no** se porta: en un
      celular BAJO/MEDIO ese router termina en el mismo motor que ya fija este
      repo, y portarlo añadiría 12,7 MB de modelos y ~487 MB de RAM pico.
- [ ] Revisar `divipol.ts` (difiere del hermano solo en el import de
      `PUBLIC_BASE`) y `clasificador.ts` / `completitud.ts` (hoy byte-idénticos)
      para que un cambio de negocio se haga una vez y se sincronice con un test,
      no a mano en dos repos.

## 2. QA de contrato en CI

- [x] `scripts/qa-aa-quickwins.ts` 11/11 — cerrado el 2026-11-04: tres
      microcopias del panel de desarrollador (`text-slate-500` → `text-slate-400`).
- [x] `scripts/qa-obs-ui.ts` 8/8 — cerrado el 2026-11-04: el ancla pedía
      «modo de diagnóstico» y el dueño lo renombró a «modo desarrollador»; se
      recalibró el harness, no la UI.
- [x] Correr `scripts/qa-*.ts` dentro de `.github/workflows/quality.yml` —
      cerrado el 2026-11-04. CI ahora valida tipos + lint + vitest + build +
      los 2 smoke de worker + los 6 harnesses, y `bun` quedó **fijo en 1.4.2**
      en `quality.yml` y `deploy-pages.yml` (el smoke compara el artefacto
      commiteado byte a byte y el minificador de bun cambia entre versiones).
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

## 4. Decisiones del dueño que frenan la salida a público

- [ ] **Licencia**: sin `LICENSE`, «público» equivale a todos los derechos
      reservados.
- [ ] **`src/assets/acta-e14-real.jpg`** es foto real de un acta y se empaqueta
      como fixture SIM; se reemplaza por las sintéticas o se justifica.
- [ ] **Siete ramas remotas ya mergeadas**: borrarlas (acción remota).
- [ ] **Peso del historial** (`.git` ≈55 MB de blobs ML): solo se reduce
      reescribiendo historia, prohibido por las reglas del repo salvo orden
      expresa.

## 5. Higiene pendiente (bajo riesgo)

- [ ] `docs/evidence/sim-recursos/` (≈76 KB de scripts y JSON de corridas
      históricas): decidir si sigue siendo evidencia citable o se retira.
- [ ] Exports de `src/lib/e14/obs/` que `knip` no ve: valorar marcarlos con
      `/** @public */` en vez de documentarlos en `docs/DEUDA.md`.
- [ ] Duplicado `blobADataUrl` (`jornada.ts` / `puente/mapear.ts`): fusionar solo
      si aparece un tercer consumidor o si se movió a una hoja de utilidades que
      no arrastre el core.
- [ ] Los 46 comentarios que citan `apps/scanner-lab/…` con números de línea del
      lab: son trazabilidad del port, pero envejecen. Reescribirlos a
      «movido del lab (web-scanner)» al tocar cada archivo, no en un commit
      masivo.
