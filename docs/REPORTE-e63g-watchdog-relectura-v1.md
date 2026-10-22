# REPORTE — e63g watchdog-relectura-v1 (E1 del PLAN único e63g+e63h)

**Fecha:** 2026-10-22 · **Agente:** Z.ai Code · **Rama:** `fix/e63g-watchdog-relectura-v1` sobre main `f443ee1` (#68 + #69/e63k mergeados y validados en campo — informe 181622, 14/14 ENVIADA).

> **DESATENCIÓN DECLARADA (importante — RESUELTA):** el kit `INSTRUCCIONES-e63g-watchdog-relectura-v1.md`
> citado por el plan NO estaba disponible al ejecutar (ni en upload/ ni en el repo). Fuente de verdad
> aplicada: **PLAN-e63g-e63h-ruta-unica-v1.md §2 (resumen ejecutivo) + §6 (red lines)**,
> que reproduce el contrato completo. Las referencias de línea del kit (L688/L693/L833…)
> son de main @ 581ab4c — **anclas localizadas por SÍMBOLO** tal como advierte el plan.
> Ancla: bloque `if (procedeRelecturaInterna(acta))` en `procesarUno` (runner.ts).
> **RESOLUCIÓN:** el kit llegó DESPUÉS del merge (#70 → main 1946f0e) y se auditó §-por-§
> — veredicto: conformidad total en código, deuda documental saldada en el **ANEXO KIT**
> al final de este REPORTE.

---

## §0 — El agujero (por qué existe este kit)

- La re-lectura interna (e63f F2) corre **FUERA del watchdog D65**: el presupuesto
  `WATCHDOG_MS=75s` cubre solo el pipeline del intento (`escanearActa`); el bloque
  relectura hace `await getBridge().reconocerTexto(acta)` **sin tope propio** → un
  colgaje de OCR ahí dejaba la cola **esperando PARA SIEMPRE** (sin veredicto, sin
  error, sin reintento posible). Latente desde e63f: no disparó en el informe 181622,
  pero es estructural (plan §0: «agujero de colgaje»).
- Segundo agujero (FASE 1): `siguientePendiente()` salta los ids `masiva-temp-` — si la
  copia a IDB de un lote aterriza **después** de que el bucle rompió (cola que se vació
  mientras el lote copiaba), las filas nuevas quedaban **PENDIENTE para siempre** con el
  runner muerto.

## §1 — Implementación F0: tope de la re-lectura

- **`src/lib/e14/masiva/tope.ts` NUEVO (módulo puro):** `conTope<T>(trabajo, topeMs)`
  con la tríada EXACTA del plan — `{vencido:true} | {vencido:false,valor} | {vencido:false,error}`.
  * JAMÁS `throw`/`reject`: el rechazo del trabajo viaja como **dato** (el catch de
    siempre se vuelve una rama).
  * Si el tope gana, el trabajo en vuelo se **abandona**: resolución tardía = no-op
    (resolve sobre promesa ya resuelta); rechazo tardío **tiene handler** (cero
    `unhandledrejection` — probado en QA).
  * Sin fuga de timer (clearTimeout en todo desenlace). Sin DOM/red/estado.
- **`RELECTURA_TOPE_MS = 45_000`** — constante NUEVA en runner.ts, **separada y
  documentada al margen del watchdog D65** (75s/2/5_000 byte-idénticos). Racional:
  45 s ≈ 2× el peor caso real del re-OCR a cap fino (~22 s) — vencido eso ya no es
  lentitud, es colgaje.
- **Wiring (punto único, bloque relectura de `procesarUno`):**
  * el trabajo (`reconocerTexto` → `clasificarCabecera` → `desenlaceTrasRelectura`)
    corre envuelto en `conTope(..., RELECTURA_TOPE_MS)`;
  * **rama valor** → desenlace de la re-lectura (comportamiento e63f intacto);
  * **rama error** → `sin-cambio` (mismo catch honesto de siempre, ahora como dato);
  * **rama vencido** → `await matarYRecrearWorkers()` (misma infraestructura del
    watchdog T1.2: worker de detección disposed + re-creado por self-healing, runtime
    OCR re-creado — best-effort, jamás lanza) + **veredicto de la 1.ª lectura INTACTO**
    (`actaDesenlace` sigue siendo `acta` — la rama NO lo reasigna) + token aditivo
    **`RelecturaInterna=tope`** (D51) + **CERO reintentos**;
  * `console.info` **SIEMPRE** (también con tope) — fuera de las ramas.
- La fila y el informe NO cambian de forma: el flag `relectura` sigue siendo booleano
  (`relecturaDesenlace != null` — el intento ocurrió, incluso si venció a 45 s).

## §2 — Implementación FASE 1: re-arranque del bucle tras el swap

- **`rearrancarTrasEncolar()`** (export nuevo de runner.ts, PUNTO ÚNICO) — lo llama
  `agregarFiles` del store **justo después del swap temp→id real** (el `set()` que
  produce filas PENDIENTE con id real + `colaDisponible:true`).
- **Guard IDEMPOTENTE triple** (en el runner, donde viven `stopFlag`/`corriendoFlag`):
  1. **sesión fría** (`colaSesionIniciada === false` — el dueño JAMÁS pulsó PROCESAR
     en esta sesión) → NO arranca: **D45 intacto** (encolar no procesa por sí solo);
  2. **pausa activa** (`stopFlag` — manual o auto-pausa al abrir REVISIÓN) → NO
     arranca: *reanudar es MANUAL* (contrato del botón, kit D65);
  3. **cola viva** → `iniciarRunner()` es no-op (corriendoFlag) y el bucle vivo toma
     las nuevas en su siguiente pasada.
- **Ventana de carrera cerrada:** el re-check va **diferido (macrotask)** — si el bucle
  rompe ENTRE el swap y el llamado, al disparar el timer el `finally` del bucle ya limpió
  `corriendoFlag` y el bucle renace por la puerta de siempre (`iniciarRunner`). La pausa
  que llegue tarde también gana (re-check de `stopFlag` dentro del timer).
- `colaSesionIniciada = true` se estampa **SOLO dentro de `iniciarRunner()`** — jamás
  desde fuera.
- **FASE 2 (píldora «COLA PAUSADA»): NO implementada** — el plan la condiciona a que el
  dueño la pida («solo si el dueño la pide — no bloquea el PR»).

## §3 — QA headless (`scripts/qa-watchdog-relectura.ts` — 34/34)

1. **Tríada conTope (runtime, timers cortos):** valor a tiempo (valor exacto) · error a
   tiempo (identidad del error conservada, viaja como dato) · vencido · `conTope` jamás
   rechaza (await directo sobre promesa rechazada) · **rechazo tardío tras vencido sin
   unhandledrejection** (contador en 0) · valor tardío no re-resuelve · sin fuga de
   timer (6 casos en <5 s de reloj real).
2. **Constantes:** `RELECTURA_TOPE_MS = 45_000` literal · WATCHDOG 75_000/2/5_000
   byte-idénticos · tríada exacta en tope.ts.
3. **Wiring F0 (source-scan por símbolo):** import `./tope` · `conTope(..., RELECTURA_TOPE_MS)`
   en el bloque · rama vencido llama `matarYRecrearWorkers()` y **NO reasigna
   `actaDesenlace`** · token `tope` + `sin-cambio` · rama valor = e63f intacto · rama
   error = sin-cambio · traza SIEMPRE con `RelecturaInterna=${relecturaToken}` ·
   **sin `for`/`while` en el bloque** (cero reintentos) · `conTope(` aparece EXACTAMENTE
   1 vez en runner.ts (el watchdog D65 no se toca).
4. **FASE 1 (source-scan):** export `rearrancarTrasEncolar` · guard literal
   `!colaSesionIniciada || stopFlag` · `colaSesionIniciada = true` SOLO en
   `iniciarRunner` · re-check diferido con pausa tardía · el store llama
   `rearrancarTrasEncolar()` DESPUÉS del swap y **UNA sola vez** (punto único).
5. **Invariancias:** umbrales 0.82/0.6/0.55 · OPTIMA=8/ADVERTENCIA=6.5 ·
   DEDUP_HAMMING_MAX=6 · DEDUP_CINTA_CIERTA=2 · proxy=true — byte-idénticos.

## §4 — Gates

`bun install --frozen-lockfile` sin cambios (scanner-core intacto) · `tsc` 0 · `lint` 0 ·
QA watchdog-relectura **34/34** · QA autoenvío **33/33** · QA escaneo-ya-recortado
**24/24** · QA identidad-acta **30/30** · build `NEXT_PUBLIC_BASE_PATH=/digielect14` OK.

## §5 — Validación del dueño (mini-Fase D post-merge — plan §2/§7)

1. **Corrida completa del lote → la cola TERMINA SIEMPRE** (el agujero de relectura
   queda cerrado aunque el OCR se cuelgue a mitad de la re-lectura: veredicto intacto,
   `RelecturaInterna=tope` en consola si llegó a vencer).
2. **Soltar fotos con la cola viva → las nuevas arrancan solas** (incluye el caso
   borde: soltar cuando el bucle se está apagando). Con la cola PAUSADA no arrancan
   solas (contrato manual) y en sesión fría tampoco (D45 — encolar no procesa).
3. **14/14 ENVIADA se mantiene** — nada de criterios tocó este kit (solo presupuesto
   de tiempo + arranque de bucle).

## §6 — Red lines (plan §6) — verificación

1. Umbrales 0.82/0.6/0.55/8/6.5 **byte-idénticos** ✓ (QA source-scan). 2. HAMMING_MAX=6,
   CINTA=2, capa 2 e63k intacta ✓. 3. WATCHDOG byte-idéntico; `RELECTURA_TOPE_MS=45_000`
   es constante NUEVA; **la relectura jamás reintenta** ✓ (sin bucles, QA). 4. proxy=true
   ✓. 5. Palancas NO-GO no se tocan ✓ (install frozen sin cambios). 6. Dedup jamás
   inventa: el bloque relectura no toca dedup; fallback/procesar-igual intactos ✓.
   7. Re-chequeo acotado: re-arranque solo-lectura de estado propio, techo n/a, sin
   timers globales (el único timer es el re-check de 0 ms) ✓. 8. §2.5 no aplica (es de
   e63h/E3). 9. Trazas solo-aditivas (token `tope` al union del token D51) · commits
   Conventional · merge de 2 padres · worklog append · REPORTE ✓. 10. Cero producción
   fuera de masiva: diff = tope.ts (nuevo) + runner.ts + store.ts + QA + docs ✓.

---

## ANEXO KIT — re-lectura §-por-§ tras la entrega del kit real (addendum)

El kit `INSTRUCCIONES-e63g-watchdog-relectura-v1.md` llegó DESPUÉS del merge (#70 → main
1946f0e). Auditoría completa §-por-§ sobre main @ 1946f0e — **VEREDICTO: conformidad
total en código; CERO desvíos funcionales.** Las 2 variantes declaradas son equivalentes
o más estrictas, ambas locked por QA source-scan:

| § del kit | Veredicto | Nota |
|---|---|---|
| §0 verdad medida | ✓ | diagnóstico coincidente (cita abajo en §0-bis) |
| §2.1 constante 45 s | ✓ | `RELECTURA_TOPE_MS = 45_000` nueva y separada; D65 (75s/2/5s) byte-idéntico |
| §2.2 tríada canónica | ✓ | `tope.ts` usa la forma CORREGIDA del kit (§2.2 «CUIDADO con el rechazo»), no el boceto con `throw` dentro de `.then` |
| §2.3 wiring | ✓ equivalente | dos variables (`relecturaDesenlace` semántico + `relecturaToken` de log) en vez de una: mismo flag `!= null`, mismo token `tope` en `vencido`, misma rama error→`sin-cambio`; pipeline inline (IIFE con las 3 llamadas del kit: `reconocerTexto` → `clasificarCabecera` → `desenlaceTrasRelectura`) dentro de `conTope`; `console.info` SIEMPRE |
| §3 FASE 1 | ✓ + más estricta | guard triple (sesión fría D45 / pausa manual+auto D59 / cola viva no-op) + re-check diferido (macrotask). El escenario EXACTO del kit (cola viva, bucle rompe sobre temps, swap aterriza) re-arranca igual |
| §4 FASE 2 (píldora) | no aplicable | el propio kit: «solo si el dueño la pide; no bloquea el PR» |
| §5 QA | ✓ (1 caso reforzado) | caso 1 ahora usa promesa que **NUNCA resuelve** (literal del kit §5.1) — antes usaba una que resolvía tarde; mismo desenlace de rama, ahora literal |
| §6 red lines | ✓ las 9 | verificación detallada en §6 de este REPORTE |

### §0-bis — La verdad medida (cita que el kit exige en el REPORTE)

`src/lib/e14/masiva/runner.ts` L48-51 (historia del propio repo — el síntoma ya ocurrió
y está documentado por el repo mismo):

> «Antes (e14-masiva-ux-v1 T4): presupuesto ÚNICO de 120 s — un colgado moría CIEGO una vez
> (informe 20261020-122235: 3 actas ~175 s, 8.7 min de cola congelada, `tiempos: null` sin
> etapa ni duración — **el "se detiene a medio camino"**).»

Lo resolvió el watchdog D65 (presupuesto POR INTENTO + `matarYRecrearWorkers` + veredicto
honesto); este kit (e63g) cierra los DOS agujeros que quedaban: la re-lectura interna
e63f F2 fuera del watchdog (F0) y la carrera temp→id (FASE 1).

### §1-bis — Diagnóstico diferencial (los 3 modos de «se detiene», kit §1)

| Modo | Qué se ve en UI | Causa | ¿Bug? |
|---|---|---|---|
| **A. Congelamiento relectura** | Fila eterna en PROCESANDO + «COLA ACTIVA» + PROCESAR deshabilitado + sin log `relectura-interna` de esa fila | OCR/OpenCV colgado en la re-lectura (fuera del watchdog) | **SÍ — este kit (F0)** |
| **B. Auto-pausa D59** | «COLA QUIETA / N EN COLA» + botón PROCESAR libre | Se abrió un acta de la bandeja o captura individual. Reanudación MANUAL por diseño | No — decisión vigente |
| **C. Carrera de temps** | «COLA QUIETA / N EN COLA» justo después de soltar fotos con la cola viva | El bucle sale cuando lo único pendiente son filas temp mientras la copia a IDB está en vuelo | Sí (menor) — este kit (FASE 1) |

### §3-bis — Declaración del cambio de comportamiento (FASE 1, kit §3)

**ANTES:** soltar fotos con la cola viva y que el bucle terminara las viejas mientras las
nuevas aún eran `masiva-temp-*` dejaba la cola **QUIETA con pendientes** hasta que el dueño
pulsara PROCESAR.

**DESPUÉS:** al aterrizar el swap temp→id real, `rearrancarTrasEncolar()` re-arranca el
bucle SOLO si la sesión ya estaba iniciada (D45) y no hay pausa activa (manual o
auto-pausa de REVISIÓN — reanudar sigue siendo MANUAL). Con pausa o en sesión fría: SIN
cambio de comportamiento.

### §7-bis — Plan de validación del dueño (completo, kit §7)

1. **Corrida del lote completo** en el preview del PR: la cola TERMINA SIEMPRE — cero filas
   eternas en PROCESANDO. Si una re-lectura vence el tope: esa acta cae EN_REVISION_HUMANA
   con el veredicto de la 1.ª lectura (como antes de e63f) y la cola SIGUE con la siguiente.
2. **A/B esperado con el lote 120553:** 26/26 ENVIADA se mantiene (con F1a, `171446.jpg`
   clasifica AUTO → OPTIMA sin pasar por relectura; si otra acta cae a relectura y vence al
   tope, quedará en revisión — la cola NUNCA se congela).
3. **Consola durante la corrida:** cada fila termina con su línea de desenlace; si hubo
   tope, aparece `RelecturaInterna=tope` con ms ≈ 45_000.
4. **Prueba de soltar fotos con la cola viva** (FASE 1): soltar un segundo lote a mitad de
   corrida → al terminar las viejas, las nuevas arrancan solas.
5. **Criterio NO-GO:** si alguna acta que HOY se autoenvía dejara de autoenviarse por este
   kit → NO-GO (no debe pasar: el tope no cambia veredictos, solo evita el colgaje).
