# Medición de rendimiento — Digitalizador E-14

**Sesión:** 2026-11-05 · **Dispositivo:** `adb-R5GYB558JPE-8VZrKc` (Android 10, 8 núcleos, 8 GB RAM)
**Hub:** `https://192.168.1.8:8443/` · **Muestra:** 17 actas, 214 long tasks, 6 sesiones

---

## 1. Tiempos del pipeline (17 actas reales)

| Etapa | min | p50 | p90 | max | media |
|---|---:|---:|---:|---:|---:|
| `procesoMs` | 757 | 2.256 | 2.969 | 3.211 | 2.287 |
| `calidadMs` | 53 | 153 | 176 | 185 | 130 |
| `ocrMs` | 3.192 | 5.732 | 9.265 | 10.434 | 6.299 |
| `totalMs` | 7.584 | 9.843 | 20.734 | **42.286** | 13.046 |

El OCR es el **48 %** del tiempo en la mediana, y hasta el **69 %** en el p90. `calidadMs` es irrelevante (1 %).

---

## 2. El HEIC de 50 MP — diagnóstico definitivo

**No es lentitud: es un fallo con timeout.** El evento de observabilidad lo registra textualmente:

```
[e14] rescate HEIC topado
{"mensaje":"El decodificador HEIC no terminó en 45 s: tómate la foto en JPEG."}
```

**Cronología real del acta `d440276f`:**

| t (ms) | Evento |
|---:|---|
| 0 | Usuario pulsa "Importar imagen" |
| 53 | Long task 94 ms |
| 1.290 | Long task **1.362 ms** (decode inicial) |
| 2.871 | Long task 598 ms |
| 20.228 | Long task 727 ms |
| **50.000** | ← **timeout HEIC (45 s)** |
| 50.437 | `perf` registrado: `totalMs: 42.286` |

El pipeline **terminó igual** (42 s) pero el HEIC **nunca se convirtió**. El tiempo se perdió completo.

### Por qué el tope de 24 MP no se aplicó

En `core/image-processor.ts:239`:

```ts
export const HEIC_TOPE_MP_DEFECTO = 24;
export const HEIC_LIMITE_MS_DEFECTO = 45_000;
```

El comentario del propio código lo explica (`image-processor.ts:231-237`):

> `HEIC_TOPE_MP_DEFECTO` — arriba de este tamaño el rescate NIQUE se despacha.
> 24 MP deja pasar holgado el sensor de 12 MP (4032×3024) y corta el modo
> 50 MP de los Xiaomi/Realme que activan HEIF.
> `HEIC_LIMITE_MS_DEFECTO` — techo PROPIO de la conversión. **Vale para los
> archivos cuyas dimensiones no se pudieron leer** (olfateo devuelve null).

**El tope de 24 MP solo actúa si `dimensionesHeic()` logra leer el `ispe` del contenedor ISO-BMFF.** Si el olfateo devuelve `null` (caja que no cierra, HEIC multi-imagen, sub-ítems raros), la única protección que queda es el reloj de 45 s — que es exactamente lo que pasó.

**Resultado:** 45 s perdidos, acta procesada con una imagen que no era la que el operario eligió.

### Acciones

| Acción | Efecto |
|---|---|
| **Decodificar HEIC fuera del hilo principal** (`createImageBitmap` en Worker) | El operario ve progreso real en vez de un visor congelado 45 s |
| **Bajar `HEIC_LIMITE_MS_DEFECTO` a ~15 s** | Falla rápido y honesto; 45 s es demasiado para un operario en campo |
| **Avisar ANTES de procesar** cuando el MIME es HEIC y no se pudieron leer dimensiones | El operario decide si espera o cambia a JPEG |
| **Mostrar el peso del archivo en el mensaje de error** | Hoy el mensaje culpa al formato; el problema es el tamaño |

---

## 3. Scores bajos y bloqueo del autoenvío

**11 de 17 actas (65 %) quedan en ADVERTENCIA.** El autoenvío **exige `OPTIMA`** (`store.ts:905`, `1083`, `1215`; `rastreo/motor.ts:330`: `autoEnvio = !huboRevision`).

### El techo de 7.9 se aplica en OH pese a una lectura FUERTE

Datos reales de los techos aplicados:

```
acta d440276f → techos: ["piso-lectura-FUERTE:8.5", "recortada:7.9"]
                scoreVisual 6.9 → scoreFinal 7.9
```

