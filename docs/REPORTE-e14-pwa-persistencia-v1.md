# REPORTE — KIT e14-pwa-persistencia-v1 — Auditoría integral + PWA offline (H6) + Persistencia de jornada (L6)

## Resumen

Tres frentes en una rama (`feat/e14-pwa-persistencia-y-mejoras`, PR #38):

1. **AUDITORÍA** de TODO el código del producto (3 pases: `src/lib/e14` core · screens/UI · `masiva/**`) cruzados contra la doctrina del vault → **6 bugs CRÍTICOS + 14 medios + 12 menores corregidos** (tabla abajo). Cero cambios de doctrina: `evaluarGate`, pisos/techos, telemetría, `hashMock` (transmisión mock por diseño hasta el módulo de supervisión), D48 y chips SIM INTACTOS.
2. **PWA (H6)**: `public/sw.js` adaptado del lab (`escaner-v7` → `e14-v1`) + iconos + manifest completo + `PwaRegister` — instalable y **offline**: el motor OCR (~30 MB) se cachea AL PRIMER USO.
3. **PERSISTENCIA (L6)**: `src/lib/e14/jornada.ts` (NUEVO) — IndexedDB vanilla `e14-jornada-v1`: la jornada sobrevive recargas/caídas de batería, incluida el acta en REVISIÓN con sus fotos; REINICIAR JORNADA (2 toques) en RESUMEN; SIM OFF ya no quema progreso falso (mesas derivadas de lo real).

## §1 Bugs corregidos (auditoría)

### Críticos

| # | Bug | Fix | Archivo |
|---|-----|-----|---------|
| C1 | `paginaVerPag` leía el grupo `[1]` (**Ver** — siempre `01`) en vez del `[2]` (**Pág**) → pág 2 archivada en hueco P1 cuando el código 1D no se lee + `VERPAG_CODIGO_DISCREPAN` espurio | Usa el grupo `[2]` | `clasificador.ts:533` |
| C2 | `archivarHueco`: hueco duplicado conservaba `previa.huecos` → RESCANEO jamás subía a OK (AC-RC5 rota, mesa EN_PROCESO eterna) | El duplicado REEMPLAZA el estado del hueco | `store.ts:381` |
| C3 | `defaultQuad()` factory nueva por render → el effect de QuadEditor con deps `[quadInicial]` re-tweenaba → el recorte manual del usuario se BORRABA en re-render (errorRecorte/revelando) | `quadInicialEditor` memoizado `[status, quadDetectado]` | `ReviewView.tsx` |
| C4 | MASIVA `sincronizarAlVolver` comparaba `actaActual.id` (`acta-*`) vs `origenAbierto` (`masiva-*`) → NUNCA coincidía (código muerto): ediciones de REVISIÓN jamás sincronizaban → doble envío posible | Identidad por `registro.acta.id === actaActual.id` | `masiva/store.ts:290` |
| C5 | `enviarLote` sin flag de re-entrancia → doble tap = doble envío del lote | Flag `enviandoLote` (early-return + finally) + botón disabled/«ENVIANDO…» | `masiva/store.ts:347` |
| C6 | `listarRegistros` materializaba la cola COMPLETA (actas con dataURLs 7–14 MB c/u) en `cargarFilas`/`ResumenView`/informe → OOM en jornada real (100+ actas) | `listarMapeados(mapper)` con cursor que NO retiene registros + `contarRegistros()` con `count()` nativo; callers migrados | `masiva/cola.ts:120` |

### Medios

- **M1** `registrarEnvio` aplicaba `paginaObjetivo` stale en envíos MASIVA (el comentario mentía) → guion contaminado.
- **M2** `repetirFoto` excedía `maxIntentos` → «INTENTO 5 DE 4» + historial duplicado. Semántica de ciclo §7: ADVERTENCIA/ENVIADA/cerrados → intento 1 (ciclo nuevo); RECHAZADA/RH-bajo-tope → intento+1 con CAP.
- **M3** `dispararEscaneo` catch mudo (cero log/feedback) → `console.error`.
- **M4** IMPORTAR sin guard durante captura → 2 pipelines concurrentes. Guard in-flight en `dispararEscaneo` (vista `analizando` → return) + guards tempranos con aviso.
- **M5** Guards asimétricos `aplicarRecorte` (sin `revelando`)/`cambiarFiltro` (sin re-validación de identidad post-await → recorte sobrescrito).
- **M6** Sondas de cámara seguían tras desmontar (loop sin chequear `cancelado`).
- **M7** `mejorarFotoActa` OPTIMA forzaba vista `revision` ~15 s después (teletransporte).
- **M8** Runner enviaba ANTES del guard de fila quitada + catch re-persistía ERROR sin guard (zombie).
- **M9** `agregarLote` con quota → diagnóstico falso «navegador no soporta». Aviso específico «ALMACENAMIENTO LLENO…» + `colaDisponible` sigue `true`.
- **M10** SIM OFF dejaba progreso falso quemado en `mesas` (efecto compuesto) → RESUELTO con la derivación de mesas reales de L6.
- **M11** Informe deserializaba registros SIN carpeta + todas las imágenes en RAM a la vez → solo filas con carpeta.
- **M12** Runner no se pausaba al disparar escaneo individual (solo al abrir acta) → auto-pausa con import dinámico (romper ciclo store→runner→store).
- **M13** Filas temp: QUITAR/VACIAR durante la copia → huérfanos en IDB (el swap temp→real borra los ids quitados).
- **M14** `guardarRegistro` fallaba tras envío → fila ERROR + registro PENDIENTE → reproceso + doble envío. Persistencia post-envío con reintento mínimo (LISTA sin acta).

### Menores

Interval leak de `conRampa` (autolímite de ticks), id de historial colisionable (contador), canvas ganador del burst sin liberar, `ToolbarBtn` sin disabled real (visual+aria+tab), tarjetas `role=button` sin `onClick`, botón de conexión del TopBar muerto para teclado (ahora `aria-pressed` + teclado), QuadEditor spinner infinito si decode falla (estado `falloDecode` honesto), PROCESAR habilitado con solo temps, unrar fetch fail → `WASM_NO_CARGO` (no `PROTEGIDO_O_CORRUPTO` falso), throttle tragaba el último evento, backdrop del selector de modo no cubría el dock (fixed), sheets sin Esc, Rotar 90° sin gate de `fotoProcesada`, QUITAR disabled en fila PROCESANDO, pendientes excluye `masiva-temp-`.

## §2 PWA (H6)

- **`public/sw.js`** — copia adaptada del lab (`escaner-v7` → `e14-v1`, adaptación declarada en el header):
  - navigate → **network-first** (la app siempre fresca si hay red);
  - `_next/static` → cache-first (inmutables con hash);
  - resto → SWR tope 80 entradas;
  - **MOTOR cache-on-first-use**: `/models/rapidocr/` + `/vendor/onnxruntime/` (~30 MB) — el primer escaneo con conexión deja el motor offline PARA SIEMPRE;
  - precache best-effort de opencv + detection-worker;
  - **E-04 sin `skipWaiting` incondicional**: listener `SKIP_WAITING` + banner con consentimiento (nunca recarga a media acta) + limpieza de cachés viejas en `activate`.
- **`src/lib/e14/update-banner.ts`** — verbatim del lab: «Nueva versión lista» + Recargar.
- **`src/components/e14/PwaRegister.tsx`** — montaje único. ADAPTACIÓN declarada: sin warm-up OCR (e14 ya tiene `prowarm` D50).
- **Iconos** 192/512/maskable (zona segura)/apple-touch — paleta de marca `#070A0D`/`#00E676`.
- **`manifest.webmanifest`** completo (lang es-CO, scope, orientation, categories, maskable) + metadata icons/appleWebApp en `layout.tsx`.

## §3 Persistencia (L6)

- **`src/lib/e14/jornada.ts`** (NUEVO) — IndexedDB vanilla `e14-jornada-v1`, 2 stores:
  - `estado` (1 registro, clave fija): archivadas, `puestoActual`, historial (tope 200), contadores de sesión, `motivosNoEnvio` — estado LIVIANO.
  - `acta` (1 slot): el acta en revisión CON fotos (solo fuentes CÁMARA/ARCHIVO — SIM/MASIVA jamás: la cola MASIVA tiene su propia IDB D45).
- **Derivación, no duplicación**: `mesasRealesDe()` (compartida con ACTAS) — las mesas NO se persisten; se derivan de archivadas+puesto al restaurar. Consecuencia: **SIM OFF restaura el guion REAL** (fix M10 — antes quedaba quemado el progreso falso del SIM).
- **Store**: `arrancarJornada()` (restaura + restaura acta en revisión; guards de actividad temprana), `reiniciarJornada()` (reset completo + slot + cola MASIVA vía imports dinámicos), persister por SUSCRIPCIÓN (estado por comparación JSON — el tick SIM no dispara escrituras; acta por identidad de referencia).
- **Gate multi-pestaña**: `persisterActivo` solo se abre en el `finally` de `arrancarJornada` — una pestaña nueva jamás pisa la jornada persistida de otra.
- **REINICIAR JORNADA** en RESUMEN — 2 toques (patrón VACIAR), aria-labels.

### Bugs propios del kit, encontrados y corregidos durante el E2E

1. `guardarJornada` hacía `put(estado)` SIN clave en un store sin keyPath → `DataError` síncrono tragado → jamás persistía. Fix: `put(estado, KEY_ESTADO)`.
2. `ultimaActaPersistida` inicializada `undefined` → el primer `set` del arranque (`actaActual null ≠ undefined`) limpiaba el slot ANTES de que `arrancarJornada` lo leyera. Fix: inicializa `null`.
3. Arranque fresco de una 2ª pestaña sobrescribía la jornada persistida con el seed antes de restaurar → gate `persisterActivo` (arriba).
4. TDZ de HMR: declaraciones `let` del persister movidas antes del `create` (unhandledRejection al re-evaluar el módulo).

## §4 Evidencia E2E (foto real del dueño — Galaxy A56, 4000×3000, EXIF upper-right)

- IMPORTAR → pipeline 11.5 s → **OCR conf 94%** (44 cajas/41 líneas) → clasif **AUTO `88·120·15·02·012`** · código `710007453010102` → lectura FUERTE anclas 9 → **score 8.5 → ÓPTIMA auto-enviada** → ACTAS: FRANKFURT CONSULADO · 12 mesas DIVIPOL · MESA 12 EN PROCESO.
- **Recarga** → jornada restaurada (count ACTAS + historial + archivadas + puesto) + acta ENVIADA restaurada en REVISIÓN con fotos.
- **REINICIAR JORNADA** → estado fresco verificado.
- **MASIVA** con la misma foto → ENVIADA AUTO, contadores correctos.
- Sesión limpia de navegador: **0 errores de consola**.
- Gates: `tsc --noEmit` 0 · `lint` 0-0 · dev compila y sirve 200.
- Assets PWA: manifest/sw.js/iconos → 200.

## §5 NO tocado (intencional)

`hashMock` (transmisión mock — el módulo de supervisión real está pendiente de diseño con el dueño) · timeout MASIVA 120 s vs 15 s individual (**D48** intacto) · SIM comparte mesas (D6) · score AUTO=10 (D-1) · `unzipSync` → `unzip` async (diferido por riesgo CSP/workers en despliegue estático — no es hot path).

## §6 Desviaciones

- `package.json`: el script `dev` del sandbox se coló en el primer push del PR (`next dev -p 3000 2>&1 | tee dev.log` + salto de línea final perdido) — **revertido byte a byte a `next dev -p 3001`** tras la auditoría del dueño.
- `worklog.md` en la raíz (bitácora del agente sandbox) se commiteó por error en el primer push — **fuera del repo** (des-trackeado; ignore local vía `.git/info/exclude`, sin tocar `.gitignore` del proyecto). Este registro vive en `docs/worklog.md` como manda AGENTS.md.

## §7 Pendientes del dueño

1. **Auditar/mergeear PR #38** (nada mergeueado).
2. **D48**: decidir el timeout MASIVA 120 s vs 15 s individual (documentado, no tocado).
3. Probar **instalación PWA + offline en SU teléfono** (el SW exige https — GH Pages/Vercel sí, sandbox http no registra).
4. `unzipSync` → `unzip` async si algún día el despliegue lo exige.
