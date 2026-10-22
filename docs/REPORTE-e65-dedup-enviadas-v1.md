# REPORTE e65-dedup-enviadas-v1 — NO reprocesar imágenes ya enviadas (por defecto)

**Fecha:** 2026-10-22 · **Base:** `main @ 030dff9` (post e64-qr-v1, PR #74) — base del kit VERIFICADA en remoto ✓
**Rama:** `feat/e65-dedup-enviadas-v1` · **Kit:** `PLAN-e65-dedup-enviadas-implementacion-agente-v1`
**QA:** `scripts/qa-dedup-enviadas.ts` **42/42** + suite previa 68/68 · 33/33 · 24/24 · 30/30 · 34/34 (cero regresiones)

---

## 1. Qué entrega

Al encolar archivos en MASIVA, si el contenido ya existe en un registro cuyo acta está
**ENVIADA** (misma cola persistente, aunque la fila original ya no esté viva), la fila nace
**YA-ENVIADA**: chip esmeralda en la bandeja, **cero decodificadores, cero OCR, cero envío**.

Cadena de dedup de encolado ampliada (background, sin bloquear UI):

| Orden | Capa | Contra quién | Coste | Desenlace |
|---|---|---|---|---|
| ① | **BYTES (nueva — SHA-256)** | índice histórico de enviadas + cola viva enviada | ~10-200 ms, sin decode | **YA-ENVIADA** (ni siquiera decodifica) |
| ② | dhash (D65, intacta) | filas vivas (hoy) **+ índice histórico** (nuevo) | decode + hash | cinta cierta → **YA-ENVIADA** si la original fue ENVIADA, **DUPLICADA** si no (hoy) |
| ② | banda 3..6 (e63k, intacta) | — | — | sin marca → pipeline → capa 2 decide (hoy) |
| ③ | identidad (e63k, intacta) | filas vivas post-OCR | OCR | DUPLICADA (hoy) |

Escape SIEMPRE: **PROCESAR IGUAL** sobre YA-ENVIADA → PENDIENTE + `forzarDedupOff` +
`enviadaDe` fuera → reproceso completo real (doctrina e63k intacta).

## 2. Decisiones declaradas (del kit + micro-decisiones propias)

- **D-e65-1..8 del kit: implementadas tal cual** (ver comentarios in-código con el tag
  `e65-dedup-enviadas-v1` y las red lines RL-e65-1..8 verificadas por QA Bloque 4).
- **M-e65-1 — `marcarYaEnviada()` helper** (kit escribía el bloque inline en el loop):
  misma semántica, un solo lugar con el patrón anti-zombi completo (fila viva + PENDIENTE +
  registro leíble + write IDB OK → `false` conservador). La usan la capa bytes (2 llamadas)
  y la capa dhash (1 llamada) — cero duplicación de guards.
- **M-e65-2 — Desempate del índice histórico**: el candidato histórico gana SOLO si es
  estrictamente más cerca (`d < hamming`); empate → la viva manda (FIFO — comportamiento
  de hoy). El kit no definía el empate; se declara aquí.
- **M-e65-3 — `dedupDistancia` en YA-ENVIADA-by-dhash**: la distancia escrita en el write #2
  permanece (es factual del match). En YA-ENVIADA-by-bytes no hay distancia (no se inventa).
- **M-e65-4 — `hashBytes` restaurado SIEMPRE en `filaDeRegistro`** (kit literal); `enviadaDe`
  SOLO cuando el estado es YA-ENVIADA (SOLO-VISUAL — no contamina filas vivas normales).
- **M-e65-5 — Índice de sesión y envíos posteriores**: el índice se carga UNA vez por sesión
  de encolado (D-e65-3); lo que se envía DESPUÉS de la carga queda cubierto por las filas
  vivas (bytes con verificación de registro + dhash como hoy) — cero hueco, sin recargar IDB.
- **M-e65-6 — QUITAR de una enviada con índice cargado**: puede quedar una entrada stale →
  un re-encolado marca YA-ENVIADA apuntando a un registro quitado. Benigno (SOLO-VISUAL,
  escape PROCESAR IGUAL disponible); se declara, se no se compensa (misma tolerancia del
  mapa de identidad e63k de sesión).

## 3. Desviaciones del kit (todas declaradas)

1. **tsc transitoriamente rojo entre T-2 y T-7/T-8**: añadir un valor a `EstadoEntrada` y a
   la unión `dedup` rompe mecánicamente el switch exhaustivo de `pildoraDe` (MasivaView) y la
   unión de `FilaInforme` (informe). Es la consecuencia del contrato D57 con el mapa de
   commits del kit (una tarea = un commit). Verde desde T-7; gates finales 0 errores.
2. **T-5 es un commit de verificación** (cero código de runner): la invariant
   «`siguientePendiente` solo toma PENDIENTE/DUPLICADA → YA-ENVIADA jamás entra» se
   documenta en el docstring de la función y se verifica por QA (Bloque 3).

## 4. QA (headless, estilo e64)

`bun scripts/qa-dedup-enviadas.ts` — **42/42**:

- **Bloque 1 (runtime — la capa nueva corre de verdad):** vector SHA-256('abc') exacto vs
  `node:crypto` · determinismo (mismos bytes → mismo hash, otro File) · contenido distinto →
  hash distinto (F4) · 8 MB en **10 ms** (orden del kit) · `subtle` ausente → **null
  conservador** sin throw (RL-e65-3).
- **Bloque 2 (source-scan cadenaDedup):** bytes PRIMERO (antes del dhash) · match bytes →
  `continue` sin dhash (F1: cero decode) · match contra viva SOLO si el registro está
  ENVIADO (F7-guard) · índice LIVIANO sin Blob/acta (L7) · amplificación con la misma cinta
  (D-e65-6) · banda 3..6 resuelta ANTES de la decisión YA-ENVIADA (F6) · decisión por
  lectura del registro original (F7) · original-del-índice → YA-ENVIADA por construcción
  (F3) · hashBytes en el MISMO write del hashDedup (F4/D-e65-4) · guards anti-zombi ·
  YA-ENVIADA NO copia acta (RL-e65-2) · marca DUPLICADA byte-idéntica (F7).
- **Bloque 3 (F1-F8 wiring):** recarga (F2) · vaciar invalida índice (F8) · procesarIgual
  extiende (F5) · runner excluye YA-ENVIADA (F5) · píldora/chip/contador/terminadas/botón
  (T-7) · colaVida intacta · informe export-only + `yaEnviadas` en totales + JAMÁS exporta
  `hashBytes` (RL-e65-1).
- **Bloque 4 (red lines):** D57 aditivos AL FINAL (EstadoEntrada, unión dedup, últimos
  campos de Fila/Registro) · igualdad EXACTA `===` sin prefijos · `DEDUP_HAMMING_MAX=6`
  byte-idéntico · SHA-256 vive SOLO en dedup.ts · **cero dependencias nuevas** · cola.ts
  intacto.

**Nota honesta:** `cadenaDedup`/`marcarYaEnviada` viven en store.ts (`"use client"` + IDB) y
no corren headless — su semántica se verifica por source-scan por símbolo (líneas reales de
la rama) y la capa bytes se ejercita runtime. El flujo end-to-end en navegador (F1-F8 con
IDB real) queda para la mini-Fase D del dueño (§6).

## 5. Gates

- `bunx tsc --noEmit` → **0 errores** · `bun run lint` → **0 errores**
- Build estático `NEXT_PUBLIC_BASE_PATH=/digielect14` → **OK** (ruta `/` prerenderizada)
- QA: e65 **42/42** · qr-identidad **68/68** · autoenvío **33/33** · escaneo **24/24** ·
  identidad-acta **30/30** · watchdog **34/34**
- `package.json`/`bun.lock` **sin cambios** (RL-e65-8)

## 6. Cómo probar (mini-Fase D del dueño, navegador)

1. **F1:** con una cola que tenga un registro ENVIADA → soltar el MISMO archivo → la fila
   nace **YA ENVIADA** (chip esmeralda) en <1 s, consola
   `[e14] dedup fila=… YA-ENVIADA bytes dupOf=…`, cero `decodeMs`/`procesoMs`.
2. **F2:** recargar la página → la fila sigue YA ENVIADA (persistida + restaurada).
3. **F3:** re-encolar un archivo cuyo registro enviado es PREVIO al kit (sin hashBytes) →
   match por dhash Hamming 0 → YA-ENVIADA (`dhash hamming=0`).
4. **F4:** archivo NUEVO → PENDIENTE → procesa → LISTA (flujo de siempre; su `hashBytes`
   quedó estampado — el próximo re-encolado matchea por bytes).
5. **F5:** PROCESAR IGUAL sobre la YA-ENVIADA → PENDIENTE → reproceso completo real → LISTA.
6. **F6/F7:** banda 3-6 sigue aplazada (capa 2 decide); original en cola SIN enviar →
   DUPLICADA como hoy.
7. **F8:** VACIAR + re-encolar → TODO reprocesa (límite documentado D-e65-8).
8. **Informe:** las filas YA-ENVIADA exportan `estado: "YA-ENVIADA"`, `dedup: "ya-enviada"`;
   `totales.yaEnviadas` las cuenta; `hashBytes` jamás aparece.

**Escenario real del dueño (kit §7):** re-encolar el lote 21-oct (38 enviadas + 4 fallidas)
→ las 3 gemelas de QR fallidos (imagen9/durazno7/durazno8) quedan YA-ENVIADA por dhash 0
(sin perder nada — el payload vive en su gemela, evidencia bench12) y `20261021_160922.jpg`
reprocesa completo y con e64 ahora sí lee su QR (`+TENTeAA…`). Si quiere el QR estampado en
una gemela específica → PROCESAR IGUAL sobre esa fila.

## 7. Fuera de alcance (v1, kit §8)

- Cementerio de enviadas que sobreviva `vaciar()` (el histórico vive SOLO en la IDB del
  dispositivo).
- Mapa QR histórico persistente (capa 0 contra registros viejos) — fase futura.
- Guard JPEG-camuflado (durazno7/8: JPEG con extensión `.heic`) — kit aparte.