La secuencia en `scanner-core-bridge.ts:2468-2491`:

```ts
// 1. La lectura FUERTE SUBE el score a 8.5
if (senal.nivel === "FUERTE" && calidad.level !== "poor") {
  score = Math.max(score, PISO_LECTURA_FUERTE);   // → 8.5
}
// 2. Pero si el acta está RECORTADA, baja a 7.9
if (recortada) {
  score = Math.min(score, TECHO_ESCUDO_FONDO);    // → 7.9  ADVERTENCIA
}
```

`8.5` sería **OPTIMA** (el umbral de OPTIMA es `≥8`). **El techo de `recortada` lo tumba a 7.9 y mata el autoenvío.**

### El problema de fondo

`scoreVisual` de las 11 ADVERTENCIA varía entre **6,9 y 8,4** — pero **todas aterrizan exactamente en 7.9**. Eso no es una medición de calidad: es todo lo que atraviesa el techo. La información real de calidad **se pierde**.

Un acta con `scoreVisual` 8,4 y lectura FUERTE está tan buena como una `OPTIMA`, pero no se autoenvía.

### Acciones propuestas (en orden de riesgo)

| # | Cambio | Efecto | Riesgo |
|---|---|---|---|
| **A** | Persistir `scoreVisual` separado del `scoreFinal` y mostrarlo en REVISIÓN | El operario ve «calidad de foto 8,4 · recortada» en vez de un 7,9 opaco | **Nulo** — solo presentación |
| **B** | Flag `autoEnvioConRecorte` (default OFF) → con lectura FUERTE + recortada, permitir OPTIMA | Recupera el autoenvío en ~65 % de actas | Medio — decisión de negocio |
| **C** | Revisar si el escudo `recortada` sigue siendo necesario cuando `quadOrigen` es fiable | Elimina el techo de raíz | Alto — toca la regla D10 |

**Recomiendo A ya (cero riesgo) y B como flag para que tú decidas.**

---

## 4. Detección en vivo: no existe

**Hallazgo:** no hay detección de quad en vivo. El quad se detecta **dentro del pipeline**, después de la captura (`scanner-core-bridge.ts` — `detectarQuad` se invoca en `pipelineFoto`/`pipelineRecorte`).

Lo único que corre en vivo a **5 Hz** es el anillo ZSL (`useAnilloBestShot.ts:37`: `RING_FEED_MS = 200`).

**Consecuencia:** el operario apunta sin ninguna guía visual de si el acta está bien encuadrada. Se entera cuando termina el pipeline, 8–15 s después — y solo entonces puede reintentar.

Esto **explica parcialmente los scores bajos**: sin feedback en vivo, el operario no sabe si la foto servirá hasta que es tarde.

---

## 5. Captura → pantalla de espera

**18 bloqueos durante la captura, 10.093 ms acumulados, máximo 2.245 ms.**

| Long task | Origen |
|---:|---|
| 2.245 ms | `click:Importar imagen` |
| 1.362 ms | `click:Importar imagen` |
| 832 ms | `click:Importar imagen` |
| 615 ms | `click:Importar imagen` |
| 598 ms | `click:Importar imagen` |
| 512 ms | `click:Encender la linterna` |

Todos en `useDestello.ts:191-225` (`archivoDentroDeTope`): FileReader → `loadImage` → `downscaleImage` → `fetch` + `.blob()`, **todo síncrono en el hilo principal antes de navegar a ANALIZANDO**.

El operario pulsa "Importar" y el visor **se congela hasta 2,2 s sin ningún feedback**.

---

## 6. Gestión de recursos

| Recurso | Uso | Valoración |
|---|---|---|
| **Heap JS** | 30,5 MB de 1.878 MB (1,6 %) | ✅ Excelente |
| **PSS de Chrome** | 215 MB | ✅ Razonable |
| **RAM libre** | 3.059 MB de 7.595 MB (40 %) | ✅ Holgada |
| **CPU durante pipeline** | 138 % user + 141 % sys de **800 %** | ⚠️ **Solo 2,8 de 8 núcleos** |
| **Workers JS creados** | **0** | ⚠️ Ver abajo |
| **Almacenamiento** | 15,4 MB de 10.255 MB (0,15 %) | ✅ Irrelevante |

### La CPU es el hallazgo grave

