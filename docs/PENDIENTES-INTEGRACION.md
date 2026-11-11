# PENDIENTES-INTEGRACION — dejados sobre la mesa por la Ola 7

Lo que la Ola 7 (arquitectura, calidad y documentación) dejó **a medias a
propósito** — porque la otra mitad es de otro agente/PR — o bloqueado por
configuración ajena. Cada entrada dice QUÉ falta, QUIÉN y CÓMO se cierra.
Nada de esto es bug: es integración pendiente entre olas.

---

## 1. Swap de imports de componentes → `fachada.ts` (7.5) — ✅ CERRADO EN LA INTEGRACIÓN

* El swap de los 22 imports (12 archivos) SE HIZO en la integración final;
  `rg "@jg-stevan/scanner-core" src/components` → 0 y la regla
  `no-restricted-imports` está en **`error`**. Criterio de cerrado cumplido.

## 2. Fórmula de calidad consumida — falta el «criterio cerrado» de tamaño (7.6)

* La fórmula (`puntajeCalidad` + `nivelPorPuntaje`) ya vive UNA sola vez en
  `packages/scanner-core/src/core/image-processor.ts` con test
  (`src/core/__tests__/calidad-puntaje.test.ts`); el bridge la consume.
* **Pendiente multi-PR**: dividir `scanner-core-bridge.ts` (~2.5k líneas) en
  `sim/`, `scoring/`, `ocr-cascada/`, `recorte/`, `entidad/`. El corte del
  `pipelineRecorte` es el mismo territorio que el troceado 7.3
  (`docs/PLAN-TROCEADO-PIPELINE.md`) — coordinar para no hacerlo dos veces.

## 3. Migración gradual a sub-interfaces (7.8)

* `PasosPipelineL2` ya ES la intersección `PasosCaptura & PasosCalidad &
  PasosOcr & PasosGate` (mismos 21 miembros — cero rotura).
* **Pendiente**: que el troceado 7.3 haga que cada paso nuevo declare SU
  sub-interfaz (no el paquete de 21). La god-interface desaparece cuando el
  último consumidor deje de pedirla entera.

## 4. `MAX_INTENTOS_ESCANEO` en `store.ts` (7.1) — ✅ CERRADO EN LA INTEGRACIÓN

* `store.ts` ya importa la constante de `politica/umbrales` y el literal
  `maxIntentos: 4` fue sustituido (integración final).

## 5. Foto real del acta: borrar el binario (Ola 1 · D35)

* El CÓDIGO ya no referencia `src/assets/acta-e14-real.jpg` (el modo SIM
  usa solo los 4 sintéticos `acta-sim-*.jpg` con cargadores dinámicos S-6).
* **Pendiente de custodia del repo**: `git rm src/assets/acta-e14-real.jpg`
  (348 KB, foto real de un acta — la decisión D35/Ola 1 la retira). El
  archivo sigue en disco porque `src/assets/**` no era zona de esta ola.
* **Validación de demo pendiente del dueño**: con la foto real retirada, el
  asset [0] del modo SIM es `acta-sim-extra-1.jpg` (pipeline completo) —
  confirmar que el chip 8.2 sigue cayendo en ÓPTIMA; si no, recalibrar el
  orden de `ACTAS_SIM` (un cambio de UNA línea en el bridge).

## 6. Test de componente `review-view.copy.test.ts` (7.10) — activarlo

* El test está ESCRITO y parsea limpio, pero corre `skip` por DOS bloqueos
  de configuración fuera de esta zona:
  1. `vitest.config.ts` (zona de otro agente) no define el alias `@/*` de
     tsconfig — `ReviewView` importa `@/lib/e14/store` y no resuelve.
     Añadir `resolve: { alias: { "@": path.resolve(__dirname, "src") } }`.
  2. `@testing-library/react` + `jsdom` declarados en devDependencies pero
     SIN instalar (`bun install`).
* **CIERRE**: alias + install + cambiar `describe.skip` por `describe`.
  El upgrade a Testing Library real (interacciones) es opcional.
* Mismo estado para `e2e/humo.spec.ts` (Playwright no instalado): el spec
  documenta en su cabecera los 3 pasos para activarlo y llevarlo a CI.

## 7. Harnesses `qa-*.ts` — informe caso por caso (7.11)

Decisión por harness (criterio del plan: migrar a imports solo cuando el
cambio sea mecánico y seguro; los contratos de TEXTO se quedan):

