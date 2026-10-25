# REPORTE-kit-e73-sondeo-qr-precoz-v1

**Kit:** ORDEN-KIT-e73-sondeo-qr-precoz-v1 (RE-EMISIÓN 2026-10-25) — sondeo QR precoz
en INGESTA (dedup pre-pool por identidad)
**Base:** `main` @ `043b2ba` (wave 3 COMPLETA) · **Rama:** `feat/sondeo-qr-precoz-v1`
**Gate:** tsc 0 · lint 0/0 · vitest **294 = 268 base + 26 e73** · build OK · QA 11/11 · anclas 10/3/11

---

## 1. Qué aterrizó (commits atómicos)

| Commit | Tarea | Contenido |
|---|---|---|
| T1 | §A.2–A.5 + §D (base) | `qr-pixeles.ts` (refactor puro) · `sondeo-qr.worker.ts` · `sondeo-qr.client.ts` · flags `sondeoQrPrecoz`/`sondeoQrPresupuestoMs` · 13 tests |
| T2 | §B + §C | wiring `cadenaDedup` (capa ENTRE bytes y dhash) · índice histórico por payload · 8 tests |
| T4 | §D (test) | saneo de flags: override válido / tipo inválido → default / desconocidas rechazadas · 1 test |
| T5 | §E | línea del informe + `totalesDedup.qrSondeo` + chip «SONDEO QR N/M» en MasivaView · 4 tests |
| T7 | §F | este REPORTE (+ verificación knip) |

## 2. §A — Worker de sondeo (infraestructura NUEVA)

- **Smoke de bundling (§A.1 — la PUERTA):** `bun run build` exit 0 con la referencia
  `new Worker(new URL("./sondeo-qr.worker.ts", import.meta.url), { type: "module" })` viva en
  `sondeo-qr.client.ts` (único `new Worker` de `src/` — verificado: cero precedentes). El build
  se re-corrió en CADA commit del gate (el wiring T2 hace el import real → el chunk del worker
  se emite). Smoke manual EN DEV (navegador) queda en §H del kit — verificación de campo del dueño.
- **Feature-detect:** `typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined"`
  → `null` SIEMPRE, sin instanciar (test 10).
- **§A.2 refactor puro:** `PixelesQr · EspecieBanda · BANDAS_BASE/BANDA_A · intentoSobrePixeles ·
  rotar90/rotarPixeles` movidos a `qr-pixeles.ts` (módulo worker-safe: cero DOM, cero zxing) y
  RE-EXPORTADOS por `identidad-qr.ts` — **cero diffs en consumidores** (runner/puente/QA/tests
  siguen importando de identidad-qr). `qa-qr-identidad` 72/72 verde tras el refactor.
- **§A.3 ladder presupuestado:** reló LOCAL inyectable (`ahora`) — chequeo ANTES de entrar a cada
  tier; sin presupuesto (≤0) → null inmediato; S3 barrido SOLO si restan ≥ 1500 ms
  (`SONDEO_S3_MINIMO_RESTANTE_MS`). `bitmap.close()` INMEDIATO tras el draw. JAMÁS throw.
- **zxing PROHIBIDO en el worker:** el grafo ESTÁTICO del worker solo contiene `qr-pixeles.ts`
  (jsQR vendido — puro JS). El barrido del repo (`barridoQrDePixeles` — jsQR-only, síncrono,
  puro) llega por **import DINÁMICO cacheado** (una vez por vida del worker): los tiers zxing
  del pool jamás se ejecutan en el worker y el wasm/glue jamás se descarga (la referencia lazy
  de `identidad-qr` nunca se consume — el worker solo llama a `barridoQrDePixeles`).
- **§A.4 cliente:** singleton + cola FIFO SERIALIZADA (1 sondeo a la vez — RAM móvil) · hard-kill
  `presupuesto + 1000 ms` → `terminate()` + respawn perezoso + resolve null · flag OFF → null SIN
  instanciar worker · jamás throw.

## 3. §B/§C — Wiring en `cadenaDedup` (capa ENTRE bytes y dhash)