Con `hardwareConcurrency = 8`, `deviceMemory = 8 GB`, `crossOriginIsolated = true` y `SharedArrayBuffer` disponible, el dispositivo es **tier ALTO**. El plan (`plan.ts:37`) asigna `ALTO: 6` hilos de OCR.

Pero el consumo real es **2,8 núcleos de 8**. Hay **5 núcleos ociosos**.

Causa probable: `ort.env.wasm.proxy = true` (`rapidocr.ts:158`) mueve ONNX a un worker proxy, y si `numThreadsOcrEfectivos()` no devuelve >1 en la práctica, el worker proxy corre **mono-hilo**. También explica `workerCount: 0`: el worker lo crea ONNX Runtime internamente, no `new Worker` de la app, así que mi interceptor no lo ve — pero el efecto en CPU es medible y coherente con 1 hilo activo + trabajo de UI.

**Acción:** verificar en runtime el valor efectivo de `ort.env.wasm.numThreads` y `ort.env.wasm.proxy`. Si `numThreads === 1`, ahí está el 2–3× de mejora disponible.

---

## 7. Capacidades del dispositivo NO aprovechadas

| Capacidad | Disponible | En uso |
|---|---|---|
| `SharedArrayBuffer` + `Atomics` | ✅ | ⚠️ Declarado, efecto dudoso |
| `OffscreenCanvas` | ✅ | ❌ **No se usa** para decode/downscale |
| `createImageBitmap` | ✅ | ❌ **No se usa** para importar |
| `crossOriginIsolated` | ✅ `true` | ✅ Sí |
| 8 núcleos | ✅ | ❌ Solo 2,8 usados |
| WebCodecs (`VideoDecoder`) | ❓ | ❌ No investigado — podría decodificar HEIC vía `<img>` nativo |
| Service Worker | ❌ (`null`) | — |

---

## 8. Plan de mejora priorizado

| # | Acción | Ahorro | Riesgo | Archivo |
|---|---|---|---|---|
| **1** | Verificar y forzar `numThreads` real en ONNX | **2–3× en OCR** | Bajo | `rapidocr.ts:146` |
| **2** | `createImageBitmap` + Worker en importar | **−10 s en HEIC**, −2,2 s en JPEG | Bajo | `useDestello.ts:191` |
| **3** | Bajar timeout HEIC 45 s → 15 s + aviso previo | Falla honesta | Muy bajo | `image-processor.ts:240` |
| **4** | Exponer `scoreVisual` en REVISIÓN | 0 s, recupera control | Nulo | `ReviewView.tsx` |
| **5** | Flag `autoEnvioConRecorte` | Recupera 65 % autoenvío | Medio (decisión tuya) | `flags.ts` |
| **6** | Persistir `decodeMs`/`detectMs` | Habilita medir | Muy bajo | `scanner-core-bridge.ts:1977` |
| **7** | Detección de quad en vivo | Menos reintentos | Alto (feature nueva) | — |

**Las 1–4 y 6 no cambian el resultado de ninguna acta.** La 5 es la que necesitas aprobar.

---

## 9. Cierre de la tarde (2026-11-05) — lo que quedó medido y lo que no

Métrica honesta: **`change → REVISIÓN`** tomado de `transiciones` del JSON de cada corrida. El `reloj` bruto
infla 1,0–1,3 s de transporte CDP y `importar → revisión` incluye 0,3–2,8 s de React antes del pipeline.
Corpus: las 6 JPG reales de `imagenes procesadas/` + 4 recortes sintéticos (`corte-pie/lado/A/B`) para el
camino de rechazo. Hasta la serie E1 el overlay `{"ocrRecAltura":40,"ocrRecCabecera":14,"ocrRecPie":14,
"ocrRecBordesRescate":7}` vivía en `localStorage` del celular; **con la serie F1 ya es default en `flags.ts`
y esa corrida se midió con el almacenamiento limpio** (cero overrides).

### Series de referencia (mesiana sobre las 6 actas)

