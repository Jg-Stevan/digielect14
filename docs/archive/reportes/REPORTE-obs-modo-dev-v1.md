# REPORTE — obs-modo-dev-v1 (feat/obs-modo-dev-v1 · agente 2 · KIT e14-observabilidad-v1)

> **Task ID 7-b** · Branch `feat/obs-modo-dev-v1` desde `main` `b603183` (merge #93).
> **Una línea:** UI completa del modo de diagnóstico (tuerca + badge + panel de 7
> secciones + VistaErrores + salud en vivo) con el flujo INFORME ZIP migrado fuera
> de Resumen — entregada en **FASE 0** (esqueleto funcional sin imports de `obs/`)
> porque `origin/feat/obs-nucleo-v1` (agente 1) **no existe todavía**; FASE 1 queda
> trazada y es un cambio solo del puente.

---

## 1 · Qué se hizo (6 commits, uno por tarea del kit)

| Tarea | Commit | Contenido |
|---|---|---|
| **A2-C1** | `feat(dev): tuerca en Resumen + activación armada (C1)` | `dev/TuercaResumen.tsx` (nuevo): tuerca SIEMPRE visible arriba-izquierda del header de ResumenView, gris OFF / acento ON, activación ARMADA (patrón «reiniciar jornada»: confirmación + timeout 4 s) con la copia EXACTA del kit; engranaje SVG inline (`icons.tsx` intacto); Esc y clic-fuera desarmen; `aria-label` + foco visible. |
| **A2-C2** | `feat(dev): badge DEV persistente (C2)` | `TopBar.tsx`: chip «DEV» en la esquina del contenido central cuando el modo está ON, `pointer-events-none`, jamás intrusivo. Re-render barato: evento DOM intra-pestaña + `storage` cross-pestaña — **CERO timers/polling**. |
| **A2-C3** | `refactor(resumen): fuera el botón INFORME ZIP (C3)` | ResumenView sin el botón ZIP ni sus estados (`generando`/`listo`/`motivo`/`colaVacia`) ni el efecto `contarRegistros` que solo lo alimentaba. **Dif neto −77 líneas.** Grep negativo: 0 refs vivas (eran locales). El flujo NO se pierde: migra a PanelDev §5 (C4). |
| **A2-C4** | `feat(dev): PanelDev completo (C4)` | `dev/PanelDev.tsx` (nuevo) con las 7 secciones EN EL ORDEN del kit (detalle §2). `dev/contrato.ts` (tipos §4.2 verbatim subset + defaults D4) y `dev/puente.ts` crecen CON consumidor (knip = baseline en cada commit). |
| **A2-C5** | `feat(dev): VistaErrores con breadcrumbs (C5)` | `dev/VistaErrores.tsx` (nuevo): modal HIJO (z-[80] sobre z-[70]) — card por `ErroresAgrupados` (digest, severidad, tipo, mensaje expandible, archivo, veces, 1.ª/últ. relativas, versiones) y, al expandir, **breadcrumbs del evento más reciente en timeline vertical** («hace 2 min · clic · INICIAR TANDA»). «VACIAR BUFFER» armado (4 s) → `purgarBuffer()`. |
| **A2-C6** | `feat(dev): salud en vivo + hook + cierre (C6)` | `dev/useSaludVivo.ts` (nuevo): snapshot inicial + refresco cada 30 s SOLO mientras el panel está abierto (timer limpiado al desmontar — NUNCA timer global). Integración final: PanelDev montado desde la tuerca, badge, ZIP fuera de Resumen. REPORTE + worklog. |

## 2 · El PanelDev (puerta de entrada visual a TODA la observabilidad)

Convención de overlay **copiada de `AyudaOverlay.tsx`** (fixed inset-0 z-[70],
backdrop blur, clic-fuera cierra, Esc cierra, `role="dialog"` `aria-modal`) +
**focus trap básico** (Tab cicla dentro del panel; mientras el modal hijo
VistaErrores está abierto el manejador del panel se retira — sin cierre en cascada).
Acceso SOLO por la tuerca (sin ruta ni query param).

1. **Estado** — appVersion · modo (con DESACTIVAR armado, flujo inverso del C1,
   cierra el panel) · `idDispositivo`/`idSesion` truncados · política en texto
   («Metadatos: sí · OCR: no · Miniaturas: no · Salud: sí» — defaults D4 verbatim).
2. **Salud del dispositivo** — snapshot vivo (hook C6) + REFRESCAR + toggle
   «MUESTREO CADA 5 MIN» (escribe `saludEnVivo` en política y llama
   `iniciarMuestreoSalud()`/`detenerMuestreoSalud()`; activar confirma). Badge de
   tier con color (ALTO verde / MEDIO ámbar / BAJO rojo) + nota `tierInferido`.
   Card: RAM GB · núcleos · batería % · red · storage libre · memoria JS.
3. **Reportes de errores** — contador del buffer (`contarEventos`) + top-10 por
   digest (`eventosPorDigest`) + «VER DETALLE» → VistaErrores (C5).
4. **Ajustes de datos (privacidad)** — los 4 toggles de `PoliticaDatos` con
   defaults D4 y descripción; **activar muestra confirmación inline** (coherencia
   D4); desactivar es inmediato (menos recolección jamás se confirma).
5. **Exportar** — los 2 botones (reemplazan al de Resumen): **ZIP** = flujo
   migrado de C3 (lazy `generarInformeZip` + `downloadBlob`, chequeo de cola
   vacía, mensajes); **JSON** = `descargarReporte("json", vaciar)` del contrato.
   Disabled con motivo si el buffer está vacío (`contarEventos`); checkbox
   «VACIAR BUFFER TRAS EXPORTAR» (default ON) que aplica a ambas exportaciones.
6. **Kill switch (overrides manuales)** — 3 switches que escriben
   `guardarOverridesFlags`: `poolWorkers 2→1` · `thumbsOn off` ·
   `ocrThreadsTope 4→2`, cada uno con nota de efecto; la tabla §7 los refleja AL
   INSTANTE (criterio 4). Aviso verbatim: «Estos cambios de proceso los decides
   tú; la app nunca los hace sola».
7. **Flags activas** — tabla de valor efectivo (`leerFlags()`) con chip
   «OVERRIDE» por fila tocada + botón «REFRESCAR FLAGS» → resultado
   `ok | sin-endpoint | error` (FASE 0: `sin-endpoint`, honesto — no hay endpoint).

## 3 · Arquitectura FASE 0 — el puente (por qué compila sin el núcleo)

`origin/feat/obs-nucleo-v1` no existe (verificado al arranque: fetch + API de
branches + PRs abiertos = 0). El kit lo anticipa: «FASE 0: componentes con
esqueleto estático SIN imports de `obs/`». Lo construido va MÁS ALLÁ del
esqueleto: es **funcional contra las claves pinned**, y el núcleo se enchufa sin
tocar la UI:

- **`dev/contrato.ts`** — subset VERBATIM de `§4.2` (tipos + defaults D4).
  FASE 1: se ELIMINA y los imports pasan a `obs/tipos` (mismos nombres).
- **`dev/puente.ts`** — firmas EXACTAS de `§4.3`:
  - Real y persistente (claves inalterables `§4.1`): `guardarModoDev`
    (`e14-dev-mode`), `guardarPolitica` (`e14-obs-politica`),
    `guardarOverridesFlags` (`e14-flags-overrides`) — escritura JSON con los
    formatos del contrato, compatible byte a byte con el núcleo futuro.
  - Reactivo sin polling: `useModoDev` / `usePolitica` / `useOverridesFlags`
    (evento DOM intra-pestaña + `storage` cross-pestaña).
  - **Honesto vacío** (jamás inventa): `contarEventos()→0`,
    `eventosPorDigest()→[]`, `obtenerDispositivo()→null`,
    `idSesion()→null`, `descargarReporte()`→falla con mensaje claro,
    `iniciar/detenerMuestreoSalud()` no-op, `refrescarFlags()→"sin-endpoint"`.
  - Privacidad por diseño: `idDispositivo()` SOLO lee la clave pinned del
    núcleo; cero `console.*`; cero network; cero PII.
  - Crecimiento con consumidor: C1 trajo solo modo-dev; C4 política/flags/
    salud/identidad/export; C5 `purgarBuffer` (2.º consumidor); C6 el hook.
- **FASE 1** (cuando el dueño mergee el núcleo): recrear la branch
  (`git checkout -b feat/obs-modo-dev-v1 origin/feat/obs-nucleo-v1`),
  migrar los esqueletos (commits cherry-pick limpios), y reescribir los CUERPOS
  del puente como delegación a `obs/politica.ts` · `obs/buffer.ts` ·
  `obs/dispositivo.ts` · `obs/identidad.ts` · `obs/export.ts` · `lib/e14/flags.ts`.
  Ni la tuerca, ni el badge, ni el panel, ni VistaErrores cambian.

## 4 · Verificación manual en navegador (checklist §6 — ítems 1-2-3-5-8)

App real (`next dev :3001`, viewport 390×844 y 360×740, capturas en la sesión):

1. **Activación** ✓ — tuerca pide confirmación con la copia EXACTA; SÍ →
   `e14-dev-mode:"on"` + aria pasa a «Abrir modo de diagnóstico»; el armado
   expira a los 4 s (verificado por inactividad); desactivar desde el panel →
   `"off"` + panel se cierra.
2. **Badge** ✓ — acta SIM 7.0 → REVISIÓN: TopBar «7.0/10 ADVERTENCIA · DEV»,
   chip no intrusivo.
3. **Toggles** ✓ — `textoOcr` OFF→ON muestra confirmación y SOLO persiste tras
   SÍ; ON→OFF inmediato; política persiste tras reload; kill switch
   `poolWorkers:1` persiste y la tabla muestra «1 · OVERRIDE» al instante.
5. **Export** ✓ — ambos botones disabled con «BUFFER VACÍO (0 EVENTOS) — NADA
   QUE EXPORTAR» (buffer FASE 0 = 0, honesto); checkbox default ON; el flujo
   ZIP migrado queda cableado para FASE 1.
8. **Offline** ✓ — el panel es 100 % local (localStorage + eventos DOM; cero
   fetch/network en `dev/`) — funciona sin conexión por diseño.

Layout: 360 px SIN overflow horizontal (`scrollWidth == clientWidth == 360`);
tuerca con blanco táctil 44 px despejado (`pl-[56px]`); panel legible y
scrollable en 360 y 390.

## 5 · Desviaciones al contrato/kit (todas menores y justificadas)

1. **TopBar solo existe en REVISIÓN** (shell D3: `page.tsx` lo monta solo ahí) —
   el criterio «badge visible en TopBar en TODAS las vistas» es físicamente
   imposible dentro de mi zona (montarlo en otras vistas exigiría tocar
   `page.tsx`, zona del agente 1). El badge aparece donde TopBar renderiza; si
   el dueño quiere badge global, el shell (agente 1) puede montar el mismo chip.
2. **Dif de TopBar = +25/−7** (kit pedía ~5-10 líneas) — el wrapper `relative`
   alrededor del contenido central (píldora O título) + comentarios explican la
   diferencia; la lógica D1 queda intacta.
3. **Header de ResumenView ajustado** para caber la tuerca en 360 px: tuerca
   `absolute left-2` + contenido con `pl-[56px]`; el chip del header muestra
   «TRANSMITIDO» solo ≥400 px (en 360 queda «42 %» — cero pérdida de dato).
4. **`leerModoDev`/`leerPolitica`/`leerOverridesFlags` privadas en el puente**
   (knip: «cada export nace con consumidor o queda interno» — sus únicos
   consumidores FASE 0 son los hooks del propio puente). FASE 1 delega igual.
5. **C3 dejó 2 exports huérfanos transitorios** (`generarInformeZip`,
   `contarRegistros`): sus únicos consumidores eran el botón eliminado y sus
   zonas (`informe.ts`, `cola.ts`) me están PROHIBIDAS. Renacieron con
   consumidor en C4 (PanelDev §5). Knip = baseline exacto en C1-C2 y C4-C6.
6. **`descargarReporte` FASE 0 falla honesto** (throw) — inalcanzable desde la
   UI (los botones exigen buffer > 0 y el buffer FASE 0 es 0); jamás simula una
   descarga.
7. **aria-label de la tuerca dinámico**: OFF «Activar modo de diagnóstico» /
   ON «Abrir modo de diagnóstico» (el kit pinnó «Abrir modo de diagnóstico»
   para la apertura; en OFF el propósito real es activar — mejor a11y).
8. **Sparkline de memoriaJS (C6, opcional)** — OMITIDO (la marca opcional del
   kit lo permite; se priorizó el cierre completo y la verificación).
9. **Tabla de flags FASE 0 = defaults + overrides** — la capa remota
   (`public/flags.json` / endpoint, caché 24 h) vive en `lib/e14/flags.ts` del
   agente 1; «REFRESCAR FLAGS» ya está cableado y responde `sin-endpoint`.

## 6 · Gate completo (por commit; árbol commiteado — `check-quality.sh`)

| Gate | Resultado |
|---|---|
| `bunx tsc --noEmit` | **0 errores** (6/6 commits) |
| `bun run lint` | **0 errores** — 1 warning PREEXISTENTE (`logger.ts:25`, lo elimina el agente 1; 0 warnings nuevas) |
| `bun run test` | **70/70** vitest (4 archivos) |
| `scripts/qa-*.ts` | **294/294** — autoenvío 33 · dedup 50 · recortado 24 · historico 49 · identidad 32 · qr 72 · watchdog 34 |
| `bun run build` | **exit 0** (1 ruta) |
| `bunx knip` | **= baseline exacto de main** (diff vacío: 4 exports + 13 types preexistentes; 0 ítems nuevos) |
| Anclas QA (runner/cola/historico) | INTACTAS — mis zonas no tocan archivos con anclas |
| Zonas prohibidas | `lib/**`, `informe.ts`, `runner*`, QA scripts, `ScanView/MasivaView/ActasView/ReviewView`, `ROADMAP.md`, `DECISIONS.md`, `package.json` — **0 diffs** |

## 7 · Pendiente (FASE 1, tras el merge del núcleo del agente 1)

- Recrear la branch sobre `origin/feat/obs-nucleo-v1` y conectar los módulos
  reales (solo cambia `puente.ts`; `contrato.ts` se elimina a favor de
  `obs/tipos`) — el kit define el paso como `git checkout -b` desde el núcleo.
- Criterios que REQUIEREN núcleo (quedan para FASE 1): export ZIP/JSON real con
  la forma `ReporteSesion` (criterio 2), overrides reflejados en el pipeline
  (criterio 4, efecto — el agente 1 ya lo verificó del lado del núcleo),
  snapshot de salud real + muestreo 5 min, breadcrumbs reales.
- `appVersion()` FASE 0 = `"0.1.0"` (espejo de package.json) → FASE 1 usa
  `obs/identidad.ts` (import del package.json, per contrato).

## 8 · Continuidad

- Branch `feat/obs-modo-dev-v1` (6 commits) pushed a origin; **el agente NO
  mergea** — orden del dueño: 1.º núcleo → 2/3 en cualquier orden (§1 README).
- Los commits son cherry-pick limpios (cada uno compila y pasa gate) para la
  FASE 1 sobre el núcleo.
- Coordinación con agente 3 (transporte+QA): archivos disjuntos — merge limpio
  garantizado. Nada que pedirle.
- Para el agente 1: los formatos de escritura de `e14-obs-politica` y
  `e14-flags-overrides` ya están en uso (JSON con los shapes de §4.2) — leer/escribir
  esas claves con sus helpers es compatible sin migración.

---

# FASE 1 — PUENTE DELEGADO EN EL NÚCLEO REAL (obs-nucleo-v1 existe)

> Rama recreada: `git checkout -b feat/obs-modo-dev-v1 origin/feat/obs-nucleo-v1`
> (8 commits del núcleo, head 7475625) + cherry-pick limpio de los 6 commits
> C1-C6 de la FASE 0 (único conflicto: `docs/worklog.md`, resuelto
> «conservar ambos bloques») + 1 commit de cableado FASE 1.
> **La UI no cambió**: firmas del puente, JSX y consumidores intactos — solo
> los CUERPOS del puente pasaron de stubs honestos a delegación.

## F1 · Qué cambió (commit `feat(dev): FASE 1 — el puente delega en obs/* real`)

| Función del puente | FASE 0 (stub) | FASE 1 (real) |
|---|---|---|
| `leer/guardarModoDev` | localStorage directo | delega en `obs/politica.ts` (claves pinned §4.1) |
| `leer/guardarPolitica` | spread local sobre default | delega en `obs/politica.ts` — defaults D4 + saneo de corruptos (→ defaults + warn `PoliticaCorrupta`) del núcleo |
| `leerFlags` | defaults + overrides locales | delega en `lib/e14/flags.ts` — cadena REAL: DEFAULTS ← `public/flags.json` (cacheado 24 h, offline-safe) ← overrides (máxima prioridad) |
| `refrescarFlags` | siempre `"sin-endpoint"` | delega — fetch real de `/flags.json` con reintentos exponenciales; hoy 404 → `"sin-endpoint"` honesto |
| `obtenerDispositivo` | `null` | delega en `obs/dispositivo.ts` — snapshot REAL (RAM/núcleos/batería/red/storage/memoriaJS + tier); try/catch del puente conserva la firma `\| null` (SSR/navegador sin APIs → "—") |
| `iniciar/detenerMuestreoSalud` | no-op | delega — timer 5 min del NÚCLEO (idempotente, re-verifica modo dev + saludEnVivo + telemetriaSalud CADA tick y se auto-detiene) |
| `contarEventos/eventosPorDigest/purgarBuffer` | `0 / [] / no-op` | delega en `obs/buffer.ts` — IndexedDB `e14-obs` REAL (tope 500 + TTL 30d) |
| `idDispositivo/idSesion/appVersion` | lectura de clave / `null` / `"0.1.0"` espejo | delega en `obs/identidad.ts` — appVersion de `package.json` importado; idSesion UUID por sesión; idDispositivo crea el UUID persistente en la 1.ª lectura (diseño lazy del núcleo) |
| `descargarReporte` | `throw` honesto | delega en `obs/export.ts` — `construirReporte` + ZIP fflate/JSON reales |
| `dev/contrato.ts` | tipos §4.2 verbatim | **ELIMINADO** — la UI importa de `@/lib/e14/obs/tipos` (PanelDev, VistaErrores); `POLITICA_DEFAULT` desde `obs/politica` |

Reactividad PRESERVADA: los setters del núcleo no notifican, así que el
puente sigue emitiendo su evento DOM intra-pestaña `e14-obs:cambio` (+`storage`
cross-pestaña) tras delegar — CERO timers/polling en la UI.

## F2 · DESVIACIÓN (la única de la FASE 1): overrides con semántica REPLACE

`obs/politica.guardarOverridesFlags` del núcleo hace **MERGE**
(`{...actual, ...o}`) — no existe forma de BORRAR una clave. El kill switch
del panel necesita APAGAR un override (la UI construye el objeto final y
hace `delete` de la clave apagada): bajo merge, el override sobreviviría
pegado en storage y el switch jamás apagaría (fallos verificados mentalmente
contra `toggleOverride` de PanelDev L292-305).

Resolución (zona del agente 2 respetada — `lib/**` intacto): el puente
`guardarOverridesFlags` escribe el objeto FINAL directo en la clave PINNED
`e14-flags-overrides` (§4.1 — exportada por el núcleo como `CLAVE_OVERRIDES`).
La LECTURA y el saneo siguen siendo 100 % del núcleo
(`leerOverridesFlags` → `sanearFlags` dentro de `leerFlags`). El contrato
§4.3 fija la FIRMA, no la semántica merge/replace; el resto de setters
sí delegan. Verificación en vivo: ON → `{"poolWorkers":1}` + tabla
«poolWorkers override 1»; OFF → storage `{}` + tabla «poolWorkers 2» sin chip.

## F3 · Verificación manual FASE 1 (build standalone de producción :3001 + agent-browser)

- Panel abierto con núcleo real: VERSIÓN `0.1.0` (package.json) · DISPOSITIVO
  `d78f4f0d…2270` (UUID persistente `e14-obs-device-id` creado por el núcleo) ·
  SESIÓN `9a27ed0b…aab4` · política D4 en texto.
- Salud REAL en vivo: TIER BAJO · RAM 4 GB · NÚCLEOS 2 · BATERÍA 100 % ⚡ ·
  RED 4g · STORAGE 10240 MB · MEMORIA JS 26 MB (FASE 0 mostraba «—»).
- Error REAL inyectado por consola → captura del núcleo → `2 EN BUFFER` →
  card con digest `6129e389` + «VER BREADCRUMBS (6)»: timeline vertical con
  los 6 rastros reales («hace 58 s · clic · …», «vista · resumen») — «cómo
  surgió el error» del kit, funcionando de punta a punta.
- Export JSON con buffer poblado → descarga real (`construirReporte` +
  `descargarBlob`) + buffer purgado por `vaciarDespues` → «0 EN BUFFER» +
  export deshabilitado con motivo. Sin MOTIVO de error (cero excepciones).
- Kill switch: ON → storage `{"poolWorkers":1}` + chip `override` + valor
  efectivo `1` en la tabla; OFF → storage `{}` + valor `2` sin chip (F2).
- REFRESCAR FLAGS → fetch real 404 → «SIN ENDPOINT DE FLAGS (default
  null — D1)» (estado correcto del repo hoy).
- Privacidad: activar TEXTO OCR → confirmación inline «¿Activar el guardado
  del texto OCR? … SÍ/NO» → `e14-obs-politica` persistido con `textoOcr:true`
  + sección 1 reactiva («OCR: sí»).
- DESACTIVAR MODO (armado 4 s) → `e14-dev-mode: off` + panel cerrado.
- **0 errores de página · 0 errores/warnings de consola** (el único error
  fue el `humo-fase1` inyectado adrede para poblar el buffer).

## F4 · Gate FASE 1 (check-quality.sh, árbol commiteado)

- `tsc --noEmit` **0** · `lint` **0 err/0 warnings** · `build` exit 0
- vitest **153/153** (70 base + 83 obs/flags del núcleo — los tests del
  núcleo prueban AHORA los mismos módulos que consume el puente)
- QA 7/7: 33+50+24+49+32+72+34 = **294/294**
- knip: **25 → 19 unused exports vs el núcleo** — 6 exports del contrato
  obs GANARON su primer consumidor real (`descargarReporte`,
  `guardarPolitica`, `guardarModoDev`, `detenerMuestreoSalud`,
  `CLAVE_OVERRIDES`, `POLITICA_DEFAULT`); 0 nuevos unused (diff completo
  contra `origin/feat/obs-nucleo-v1` vacío salvo esas 6 mejoras).
- Diff de la FASE 1: `dev/puente.ts` (cuerpos) · `dev/contrato.ts` (borrado)
  · `dev/PanelDev.tsx` + `dev/VistaErrores.tsx` (SOLO línea de import de
  tipos) · `dev/useSaludVivo.ts` (comentario) · docs. **Cero diff en
  `screens/`, `TopBar`, `lib/**`, `obs/**`.**

## F5 · Continuidad FASE 1

- Branch `feat/obs-modo-dev-v1` (head FASE 1) pushed — STACKED sobre
  `origin/feat/obs-nucleo-v1` (aún sin merge). El PR apunta a `main` y
  mostrará los commits del núcleo hasta que el dueño lo integre (orden §1:
  1.º núcleo → 2/3).
- Al agente 1: nada que pedir — el núcleo cumplió el contrato §4.3 al
  pie de la letra (firmas idénticas 1:1; la única fricción fue la
  semántica merge del override, resuelta en F2 sin tocar su zona).
- Al agente 3 (transporte): `estadoTransporte` sigue sin consumir desde la
  UI (fuera del kit del agente 2) — su stub permanece.