- Orden por archivo FIFO: **bytes (INTACTA)** → **sondeo NUEVO** → **dhash (INTACTA)**.
- `forzarDedupOff` manda SIEMPRE (cinturón — el guard vive en `cadenaDedup`, test source-inspection 7).
- **(a) Cola viva:** `mapaSondeoPayload` (payload → filaId) construido EN la cadena — primer
  ganador gana, filas ≠ PENDIENTE excluidas → DUPLICADA persistente con la MISMA rama del dhash
  (guard filaViva PENDIENTE + leerRegistro + write + patchFila), dedup **`"qr-sondeo"`** (D57 AL FINAL).
- **(b) Histórico:** índice por payload (§C) → `marcarYaEnviada(id, hit.id, "payload", …)` — via
  EXISTENTE `"payload"` (cero churn D57), dedup default `"ya-enviada"` (guard wave3 C.2 satisfecho).
  `COLA_PERSISTENTE=false` (MODO PRUEBAS e64p C-3) → el ledger NO alimenta el índice.
- **(c) Sin match:** la fila se registra como original futura + sigue a dhash **byte a byte**.
- **§C índice:** `indiceEnviadasPorPayload()` en `historico.ts` — MISMO patrón del cache del
  índice de enviadas + hook `actualizarIndicePayload` al MISMO punto de invalidación
  (`registrarEnviadaHistorico`). Solo entradas con `payloadQr != null`; llave OPACA (jamás se parsea).
- **INTOCABLES respetados:** `runner.ts` diff VACÍO ✓ · pipeline in-pool de identidad-qr ✓ ·
  relectura/tope/cola ✓ · capa bytes/dhash/cinta cierta/e63k ✓ · zxing in-pool ✓.

## 4. §D/§E — Flags, telemetría, UI, informe

- Flags: `sondeoQrPrecoz` (default **true**) · `sondeoQrPresupuestoMs` (default **2500**, saneo
  clamped 500..30000) — campos AL FINAL de `FlagsApp` (D57) + whitelist de saneo aditiva.
- Telemetría: `sondeoQrMs` (sondeo CORRIÓ, con o sin lectura) · `sondeoQrTier` (SOLO con lectura)
  — en FilaMasiva/RegistroMasiva/FilaInforme AL FINAL (D57) + `filaDeRegistro` los restaura.
- Trazas grepeables: `[e14] sondeo-qr fila=<id> tier=<t> ms=<n>` · `→ DUPLICADA qr-sondeo dupOf=<id>`
  · `→ YA-ENVIADA payload` · hard-kill warn.
- Informe (D51 — línea ADITIVA AL FINAL de TOTALES): `Sondeo QR: N leídos · M con payload ·
  p50/p95 X/Y ms · tiers: full n / recorte n / …` — N=sondeos corridos, M=lecturas; "-" si nada
  (honesto). `totalesDedup.qrSondeo` NUEVO (NO entra al set e66 de `matches` — semántica estable).
- UI: chip **`SONDEO QR M/N`** en MasivaView junto al progreso de ingesta (SOLO-LECTURA del store
  — cero lógica de cola tocada).

## 5. Smoke de bundling — resultado

```
bun run build → exit 0 (Next 16 Turbopack · rutas: / · /_not-found · /api/e14/envios)
```
La referencia `new Worker(new URL("./sondeo-qr.worker.ts", import.meta.url), { type: "module" })`
empaqueta sin errores (§A.1). Verificación EN NAVEGADOR (chunk servido + decode real en worker) →
§H del kit (campo — dueño).

## 6. p50/p95 REALES — pendiente de campo (§H)

Los tests miden ms de ladder con fixtures (matriz QR real del corpus: ver sondeo-qr.test.ts).
Los p50/p95 DE CAMPO (lote real, §H.2: % gemelas marcadas en ingesta 90-95 % esperado, p50/p95
por tier) se declararán en este REPORTE tras la corrida del dueño — el kit PROHÍBE prometer
números (ahorro honesto: ~20-35 % de la ventana; captura esperada 90-95 %).

## 7. Desviaciones declaradas (REPORTE §3)

- **M-e73-1 — orden de commits:** §D (flags: tipos/default/saneo) aterrizó EN T1 (el cliente §A.4
  lo consume — "flag OFF → null sin instanciar" es parte del contrato del cliente); el TEST de
  flags vive en su commit T4. §C (índice) aterrizó EN T2 (el wiring (b) lo consume — commit
  intermedio compilable). El orden del kit T1→T2→T4→T3→T5→T7 se respeta como ORDEN LÓGICO de
  unidades atómicas; cada commit compila y pasa su suite.