| serie | configuración | mediana `chg→rev` | `ocr` | `rec` | brújula | desenlaces |
|---|---|---:|---:|---:|---:|---|
| A1 | brújula 3 pases (default de la mañana) | 8 849 | 4 742 | 3 902 | 828 | 10/8.5/10/8.9/10/8.6 · **6/6 ENVIADA** |
| A2 | repetición de A1 | 8 730 | 4 731 | 3 958 | 773 | idéntico |
| B1 | bundle + racimo de banderas | 8 517 | 4 467 | 3 641 | 528 | idéntico |
| D1 | `qrBrujulaWarpPases:0` aislado (atribución) | 8 517 | 4 702 | 3 886 | 518 | idéntico |
| **E1** | **default nuevo en el bundle** | **8 895** | 4 675 | 3 883 | **549** | idéntico, **6/6 ENVIADA** |
| **F1** | **defaults puros, cero overrides en el celu** | **8 394** | 4 513 | 3 728 | 550 | idéntico, **6/6 ENVIADA** |

A/B/A: la brújula baja 280 ms en las 6 actas y el `paso`/`score`/`anclas`/`chars` no se mueven en ninguna
serie ⇒ `qrBrujulaWarpPases:0` es default. La mediana total no baja proporcionalmente (8 517 → 8 895): el
ruido térmico del A56 es real — misma config varió el `rec` 1 899↔3 203 en sesiones distintas.

### Los dos fixes de fondo

1. **Perdón del veto 4/4 fiduciales** (`integridad.ts` + `perdonFaltaFiduciales`). El acta 084854 — la que
   fallaba el autoenvío por tener una esquina fuera del cuadro — hoy cierra 10 ÓPTIMA y se sola. Validado
   en las 6 (tabla arriba) y en espejo en `supervision-e14` (450/450, paridad 16/16).
2. **Rechazo temprano** (bandera `ocrCorteIncompleta`, default ON). La verificación de completitud se
   cosecha **antes** del OCR; si ya dijo `completa:false` el desenlace está bloqueado, así que el presupuesto
   del OCR se declara vencido: nada de re-OCR 1920, nada de ROI, nada de Tesseract y nada de rescate por
   bordes (`sinRescateBordes` en el motor). Se sigue cobrando **una** pasada porque el texto alimenta el
   informe y el panel de corrección.

   | corrida | acta recortada por un lado (86 % del ancho) | `chg→rev` | `ocr` | `paso` | veredicto |
   |---|---|---:|---:|---|---|
   | `noc-lado` | sin el corte | 24 056 | 11 625 | `roi` | 4.9 RECHAZADA |
   | `sic-lado` | con el corte | 17 231 | 4 532 | `1280` | 4.9 RECHAZADA |
   | `E1-lado` | con el corte, bundle final | 16 991 | 4 637 | `1280` | 4.9 RECHAZADA |
   | `F1-lado` | con el corte, **cero overrides** | **16 398** | 4 536 | `1280` | 4.9 RECHAZADA |

### El piso y por qué los 5 s no salen con el motor en el celular

Cuenta de la mediana E1: `rec` 3,9 + `det` 0,7 + doble warp 1,6–1,9 + brújula 0,5 + decode 0,5–1,0 + app y
cierre 0,8 ≈ **8,5–8,9 s**. El `rec` cuesta ~135–160 ms por línea y estas actas tienen 35–43 líneas: es el
78 % del tiempo y la CPU ya está saturada (7,7 de 8 núcleos durante el rec), así que no queda hilo que rascar.

Bajar de 5 exige **una de estas dos**, y ninguna es una bandera:

- **Dejar de leer la hoja entera** (bandas: cabecera + tabla de votos + pie, no las 40 líneas) — cambia el
  contrato de extracción y hay que revalidar el gate línea por línea.
- **Sacar el OCR del wasm** (sidecar en la LAN o runtime nativo) — descartado por el mantenedor en la decisión
  del 2026-11-05.

Palancas medidas y cerradas: hilos, sesiones hermanas, WebGPU, forma fija del tensor, `ocrRecWmax` 384/320,
`ocrLeerBw`, altura 24/32, pases de brújula, `ladoMaxTrabajoPx:1536` (ahorra 0,75 s de warp pero rompe el
gate porque fiduciales y secciones se miden sobre esa misma imagen).

Costo conocido que queda en el camino de rechazo: `probeOrientacion` 6,7–14,2 s cuando el QR no se lee
(`E1-lado`: 9 824 ms de los 16 991). No se corta: la brújula QR ya dio la señal en las 6 actas reales
(278–953 ms) y el sondeo es la red de seguridad para fotos sin QR legible; posponer el guard por debajo del
sondeo exigiría una regla nueva rotation-invariante en `completitud.ts` (dos repos + CONTRATO) y solo
beneficia a actas ya condenadas.
