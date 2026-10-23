# REPORTE — Hotfix e72 · Guard de ingesta × pool + P2.1-v2 (el veredicto de contenido manda sobre el envío)

**Rama**: `fix/e72-guard-dedup-v1` · **Base**: main @ `6fdfeb2` (e71, PR #87) — EXACTA contra el remoto.
**Disparador**: smoke test EN VIVO del dueño (post-e71) — race condition detectada y diagnosticada por el dueño con evidencia de consola e informe.

---

## §0 Resumen

El smoke en vivo del dueño validó e71 (P3.1 `yaEnviadas: 5` ✓ · P9 `almacenamientoMB: 37.5` ✓ · P2.1 herencia DUPLICADA en el flujo tradicional ✓) y destapó UNA race entre Opt-1 (dedup SHA-256 en la ingesta) y Opt-3 (pool de 2 workers): **imagen10** (gemela exacta de imagen9, mismo archivo) fue marcada `instantanea sha256 dupOf=imagen9` en la ingesta, pero el runner la tomó igual, le pagó **32 s de OCR** (`totalMs: 32219`) y el desenlace la dejó **ENVIADA** (con la traza `dedup: "v2"` puesta) en lugar de DUPLICADA.

El hotfix cierra la race por DOS planos (ambos en `masiva/runner.ts` — cero toques en store/cola/bridge):

1. **Guard de ingesta × pool** — la rama DUPLICADA, al fallar la copia porque la original VIVE pero aún no tiene desenlace, **ESPERA** su desenlace (sondeo ligero acotado) y re-copia. El duplicado JAMÁS paga OCR.
2. **P2.1-v2 (desenlace-contenido)** — si una fila llega AL DESENLACE con el veredicto de contenido puesto (traza `v2` de cadenaDedup o gemela EXACTA por `hashBytes` ya LISTA), el envío **NUNCA** corre: se resuelve por la maquinaria P2.1 o, sin original resoluble, DUPLICADA con su propio desenlace (revisión disponible).

Más: **tiempos propios de la copia** (criterio del dueño: el informe del duplicado muestra `totalMs ≈ 0` y `ocrMs = 0`, no los heredados del original).

Gates: **tsc 0 · lint 0 · 7/7 suites QA (33·50·24·49·32·72·34 = 294 checks — adenda honesta en qa-qr-identidad)** · `package.json`/`bun.lock` INTACTOS.

---

## §1 M-e72-0 — Recon: la anatomía exacta de la race

**Secuencia del dueño (imagen9 + imagen10 idénticas en un lote EN VUELO):**

1. `agregarFiles` crea las filas PENDIENTE al instante (temps) → hash SHA-256 secuencial (~68 ms/file) → `agregarLote` (swap temp→id, `hashBytes` en el primer write) → **`dedupExactoIngesta`** marca imagen10 `DUPLICADA dupOf=imagen9` (log `[e14] dedup fila=… instantanea sha256 dupOf=…`) — PERO el pase es ASINCRÓNICO (awaits de `indiceEnviadasDe`/`leerRegistro`) y el **pool del runner ya estaba corriendo** (imagen5 en worker1): la reserva de la siguiente fila (`siguientePendiente`, que toma `PENDIENTE` **o `DUPLICADA`** por diseño e14-masiva-tiempos) ganó la carrera.
2. `procesarUno` rama DUPLICADA → `reutilizarResultado` → `reutilizarResultadoCritica` lee el registro de imagen9 → **`actaOrigen` null** (imagen9 aún sin desenlace — en cola/vuelo) → `return false` → **fallback: reproceso completo** (`sin-original reprocesa-completo`) → OCR 32 s.
3. En paralelo, `cadenaDedup` (fire-and-forget) calcula el dHash de imagen10: hamming 0 contra imagen9 → estampa la traza **`dedup: "v2"` en el registro** (write de traza, L554 store) — pero su marca DUPLICADA pre-OCR la bloqueó el guard anti-zombi (fila ya PROCESANDO, no PENDIENTE).
4. El desenlace de imagen10: la capa-2 identidad no matcheó (sin consenso de la serie impresa / original sin `serie` aún) → `status === "OPTIMA"` → **envío automático → ENVIADA**. La traza `v2` quedó como testigo.

**Hallazgos clave del recon:**

- `siguientePendiente` (runner L460-474) toma `PENDIENTE || DUPLICADA` — las DUPLICADAS ENTRAN al loop **por diseño** (su procesamiento es la copia rápida <1 s); el gap es el fallback cuando la original no resolvió todavía.
- La capa-0 QR ya resuelve ESTA MISMA carrera para su caso: `esperarDesenlaceQr` (e63m, `identidad-qr.ts` L782) — espera acotada SOLO-LECTURA con techo 15 s. Insuficiente aquí: la original puede estar PENDIENTE (la espera de e63m la trata como techo) y el techo 15 s no cubre un pipeline OCR completo (~32 s).
- El watchdog D65 vive DENTRO del pipeline (bridge, `timeoutMs` por intento) — una espera en la rama DUPLICADA (ANTES del `try`) es segura.
- `marcarYaEnviada` ya estaba importada en el runner (e65b T-4); `indiceEnviadasDe` NO está exportada (el guard P2.1-v2 queda vivo-local — §3.2, desviación M-e72-3).
- Contrato escaneado (qa-qr-identidad): el spread `...(qrPayload ? { qrPayload } : {})` debía ser EXACTAMENTE 3 writes → el guard añade el 4.º legítimo (ruta DUPLICADA-e72) → **adenda honesta 3→4**.
- Red line T-5 (qa-dedup-enviadas F5/D-e65-7): la literal `"YA-ENVIADA"` está VETADA en el runner entero → los guards de e72 usan **whitelist de estados copiables** (PENDIENTE/PROCESANDO/LISTA/DUPLICADA) — misma semántica sin la literal vetada.

---

## §2 Fix 1 — Guard de ingesta × pool (la copia espera, jamás paga OCR)

**`masiva/runner.ts` — rama DUPLICADA de `procesarUno`:**

```
if (await reutilizarResultado(fila, t0)) return;            // copia directa (intacto)
if (fila.dupOf && (await esperarDesenlaceOriginal(...))) {  // NUEVO e72
  if (await reutilizarResultado(fila, t0)) return;          // re-copia tras el aterrizaje
}
// Fallback: des-marcar y reprocesar como fila normal (INTACTO)
```

**`esperarDesenlaceOriginal(estaFilaId, originalId)`** (helper nuevo, junto a `reutilizarResultadoCritica`):

- Sondeo SOLO-LECTURA cada `ESPERA_ORIGINAL_INTERVALO_MS = 400` ms — `leerRegistro(originalId).acta` presente → `true` (la copia procede al instante).
- Salidas honestas (`false` → fallback de siempre): original QUITADA/AUSENTE/ERROR/sin-estado-copiable (whitelist), ESTA fila QUITADA en la espera (la voluntad del dueño manda), o techo `ESPERA_ORIGINAL_TECHO_MS = 600_000` (10 min ≈ 4× el peor caso del watchdog D65 con reintentos).
- Sin timers globales (mismo patrón de `esperarDesenlaceQr` e63m), techo a escala OCR.
- **Sin deadlock por construcción**: la original SIEMPRE lleva `agregadaEn` menor (la ingesta solo matchea filas ANTERIORES; el guard P2.1-v2 filtra la gemela en vuelo por `agregadaEn < fila.agregadaEn`) y `siguientePendiente` es FIFO → la original se reserva antes que su copia; el otro slot del pool la alcanza. Un waiter solo ocupa SU slot mientras la original está en el otro (o ya aterrizó).
- El segundo `reutilizarResultado` conserva el `t0` original → `esperaMs` (P3.4) sigue midiendo la espera de COLA (pre-inicio), no la espera dedup; el log `reutiliza … ms=` sí incluye la espera (traza honesta de la fila en el pipeline).

## §3 Fix 2 — P2.1-v2: desenlace-contenido (el veredicto manda sobre el envío)

**`masiva/runner.ts` — bloque insertado tras la capa-2 identidad y antes de la decisión de envío:**

Activación (conjuntiva, anti-falso-positivo): `!forzarDedupOff && registro.hashBytes != null && (registro.dedup === "v2" || ∃ gemela misma-hashBytes estado LISTA)`.

- **¿Por qué la original jamás cae aquí?** Su traza es `sin-match` (cadenaDedup es FIFO — sus candidatas son ANTERIORES) y una gemela en cola (DUPLICADA/PENDIENTE POSTERIOR, marcada dupOf=esta) NO activa el guard (no es LISTA, no hay traza v2). La activación por gemela-LISTA sin traza cubre la variante sha256 pura (cadenaDedup aún sin estampar); bytes idénticos ⇒ mismo acta ⇒ cero riesgo de falso positivo.
- **(a) Gemela LISTA** → `reutilizarResultado` (mutex Opt-3) — P2.1: hereda DUPLICADA o RECHAZADA; el OCR ya pagado se descarta (la copia ES el desenlace correcto).
- **(b) Gemela ANTERIOR en vuelo (PENDIENTE/PROCESANDO, `agregadaEn` menor)** → `esperarDesenlaceOriginal` (mismo guard acotado) → re-copia. El OCR de ESTA fila ya se pagó (precio de la race) — el desenlace correcto sigue siendo el de la original.
- **(c) Sin original resoluble** (gemela QUITADA en la carrera / `v2` por dHash de bytes distintos / gemela desaparecida) → **DUPLICADA con SU PROPIO desenlace**: `acta.status = "DUPLICADA"` + `diagnostico.status` + `enviadoAutomaticamente = null` (doctrina e66), fila `estado DUPLICADA + statusActa DUPLICADA + enviadaAuto false`, SU score/rechazo/página/título/serie preservados (revisión disponible), `dupOf` apuntando a la gemela conocida si existe. **Cero envío, cero contador** (mismo patrón de retorno de la capa-2). El rechazo propio NO se pierde: viaja en el acta y en `motivo`.
- La traza `dedup: "v2"` del registro se CONSERVA en todas las ramas (post-mortem) + `qrPayload`/`qrEstado` de la capa 0 se estampan en el write (c) — ruta DUPLICADA-e72.

## §4 Tiempos propios de la copia (criterio del dueño: «totalMs casi 0»)

`reutilizarResultadoCritica` (punto único P2.1/e66): además del `esperaMs` propio (P3.4), la copia estampa **`totalMs = Date.now() − tCopia`** (la copia en sí: lecturas+writes+thumb ≈ decenas de ms) y **`ocrMs = 0` explícito** (la copia JAMÁS paga OCR). El resto de tiempos (procesoMs/calidadMs/decodeMs…) queda heredado: describen el pipeline que produjo el desenlace copiado (nulls jamás inventados). `totalMs` NO incluye la espera (contrato del informe) — la espera dedup es visible en los logs `[e14] dedup … espera-original` y en la duración PROCESANDO de la bandeja.

## §5 Desviaciones y notas honestas (M-e72-*)

- **M-e72-1** — El plan del dueño hablaba de «saltar la fila marcada DUPLICADA en el runner»: saltarla en seco la dejaría DUPLICADA para siempre (nadie la copia). Implementación equivalente al criterio de aceptación («totalMs casi 0 o solo tiempo de espera»): la fila entra, ESPERA el desenlace de su original y copia — la espera ES el «tiempo de espera» del criterio.
- **M-e72-2** — El techo de espera es 10 min (no infinito): lotes profundos con la original muy atrás podrían vencerlo → fallback de reproceso completo (honesto, cero pérdida de foto). Escenario esperado raro (la original va delante en FIFO); subir el techo es una constante (`ESPERA_ORIGINAL_TECHO_MS`).
- **M-e72-3** — El guard P2.1-v2 NO consulta el histórico de enviadas (la maquinaria YA-ENVIADA por contenido vive en la ingesta, `dedupExactoIngesta`, que corre antes de que el duplicado nacido en lote llegue al pipeline): `indiceEnviadasDe` no está exportada y exportarla ampliaba superficie store→runner sin necesidad para el caso del dueño. Una re-subida Racing hacia el pipeline con SOLO match histórico (sin gemela viva ni traza v2) hoy enviaría — ventana considerada remota; queda como item de kit futuro si el dueño quiere cerrarla.
- **M-e72-4** — El (c) estampa `statusActa: "DUPLICADA"` aunque el desenlace propio fuera RECHAZADA (mandato literal del dueño: «v2 o sha256 → statusActa DUPLICADA»); el rechazo propio se conserva en el acta + `motivo` (visible en revisión y export).
- **M-e72-5** — Adendas QA: `qa-qr-identidad` — el spread `qrPayload` pasa de EXACTAMENTE 3 a EXACTAMENTE 4 writes (nueva ruta DUPLICADA-e72, misma write controlada D57). `qa-dedup-enviadas` SIN cambios (los guards usan whitelist — la literal `"YA-ENVIADA"` sigue vetada y AUSENTE del runner).

## §6 Gates

- **tsc**: 0 errores (`bunx tsc --noEmit`).
- **lint**: 0 (`bun run lint`).
- **QA 7/7**: autoenvío 33 · dedup-enviadas **50** · escaneo-ya-recortado 24 · historico-enviadas 49 · identidad-acta 32 · qr-identidad **72** · watchdog-relectura 34 = **294 checks OK** (e71: 290 — +4 por la adenda M-e72-5).
- `package.json` / `bun.lock` INTACTOS (cero dependencias nuevas).
- Commit único de fix (`f6b5638`) — rollback trivial (revert de 1 commit).

## §7 Criterios de aceptación del dueño → cobertura

1. **«Subir el mismo archivo 2 veces en un lote → el segundo no consume OCR (totalMs casi 0 o solo espera) y aparece como DUPLICADA»** → Fix 1: la copia espera y re-copia; informe `[LISTA/DUPLICADA]` con `totalMs` propio ≈ 0 (§4). Verificado estructuralmente (tsc/QA); smoke final del dueño pendiente (§8).
2. **«v2 o sha256 → statusActa final DUPLICADA (no ENVIADA)»** → Fix 2 (a/b/c): ninguna fila con veredicto de contenido llega a `registrarEnvioMasiva`.
3. **tsc 0, lint 0, QA verdes** → §6.

## §8 Pendiente del dueño (smoke sugerido)

1. Mismo archivo ×2 en un lote EN VUELO (el escenario exacto del bug): consola esperada → `instantanea sha256 dupOf=` + `espera-original dupOf=` + `reutiliza status=DUPLICADA ms=<espera>`; informe → imagen10 `[LISTA/DUPLICADA]`, `totalMs` < 1 s, `ocrMs 0`.
2. Ingesta instantánea clásica (cola fría): 1 pendiente + 1 duplicada SIN PROCESAR (regresión e71 — intacto).
3. Lote normal 10 fotos: los desenlaces ENVIADA/ADVERTENCIA/RECHAZADA byte-idénticos a e71 (el guard solo entra con veredicto de contenido o gemela exacta).
4. PROCESAR IGUAL sobre una duplicada: `forzarDedupOff` respeta el reproceso completo (RL-e65b-6 intacta).