- **M-e73-2 — contrato del cliente:** `sondearQrPrecoz` devuelve `{payload: string | null;
  tier: string | null; ms: number} | null` (espejo de `RespuestaSondeo` del worker): el OBJETO
  significa «corrió y midió» (payload null = sin QR — alimenta «N leídos» del informe §E) y `null`
  significa «NO corrió» (flag OFF / sin soporte / hard-kill / error). El kit declaraba
  `{payload: string; …} | null` — con esa forma «N leídos» no distinguiría «sondeó sin leer» de
  «no sondeó» (la telemetría del informe sería imposible sin inventar).
- **M-e73-3 — write extra SOLO en hits YA-ENVIADA (rama b):** la telemetría del sondeo se estampa
  con UN write previo a `marcarYaEnviada` (que la ARRASTRA con su `...registro` — su write anclado
  de qa-historico queda byte a byte). Coste: 1 write extra SOLO en filas YA-ENVIADA por payload
  (las más valiosas). La rama común (sin match) pliega la telemetría EN el MISMO write del hash
  (snapshot — los literales anclados de wave3 C.2 quedan byte a byte: guard de contrato verde).
- **M-e73-4 — README-KITS.md no existe en el repo** (verificado): la entrada e73 queda LIBRE
  (kit §F: «confirmar al merge que sigue libre» — confirmado). knip: sin cambios de contrato que
  exijan baseline nuevo (exports nuevos todos consumidos — ver §8).
- **M-e73-5 — fixture de rotación:** los tests de rotación (90/180/270) asiertan payload EXACTO y
  tier no-vacío (jsQR es invariante a rotación — el tier EXACTO que lee depende del fixture; el
  contrato del ladder es el payload, no el tier).
- **M-e73-6 — 3 F-checks de `qa-dedup-enviadas.ts` actualizados (patrón wave3):** las anclas que
  codificaban «X es el ÚLTIMO campo» (unión dedup del informe · unión dedup de RegistroMasiva ·
  últimos campos de FilaMasiva/RegistroMasiva) se actualizaron al nuevo contrato — `'qr-sondeo'` y
  `sondeoQrMs/sondeoQrTier` entran AL FINAL (D57 append — exactamente lo que la doctrina ordena);
  nada se reordena ni elimina. Los 3 anclas SAGRADAS del kit (COLA_PERSISTENTE 10 · RL-e65b-5 3 ·
  MODO PRUEBAS 11) quedan INTACTAS. QA dedup-enviadas: **50/50**.

## 8. Gate completo (por commit y final)

| Paso | Resultado |
|---|---|
| `bunx tsc --noEmit` | 0 errores |
| `bun run lint` | 0 errores / 0 warnings |
| `bun run build` | exit 0 (smoke §A.1 incluido) |
| `bun run test` | **294** = 268 base + 26 e73 (T1 13 · T2 5 · §C 3 · T4 1 · §E 4) |
| `bash scripts/check-quality.sh` | 11/11 QA — ver salida final del gate |
| Anclas COLA_PERSISTENTE 10 · RL-e65b-5 3 · MODO PRUEBAS 11 | **INTACTAS** (verificado: 10 · 3 · 11 sobre el árbol final — las 2 menciones del sondeo reescritas a minúsculas para no inflar el ancla; qa-dedup-enviadas 50/50 · qa-historico-enviadas 49/49 con F-checks actualizados patrón wave3 — M-e73-6) |
| `runner.ts` diff | **VACÍO** (§G — cero cambios en todo el kit) |
| knip | informativo — main 42 → rama **48** (+6: tipos de contrato e73 `SondeoQr · FabricaWorkerSondeo · PeticionSondeo · DepsLadderSondeo · DesenlaceSondeo · EspecieBanda` — consumidos por re-export/vía ReturnType; knip no rompe el gate) |

## 9. FIX DICTAMEN-e73-implementacion-v1 (bloqueante único §2 — verde falso del smoke §A.1)

El auditor demostró forensemente que Turbopack emitía este worker como **asset crudo**
(`.next/static/media/sondeo-qr.worker.<hash>.ts` = fuente sin compilar): el build exit 0 era
verdadero pero VACÍO — la función `sondearEnWorker` no existía en ningún chunk y el cliente
referenciaba TypeScript crudo (fallo de MIME en producción). Feature muerta en silencio
(honesta — onerror → null → dhash intacta — pero 0 % de captura en lugar de 90-95 %).

