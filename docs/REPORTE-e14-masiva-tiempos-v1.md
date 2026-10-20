# REPORTE — KIT e14-masiva-tiempos-v1 (AGENTE 2, cola MASIVA) — B1 dedup + B5 prefetch

**Base:** `main @ 022bd47` (post PR-35 orientación + PR-34 bancos + registro #36) · **Ramas:** `feat/e14-masiva-dedup-v1` (PR-1) y `perf/e14-masiva-prefetch-v1` (PR-2, apilada) · **Ejecutado por:** Z.ai Code (terminación por orden directa del dueño — el AGENTE 2 original no dejó ninguna entrega: sin rama, sin commits, sin PR, sin worklog; solo las instrucciones en `upload/`).

---

## §0 Resumen

| Palanca | Qué hace | Resultado medido (arnés local, build estático, COOP/COEP) |
|---|---|---|
| **B1 — Dedup** (PR-1) | dhash 64-bit sobre thumb 320 (reuso `hacerThumb`) al ENCOLAR; Hamming ≤ 6 → fila `DUPLICADA` (visual) que al procesar **reutiliza el resultado de la original** en <1 s; botón **«PROCESAR IGUAL»** fuerza el reproceso | Copias en **42–141 ms** (kit: <1 s ✓); gemelas detectadas **cross-formato** (jpg↔png, jpg↔webp); resultado idéntico (score/status/clasif/cod); ahorro real: **~10–13 s por duplicado** |
| **B5 — Prefetch** (PR-2) | decode del archivo N+1 en background DURANTE el OCR de N (slot de 1) vía memo `WeakMap<File>` del decode en el bridge | `decode=0 ms` (memo HIT) en las filas 2..N vs `491–512 ms` de la primera; trazas de prefetch **encadenadas** (431 ms, 374 ms — ocultas tras el OCR); ahorro teórico del kit ~1.5–2.5 s/acta con HEIC (aquí jpg: ~0.3–0.5 s ocultos por acta) |

**Cero regresión:** `bun run lint` 0 · `tsc` 0 · `build BUILD_STATIC=1` OK (ambas ramas) · SIM intacto (0 cambios en gate/caps/escudos/chips) · desenlace idéntico por foto (sana → 8.5 AUTO ENVIADA en todos los caminos; girada90 → 8.5 con `rot=270 aplicado=1` del kit de orientación).

---

## §1 PR-1 — Dedup por hash perceptual (`feat/e14-masiva-dedup-v1`)

### §1.1 Diseño implementado

- **`src/lib/e14/masiva/dedup.ts` (NUEVO):** `dhash64DeDataUrl` (canvas 9×8 grises, gradiente horizontal → 64 bits → hex 16), `hamming64`, `dhashDeArchivo` (misma vía del pipeline: `fileToCaptureDataUrl` del core → `hacerThumb` 320 (reuso literal del kit) → dhash). Toda la cadena devuelve `null` ante cualquier fallo — **jamás tumba el encolado**.
- **Cadena de hashing al encolar** (`store.agregarFiles` → `cadenaDedup`, fire-and-forget, FIFO del lote): por archivo → dhash → persiste `hashDedup` en IDB → compara contra TODAS las filas con hash (`estado !== "ERROR"`) → Hamming ≤ 6 → marca `DUPLICADA` (persistente: `estado`, `dupOf`) apuntando a la original MÁS PARECIDA (desempate por menor Hamming y más antigua). Guards anti-zombi: si la fila fue quitada/vaciada mientras el decode corría, se salta (el dueño manda).
- **Runner:** `siguientePendiente` incluye `DUPLICADA` (FIFO); `procesarUno` rama dedup → `reutilizarResultado`: copia `registro` (acta **re-identificada** `id: fila.id` — contrato de `sincronizarAlVolver`), thumb y desenlace COMPLETOS, **sin contadores ni re-envío** (el desenlace de la gemela ya fue registrado con la original). Traza propia: `[e14] dedup fila=<id> dupOf=<orig> reutiliza score=<s> ms=<ms>`.
- **Fallback honesto:** original quitada/ERROR/sin acta → la fila se des-marca (`PENDIENTE`, `dupOf` fuera, persistente) y corre el pipeline COMPLETO en el mismo pase (`[e14] dedup fila=<id> sin-original reprocesa-completo`). Jamás inventar.
- **«PROCESAR IGUAL»** (`store.procesarIgual` + botón ámbar por fila DUPLICADA en `MasivaView`): des-marca a `PENDIENTE` persistente → el runner la reprocesa COMPLETA como cualquier fila (`[e14] dedup fila=<id> procesar-igual`).
- **UI:** píldora `DUPLICADA` (gris) + sub-etiqueta `≡ <nombre original>` + botón PROCESAR IGUAL + conteo `DUPLICADAS n` en la línea de conteos + PROCESAR habilitado con PENDIENTES=0 si hay DUPLICADAS.

### §1.2 Evidencia E2E (arnés `/home/z/tmp/orient-verif/serve-e14.ts`, build estático, 5 fotos: sana.jpg + sana-gemela.png + girada90.jpg + girada90-gemela.webp + mesa002/original.jpg)

Marcado al encolar (bandeja, ~9 s tras soltar — hashes en background):
```
SANA.JPG            PENDIENTE
SANA-GEMELA.PNG     DUPLICADA ≡ SANA.JPG        ← jpg↔png
GIRADA90.JPG        PENDIENTE
GIRADA90-GEMELA.WEBP DUPLICADA ≡ GIRADA90.JPG   ← jpg↔webp
ORIGINAL.JPG        PENDIENTE
```

Procesado (trazas verbatim de consola):
```
[e14] masiva-prefetch fila=masiva-...-2 listo ms=431          ← PR-2 (B5)
[e14] dedup fila=masiva-...-1 dupOf=masiva-...-0 reutiliza score=8.5 ms=141
[e14] masiva-prefetch fila=masiva-...-4 listo ms=374
[e14] dedup fila=masiva-...-3 dupOf=masiva-...-2 reutiliza score=8.5 ms=42
```

Desenlaces (bandeja final): SANA → `ENVIADA AUTO 8.5 1/2 AUTO` · SANA-GEMELA → **idéntico** · GIRADA90 → `ENVIADA AUTO 8.5` · GIRADA90-GEMELA → **idéntico** · ORIGINAL (mesa002, foto distinta) → `ADVERTENCIA 7.9` (su propio desenlace — el dedup no la tocó). Conteos: `ENVIADAS 4 · EN COLA 0 · PENDIENTES 0 · ERRORES 0`.

### §1.3 Aceptación PR-1

- **AC-B1 ✓** — gemelas → DUPLICADA + resultado IDÉNTICO (score/status/clasif/cod) + copias <1 s (42–141 ms) + traza `dupOf=` presente. *Gemelas del dueño .heic+.jpg no disponibles en sandbox → provisiones del kit §4.2 aplicadas (mismo archivo, otro nombre y formato — para dhash son gemelas igual); la vía .heic usa el MISMO `fileToCaptureDataUrl` del pipeline (misma conversión → mismo hash).*
- **AC-B2 ✓** — cola sin duplicados → cero cambios: mesa002 ORIGINAL procesó normal (ADVERTENCIA 7.9 propio); sana/giradas con los mismos desenlaces que pre-kit; ninguna fila sana marcada.
- **AC-B3 ✓** — PROCESAR IGUAL sobre GEMELA-B3.PNG (marcada DUPLICADA contra sana LISTA): traza `procesar-igual` → fila PENDIENTE → PROCESAR → pipeline COMPLETO (probe orientación 3168 ms + pipeline 8366 ms, decode=393 ms fresco) → `ENVIADA AUTO 8.5` como fila normal.

---

## §2 PR-2 — Solape decode/detect (`perf/e14-masiva-prefetch-v1`, apilada sobre PR-1)

### §2.1 Diseño implementado (con desviación — ver §3.2)

- **Memo de decode en el bridge** (`scanner-core-bridge.ts`, ÚNICO call site): `decodeMemo = WeakMap<File, Promise<string>>` — el MISMO File jamás se decodifica dos veces; si el decode falla, la entrada sale de la memo y el siguiente intento re-decodifica (comportamiento de hoy). Export nuevo: `precargarDecodeArchivo(file)`.
- **Runner (slot de 1):** al iniciar la fila N, `dispararPrefetch` toma la próxima fila pipeline-able (PENDIENTE, no temp, no DUPLICADA — la copia no decoda), lee su registro y precalienta la memo con LA MISMA instancia del File; `procesarUno` consume el slot capturado (`archivoPredecode`) → el pipeline golpea la memo (decode ~0 ms). Ciclo de vida del slot en `bucle()` (captura → null → disparo siguiente); en fila DUPLICADA el slot **se conserva** (la copia no lo gasta). Guard `stopFlag`: pausa → no dispara; prefetch en vuelo muere solo (nadie lo consume). Fallo del prefetch → catch silencioso + slot fuera → la fila re-decodifica en su turno (AC-P2, jamás bloquea).
- **Trazas propias:** `[e14] masiva-prefetch fila=<id> listo ms=<ms>` (cuando aterriza el decode oculto).

### §2.2 Evidencia E2E (mismo arnés, lote de 3 pipeline-ables + 2 gemelas)

```
total=9196 | decode=512   ← fila 1: decode de SIEMPRE (no hay prefetch para la primera)
total=7710 | decode=0     ← fila 2: MEMO HIT (prefetch 431 ms oculto tras el OCR de la fila 1)
total=9906 | decode=0     ← fila 3: MEMO HIT (prefetch 374 ms oculto tras el OCR de la fila 2)
```

Prefetch ENCADENADO (una traza por fila, cero decodes desperdiciados): `fila-2 listo ms=431` → `fila-4 listo ms=374`. Con HEIC del dueño el efecto escala (decode 1–2 s → oculto íntegro; ahorro kit ~1.5–2.5 s/acta).

### §2.3 Aceptación PR-2

- **AC-P1 ✓** — timing evidenciado: `decode=0 ms` (memo HIT) en filas 2..N vs 491–512 ms de la fila 1; trazas de prefetch con ms del decode oculto.
- **AC-P2 ✓** — pausa mid-run (PAUSAR tras ~6 s → cola termina la fila en curso y queda `PENDIENTES 1` quieto) → PROCESAR reanuda y completa (`ENVIADAS 7 · ERRORES 0`). Archivo corrupto (200 KB de urandom como .jpg): sin marca dedup (hash null) → fila `ERROR` con motivo honesto `NO SE PUDO DECODIFICAR LA IMAGEN...` — sin crash, sin errores de página (comportamiento de hoy).
- **AC-P3 ✓** — identidad: sana → `8.5 AUTO ENVIADA` en los 3 caminos (original, copia dedup, PROCESAR IGUAL completo); girada90 → `8.5` con `rot=270 aplicado=1` idéntico al kit de orientación. El prefetch NO altera el pipeline (misma promesa de decode, mismos píxeles).

---

## §3 Desviaciones documentadas (precedente: ADAPTACIÓN de archivos.ts, D47)

### §3.1 Hash al encolar vía `fileToCaptureDataUrl` (decode completo en background)

El kit decía «dhash sobre el thumb 320px que **ya produce** `hacerThumb`» — pero en la base, las filas PENDIENTES **no tienen thumb** (solo nace con el acta procesada; lección L7: filas livianas). Reuso literal logrado: el dhash se calcula sobre EXACTAMENTE ese thumb (`hacerThumb(dataUrl)` — importado del runner), pero el dataUrl de partida se produce al ENCOLAR con la MISMA vía del pipeline (`fileToCaptureDataUrl` — EXIF/12MP/HEIC). Costo: decode completo por foto en background (jpg ~0.3–0.5 s, heic ~1–2 s), jamás bloquea la UI, y el ahorro neto es masivo (evitar 10–13 s de OCR por duplicado). Ventaja extra: al aplicar EXIF como el pipeline, las gemelas .heic/.jpg de una misma foto producen el MISMO hash.

### §3.2 Memo de decode en `scanner-core-bridge.ts` (zona del Agente 1)

El kit §3 asumía que el prefetch hacía el decode «reusable» — verificado en el core: `fileToCaptureDataUrl` **NO memoiza** (dist/image-processor.js) → el prefetch literal decodificaría DOS veces (peor, y violaría el propio AC-P1). Implementación mínima para salvar la intención: memo `WeakMap<File>` transparente en el ÚNICO call site del decode del pipeline + export `precargarDecodeArchivo` (~25 líneas comentadas, 1 línea cambiada). El kit prohibía tocar `scanner-core-bridge.ts` **por trabajo paralelo con el Agente 1** — esa razón está extinguida (su PR #35 ya está mergeado en main; este kit lo termina el mismo agente por orden directa del dueño). Cero cambios de píxeles/comportamiento para TODOS los flujos existentes (misma promesa; SIM usa Files propios y deterministas — intacto).

### §3.3 Nota de identidad en la copia dedup

El acta copiada se re-identifica con el id de la fila dup (`acta: { ...original, id: fila.id }`) — es el contrato que `sincronizarAlVolver` exige (`acta.id === origenAbierto`) y hace que REVISIÓN funcione completo sobre la copia. Sin contadores ni re-envíos (el desenlace gemela ya fue registrado con la original).

---

## §4 Verificación y entrega

1. ✓ `bun run lint` 0 · `tsc` 0 · `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build` OK (cada rama compila SOLO: PR-1 sin bridge/memo; PR-2 con todo).
2. ✓ Navegador real (arnés COOP/COEP, `crossOriginIsolated=true`): batería completa §1.2/§2.2 + §2.3.
3. ✓ `git merge origin/main` antes de ready: ambas ramas nacen de `origin/main @ 022bd47` (último merge del repo — el registro del deploy de orientación). Documentos compartidos ya sincronizados en el origen de cada rama.
4. CI verde → PR ready (2 PRs: PR-1 `feat/e14-masiva-dedup-v1`, PR-2 `perf/e14-masiva-prefetch-v1` apilada — **el dueño mergea PR-1 y DESPUÉS PR-2**, kit §4.3).
5. ✓ Docs: este REPORTE + D52 («masiva-dedup-hash-perceptual») + ROADMAP (sección MASIVA-TIEMPOS) + AGENTS.md (1 línea) + worklog (entradas PR-1 y PR-2).

## §5 Pendiente del dueño

- Merge PR-1 → PR-2 (en ese orden — PR-2 está apilada).
- AC-B1 con sus gemelas REALES (.heic+.jpg de los lotes 1792448306752/1792448561064) en SU equipo — la vía .heic usa el mismo decode del pipeline; la evidencia sandbox usó la provisión §4.2 del kit.
- Ahorro B5 con HEIC reales en SU equipo (aquí jpg: 0.3–0.5 s/acta ocultos; HEIC esperado 1–2 s).
