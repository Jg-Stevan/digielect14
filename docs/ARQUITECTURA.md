# ARQUITECTURA — digielect14

Mapa del repo para leerlo sin explorarlo a ciegas. Si vas a cambiar
comportamiento, empieza por el pipeline (§2) y por las flags (§5).

## 1. Forma del proyecto

```
src/app/            rutas de Next (una sola página: src/app/page.tsx)
src/components/e14/ UI: pantallas, hooks de cámara, panel de desarrollador
src/lib/e14/        dominio: pipeline, OCR, QR, clasificación, envío, observabilidad
src/assets/         imágenes SIM empaquetadas (fixtures del modo simulación)
public/             modelos ONNX, traineddata, wasm, service worker, divipol.json
scripts/            QA con contrato (qa-*.ts), build de workers, servidores locales
docs/               DECISIONS (autoridad), reportes de medición, esta arquitectura
```

Sin base de datos y sin API propia: el estado vive en el dispositivo
(IndexedDB + `localStorage`) y la única salida de red con datos es el hub.

## 2. El pipeline de un acta

Un acta entra por cámara o por archivo y sale con `status`, `score`, `quad`,
`ocrTexto` y `clasificacion`. El orquestador es
`RealCoreBridge.escanearActa()` ([src/lib/e14/scanner-core-bridge.ts:1231](src/lib/e14/scanner-core-bridge.ts#L1231));
las etapas emiten progreso con `etapa` canónica
(`DETECTANDO → RECORTANDO → REALZANDO → CALIDAD → OCR`).

| # | etapa | dónde | qué produce |
|---|---|---|---|
| 1 | capa 0 QR | [src/lib/e14/qr/capa0-qr.client.ts](src/lib/e14/qr/capa0-qr.client.ts) + `capa0-qr.worker.ts` | identidad del acta desde el frame, en worker, en paralelo a la detección |
| 2 | detección de bordes | `scanner-core` (`detectDocumentEdgesDetail`) | `quad` de 4 esquinas |
| 3 | orientación | [orientacion.ts](src/lib/e14/orientacion.ts), [orientacion-qr.ts](src/lib/e14/orientacion-qr.ts) | rotación 0/90/180/270 elegida por brújula QR y probe con presupuesto por tier |
| 4 | warp + realce | `scanner-core` vía `recortar()` | `fotoProcesada` (la que se envía) |
| 5 | OCR | [ocr-cascada.ts](src/lib/e14/ocr-cascada.ts), [ocr/tesseract.ts](src/lib/e14/ocr/tesseract.ts), [ocr-escalonado.ts](src/lib/e14/ocr-escalonado.ts), [ocr/rapidocr.ts](src/lib/e14/ocr/rapidocr.ts) | texto + líneas + confianza |
| 6 | clasificación | [clasificador.ts](src/lib/e14/clasificador.ts) + [divipol.ts](src/lib/e14/divipol.ts) + [kits.ts](src/lib/e14/kits.ts) | depto/municipio/zona/puesto/mesa contra el catálogo oficial, nivel `AUTO`/`SUGERIDA`/`MANUAL` |
| 7 | marcadores | [marcadores.ts](src/lib/e14/marcadores.ts) | ¿hay tinta en la zona de votos? (D41 — **no** lee votos) |
| 8 | completitud | [completitud.ts](src/lib/e14/completitud.ts) | secciones esperadas presentes |
| 9 | gate | `evaluarGate()` ([scanner-core-bridge.ts:2722](src/lib/e14/scanner-core-bridge.ts#L2722)) | `status`: AUTO+score≥8 → `OPTIMA`, ≥6.5 → `ADVERTENCIA`, bajo → `RECHAZADA`; SUGERIDA/MANUAL → `EN_REVISION_HUMANA` |
| 10 | envío | [puente/](src/lib/e14/puente) | `POST {hub}/actas` con cola offline-first |

Regla de oro del gate: **la decisión la toma `evaluarGate`, no el score crudo**.
El veto `INCOMPLETA` y el marcador `SIN_VOTOS` corren fuera de `evaluarGate`
pero mandan sobre él (D6, D41). Nadie fuerza un `status` a mano.

## 3. Estado y pantallas

`useE14Store` ([src/lib/e14/store.ts:454](src/lib/e14/store.ts#L454))
es la única máquina de estados: `dispararEscaneo()` invoca al bridge,
`analisisCompletado()`/`enviarActa()` mueven la vista, y `jornada.ts` persiste
la sesión (actas archivadas, contadores de motivo de no envío).

Vistas ([src/components/e14/screens/](src/components/e14/screens)):
`ScanView` (cámara/importar y disparo) → `AnalyzingView` (progreso) →
`ReviewView` (aceptar/corregir/enviar) → `ActasView` (bandeja del puesto) →
`ResumenView` (cierre de jornada). Edición manual: `QuadEditor.tsx` (recorte y
rotación) y `PanelClasificacion.tsx` (ubicación leída a mano). La cámara vive en
`hooks/useSesionCamara.ts` (sondas, caching de la cámara trasera, cascada
`facingMode`) con `useLinterna`/`useDestello`/`useAnilloBestShot` alrededor.

`dev/PanelDev.tsx` es el panel de desarrollador (no visible en producción):
flags vivas, salud del dispositivo, trazas, informe de rastreo de tiempos y
botón SIM.

## 4. Motor OCR: por qué es una cascada

Intento 1 = **Tesseract** (`spa` 4.0.0_best, PSM 4, OEM LSTM, worker propio,
presupuesto 60 000 ms) — barato en RAM y muy preciso en texto impreso.
Puerta = un gate de legibilidad sobre su salida. Intento 2 = **RapidOCR
PP-OCRv4** sobre `onnxruntime-web` (wasm), en modo escalonado: 1.ª pasada con
`DET_CAP_RAPIDO` (1280) y segunda con `DET_CAP_PROD` (1920) solo si hace falta.

Entre motores decide el gate de texto, no un umbral fijo: el candidato
compuesto se adopta solo si **añade anclas** (`rescateAporta()`). El resultado
es determinista por construcción — mismo motor en todos los dispositivos, sin
router por hardware. `public/flags.json` permite apagar la cascada
(`ocrCascada: false`) y volver al OCR único.

Multihilo: `onnxruntime-web` solo usa `numThreads > 1` si la página es
`crossOriginIsolated`. Por eso el deploy en Cloudflare Pages manda COOP/COEP
(`public/_headers`) y en local hay que servir con
`bun run scripts/serve-coop-coep.mjs`.

## 5. Paridad con `supervision-e14` (el mismo motor, dos productos)

`supervision-e14` es el supervisor MASIVO del mismo dominio (lote de actas,
bandeja, control de tiempos). Este repo es el digitalizador de UN puesto desde
el celular. Los dos comparten el motor y el negocio — y este repo **no** debe
heredar nunca el módulo masivo (cola, runner, dedup de lote): lo que se comparte
es el pipeline de UN acta y el resultado final de ese acta.

Qué es literalmente el mismo motor (verificado byte a byte; la fila del core es
de 2026-11-04, cuando el motor dejó de ser npm y se vendorizó):

| Pieza | Evidencia |
|---|---|
| Motor | `src/lib/e14/core/` en los dos repos: los módulos compartidos son byte a byte idénticos y su md5 está en `core/CONTRATO.json`. Antes era `@jg-stevan/scanner-core` `^0.4.0` en los dos `package.json` — esa garantía la reemplazó `scripts/qa-core-vendorizado.ts` |
| Tesseract | `tesseract.js` 5.1.1 y el MISMO `spa.traineddata` (md5 `130215a6…` descomprimido; los `.gz` difieren solo por nivel de compresión) |
| RapidOCR | mismas ONNX PP-OCRv4 (`70e8929d` det · `8e4817a3` rec · `c99c6bfc` cls) y `onnxruntime-web` 1.30.0 |
| Base DIVIPOL | `public/e14/divipol.json` idéntico (`8d4b0963…`) |
| Negocio | `clasificador.ts` · `completitud.ts` · `kits.ts` · `divipol.ts` idénticos tras diferencias declaradas (el hermano exporta dos símbolos para sus tests y trae `PUBLIC_BASE` de `@/shared/env`) |

Cómo se sostiene, sin ejecutar los dos motores en un mismo CI
([scripts/qa-paridad-motor.ts](scripts/qa-paridad-motor.ts)
solo funciona cuando el hermano está en el disco):

1. **El golden** — `src/lib/e14/__fixtures__/contrato-motor.json`: 21 cabeceras
   SINTÉTICAS (nada de actas reales) con la salida exacta del clasificador más
   sus derivados (`claveDeMesa`, `nombreExportacion`, título/ubicación y el flag
   de recorte) y la escalera `score → status`. Lo genera
   `bun scripts/gen-contrato-motor.ts`; `--check` dice si el golden aún refleja
   el motor.
2. **Cada repo lo valida contra su propia copia** — aquí
   [contrato-motor.test.ts](src/lib/e14/contrato-motor.test.ts)
   (vitest), allá el mismo archivo con `bun:test`. El golden es idéntico en los
   dos, así que un cambio de negocio hecho en un solo repo deja rojo el otro: la
   sincronía se paga copiar el archivo, no con una conversación.
3. **El umbral tiene que estar EN la banda de algún descriptor**. Medido: con
   los primeros 16 descriptores, subir `UMBRAL_AUTO` de 0.82 a 0.85 dejaba el
   contrato VERDE — los descriptores no rozaban el umbral. Se añadieron casos
   de puesto resuelto por nombre con conf 0.86 / **0.82 exacto** / 0.78 y un
   LUGAR a medias (sim 0.56) en las bandas de `UMBRAL_VERIFICACION_LUGAR` y
   `UMBRAL_SUGERIDA`; hoy las cuatro mutaciones de umbral ponen el contrato rojo.

Fuera del contrato, a propósito: el OCR sobre píxeles (necesita navegador +
wasm), `quad`, `score` y el `puente/` de envío (existe solo aquí). Un cambio en
esas capas se valida con los QA y las mediciones de campo, no con el golden.

## 6. Flags y adaptación por dispositivo

Cadena de precedencia: `DEFAULTS` ([src/lib/e14/flags.ts](src/lib/e14/flags.ts))
← `public/flags.json` (remoto, cacheado 24 h, offline-safe) ← overrides de
`localStorage` (kill-switch manual del mantenedor, siempre gana).

**Alta obligada al añadir un flag**: los dos filtros son INDEPENDIENTES y hay
que escribir la clave en los dos — `sanearFlags()` en
[flags.ts](src/lib/e14/flags.ts)
(recibe el JSON remoto) y `leerOverridesFlags()` en
[obs/politica.ts](src/lib/e14/obs/politica.ts)
(recibe el localStorage). Si se omite el segundo, el kill-switch del mantenedor no
manda y el flag se lee siempre por default — fallo silencioso, no ruidoso. El
tipo vive en `obs/tipos.ts` (`FlagsApp`, campos ADITIVOS AL FINAL por D57) y el
literal exhaustivo de `FLAGS_DEFAULT` está fijado en `flags.test.ts`.

`adaptacion/perfil.ts` perfila el dispositivo (SIMD, SAB, hilos, GPU, benchmark
de canvas) y `adaptacion/plan.ts` traduce el perfil a un plan: hilos de OCR por
tier (BAJO 2 · MEDIO 3 · ALTO 6), presupuestos de tiempo y knobs de rescate.
`adaptacion/informe-ia.ts` exporta ese plan como JSON legible para depurar
campo sin acceso al teléfono.

## 7. Salida de datos (única)

`puente/mapear.ts` construye la `EntradaPuente` (metadatos + fotos + clasificación)
→ `puente/cola.ts` la persiste en IndexedDB → `puente/envio.ts` hace
`POST {hub}/actas` con kill local tras `FALLOS_KILL_LOCAL` fallos seguidos →
`puente/recuperar.ts` re-sincroniza lo pendiente. `enganche.ts` conecta el
store con el puente. Nada se envía sin pasar el gate, y nada se envía a un
endpoint distinto del hub.

## 8. Observabilidad y rastreo

`obs/` buffer de eventos en IndexedDB (`buffer.ts`), transporte con reintentos
y kill local (`transporte.ts`), breadcrumbs, contadores de uso con hash `fnv1a8`
(**cero PII**: ni actas ni coordenadas), heartbeat en worker y export de
reportes. Su contrato de superficie pública lo verifica
`scripts/qa-obs-contract.ts` con regex sobre el fuente: por eso varios exports de
`obs/` parecen "unused" para `knip` y no lo son.

`rastreo/` es el cronómetro del flujo real (motor pasivo del store) que produce
el informe de tiempos por vista; se opera desde `dev/SeccionRastreo.tsx`.

## 9. Pruebas y QA

- Unitarios: `src/**/*.test.ts` con vitest (`bun run test` — 17 archivos, 267
  tests). Anclas de contrato de comportamiento (p. ej. `ocr-cascada.test.ts` lee
  el fuente para exigir que ciertas constantes no cambien de valor).
- **Contrato de paridad con el hermano**: `contrato-motor.test.ts` valida el
  golden de §5; se regenera con `bun scripts/gen-contrato-motor.ts` (y
  `--check` dice si el golden sigue reflejando el motor).
- QA de contrato: `scripts/qa-*.ts` (obs, privacidad, transporte, UI, autoenvío,
  paridad-motor). `qa-paridad-motor.ts` sale «omitido» sin el checkout de
  `supervision-e14` al lado; con `E14_HERMANO=/ruta` se le señala otra ubicación.
- Smoke de workers: `scripts/smoke-*.mjs`.
- Gate local: `scripts/check-quality.sh` (lo mismo que corre CI).
- Superficie muerta: `bunx knip`.

## 10. Por dónde entra un cambio

| quiero… | miro primero |
|---|---|
| cambiar qué se considera acta válida | `evaluarGate` + `statusDeScore` + D6/D41 |
| velocidad de OCR | §4, `adaptacion/plan.ts`, `docs/REPORTE-e14-gama-baja-20s-v1.md` |
| que acepte otra imagen/foto rar | `hooks/useSelectorFuente.ts` + F-HEIC del core |
| identificar mejor la cabecera | `clasificador.ts` + `kits.ts` + `docs/research/PATRON-identificacion-actas-e14.md` + el contrato de §5 (regenerar y propagar el golden) |
| tocar envío/hub | `puente/*` + `docs/ENDPOINT-REPORTES.md` |
| medir en dispositivo real | `rastreo/*` + PanelDev §9 |

Antes de decidir cualquier umbral, busca la `D<n>` en `docs/DECISIONS.md`: casi
todos los números de este repo tienen una decisión que explica por qué valen lo
que valen.