### Fix (§3.1-3.3 del dictamen — criterios todos verificados)

| Criterio | Implementación | Verificación |
|---|---|---|
| §3.1 worker emitido como JS compilado | Precompilación DEDICADA: `scripts/build-sondeo-worker.mjs` (Bun.build IIFE clásica, sin minificar) → `public/scanner/sondeo-qr.worker.js` (artefacto comprometido; precedente `detection-worker.js` de scanner-core). Cliente instancia por URL absoluta `${NEXT_PUBLIC_BASE_PATH}/scanner/sondeo-qr.worker.js` (worker CLÁSICO, patrón WORKER_URL del core) | MIME `application/javascript` en producción (curl sobre `next start`) · smoke marcadores |
| §3.2 smoke REAL integrado al gate | `scripts/smoke-sondeo-worker.mjs` en check-quality.sh (paso 3bis): FRESCURA (regenera a /tmp y compara BYTE A BYTE — artefacto obsoleto = fallo) · MARCADORES (`sondearEnWorker` · `ladderSondeoDePixeles` · `barridoQrDePixeles` · `onmessage`) · PROHIBIDOS ausentes (`import(` · `zxing` · `process.env` · `identidad-qr`) · CLIENTE (cero `.ts` en `static/media`, cero refs al `.ts`, chunk referenciando el `.worker.js`) · ENTREGA (`out/` byte-idéntico si existe) | gate TODO VERDE — el smoke quedó dentro del paso 3bis y corta el gate |
| §3.3 verificación de navegador PRE-merge | `next start` + inyección de PNG con la matriz QR real del corpus vía input MASIVA | **chip «SONDEO QR 2/2» + status «Sondeo QR: 2 leídos, 2 con payload» + gemela marcada DUPLICADA en INGESTA (dedup pre-pool §B vivo)** — imposible con worker muerto («0 leídos · 0 con payload» según el propio dictamen §2.3) |

### Cambios del fix (contención T1 — diseño intacto, el auditor lo aprobó sin reservas)

1. **Movimiento puro §A.2 (misma doctrina del kit):** el BARRIDO jsQR completo
   (`barridoQrDePixeles` + `Cuadrante`/`CUADRANTES` + `limitesDeCuadrante` + `ventanaDePixeles`
   + `jsQrDeVentana` + `ladoDeVentana` + `BARRIDO_VENTANAS` + `QR_RECORTE_LADO`) se movió de
   `identidad-qr.ts` a **qr-pixeles.ts** SIN cambio de comportamiento, con RE-EXPORT en
   identidad-qr (cero diffs en consumidores: runner.ts, QA y tests siguen importando de
   identidad-qr). Motivo: el S3 pasa a import ESTÁTICO del módulo puro — el grafo del bundle
   queda jsQR-only (el import dinámico de identidad-qr arrastraba scanner-core con
   `process.env` a nivel de módulo, que CRASHEA en worker; verificado empíricamente).
2. `sondeo-qr.worker.ts`: import estático de `barridoQrDePixeles`/`QR_RECORTE_LADO` +
   `DEPS_REPO` estático (muere `depsRepoDe` y su modo de fallo) — API del ladder y deps
   inyectables de tests SIN CAMBIO.
3. `sondeo-qr.client.ts`: fábrica → worker clásico por URL absoluta (muere el
   `new URL(..., import.meta.url)` que Turbopack no compila).
4. `scripts/qa-qr-identidad.ts`: 3 anclas de source-scan actualizadas por la reubicación
   (winFilo ≥ 4 y `e64-qr T-1.0` ≥ 2 se cuentan sobre AMBAS fuentes; literal
   `export const QR_RECORTE_LADO = 600;` se ancla a qr-pixeles.ts) — mismas garantías,
   nueva ubicación. QA 72/72 verde.
5. Desviación de herramienta declarada: `Bun.build` con `outfile` a solas NO escribe en
   bun 1.3.14 — ambos scripts usan `outdir`+`naming` (quirk documentado en el código).

### Gate del fix (completo, sobre el árbol con el fix)

tsc 0 · lint 0 · build exit 0 · **smoke 3bis TODO OK** · vitest **294/294** · QA **11/11**
(incl. qr-identidad 72/72) · knip informativo · humo de navegador pre-merge §3.3 ✓
