# REPORTE — HOTFIX veto ya-enviada post-OCR v1 (H1 + H2)

**Branch:** `fix/ya-enviada-veto-postocr-v1` · **Base:** `main` = `57a235a` (post PRs #101/#102)
**Kit:** `HOTFIX-capa3-veto-postocr-v1.md` · **Territorio:** `masiva/runner.ts` (+ recalibración aditiva de 1 ancla QA) · **Prioridad electoral.**

---

## 0 · El hueco de campo (lote 3 — 2 escapes / 27 atrapados)

`imagen10.jpg` y `20261021_160932.jpg` se **RE-ENVIARON** con payload QR byte-idéntico al de
enviadas del lote 2. Causas raíz verificadas en `57a235a`:

1. **Rutas capa0→envío sin re-consulta del ledger.** El guard T-4 (`enviadaPorPayload` →
   `marcarYaEnviada` → `return`, runner L543-562) solo corre en `if (!originalQr)`. Las rutas
   que llegan al desenlace CON payload en mano por otra puerta — fallback
   `reutilizarResultado=false`, original `PENDIENTE/ERROR`, techo-vencido de la APLAZADA —
   **envían sin volver a consultar el histórico**.
2. **Ledger T-3a con llaves viejas (carrera ingesta×pipeline).** `registro` se lee al ENTRAR al
   pipeline (L427); `cadenaDedup` persiste `hashDedup`/`hashBytes` DESPUÉS (L562-563 del store).
   El write del ledger usaba el snapshot → `hashDedup: undefined` → el cinturón
   **D-e65-6 saltaba la entrada** (`if (!h.hashDedup ...) continue`, store L535) → una copia
   re-saved a Hamming 0 de una enviada no era atrapada en ingesta (caso imagen10).

---

## 1 · H1 — veto de payload post-OCR en el punto único de envío

`runner.ts`, DENTRO de `if (actaDesenlace.status === "OPTIMA")`, ANTES de
`registrarEnvioMasiva` (el veto devuelve y jamás llega al envío ni al stamp `ENVIADA`):

```ts
const diagQr =
  qrPayload ?? actaDesenlace.qrPayload ?? registro.qrPayload ?? null;
if (diagQr && !fila.forzarDedupOff) {
  const enviadaPostOcr = await enviadaPorPayload(diagQr);
  if (enviadaPostOcr && enviadaPostOcr.id !== fila.id) {
    if (await marcarYaEnviada(fila.id, enviadaPostOcr.id, "payload",
        undefined, undefined, diagQr, true)) {
      logger.info(`[e14] veto ya-enviada post-ocr ${qrCorto(diagQr)} fila=${fila.id} hist=${enviadaPostOcr.id}`);
      return; // sin envío — el OCR pagado es costo hundido (caso raro)
    }
  }
}
```

- **Misma llave exacta y misma maquinaria** de capa0-qr T-4 (`marcarYaEnviada` via `"payload"`,
  `aceptarProcesando=true` — la fila está `PROCESANDO` al llegar al desenlace). Sin fuzzy
  (RED LINES 5/10). Jamás se apunta a sí misma. `forzarDedupOff` manda SIEMPRE (RL-e65b-6).
- Índice caído → `enviadaPorPayload` → `null` conservador → la fila sigue su curso (RL-e65b-3).

### ADAPTACIÓN DECLARADA (árbol real vs kit)

El kit redacta el veto con `actaFinal.diagnostico?.qrPayload ?? actaFinal.qrPayload` y atribuye
la recuperación post-OCR al «stage de identidad del bridge» (`diag.qrPayload`). **En `57a235a`
esa vía no existe**: `DiagnosticoActa` no declara `qrPayload` y el bridge OMITE `qrCam` en
masiva (`scanner-core-bridge.ts` L1155-1157 — «la capa 0 del runner manda en masiva»). Las
fuentes REALES del payload en el punto de envío son:

1. `qrPayload` — la capa 0 de ESTA corrida (decodificarQrDeCapture sobre el original);
2. `actaDesenlace.qrPayload` — futuro-proof (hoy `undefined` en masiva; existe en el tipo);
3. `registro.qrPayload` — payload persistido por una pasada previa del MISMO registro
   (ERROR/DUPLICADA reprocesada — recovery honesto).

El comportamiento pedagógico del kit (consultar el ledger post-OCR con la MISMA llave exacta
antes de estampar el envío) queda intacto; lo que cambia es de dónde se lee el payload, y esa
desviación está documentada aquí y en el comentario del código.

---

## 2 · H2 — el ledger lleva las llaves frescas de la fila

```ts
const filaViva = useMasivaStore.getState().filas.find((f) => f.id === fila.id);
void registrarEnviadaHistorico({
  id: fila.id,
  ts: Date.now(),
  hashBytes: filaViva?.hashBytes ?? registro.hashBytes,
  hashDedup: filaViva?.hashDedup ?? registro.hashDedup,
  payloadQr: qrPayload ?? undefined,
  serie: identidad?.serie ?? registro.serie ?? undefined,
}).catch(() => {});
```

- Sin campos nuevos: se COMPLETA la escritura de campos ya declarados
  (`EntradaHistorica.hashDedup/hashBytes`). Fallback al snapshot si la fila viva ya no está
  (conservador — mismo valor que hoy).
- La marca YA-ENVIADA (veto y capa0) ya alimentaba el ledger con registro fresco
  (`marcarYaEnviada` re-lee en store.ts) — no se tocó.
- Efecto (smoke #1 del kit): la próxima re-subida de una copia re-saved (bytes ≠, píxeles =)
  cae por **dhash-vs-histórico en INGESTA** (Hamming ≤ 6) aunque el QR jamás decodifique.

---

## 3 · QA — recalibración ADITIVA (1 ancla)

`scripts/qa-historico-enviadas.ts` T-3a grepeaba el hook del ledger byte-exacto con las llaves
del snapshot. H2 lo cambia por mandato del propio kit → ancla recalibrada a la nueva forma
byte-exacto (misma semántica: fire-and-forget, payload/serie vivos) y el mensaje ahora documenta
la recalibración. **Ninguna otra ancla tocada**: qa-dedup-enviadas 50/50, qa-qr-identidad 72/72,
qa-watchdog-relectura 34/34, qa-autoenvío 33/33, qa-identidad-acta 32/32, qa-escaneo 24/24,
obs×4 verde — el literal `"YA-ENVIADA"` sigue ausente de runner.ts (D-e65-7).

## 4 · Tests (vitest — `runner-veto-postocr.test.ts`, 6, patrón runner-rechequeo)

1. **H1 hit real**: payload del registro de una ENVIADA (capa 0 falló — caso campo) →
   NO hay envío, fila `YA-ENVIADA` (enviadaDe al hist), traza `veto ya-enviada post-ocr`,
   la marca alimenta el ledger (T-2d) y `registrarEnvioMasiva`/`horaEnvio` jamás corren.
2. **Payload nuevo** → envío normal byte-idéntico (`registrarEnvioMasiva` 1×, LISTA/ENVIADA).
3. **Índice caído** (`listarHistorico` rechaza — RL-e65b-3 REAL, no mock de la llave) → envío normal.
4. **forzarDedupOff** con la ENVIADA en el ledger → el veto ni consulta (`listarHistorico` sin
   llamadas), cero marca YA-ENVIADA, el envío del dueño sale (RL-e65b-6).
5. **H2**: registro stale sin llaves + fila viva con hash → la entrada del ledger lleva
   `hashDedup`/`hashBytes` NO vacíos (regresión exacta del caso imagen10).
6. **Orden fuente**: veto entre el bloque OPTIMA y `registrarEnvioMasiva`; sin literal
   `"YA-ENVIADA"` en runner; bloque capa0 T-4 byte a byte; ledger fire-and-forget (sin `await`).

**NOTA DE INFRA (hallazgo del kit):** `store.ts` importa `./runner` (cículo histórico del SPLIT
C1). Un `vi.mock("./store", …)` con `importOriginal` re-entra en el ciclo y deja al runner
enlazado al store REAL mientras el test ve el mock (el veto se ejecuta y el mock registra 0
llamadas). Por eso `./store` queda REAL al 100 % y solo se mockea la hoja `./historico` — la
vía del índice es la real (`listarHistorico → indiceEnviadasDe → enviadaPorPayload`).

## 5 · Gate

`tsc` ✓ · `lint` ✓ (0 warnings) · `vitest` **215/215** ✓ · `qa-*` **306/306** ✓ ·
`build` (Next 16 Turbopack) ✓ · `knip` ~38+19 (baseline, no rompe) —
`bash scripts/check-quality.sh` → **TODO VERDE** sobre el árbol commiteado.

## 6 · Fuera de alcance (intacto)

Capa BYTES, capa0-qr, cadenaDedup, D-e65-6, `PROCESAMIENTO_CONCURRENTE`, flags, orientación,
informe, y la branch C (`feat/informe-reuso-tier-v1` — no pisa runner.ts, sin conflicto).
El re-chequeo B1 del wave-2 NO va en este branch (merge PRIMERO — orden §4 del kit).
La acción del dueño (§3 del kit — deduplicar en destino los 2 re-envíos ya salidos) es fuera
de código.
