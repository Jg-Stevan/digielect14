# REPORTE — feat/poolworkers-wiring-v1 (Agente B, REPARTE-3-AGENTES-v1)

**Kit:** `AGENTE-B-poolworkers-wiring-v1.md` · **Base:** `main` = `7dd570d` (PR #97 integrado — coincide con el hash del kit, sin drift) · **Branch:** `feat/poolworkers-wiring-v1` · **Fecha:** 2026-10-23 (Bogotá)

Naturaleza: kill switch, no optimización. El flag `poolWorkers: 1|2` ya existía en el contrato (`obs/tipos.ts:83`, default 2 en `FLAGS_DEFAULT`); el runner NO lo leía (`const PROCESAMIENTO_CONCURRENTE = 2` hardcodeado). Este branch conecta el cable y recalibra la única ancla QA que grepeaba el string viejo.

---

## 1. Seguimiento del kit + desviaciones justificadas

| § Kit | Pedido | Estado |
|---|---|---|
| §1 | `runner.ts` ~L132: `const PROCESAMIENTO_CONCURRENTE = leerFlags().poolWorkers ?? 2;` + import `leerFlags` de `../flags` | **HECHO** — string EXACTO (L137); import en zona de imports (L19, tras `get-bridge`) con comentario de contexto |
| §2 | Recalibrar ancla `qa-dedup-enviadas.ts` (~L375): 1 include de la condición compuesta | **HECHO** — L375 `runner.includes("const PROCESAMIENTO_CONCURRENTE = leerFlags().poolWorkers ?? 2;") &&` (los otros 2 includes y el mensaje intactos) |
| §3 | Test de saneo del flag (4 casos) + saneo en `flags.ts` si faltara | **HECHO EL TEST** (4 casos, §4 abajo). **El saneo YA EXISTÍA** en `flags.ts:43` (`if (p.poolWorkers === 1 || p.poolWorkers === 2)`) — el kit dice «si… no existe aún, añádelo»: existía, no se tocó flags.ts |
| §4 | PROHIBIDO: orientacion/scanner-core-bridge/informe/obs/**, 3+ workers, cambiar default, debilitar tests | **RESPECTADO** — `git diff main..HEAD` = 3 archivos de mi territorio + docs |
| §5 | Gate completo 100 % verde | **VERDE** (§3 abajo) |
| §6 | Smoke 1-worker / 2-workers | **HECHO lo verificable: ESTÁTICA + RUNTIME en navegador** (§4) — la cola con actas reales queda para campo (no ejecutable en este entorno) |
| §7 | Commits pequeños en español · push | **HECHO** (§2 abajo) |

**Desviaciones menores (documentadas, ninguna funcional):**

1. **Comentario viejo distinto al que el kit describe.** El kit muestra como «viejo» un comentario de 1 línea (`benchmark aprobado).`); el real era de 3 líneas (`benchmark aprobado, «el hardware ya demostró soportar»). Constante única: revertir a 1 = …pre-e71. */`). Se reemplazó el bloque REAL por el comentario nuevo del kit (que conserva la semántica e71: «comportamiento secuencial byte-idéntico al pre-e71»). El kit mismo fija el criterio para anclas: «ajústalo con el string real y documenta la diferencia».
2. **Ubicación del contrato.** El kit citaba `masiva/tipos.ts (~L83)`; tras la integración del núcleo obs (PR #97) el contrato vive en `obs/tipos.ts:83` (`poolWorkers: 1 | 2; // default 2`). Solo lectura — nada que cambiar.
3. **`?? 2` es defensa en profundidad.** `FlagsApp.poolWorkers` es `1 | 2` no-nullable y `leerFlags()` jamás devuelve otro valor (defaults + saneo); el `?? 2` del kit se mantiene EXACTO porque (a) el QA recalibrado grepea ese string y (b) blindaje si el contrato aflojara en el futuro. Verificado: ESLint sin `no-unnecessary-condition` (no type-aware) — 0 warnings.
4. **Import con 3 líneas de comentario** (el kit pedía solo el import): sigue el estilo del archivo (cada import del runner trae su comentario de kit). El QA de qr-identidad que revisa imports del runner no se ve afectado (sus includes siguen presentes).

---

## 2. Archivos, líneas y commits

```
5e108c8 feat: pool de workers lee el flag poolWorkers — kill switch del dueño (default 2)
8d51d6e test: saneo y efectivo de poolWorkers (default 2 · override 1|2 · fuera de rango → 2)
<hash-docs> docs: REPORTE poolworkers-wiring-v1 + worklog
```

| Archivo | Cambio |
|---|---|
| `src/lib/e14/masiva/runner.ts` | +4 import (L16-19) · reemplazo comentario+constante (L133-137): `const PROCESAMIENTO_CONCURRENTE = leerFlags().poolWorkers ?? 2;` |
| `scripts/qa-dedup-enviadas.ts` | L375: 1 include recalibrado (condición compuesta, mensaje intacto) |
| `src/lib/e14/flags.test.ts` | +53: describe «flags · poolWorkers wiring (poolworkers-wiring-v1)» con 4 tests (8 → 12 tests del archivo) |
| `docs/REPORTE-poolworkers-wiring-v1.md` | NUEVO (este archivo) |
| `docs/worklog.md` | append (entrada del Agente B al final) |

Push: `origin/feat/poolworkers-wiring-v1` (branch único, sin merge — el dueño integra B primero según REPARTE §3).

---

## 3. Gate (100 % verde)

| Gate | Resultado |
|---|---|
| `bunx tsc --noEmit` | **0 errores** (exit 0) |
| `bun run lint` | **0 errores / 0 warnings** (exit 0) |
| `bun run test` | **166/166** (162 base + 4 nuevos; `flags.test.ts` 8 → 12) |
| `bash scripts/check-quality.sh` | **TODO VERDE — QA 11/11 · 355/355 checks** — ver nota |
| `bun run build` | **exit 0** · ruta `/` estática |
| `bunx knip` | informativo, exit 0 — **0 ítems nuevos** (leerFlags ya tenía consumidores; el import del runner no cambia el baseline 40) |

**Nota sobre el «294/294» del kit:** ese número corresponde a los 7 QAs clásicos (294 checks, vigente hasta PR #97). Con el gate integrado por A3-C5 (`check-quality.sh` 11/11 QAs), el total actual es **355/355** (7 clásicos 294/294 INTACTOS + contract 38 + privacidad 7 + transporte 8 + ui 8). `dedup-enviadas` recalibrado: **50/50**. Mismo criterio del kit — suite completa verde — con el total crecido por el núcleo ya integrado.

---

## 4. Smoke (kit §6) — estático + RUNTIME en navegador (producción real)

El kit permite documentar verificación estática si el flujo completo no es ejecutable en el entorno. La **cadena del flag quedó verificada en RUNTIME** (build de producción standalone :3001, navegador real): la cola con actas reales queda para campo.

### 4.a Runtime (browser, producción standalone)

Ciclo completo del kill switch verificado en el PanelDev (sección «7 · Flags activas», que renderiza `leerFlags()` — la MISMA función que alimenta `PROCESAMIENTO_CONCURRENTE` al cargar el módulo):

| Estado | Tras reload | Veredicto |
|---|---|---|
| Sin override | `poolWorkers 2` sin chip | default correcto ✅ |
| `e14-flags-overrides = {"poolWorkers":1}` | `poolWorkers` **1** **con chip «override»** + tarjeta kill switch «UN SOLO WORKER — poolWorkers 2 → 1» bajo encabezado «(overrides)» | el dueño baja a 1 → cola secuencial ✅ |
| Override vaciado `{}` | `poolWorkers 2` sin chip | vuelta al default limpia ✅ |

Flujo real ejecutado: tuerca → «¿ACTIVAR EL MODO DE DIAGNÓSTICO?» SÍ → panel abierto (PANEL DEV · ACTIVO, identidad real: TIER BAJO · RAM 4 GB · device-id creado) → override en localStorage → **reload** → tabla con chip → vaciado → **reload** → sin chip. **0 errores de página / 0 errores de consola.** El valor 1 de la tabla es exactamente al que liga la constante del pool en esa carga (kit §0: «el override aplica al recargar la página» — verificado en vivo).

### 4.b Estático + unitario

1. **Cadena de prioridad (unitaria, 4 tests nuevos):** sin override → `poolWorkers = 2` · override `1` → `1` · override `2` → `2` · override `0/3/"x"` → el saneo de `flags.ts` lo descarta y el efectivo es `2`. Cubre el kill switch de punta a punta a nivel `leerFlags()`.
2. **Wiring estático:** la constante del pool es la ÚNICA fuente del límite de vuelo (`while (enVuelo.size >= PROCESAMIENTO_CONCURRENTE)` L~1335; sin otros hardcodes de pool — grep en `src/` confirma que el resto de referencias usan la constante). Con override `1` el ciclo toma 1 acta por pasada → secuencial; con default `2` → 2 en vuelo (comportamiento e71 intacto).
3. **Timing del override:** la constante se evalúa AL CARGAR el módulo → el override `e14-flags-overrides` del dueño aplica al recargar la página (como el kit §0 anticipa). Lectura SYNC — sin async en el wiring.
4. **SSR-safe:** `runner.ts` es `"use client"` pero se importa en servidor; `leerOverridesFlags()` (obs/politica.ts:109) envuelve `window.localStorage` en try/catch → `{}` en SSR → default 2 en prerender. Sin crash de hidratación posible por este cambio.
5. **Sin ciclo de imports:** `flags.ts` importa `obs/tipos` + `obs/politica`; `politica.ts` importa `obs/{buffer,digest,breadcrumbs,tipos}` — ninguna cadena regresa a `masiva/runner` (verificado con los imports reales del árbol).
6. **Evidencia de bundle:** el build de producción contiene la forma minificada `poolWorkers??2` en `.next/static/chunks/` — el cableado llegó al artefacto.

**Humo pendiente (honesto):** solo queda la observación de LOGS de cola con actas reales (1-en-vuelo vs 2-en-vuelo visibles en el consola del módulo masiva) — requiere fotos + flujo MASIVA completo, no ejecutable en este entorno; queda para campo del dueño (CHECKLIST-CAMPO) o para el auditor con el smoke del REPARTE §4.5. La CADENA del flag (override → leerFlags → valor ligado por el pool) sí quedó verificada de punta a punta en runtime (§4.a).

---

## 5. Riesgos / puntos exactos a auditar

1. **La recalibración del ancla** (`qa-dedup-enviadas.ts:375`) — el string nuevo debe coincidir byte a byte con runner.ts:137 (hoy coincide: QA 50/50). Cualquier futuro cambio de formato de esa línea debe actualizar AMBOS.
2. **Timing de carga:** si el dueño cambia el override y NO recarga, el pool sigue con el valor de la carga anterior (constante de módulo). Es el comportamiento diseñado (kit §0) — auditar que se acepta.
3. **`?? 2` muerto por tipos:** intencional (ver Desviación 3). El auditor puede preguntar por el operador — está blindado por el QA ancla.
4. **Otros QAs que leen runner.ts** (`qa-historico-enviadas`, `qa-qr-identidad`, `qa-watchdog-relectura`): sus anclas no cruzan la constante ni el import nuevo — verificados 49/49 · 72/72 · 34/34 tras el cambio.

---

## 6. Bloqueos

**Ninguno.** Branch pusheado a `origin`. Kit A y C (REPARTE §1) no estaban disponibles en esta sesión — solo se ejecutó el kit del Agente B (sin inventar territorio ajeno).

---

*Reporte por el Agente B (Z.ai Code) — commit docs de este archivo + worklog en el mismo push.*

---

# ANEXO — cola-persistente-v1 (segunda entrega en esta misma branch)

**Kit:** `AGENTE-B-ANEXO-cola-persistente-v1.md` · **Vía elegida:** la PRIMARIA del kit — mismos commits en `feat/poolworkers-wiring-v1` (el PR #98 seguía open/draft, sin review iniciada; la alternativa «branch aparte» queda declarada por si el dueño prefiere separar al integrar).

**Petición literal cumplida:** la carga masiva NO se elimina automáticamente — **solo muere con `vaciar()` del dueño**. El MODO PRUEBAS e64p (auto-borrado al cargar) queda alcanzable vía override `colaPersistente: false` en `e14-flags-overrides`, mismo patrón que `poolWorkers`.

## A1. Seguimiento del kit + desviación justificada

| § Kit | Pedido | Estado |
|---|---|---|
| §1 | Contrato: `colaPersistente: boolean` default **true** + saneo + flags-ejemplo.json | **HECHO** — campo en `FlagsApp` (`obs/tipos.ts:88`), `FLAGS_DEFAULT.colaPersistente = true` (`flags.ts:33`), saneo en `sanearFlags` (`flags.ts:47`), línea documentada en `public/flags-ejemplo.json` |
| §2 | `store.ts` L260 → `const COLA_PERSISTENTE = leerFlags().colaPersistente ?? true;` + import | **HECHO** — string EXACTO (L264). El import YA existía (store.ts L34, por thumbsOn — cero import añadido) |
| §3 | CRÍTICO: identificador `COLA_PERSISTENTE` intacto + comentarios ancla intactos + bloques internos sin tocar | **RESPECTADO** — verificado por gate: `qa-historico-enviadas` **49/49** (L132 import-borrarHistorico · L168 `if (COLA_PERSISTENTE) {` del índice · L340 `!COLA_PERSISTENTE` en vaciar · L421 docstrings de historico.ts), `qa-qr-identidad` **72/72**, `qa-watchdog` **34/34**. El comentario nuevo del kit se AÑADIÓ (los viejos e64p C-1/C-2/C-3 quedaron completos — doc append-only en el propio bloque) |
| §4 | Test del saneo (default true · override false · "x"/0 → true) + smokes | **HECHO** — 3 tests nuevos en `flags.test.ts` (describe «colaPersistente wiring»). Smokes: **RUNTIME real** (§A3) |
| §5 | Advertencia de almacenamiento en el reporte | **§A4 abajo** |
| §6 | Gate completo | **VERDE** (§A2) |
| §7 | Reporte añadido al del kit B + hashes | **Este sección** |

**Desviación (1, justificada — la única):** el ANEXO nombra `flags.ts` + tipos, pero la cadena del override pasa por **DOS whitelists**: `sanearFlags` (flags.ts) Y `leerOverridesFlags` (`obs/politica.ts:116-121`). Sin la línea en el segundo, `e14-flags-overrides` con `{"colaPersistente":false}` se descarta ANTES de llegar a `leerFlags()` y el MODO PRUEBAS sería inalcanzable (el smoke §4.3 del propio kit fallaría). Se añadió la línea espejo en el whitelist de politica.ts (con comentario que lo explica). Es el mismo patrón que ya vive para poolWorkers. Nota de zona: `obs/tipos.ts` y `obs/politica.ts` son zonas del núcleo — el ANEXO del dueño («contrato de flags (flags.ts + tipos)») las autoriza explícitamente para este campo; cero lógica obs tocada.

**Calibración de test existente (1):** `flags.test.ts` «defaults del contrato» tenía un `toEqual` EXHAUSTIVO de `FLAGS_DEFAULT` — se añadió `colaPersistente: true` al objeto esperado (territorio «tests de flags» del kit B). Los demás asserts (sanearFlags hostiles, refrescarFlags) pasan intactos: sus inputs no llevan la clave nueva. `obs.test.ts` (L843-861, leerOverridesFlags) verificado: sus inputs tampoco llevan la clave → sin cambios.

## A2. Gate (100 % verde)

tsc **0** · lint **0/0** · vitest **169/169** (166 + 3 nuevos) · check-quality.sh **TODO VERDE — QA 11/11 · 355/355** (los 7 clásicos 294/294 INTACTOS — el «294/294» del kit es el total pre-PR #97; hoy el gate integrado suma los 4 QA-obs) · build **exit 0** · knip **0 ítems nuevos** (exit 0).

## A3. Smokes — RUNTIME real (producción standalone :3001, navegador, fixtures PNG)

1. **Persistente (default true):** 3 archivos subidos → cola `PROCESAR COLA 3` → **RELOAD → `COLA=3` SIGUEN** (con el código del ANEXO ausente, `cargarFilas()` habría ejecutado vaciarCola+borrarHistorico: antes era imposible). ✅
2. **`vaciar()` del dueño:** botón VACIAR → armado («¿SEGURO?») → confirmar → **cola vacía** (contador fuera). La válvula manual pedida por el dueño funciona. ✅
3. **Modo pruebas (override false):** 3 archivos de nuevo → `e14-flags-overrides = {"colaPersistente":false}` → RELOAD → **COLA VACÍA** (auto-borrado e64p intacto y alcanzable). ✅
4. **0 errores de página / 0 de consola** en todo el ciclo. Capturas: `/tmp/anexo-1-cola.png`, `/tmp/anexo-2-persistente.png`, `/tmp/anexo-3-vaciada.png`, `/tmp/anexo-4-modopruebas.png`.

**No ejecutado en runtime (honesto):** la re-subida post-vaciar naciendo **YA-ENVIADA** (RL-e65b-5) requiere actas reales con OCR válido (los fixtures PNG de 1×1 no producen QR/ENVIADA). Esa semántica queda cubierta por: `qa-historico-enviadas` 49/49 (anclas del ledger que sobrevive vaciar), tests del núcleo, y el smoke de campo del dueño (re-subir los 46).

## A4. Advertencia de almacenamiento (kit §5)

Con el default persistente, el IndexedDB conserva las actas completas hasta el `vaciar()` manual: el lote 1 real pesó **345.9 MB** (`almacenamientoMB` ya sale en `totales` del informe). Rutina recomendada al dueño: **arqueo → `vaciar()`**. PROHIBIDO reintroducir auto-borrado alguno; el aviso de cuota es wave 3, NO este kit (per kit).

## A5. Riesgos / puntos exactos a auditar

1. **`obs/politica.ts:121`** — la línea del whitelist (Desviación 1): confirmar que el dueño acepta el toque mínimo en zona núcleo.
2. **`obs/tipos.ts:88`** — campo nuevo en el contrato §4.2: `qa-obs-contract` valida presencia de la interface (38/38), NO bloque verbatim → sin rotura; el README-KITS §4.2 quedó un campo atrás del código (doc viva del dueño, NO editada por este agente).
3. **Timing de carga:** `COLA_PERSISTENTE` se liga AL CARGAR el módulo store → el override aplica al RELOAD (idéntico a poolWorkers, kit §0/ANEXO §0).
4. **Doble saneo** (politica + flags): auditar que ambos whitelists quedan sincronizados si el contrato crece de nuevo.

## A6. Bloqueos

**Ninguno.** 3 commits en `feat/poolworkers-wiring-v1` (feat + test + docs) pusheados al mismo PR DRAFT #98.
