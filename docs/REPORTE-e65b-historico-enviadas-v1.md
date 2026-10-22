# REPORTE — KIT e65b-historico-enviadas-v1 — LEDGER PERSISTENTE de enviadas

**Kit:** `PLAN-e65b-historico-enviadas-v1` del dueño · **Rama:** `feat/e65b-historico-enviadas-v1`
**Base:** `main @ 7113842` (e65-dedup-enviadas-v1 mergeado — PRs #75/#76/#77) — **coincide EXACTA con el remoto** (verificado vía API antes de arrancar; sin desviación de base esta vez).
**Prioridad:** ALTA — cierra el hueco real de producción del e65.

---

## §1. Problema (evidencia de producción del dueño)

Prueba del dueño con el informe `e14-informe-20261022-112945.zip` (46 actas): **VACIAR
la cola + re-subir los 46 en UN solo lote**. Resultado en e65:

- `totales.yaEnviadas = 0` — la capa bytes **no disparó ni una vez**.
- 8 filas `duraznoN.heic` → `dedup=v2 dist 0` (DUPLICADA por dhash de su copia).
- `durazno1 - copia` / `durazno4 - copia` → **reproceso completo con OCR** (7.4 s / 6.5 s).
- Todo lo demás re-envió (envío ficticio — sin daño server-side, PERO el reproceso se pagó igual).

**Causa raíz (verificada en `store.ts` @ 7113842):**

1. `indiceEnviadas` se construye UNA vez por sesión (`if (indiceEnviadas) return`) y
   `vaciar()` lo borra (D-e65-8: «el histórico muere con la cola») → tras vaciar +
   re-subir, el índice queda `[]` y NUNCA se refresca con los envíos nuevos.
2. El match contra fila viva exige que esa fila ya esté ENVIADA al momento del hash —
   en un solo lote el hash corre a ~1 s/archivo y el runner a ~10-20 s/archivo →
   cuando el gemelo se hashea, su copia aún NO fue enviada → guard conservador →
   cae a dhash → DUPLICADA en vez de YA-ENVIADA.
3. El payload QR del histórico no se consulta: la capa 0 solo mira el mapa de sesión
   (`mapaQrPayload`) → una re-foto del mismo formulario en sesión nueva paga OCR completo.

**Objetivo textual del dueño:** «lo único que necesito es que no se haga un reproceso de
las mismas actas» — traducción técnica: si un archivo ya llegó a desenlace ENVIADO,
cualquier re-subida (mismo archivo o re-foto con el mismo QR) debe quedar **YA-ENVIADA
al instante — SIEMPRE**: misma sesión, tras recargar y **tras vaciar la cola**.

---

## §2. Solución implementada (T-1 … T-6)

### T-1 — `src/lib/e14/masiva/historico.ts` (NUEVO)

Ledger PERSISTENTE de enviadas en **IndexedDB SEPARADA** `e14-masiva-historico-v1` —
la DB de la cola `e14-masiva-v1` queda INTOCADA (**cero migración**). Mismo patrón exacto de `abrirCola()` en `cola.ts`:
singleton + `onupgradeneeded` crea el store `llaves` (keyPath `id`) + `onclose` limpia
+ guard `typeof indexedDB === "undefined"` → `SIN_INDEXEDDB` con rechazo claro.
`EntradaHistorica = { id, ts, hashBytes?, hashDedup?, payloadQr?, serie? }` —
**SOLO LLAVES** (RL-e65b-1, lección L7): jamás Blob/acta/dataURL; ~100 B/registro,
miles de entradas triviales. API: `registrarEntradaHistorico` (put readwrite +
`tx.oncomplete`; throw = el caller decide), `listarHistorico` (getAll), `borrarHistorico`
(clear — SIN callers hoy, RL-e65b-5). Cero dependencias nuevas (RL-e65b-4 —
package.json/bun.lock intactos).

### T-2 — Wiring en `store.ts`

- **2a:** tipo `EntradaHistorica` UNIFICADO — importado de `historico.ts`; el tipo local
  `{id, hashBytes?, hashDedup?}` se retiró (una sola fuente de verdad, con `payloadQr?`).
- **2b:** `indiceEnviadasDe()` FUSIONA ledger + cola (re-put por `id`; **la cola viva
  manda** — más fresca). El mapper conserva los guards e65 (SOLO `acta ENVIADA` o
  `estado YA-ENVIADA`; sin llave → fuera, jamás inventar) y amplía la llave con
  `r.qrPayload` (kit T-2b — ADITIVO, D57).
- **2c:** `registrarEnviadaHistorico` export — **el ÚNICO punto donde el ledger crece**.
  Fallo de IDB → tragado (conservador). Si el cache del índice ya está construido, se
  actualiza **EN MEMORIA al instante** (mismo gesto — la re-subida de ESTA sesión
  matchea sin recargar; F1).
- **2d:** `marcarYaEnviada` **exportada** (hoy module-private) con:
  `ViaYaEnviada = "bytes" | "dhash" | "payload"` (valor NUEVO AL FINAL — D57);
  parámetro opcional `qrPayload?` estampado en el registro YA-ENVIADA (aditivo); y al
  final del éxito **alimenta el ledger** (`void registrarEnviadaHistorico(...)`) —
  cierra el gap de marcas contra filas enviadas pre-kit.
- **2e:** `enviadaPorPayload` export — lookup O(n) sobre el índice cacheado con
  **igualdad EXACTA** del payload (`h.payloadQr === payload` — llave opaca, jamás
  prefijos, RL-e65b-8); `if (!payload) return null`; catch → null conservador (M-e65b-6).

### T-3 — Hooks de ENVÍO (fire-and-forget, RL-e65b-2/3)

- **3a — envío propio** (`runner.ts`, rama `OPTIMA` → `status: "ENVIADA"`, tras
  `enviadaAuto = true`): registra `{id: fila.id, hashBytes: registro.hashBytes,
  hashDedup: registro.hashDedup, payloadQr: qrPayload ?? undefined,
  serie: identidad?.serie ?? registro.serie ?? undefined}` (M-e65b-7 — payload/serie
  VIVOS de la corrida).
- **3b — gemela reutilizada** (`reutilizarResultado`, tras `guardarRegistro(registroListo)`):
  misma llamada con las llaves del **REGISTRO DE LA GEMELA**, con guard
  `actaCopia.status === "ENVIADA"` (M-e65b-5).
- **3c — envíos manuales** (M-e65b-4 — la vía EXISTE y son DOS):
  1. **REVISIÓN** — `sincronizarAlVolver` (store.ts): si el dueño envió a mano el acta
     de una fila masiva (`actaNueva.status === "ENVIADA"`, identidad
     `registro.acta?.id === acta.id` ya verificada por el FIX C4), el hook alimenta el
     ledger con `id: origenAbierto`. El envío genérico del flujo normal NO se toca
     (fuera de whitelist — el hook vive en el punto donde la fila masiva ya es
     identificable).
  2. **LOTE ADVERTENCIA** — `enviarLote` (store.ts): tras `guardarRegistro({...registro,
     acta: actaEnviada})`, mismo hook con `id: fila.id`. Nota offline: si quedó «EN
     COLA» el status YA es `ENVIADA` — el MISMO criterio del índice
     (`acta?.status === "ENVIADA"`); coherente.
- Todos con `void … .catch(() => {})` — **jamás `await`**: el envío nunca espera al
  ledger (RL-e65b-3).

### T-4 — Capa 0 payload contra el histórico (`runner.ts`)

En el bloque capa 0, rama `if (!originalQr)` — **ANTES** de `registrarQrPayload`:

```ts
if (!fila.forzarDedupOff) {                       // RL-e65b-6 — el escape manda SIEMPRE
  const enviadaHist = await enviadaPorPayload(qrPayload);
  if (enviadaHist && enviadaHist.id !== fila.id &&  // M-e65b-8 — jamás apuntarse a sí misma
      (await marcarYaEnviada(fila.id, enviadaHist.id, "payload", undefined, undefined, qrPayload, true))) {
    console.info(`[e14] capa0-qr ya-enviada-historico ${payloadQrCorto} fila=${fila.id} hist=${enviadaHist.id}`);
    return; // sin OCR, sin envío — YA-ENVIADA jamás vuelve a siguientePendiente
  }
}
```

Traza consola: `capa0-qr ya-enviada-historico <payload corto> fila=… hist=…`.
**NOTA de cadenaDedup (verificada, cero cambios):** la capa bytes y la capa dhash YA
consultan `indiceEnviadasDe()` — con el índice fusionado (2b) quedan cubiertas por el
ledger SIN tocar su código; su log conserva la vía real (`YA-ENVIADA bytes/dhash …`).

### T-5 — `vaciar()` NO toca el histórico (REVERSA de D-e65-8 → **D-e65b-1**)

- `cola.ts vaciar()`: INTACTO (clear solo del store `archivos` de la cola).
- `store.ts vaciar()`: `indiceEnviadas = null` INTACTO — muere el **cache de sesión**,
  NO el histórico: el rebuild fusiona con el ledger (2b) → tras vaciar, el índice =
  histórico persistente (la prueba exacta del dueño: vaciar + re-subir los 46).
- `borrarHistorico()` existe pero SIN cablear a nada (RL-e65b-5).
- Cero código nuevo: comentario declarativo en el cuerpo de `vaciar()` + esta sección.

### T-6 — Docs y proceso

Este REPORTE, ROADMAP (sección e65b), worklog (append), y la adenda del QA e65 (§4).

---

## §3. Decisiones y micro-decisiones

| # | Decisión |
|---|---|
| **D-e65b-1** | **REVERSA de D-e65-8**: el histórico de enviadas SOBREVIVE la cola — «la cola es el taller, el envío es el hecho». El ledger vive en DB separada; `vaciar()` solo mata el cache de sesión (rebuild = cola + ledger). |
| **D-e65b-2** | DB separada `e14-masiva-historico-v1` (NO versionar `e14-masiva-v1`) — cero riesgo de migración; mismo patrón IDB de `cola.ts`; cero dependencias nuevas. |
| **D-e65b-3** | Índice FUSIONADO ledger+cola con re-put por `id`: la cola viva manda (más fresca — sus llaves incluyen los estampados de ESTA sesión), el ledger aporta lo que la cola ya no tiene (vaciar/recarga/otra pestaña). |

| # | Micro-decisión |
|---|---|
| **M-e65b-1** | El write YA-ENVIADA de `marcarYaEnviada` conserva la expresión e65 **byte a byte** (`hashBytes: hashBytes ?? registro.hashBytes`) — el QA e65 escanea ese bloque exacto (regresión cero); la ampliación viaja como spread aditivo DESPUÉS de `dedup: "ya-enviada"`. |
| **M-e65b-2** | El ledger NO es fatal en `indiceEnviadasDe()`: si `listarHistorico()` falla, el índice se construye SOLO con la cola viva (exactamente el comportamiento e65 — conservador, RL-e65b-3). El snippet del kit usaba `Promise.all` (ledger fatal); se adapta. |
| **M-e65b-3** | `marcarYaEnviada` gana parámetro opcional `aceptarProcesando` (default false): la capa 0 llega con la fila YA en `PROCESANDO` (marcada al entrar al pipeline) — el guard anti-zombi e65 exige `PENDIENTE`; con el flag se admite la PROPIA fila en proceso. El guard original queda INTACTO dentro del wrapper (el QA e65 escanea la línea literal). Solo el caller T-4 lo declara. |
| **M-e65b-4** | T-3c: la vía manual EXISTE — DOS puntos cableados (sincronizarAlVolver para REVISIÓN + enviarLote para el lote ADVERTENCIA), ambos con guard `status === "ENVIADA"`. El kit anticipaba «si no existe, NO inventar»: existe en `store.ts` (no en el envío genérico del flujo, que queda intocado por whitelist). |
| **M-e65b-5** | Guard RL-e65b-2 en T-3b: la gemela SOLO alimenta el ledger cuando el desenlace COPIADO es `ENVIADA` (el kit asumía gemela enviada; con original ADVERTENCIA la copia NO está enviada — jamás alimentar con no-enviados). |
| **M-e65b-6** | `enviadaPorPayload` conservador: catch → `null` (el snippet del kit no lo traía; un índice caído NO debe convertir la fila en ERROR — RL-e65b-3). |
| **M-e65b-7** | T-3a usa el payload/serie VIVOS de la corrida (`qrPayload ?? undefined` de la capa 0 + `identidad?.serie` de la capa 2) en vez de los del registro leído al inicio del pipeline (posible stale respecto a lo acabo de decidir). |
| **M-e65b-8** | Defensa en T-4: `enviadaHist.id !== fila.id` — jamás apuntarse a sí misma (en la práctica imposible: cada encolado nace con id nuevo, pero el guard es barato y honesto). |
| **M-e65b-9** | Adenda del QA e65 (`qa-dedup-enviadas.ts`, check «índice LIVIANO»): el scan esperaba `if (!r.hashBytes && !r.hashDedup) return null;` — la llave se amplió con `!r.qrPayload` POR EL PROPIO KIT (T-2b, ADITIVO D57). El intent del check está intacto («solo enviadas CON llave; sin llave → fuera») y el string actualizado declara la adenda en comentario. Mismo estilo de adenda que el PR #77. |

---

## §4. QA

### Red lines (RL-e65b-1..8) — verificadas por source-scan en `qa-historico-enviadas.ts`

1. Solo llaves en el ledger — ✓ (Bloque 1: scan del cuerpo del tipo, sin Blob/acta/dataURL).
2. Solo se alimenta de ENVIADOS — ✓ (Bloque 3: hook 3a tras `enviadaAuto = true`; 3b con guard `ENVIADA`; 3c con guard `ENVIADA`; marca YA-ENVIADA por construcción).
3. Conservador SIEMPRE — ✓ (catches en registrar/enviadaPorPayload/índice; fire-and-forget sin await).
4. Cero dependencias nuevas — ✓ (package.json sin entradas nuevas; IndexedDB vanilla).
5. `vaciar()` jamás borra el histórico — ✓ (Bloque 5; `borrarHistorico` sin import/callers).
6. `forzarDedupOff` manda sobre TODO — ✓ (guard T-4 + rama forzarDedupOff capa 0 + escape e65 intacto).
7. D57 aditivos AL FINAL — ✓ (`via "payload"` nuevo al final; `qrPayload` spread aditivo; `EntradaHistorica` nueva — sin reordenar nada existente).
8. Llaves jamás al envío/informe de contenido — ✓ (`registrarEnvioMasiva` sin llaves; informe sin `hashBytes` ni símbolos del ledger; serie SOLO informativa).

### Resultados

- **QA e65b:** `bun scripts/qa-historico-enviadas.ts` → **49/49 OK** (Bloque 1 T-1 ×10 · Bloque 2 T-2 ×11 · Bloque 3 T-3 ×5 · Bloque 4 T-4 ×7 · Bloque 5 T-5 ×4 · Bloque 6 invariantes ×12). Source-scan por SÍMBOLO (líneas reales de la rama) — nota honesta: el ledger es browser-only y NO corre headless; el end-to-end con IDB real (F1-F8 en navegador) queda para la mini-Fase D del dueño.
- **Regresión total (7 suites):** dedup-enviadas **42/42** (con la adenda M-e65b-9) · qr-identidad **68/68** · autoenvío **33/33** · escaneo-ya-recortado **24/24** · identidad-acta **30/30** · watchdog-relectura **34/34** — cero regresiones (e64 y e65 intactos).
- **Gates:** `tsc --noEmit` 0 · `eslint` 0 · package.json/bun.lock SIN cambios.

### Mapa F1-F8 → cobertura

| Factor | Cobertura |
|---|---|
| F1 misma sesión (bytes, ledger vivo) | T-3a + cache en memoria de `registrarEnviadaHistorico` + capa bytes e65 sobre índice fusionado (B2/B3) |
| F2 sobrevive VACIAR (prueba del dueño) | T-5: cola.clear() solo «archivos», store sin borrarHistorico, rebuild fusiona ledger (B5) |
| F3 sobrevive RECARGA | DB separada + índice fusionado + filaDeRegistro e65 intacto (B1/B2/B5/B6) |
| F4 re-foto sin OCR | T-4: enviadaPorPayload ANTES de registrarQrPayload → via "payload" → RETURN (B4) |
| F5 escape del dueño | guard `!forzarDedupOff` en T-4 + rama forzarDedupOff capa 0 + procesarIgual e65 (B4/B6) |
| F6 sin falsos positivos | igualdad EXACTA + ledger SOLO-ENVIADOS (4 guards) + sin llave → fuera (B2/B3/B6) |
| F7 gemelas mismo lote | lookup SOLO en rama `!originalQr` — el mapa de sesión e63m manda primero; reutilizarViaQr intacto (B4/B6) |
| F8 invariantes | YA-ENVIADA recarga · píldora esmeralda · informe yaEnviadas · llaves ausentes de envío/informe · pkg intacto · vaciar sin borrarHistorico (B5/B6) |

---

## §5. Commits (Conventional Commits, español — uno por tarea)

```text
7a3b5be feat(e14): e65b-historico-enviadas T-1 — ledger persistente de enviadas (DB separada, solo llaves, L7)
9df1cb5 feat(e14): e65b-historico-enviadas T-2 — índice fusionado ledger+cola, registro en envío, enviadaPorPayload, marcarYaEnviada exportada (+via payload)
8b88cf4 feat(e14): e65b-historico-enviadas T-3 — hooks de envío (runner propio + gemela reutilizada + manuales REVISIÓN/lote, fire-and-forget)
720ce9d feat(e14): e65b-historico-enviadas T-4 — capa 0 payload contra el histórico (re-fotos sin OCR, forzarDedupOff manda)
e30d7c2 feat(e14): e65b-historico-enviadas T-5 — vaciar NO toca el histórico (reversa D-e65-8, D-e65b-1)
28b1e63 fix(e14): e65b — write YA-ENVIADA conserva la expresión e65 (QA previa, regresión cero) + adenda del scan índice LIVIANO (llave qrPayload aditiva, kit T-2b)
74b9a83 test(e14): e65b-historico-enviadas QA headless F1-F8
docs    docs(e14): e65b-historico-enviadas REPORTE + ROADMAP + worklog (este commit)
```

Nota: el `fix(e14)` intermedio nació de la verificación de regresión del QA e65
(2 checks de source-scan estricto) — se resolvió conservando la expresión e65 del
write (M-e65b-1) y adendando el scan obsoleto por el propio kit (M-e65b-9).

---

## §6. Cómo probar (mini-Fase D del dueño — el objetivo final del kit)

1. **Fase D exacta (la prueba de producción):** VACIAR la cola + re-subir los 46 del
   lote en UN solo lote → **las 46 nacen YA-ENVIADA** (píldora esmeralda al instante,
   `totales.yaEnviadas = 46`, cero OCR, cero re-envío). Consola: traza
   `dedup fila=… YA-ENVIADA bytes …` (capa bytes contra el ledger).
2. **F4 (re-foto):** re-foto de un formulario ya enviado (bytes distintos, mismo QR),
   tras vaciar → consola `capa0-qr ya-enviada-historico …` y fila YA-ENVIADA en < 2 s
   (sin OCR).
3. **F5 (escape):** PROCESAR IGUAL sobre una YA-ENVIADA → reproceso COMPLETO (el
   escape manda sobre bytes, dhash y payload).
4. **F6:** un archivo jamás visto procesa normal (sin falsos positivos).
5. **Recarga:** recargar la página y re-subir → YA-ENVIADA igual (ledger persistente).

**Fuera de scope hoy (kits futuros):** acción del dueño para `borrarHistorico()`
(el helper ya existe, sin UI); sincronización del ledger entre dispositivos (es local
por diseño — el envío es local).