| harness | ancla hoy | decisión | justificación |
|---|---|---|---|
| `qa-aa-quickwins.ts` | regex sobre clases CSS en componentes | **SE QUEDA** | contrato de TEXTO de UI (AA/contraste): lo anclado es la clase literal en el JSX — un import no puede expresarlo |
| `qa-autoenvio.ts` | imports reales (clasificador) EXCEPTO bloque 4 | **SE QUEDA** | los literales que ancla (`UMBRAL_AUTO=0.82`…) NO están exportados del paquete: exportarlos excede el alcance de paquete autorizado en esta ola. El golden `contrato-motor.json` YA cubre las mutaciones de umbral conductualmente (bandas 0.86/0.82/0.78 — ARQUITECTURA §5.3): el source-scan es cinturón+tirantes. La claves del store que mira son zona ajena (bloque 7.4) |
| `qa-obs-contract.ts` | regex de firmas `export function nombre` en su archivo | **SE QUEDA** | el contrato §4.3 congela LA FORMA de la firma (function exportada en su módulo) — un import no distingue function de const-arrow ni verifica el archivo |
| `qa-obs-privacidad.ts` | greps NEGATIVOS (0 `console.`, 0 `localStorage` fuera de claves) | **SE QUEDA** | ausencias: por naturaleza source-scan |
| `qa-obs-transporte.ts` | anclas estáticas de transporte | **SE QUEDA (en CI)** | el comportamiento YA está cubierto con imports reales por `obs/transporte.test.ts` (vitest). Consolidación futura: eliminar el harness y confiar en el vitest — decisión de dueño, no urgente |
| `qa-obs-ui.ts` | aria-labels/textos de componentes | **SE QUEDA** | contrato de TEXTO de UI; complemento natural: los tests de copy de 7.10 |
| `qa-paridad-motor.ts` | cotejo de checkout hermano | **SE QUEDA** | en CI sale «omitido» (exit 0) y la paridad real la sostiene el golden compartido (`contrato-motor.json` validado en ambos repos). La opción del plan (sembrar el checkout hermano en cache de CI) exige tocar `.github/**` — zona prohibida de esta ola |

* **Log-contrato D51** (contrato de texto): REEMPLAZADO por el constructor
  único + snapshot (`log-contrato.ts` + `log-contrato.test.ts`) — hecho.
* **Kill-switch/flags**: ya es contrato por IMPORT (`flags.test.ts` fija el
  literal exhaustivo de `FLAGS_DEFAULT`) — no hay regex que migrar.

## 8. `noImplicitAny` del raíz (7.7)

* `packages/scanner-core/tsconfig.json` ya tiene `noImplicitAny: true`
  (verificado: `bunx tsc --noEmit` verde en el paquete).
* El `tsconfig.json` RAÍZ sigue en `noImplicitAny: false` A PROPÓSITO (el
  plan 7.7.4 lo sube directorio por directorio; `src/` hoy genera demasiado
  ruido sin triar). Siguiente escalón sugerido: `src/lib/e14/politica/**`
  (nace limpia — ya tiene `no-explicit-any: error` por ESLint).

## 9. Avisos de lint nuevos a triar (7.7)

Con `no-explicit-any: warn` + `exhaustive-deps: warn` reactivados, el lint
emite ~20 avisos NUEVOS de código PREEXISTENTE (0 errores): 1 `any` en
`packages/scanner-core/src/ocr/rapidocr.ts:165`, 1 `lee` sin usar en
`tests/cascada.test.ts`, y los hooks de cámara (`useSesionCamara`/`ScanView`)
con refs deliberados — el hallazgo ALTO ya documentado en `docs/DEUDA.md`.
**Nada se silencia a ciegas**: triar con directiva justificada o arreglar.

## 10. Recalibración del número de tests en docs

`README.md`/`ARQUITECTURA.md` citaban «267 tests»; tras la Ola 7 la cifra
real es **~334 en src (vitest) + 170 en el paquete (bun)** — se actualizó
donde tocaba; el número que congele cada PR nuevo debe re-verificarse
(`npx vitest run` · `bun test packages/scanner-core`).

## 11. Paridad `integridad.ts`: E3 (marcas de esquina por regiones) vive solo en el hermano

* `supervision-e14` (commit `09c3da2`, olas E/F del motor) añadió
  `OpcionesMarcasEsquina { porRegiones?: boolean }` y la lectura por regiones
  en `marcasEsquina`; nuestra copia no lo tiene. `scripts/qa-paridad-motor.ts`
  la marca DIVERGE **desde antes** de la rama de fusión (verificado contra
  `main`: la deriva no es de `feat/fusion-evidencia-divipol`, que no toca
  `integridad.ts`).
* **CIERRE**: portar E3 (firma + lectura por regiones + su test
  `marcas-esquina.test.ts`) a este repo con su propia medición —es un cambio
  de motor, no un efecto colateral de la fusión—, o revertirla en el hermano.
  Hasta entonces el QA de paridad queda 19/20; todos los demás módulos,
  incluidos los tres nuevos de fusión, cotejan byte a byte.
