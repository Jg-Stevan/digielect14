# AUDIT.md — Fase 1: Diagnóstico (`audit/quality-pass-1`)

> **Alcance**: solo diagnóstico. NO se modificó ninguna línea de código de negocio.
> Único cambio de dependencias: `knip` añadido como devDependency (autorizado en el prompt).
> **Regla aplicada**: nada se arregló en esta fase; las dudas se anotan como *sospecha*.

---

## 1. Resultado de los comandos de verificación (estado inicial)

| Comando | Resultado | Notas |
|---|---|---|
| `bunx tsc --noEmit` | ✅ **0 errores** (exit 0) | Verificado sin pipes (salida vacía, exit real = 0). `strict: true` activo. |
| `bun run lint` | ✅ **0 errores / 0 warnings** (exit 0) | ⚠️ Verde *engrososo*: casi todas las reglas están `off` (ver A-1). |
| `bunx knip` | ✅ ejecutado con **knip@5.44.1** | knip ≥5.45 usa `oxc-parser` y crashea con `RangeError: Array buffer allocation failed` en este entorno → se fijó `5.44.1` (parser TypeScript clásico). Resultado: 17 archivos, 63 exports, 40 tipos exportados y 1 devDependency sin uso (detalle abajo). |
| `bun run build` | ✅ **exit 0** | Next.js 16.4.2 (Turbopack), compilación 10.8 s, 2 rutas estáticas (`/`, `/_not-found`). ⚠️ Log muestra `Skipping validation of types` por `ignoreBuildErrors: true` (ver A-2). |
| `bunx madge --circular` (extra) | ⚠️ **5 ciclos de imports** | Detalle en M-1/M-2/B-4. |

---

## 2. Tabla de hallazgos

| Severidad | Categoría | Archivo:Línea | Problema | Impacto | Fix sugerido | Riesgo de arreglarlo |
|-----------|-----------|---------------|----------|---------|--------------|----------------------|
| **ALTO** 🟡 PARCIAL — tanda 1 ✅ (2026-10-22, commits `d9ab74c` `c0b9ba5` `6a9bb7e` `ae3326b` `cc175c1`) | Calidad de proceso (lint) | `eslint.config.mjs:15-49` | Reglas críticas desactivadas en bloque: `no-explicit-any`, `no-unused-vars`, `no-non-null-assertion`, `ban-ts-comment`, `react-hooks/exhaustive-deps`, `react-hooks/purity`, `no-console`, `no-debugger`, `no-empty`, `no-unreachable`, `prefer-const`, etc. | El lint "verde" no protege nada: bugs de hooks, vars muertas, `debugger`, bloques vacíos y código inalcanzable pasan invisibles. Es la causa raíz de varios hallazgos de esta tabla. | Reactivar en tandas: (1) `no-debugger`, `no-empty`, `no-unreachable`, `prefer-const`, `no-unused-vars`; (2) `exhaustive-deps: "warn"`; (3) evaluar resto. Limpiar lo que salga en commits separados. → **TANDA 1 RESUELTA** (las 5 reglas activadas, una por commit; `no-debugger`/`no-empty`/`no-unreachable`/`prefer-const` con 0 problemas; `no-unused-vars` activada como warn con 11 warnings → pendiente tanda 2, ver §2.1). **Tanda 2 APLICADA** (Fase 3A.1, 2026-10-23): 5 muertas eliminadas (`2c011a2`) · 3 `ultimoOcr*` silenciados con marcador ejecutable `TODO(fase-4)` (`4bd897e`) · `recienListas`/`modoMenuMontado`/`posCola` quedan VISIBLES a propósito como sospechas documentadas (§2.2) · `exhaustive-deps` activa **scoped a ScanView.tsx** (`acb839b` — directivas justificadas en uso; activación global pendiente Fase 4). | **Bajo-Medio**: cada tanda puede revelar casos a justificar; se hace gradual y sin tocar lógica. |
| **ALTO** ✅ RESUELTO (2026-10-22, commit `650e6a2`) | Config Next.js | `next.config.ts` | `typescript.ignoreBuildErrors: true` — el build de producción **no valida tipos** (log: "Skipping validation of types"). | Hoy `tsc` pasa limpio, así que es gratuito quitarlo; el día que alguien introduzca un error de tipos, el build lo tragará y llegará a producción. | Poner `ignoreBuildErrors: false` (o eliminar el bloque). | **Bajo**: `tsc --noEmit` ya pasa con 0 errores; el build seguirá verde. Verificar con un build tras el cambio. → **RESUELTO**: bloque eliminado; build en exit 0 SIN el log "Skipping validation of types" (tsc 0 · lint 0 · build 0). |
| **ALTO** ✅ RESUELTO (2026-10-23, commits `e3d4d86` + `acb839b`) | Hooks / useEffect | `src/components/e14/screens/ScanView.tsx:1615, 1638, 1690` (deps arrays hoy: 1615/1639/1692) | 3 `useEffect` con dependencias faltantes detectados al re-activar `react-hooks/exhaustive-deps` vía CLI (sin editar archivos): (a) efecto de arranque de cámara usa `aplicarLinternaGuardada`, `setFramePendiente`; (b) efecto "playing" usa `aplicarLinternaGuardada`; (c) frame-loop usa `alimentarAnillo`, `liberarAnillo`, `mostrarAviso`. | **Hoy probablemente benigno**: las 4 funciones son `useCallback` (703, 831, 883, 907) y el loop usa deliberadamente refs (`capturarRef.current`, `autoRef`) para evitar staleness. El riesgo es *latente*: si mañana alguien añade una dependencia reactiva a esos `useCallback`, el efecto capturará la versión vieja sin advertencia (la regla está `off`). | Verificar que los 4 `useCallback` tienen deps estables (`[]` o solo refs); añadir las funciones a los arrays de deps o justificar con comentario `// eslint-disable-next-line react-hooks/exhaustive-deps — estable por useCallback([])`. | **Bajo**: los arrays de deps del efecto principal son `[fuente, reintentoCamara]` y `[camaraViva]`; añadir funciones estables no re-dispara el efecto. Probar escaneo en cámara tras el cambio. → **RESUELTO**: estabilidad verificada línea a línea — las 8 funciones implicadas son estables (`setFramePendiente` acción Zustand; `mostrarAviso`/`ponerLinterna`/`profileActiveSensor`/`liberarAnillo` `useCallback []`; `aplicarLinternaGuardada` `[ponerLinterna]`; `alimentarAnillo` `[empujarAnillo]` ← `[]`). 3 directivas `eslint-disable-next-line` con justificación puestas (e3d4d86) y regla activada scoped a ScanView para que estén en uso (acb839b). `eslint --rule exhaustive-deps:warn` en ScanView → 0 warnings. Prueba de escaneo en cámara en runtime: pendiente del dueño (Fase 4). |
| MEDIO | Arquitectura / imports | `src/lib/e14/masiva/store.ts:41` ↔ `src/lib/e14/masiva/precalor.ts:41` | **Ciclo estático real**: `masiva/store` importa `cablearPrecalor` de `./precalor` y `precalor` importa `useMasivaStore` de `./store` (ambos `import` estáticos, valores). Madge además reporta variantes: `runner → precalor → store` y `store(main) → runner → precalor → store`. | Funciona hoy, pero es frágil: el orden de evaluación de módulos decide si un binding está disponible en init (riesgo TDZ). Cualquier reordenación de imports puede romper el arranque sin error claro. | Romper el ciclo con inyección de dependencias (p. ej. `cablearPrecalor(setters)` ya lo es a medias) o un módulo neutro de tipos/eventos. **Requiere diseño previo y tu aprobación (regla 1).** | **Medio-Alto**: es refactor arquitectónico; tocarlo sin diseño puede cambiar el orden de init de los stores. |
| MEDIO (sospecha — regla 6) | Arquitectura / imports | `src/lib/e14/store.ts:759, 1304` ↔ `src/lib/e14/masiva/runner.ts:28,41` | Ciclo `store(main) → masiva/runner` con back-edge. **Mitigación ya presente**: el back-edge es *dynamic import* (`void import("./masiva/runner")`), por lo que no hay riesgo TDZ en init. | Riesgo bajo hoy (import perezoso), pero el grafo enredado dificulta razonar dependencias y facilita que futuros edits metan un import estático accidental. | Mantener el dynamic import como regla documentada (comentario), o extraer una interfaz que `runner` consuma sin importar `store`. Baja prioridad. | **Bajo** si se documenta; **Medio** si se refactoriza. |
| MEDIO | Código muerto | 63 exports sin uso — p. ej. `src/lib/e14/clasificador.ts:83-238` (5 funcs: `normalizarNombre`, `normalizarNombreLugar`, `normalizarCodigo`, `similitud`, `tipoDeDigito`, `candidatosCodigo1D`), `src/lib/e14/masiva/identidad-qr.ts` (~20 símbolos: `decodificarQrDePixeles`, `barridoQrZxingDePixeles`, constantes `QR_*`/`ZXING_*`), `src/lib/e14/informe.ts:259-605` (6 funcs), `src/lib/e14/scanner-core-bridge.ts:163,995`, `src/lib/e14/store.ts:82` (`SCORE_SIMULADO`), `src/lib/e14/marco-escaneo.ts:118`, `src/lib/e14/masiva/{cola,dedup,deskew,historico,origen,precalor}.ts` (1-4 c/u). Lista completa reproducible con `bunx knip`. | Bundle y superficie de mantenimiento mayores de lo necesario; funciones "por si acaso" que nadie llama confunden al siguiente desarrollador y a las herramientas. | Borrar export no usados en commits pequeños **por módulo** (un módulo = un commit), empezando por los triviales (`icons.tsx`, tipos exportados). Antes de borrar en `lib/e14`: confirmar que no son API pública para QA/scripts de `scripts/` (knip no sigue entry-points dinámicos — ver M-3). | **Bajo** por módulo con `tsc` + build tras cada commit. **Medio** si se hace todo de golpe (prohibido por regla 4). |
| MEDIO | Código muerto (tipos) | 40 tipos exportados sin uso — p. ej. `src/lib/e14/types.ts:29,36,277-278` (`ActaUbicacion`, `ActaCandidato`, `MesaEstado`, `PaginaEstado`), `src/lib/e14/informe.ts:46-221` (6 interfaces), `src/lib/e14/divipol.ts:21-49` (4), `src/lib/e14/masiva/archivos.ts:55-245` (4), `src/lib/e14/masiva/store.ts:95,342`, `src/lib/e14/orientacion.ts:63-84` (2 tipos + 3 consts), etc. | Igual que anterior pero para tipos: ruido de API, parsers/docs desalineados. | Mismas tandas por módulo que los exports de valor. | **Bajo**. |
| MEDIO ✅ RESUELTO (2026-10-22, commit `c93e2f6`) | Proceso / tooling | `knip.json` (raíz del repo) | Los 17 archivos que knip marca sin uso son en su mayoría **intencionales** (falsos positivos): `public/sw.js` (registrado por URL string en `PwaRegister.tsx`), `public/vendor/*` y `public/scanner/detection-worker.js` (assets copiados del core, cargados por URL), `scripts/qa-*.ts` (8 harnesses QA que corren con `bun` directo), `tools/*` (bench/serve). Sin config, knip raporta ruido en cada corrida y **entiera la señal real** (los exports muertos de arriba). | Cualquier auditoría futura repite este análisis a mano o desconfía de knip. | Crear `knip.json` con `entry: ["src/app/**/*.tsx", "scripts/qa-*.ts", "tools/**/*.js", ...]` e `ignore` para assets vendor/`sw.js`. Así el reporte queda limpio y solo señala código verdaderamente muerto. → **RESUELTO**: knip.json creado (entry: app + scripts/qa-* + tools/**; ignore: sw.js + vendor + scanner; ignoreDependencies: tailwindcss). ANTES: 121 ítems · DESPUÉS: 72 reales (16 archivos falsos + 29 exports falsos + 3 tipos falsos + 1 devDep eliminados del reporte). |
| MEDIO | Observabilidad / producción | `src/lib/e14/masiva/runner.ts` (22 `console.info`, líneas 470-732), `src/lib/e14/ocr/rapidocr.ts` (5), `masiva/store.ts` (4), `scanner-core-bridge.ts` (3), `identidad-qr.ts` (3), `store.ts` (2), `orientacion.ts` (2), `precalor.ts` (1), `divipol.ts` (1) — **43 en total** | `console.info/warn` con datos de negocio en producción: IDs de fila, payload QR (`[e14] capa0-qr original ${payloadQrCorto}`), nombres de archivo, presupuesto ms. | App 100 % client/offline → no hay fuga de red; el impacto real es ruido en devtools, leve fuga de info si el usuario comparte capturas de consola y coste de string-building. | Decidir política de logging: gate por `process.env.NODE_ENV !== "production"` o nivel `debug` con flag. **No es urgente.** | **Bajo**: envolver con helper; riesgo de perder trazas útiles para QA — mantener en dev. |
| BAJO | Config Next.js | `next.config.ts:43` | `reactStrictMode: false`. | En dev no se doble-montan efectos → bugs de cleanup (listeners, streams de cámara) pasan desapercibos. Probablemente **deliberado** (cámara/worker/ONNX no toleran doble init) → *sospecha, no bug*. | Si se quiere activar: probar en rama con el flujo completo de escaneo + masiva y ver si algún efecto no es idempotente. | **Medio**: puede revelar efectos con side-effects no idempotentes (cámara, IDB). |
| BAJO ✅ MITIGADO (2026-10-22, commit `c93e2f6`) | Dependencias | `package.json:35` (`tailwindcss` devDep) | knip la reporta como devDependency sin uso directo. | Probablemente **necesaria**: `@tailwindcss/postcss` resuelve `@import "tailwindcss"` de `globals.css` a través del paquete; quitarla puede romper el build de CSS o fijar versión ambigua vía hoisting. | NO borrar sin verificar. Si se quiere limpiar: probar build con `BUILD_STATIC=1` y dev tras remover; si falla, restaurar. Alternativa: `knip.json` → `"ignoreDependencies": ["tailwindcss"]`. → **MITIGADO**: aplicada la vía alternativa — `ignoreDependencies: ["tailwindcss"]` en knip.json; la devDep permanece (correcto). |
| BAJO ✅ RESUELTO (2026-10-22, commit `eef1cc8`) | Documentación / deps | `README.md` | El prompt del proyecto lista `tesseract.js` como librería crítica, pero **no está en package.json** (solo aparece en comentarios históricos de `clasificador.ts:869` y `scanner-core-bridge.ts:709`). El OCR real vive en `onnxruntime-web` (RapidOCR) + `zxing-wasm`. | Confusión en onboarding/auditorías (como esta): se busca una dependencia que no existe. | Actualizar el stack descrito en `AGENTS.md`/README/prompt maestro para reflejar el stack real. → **RESUELTO**: README ganó sección «Stack OCR / decodificación (producción)» (RapidOCR PP-OCRv4 + onnxruntime-web vendidos, zxing-wasm + jsQR capa 0, nota explícita de que tesseract.js NO es dependencia) y versión del motor corregida ^0.1.0 → ^0.4.0. AGENTS.md ya describía RapidOCR como motor único (sin cambios). Menciones restantes de Tesseract: solo docs históricos (worklog/kits) — NO reescritos por ser registros de decisión. |
| BAJO | Arquitectura / imports | `src/lib/e14/store.ts:38` ↔ `src/lib/e14/jornada.ts:29` | Ciclo `store ↔ jornada`, pero el back-edge es `import type` (se borra en compile-time) → **sin riesgo runtime**. | Solo ruido de grafo para herramientas (madge lo cuenta). | Nada urgente; si se toca `jornada.ts`, mover los tipos a un módulo compartido. | **Cero-Bajo**. |

---

### 2.1 Tanda 2 — `@typescript-eslint/no-unused-vars` (11 → 3 deliberados, Fase 3A.1)

Aplicada 2026-10-23 con la revisión del dueño: bucket A eliminado (`2c011a2`;
1 de las 5 — `archivoPipeline` — RESTAURADA en `3da7b21` al descubrir que era
ancla del QA e63m, ver fila 7), bucket C silenciado con marcador ejecutable
(`4bd897e`), bucket B y `posCola` quedan VISIBLES a propósito — son el
recordatorio vivo de §2.2, no ruido.

| # | Archivo:Línea | Símbolo sin usar | Desenlace |
|---|---|---|---|
| 1 | `eslint.config.mjs:7` | `__dirname` | ✅ ELIMINADO (bucket A — junto a `__filename` e imports huérfanos) |
| 2 | `scripts/qa-qr-identidad.ts:83` | `espera` | ✅ ELIMINADO (bucket A) |
| 3 | `src/components/e14/screens/MasivaView.tsx:320` | `recienListas` | 🟡 VISIBLE — veredicto B1 **(b)**: regresión de reconstrucción (§2.2-B1) |
| 4 | `src/components/e14/screens/MasivaView.tsx:633` | `posCola` | 🟡 VISIBLE — Escenario B D65 (§2.2-B2) |
| 5 | `src/components/e14/screens/ScanView.tsx:100` | `StitchFrameIcon` (import) | ✅ ELIMINADO (bucket A) |
| 6 | `src/components/e14/screens/ScanView.tsx:719` | `modoMenuMontado` | 🟡 VISIBLE — veredicto B1 **(c)**: wiring de skin anterior, candidato a eliminación (§2.2-B1; hoy en L718 tras quitar el import) |
| 7 | `src/lib/e14/masiva/runner.ts:573` | `archivoPipeline` | 🔄 RESTAURADO (`3da7b21`) — NO era muerto: **ancla del QA e63m** (`qa-qr-identidad.ts:353` grepea la línea exacta para «bloque capa 0 ANCLA»; QA dio 1 FAIL sin ella). Hoy con directiva documentando el consumidor |
| 8 | `src/lib/e14/ocr/rapidocr.ts:844` | `t0` | ✅ ELIMINADO (bucket A) |
| 9-11 | `src/lib/e14/scanner-core-bridge.ts:723-725` | `ultimoOcrConf/Det/Rec` | 🔇 SILENCIADO con `TODO(fase-4)` (bucket C — traza §4.2 PROD-2; directivas hoy en L723/725/727) |

> Lint final: **3 warnings deliberados** (`recienListas`, `posCola`, `modoMenuMontado`).
> Pendientes ejecutables: `rg "TODO\(fase-4\)" src/`.

### 2.2 Sospechas confirmadas para Fase 4 (nuevas — Fase 3A.1)

| # | Severidad | Dónde | Sospecha | Plan Fase 4 |
|---|---|---|---|---|
| B1 | ✅ **RESUELTO runtime** (2026-10-23, verificación browser sin tocar código) | `MasivaView.tsx:320` (`recienListas`) · `ScanView.tsx:718` (`modoMenuMontado`) | **Veredictos (taxonomía a/b/c del dueño):** (1) `modoMenuMontado` → **(c)** — el menú de modo descrito en los comentarios NO existe en la skin actual: en runtime `role=dialog/menu` = 0 y 0 elementos con `scale-0.97` en todo el DOM; el «selector de modo» es un segmented **siempre visible** (CÁMARA/SIM/SUBIR) y NADA llama `setModoMenuAbierto(true)` (grep); pickaxe: el consumidor JSX **nunca existió** en esta línea (`4f9c871` lo introdujo ya huérfano). Par de estados + efecto Escape = cableado de una skin anterior. (2) `recienListas` → **(b) — regresión de reconstrucción**: runtime ejecutó el pipeline MASIVA completo (upload ×3 → precalor → dedup v2 hamming=0 → orientación → OCR escalonado conf 98.2 % → desenlace RECHAZADA) con sonda DOM cada 1.5 s durante **150 s: 0 barras / 0 elementos verdes en la bandeja en TODAS las transiciones**; PERO el destello D65 T3.3 **SÍ estuvo cableado** (`84cd0be`: barra `h-1` verde bajo `LISTA && recienListas.has(f.id)`) y la reconstrucción `4f9c871` (zip D68-D72) perdió el bloque **COMPLETO** de barras — hoy el JSX no renderiza ninguna barra de progreso en filas (solo chip %); el comentario L631 («barra h-1 discreta») sobrevive huérfano. | Fase 4 — decisión del dueño: para `recienListas`: (a) **re-cablear** restaurando el bloque D65 T3.3 (plomería `recienListas`/`enColaVida`/`posCola` intacta; el QA e65b grepea el FILTRO `colaVida`, sigue verde), o (b) remover estado+efecto+comentarios. Para `modoMenuMontado`: candidato claro a **eliminación** (estados + efecto Escape + comentarios L713-716/767-769). Nota honesta: el instante exacto LISTA no fue observado en vivo (actas sintéticas sin QR → RECHAZADA); la ausencia del destello es estructural — el markup no existe en el render actual, no depende del desenlace. Evidencia: capturas `/home/z/e14test/{31-sim,41-final}.png`, logs `/home/z/e14test/v4.log`·`v5.log`. |
| B2 | 🟡 **MEDIA** | `MasivaView.tsx:633` (`posCola`) + cadena `enColaVida`:632 / `useMemo colaVida`:305-315 | **Escenario B — NO borrar.** La plomería D65 (barra de progreso de cola) está documentada como INTACTA por el kit e65b (worklog:2065 «colaVida/enColaVida INTACTOS — no entra al contador de cola»; REPORTE-e65:77 «colaVida intacta»), protegida por gate QA EJECUTABLE (`scripts/qa-dedup-enviadas.ts:257` grepea el filtro de `colaVida` dentro del fuente de MasivaView) y citada en AGENTS.md. `posCola` (posición en cola) quedó sin consumidor de UI: el bloque de barras «h-1» del comentario D65 T3.3 **existió (`84cd0be`) y se perdió en la reconstrucción `4f9c871`** — pickaxe + runtime lo confirman (ver B1: hoy el JSX no renderiza ninguna barra en filas). | Decisión del dueño: (a) implementar la barra/posición usando `posCola` (plomería lista), o (b) remover la cadena completa JUNTO con el gate QA del kit e65b — jamás solo el código: rompería el QA. |

---

## Protocolo obligatorio antes de borrar código "muerto"

> Nacido de la **lección 3A.1** (§5): `archivoPipeline` se eliminó como export
> muerto (`2c011a2`) y rompió el QA e63m — `qa-qr-identidad.ts:353` hace
> `indexOf` sobre el código fuente de `runner.ts`. Los 3 gates (tsc/lint/build)
> pasaron limpios; solo la corrida del QA detectó la ruptura (restaurado en
> `3da7b21`).
>
> **Aplicable a CUALQUIER borrado de export/símbolo/import, en cualquier fase,
> incluidos los "triviales"** (tipos, iconos, primitives: pueden esconder
> consumo dinámico, re-exports públicos o anclas QA que knip/tsc no siguen).

1. **Grep de evidencia** — `grep -rn "<símbolo>" src/ scripts/ tools/ docs/`
   → pegar la evidencia (o el grep vacío) en AUDIT.md antes del commit.
2. **¿Aparece en `scripts/qa-*.ts`?** → NO BORRAR sin antes clasificarlo:
   - **ancla posicional** (`indexOf`/`slice`/`includes` sobre el fuente), o
   - **aserción real** (import + llamada ejecutada por el harness).
   En ambos casos: no borrar el símbolo — aplicar el paso 5.
3. **Antes del commit** — correr TODOS los harnesses:
   `for f in scripts/qa-*.ts; do bun "$f" || break; done` → 100 % verde.
4. **Después del commit** — repetir el paso 3 → si algo falla:
   `git revert HEAD` + reportar. `tsc`/`lint`/`build` **no** detectan rupturas
   de anclas QA; los pasos 3-4 sí.
5. **Símbolo solo-ancla** (sin uso funcional; su único consumidor es el QA):
   conservarlo/restaurarlo con
   `// eslint-disable-next-line @typescript-eslint/no-unused-vars — ancla QA <nombre>`
   + comentario que documente el consumidor real (ej.: `archivoPipeline`, `3da7b21`).

---

## 3. Verificado y LIMPIO ✅ (sin hallazgos)

| Ítem | Resultado |
|---|---|
| `debugger` olvidados | 0 en todo `src/` |
| `TODO` / `FIXME` / `HACK` / `XXX` reales | 0 en Fase 1 (los matches eran la palabra española "TODO" en comentarios 😄). Desde 3A.1: 3 `TODO(fase-4)` INTENCIONALES como marcadores ejecutables de deuda (`scanner-core-bridge.ts:723/725/727` — ver §2.1); rastreo: `rg "TODO\(fase-4\)" src/` |
| XSS / código dinámico | 0: sin `dangerouslySetInnerHTML`, sin `eval`, sin `new Function` |
| Errores de hidratación | 0: sin `window`/`document`/`navigator` en scope de módulo, sin `Math.random()` en render de componentes |
| `localStorage` | 3 archivos (`ScanView`, `AyudaOverlay`, `orientacion.ts`) — siempre dentro de efectos/handlers, nunca en render. Seguro. |
| Directivas `"use client"` / `"use server"` | Coherente: 19 archivos cliente con directiva; `layout.tsx` es server component correcto (font + metadata); `primitives.tsx` e `icons.tsx` no usan hooks (se compilan como cliente vía import). 0 `"use server"` — correcto para app estática/offline sin backend. |
| Manejo de errores en `fetch`/async | Revisados los 10 puntos con `fetch`: `ScanView.tsx:1134` (try/catch ✓), `divipol.ts:71` (patrón "NUNCA rechaza", degrada a manual ✓), `archivos.ts:456` (try/catch con motivo propio ✓), `rapidocr.ts:190` (caller con try/catch honesto ✓), `dedup.ts`, `scanner-core-bridge.ts` (con fallback). **Único menor**: helper `dataUrlToBlob` (`ReviewView.tsx:108`) no envuelto — su único caller (`:197`, descarga de foto) está en flujo con error boundary de UI; aceptable. |
| Build / tipos | `tsc --noEmit`: 0 errores · build Turbopack: exit 0 |

---

## 4. Resumen ejecutivo

### Conteo por severidad

| Severidad | Cantidad |
|-----------|----------|
| 🔴 BLOQUEANTE | **0** |
| 🟠 ALTO | **3** (2 confirmados de proceso/config + 1 sospecha de hooks) |
| 🟡 MEDIO | **5** (ciclos ×2, exports muertos, tipos muertos, config knip/logging) |
| 🟢 BAJO | **4** |
| **Total** | **12** |

### Los 5 problemas más urgentes (orden recomendado)

1. **Reactivar reglas ESLint críticas** (`eslint.config.mjs`) — es la causa raíz: el lint verde actual no protege nada y ya permitió acumular dead code y hooks sin verificar. Hacerlo en tandas pequeñas.
2. **Quitar `typescript.ignoreBuildErrors`** (`next.config.ts:41`) — `tsc` ya pasa 0 errores; el cambio es gratis hoy y evita que un futuro error de tipos llegue silenciosamente a producción.
3. **Resolver los 3 `useEffect` de `ScanView.tsx` (1615/1638/1690)** — la única sospecha de bug de runtime real. Las funciones implicadas parecen estables (`useCallback`), hay que añadir deps o justificar con comentario; re-probar flujo de cámara.
4. **Configurar `knip.json`** (entries de QA/tools + ignores vendor/sw) y luego **limpiar los ~103 exports/tipos muertos** en commits atómicos por módulo.
5. **Diseñar la ruptura del ciclo estático `masiva/store ↔ precalor`** — primero propuesta de diseño (regla 1), después el refactor.

### Qué arreglaría en esta sesión vs. después

**Arreglaría ahora** (riesgo bajo, verificable con los 3 comandos tras cada paso):
- Quitar `ignoreBuildErrors: true` ✅ trivial
- Tanda 1 de reglas lint: `no-debugger`, `no-empty`, `no-unreachable`, `prefer-const`, `no-unused-vars` (con `argsIgnorePattern`) ✅ el repo ya pasa tsc; lo que salga se limpia en commits separados
- Crear `knip.json` y fijar knip `5.44.1` ✅ solo config
- Deps de los 3 `useEffect` de ScanView (con prueba manual de escaneo)

**Dejaría para después** (requiere tu decisión/diseño):
- Tanda 2 de lint (`exhaustive-deps` como warn en todo el repo)
- Limpieza de exports muertos en `lib/e14` grande (`clasificador`, `identidad-qr`, `informe`) — verificar función por función contra `scripts/qa-*`
- Ciclos `precalor↔store` y `store↔runner` — refactor arquitectónico (regla 1: se pide permiso con diseño antes)
- Política de `console.*` (43 llamadas) — decisión de producto
- `reactStrictMode` — experimento en rama aparte

---

## 5. Notas de metodología

- `knip ≥5.45` crashea en este entorno (`oxc-parser` → `RangeError: ArrayBuffer allocation failed`); se instaló **`knip@5.44.1`** fijado, que usa el parser TypeScript clásico y funciona. Recomendación: mantener el pin hasta que el issue de oxc-parser lo permita.
- `react-hooks/exhaustive-deps` se ejecutó **vía CLI** (`bunx eslint src --rule '...'`) sin modificar `eslint.config.mjs` — 3 warnings reales. → Actualización 3A: la regla quedó activa **scoped a `ScanView.tsx`** (bloque `files:` en `eslint.config.mjs`, `acb839b`) con las 3 directivas justificadas en uso; sustituye el `reportUnusedDisableDirectives: off` temporal (`7de9fd7`) para conservar la higiene de directivas. Activación global: Fase 4.
- **Lección 3A.1 (nueva)**: los QA de `scripts/qa-*.ts` validan por **grep de fuente con anclas por símbolo** — p. ej. `qa-qr-identidad.ts:353` hace `indexOf("const archivoPipeline = archivo;")` y `qa-dedup-enviadas.ts:257` grepea el filtro de `colaVida` dentro del fuente de MasivaView. Un símbolo sin usos TS puede tener consumidores en los harness: antes de borrar «muertos» en `runner/`/`masiva`, grep en `scripts/` y **correr los QA** (`bun scripts/qa-<x>.ts`) — tsc/lint/build NO detectan estas rupturas (el FAIL saltó en la corrida del QA, no en los 3 gates). → Formalizado como checklist obligatoria en la sección **«Protocolo obligatorio antes de borrar código "muerto"»** de este documento (aplica a 3B-B1…B4 y a toda la Fase 4).
- Imports circulares detectados con `bunx madge --circular --extensions ts,tsx` (61 archivos, 5 ciclos reportados; 2 son benignos: 1 type-only, 1 dynamic-import).
- Durante la revisión se sospechó de un posible error de sintaxis en `ScanView.tsx:718-719` (destructuring incompleto); **descartado con hexdump (`od -c`)**: las líneas están correctas — era artefacto de renderizado de la terminal del auditor, no del repo.
- Ningún archivo de `src/` fue modificado. Los únicos cambios en el working tree son `package.json` + `bun.lock` (knip devDependency, autorizado) y este `AUDIT.md`.
