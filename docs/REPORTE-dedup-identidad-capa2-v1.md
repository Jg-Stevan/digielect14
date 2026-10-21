# REPORTE — kit e63k: dedup por identidad CAPA 2 + banda aplazada · botón instalar (PWA)

**Kit**: `INSTRUCCIONES-e63k-capa2-identidad-e-instalar-v1.md` · **Rama**: `feat/e63k-capa2-identidad-v1` desde main `581ab4c` · **Tipo**: FASE 1 dedup post-OCR por identidad impresa + hardening del dedup visual (cinta) + PWA instalar. **Cero cambios** de OCR/umbrales/criterios de votos.

---

## §0 — La evidencia que motiva el kit (consola del dueño, lote 21-oct)

1. **Falso positivo CONFIRMADO en vivo** (kit §0.1): `dedup fila=masiva-…-3 marcada hamming=6 dupOf=masiva-…-1` + `reutiliza score=10 ms=94`. Por orden FIFO, la fila -3 era la **P2 de DELEGADOS el cairo (710003992010202, tipo D)** y quedó duplicada de la fila -1 (**P2 de TRANSMISIÓN, 710003993010202, tipo T**) con desenlace REUTILIZADO ⇒ acta delegados P2 **nunca procesada** (documento perdido). `hamming=6` está EXACTAMENTE en el borde de `DEDUP_HAMMING_MAX=6`: el par 3992/3993-P2 (misma mesa, mismos votos, formularios distintos, layouts casi idénticos) cae en 6 — fuera de la cinta baja («gemelas reales 0-2; fotos distintas >12», kit e63h).
2. **Fase 0 de e63j respondida** (kit §0.2): el serie SÍ se lee en MASIVA vía OCR — 7/8 escaneos + 3/5 fotos traen `clasif.cod` de 15 dígitos = `clasificacion.codigoUnico.crudo` (consenso del código 1D, gramática `codigoUnicoE14` ya en el repo) ⇒ **CAPA 2 GO**. Capa 0 (QR fast-path) sin evidencia → NO implementada (kit futuro).
3. **PWA** (kit §0.3): `beforeinstallpromptevent.preventDefault()` del core tragaba el evento y **nadie** consumía `promptInstall()/getPwaInstallState()/subscribePwaState()` (grep en `src/` = 0) ⇒ ni banner nativo ni prompt: imposible instalar.

## §1 — F1: capa 2 por identidad + banda aplazada

**Vocabulario del veredicto de dedup (union ampliada ADITIVA, contrato D57)**: `"v2"` gemela visual cierta (hamming ≤ 2, hoy intacto) · `"visual-aplazada"` banda 3..6 NO marcada (estado intermedio) · `"identidad"` capa 2 marcó DUPLICADA por serie repetida · `"sin-match"` sin gemela o FP visual evitado (resolución final de una aplazada).

**Módulo nuevo `masiva/identidad.ts`** (lógica pura, testeable headless): `identidadDeActa(acta)` — identidad SOLO desde `clasificacion.codigoUnico.crudo` (consenso), **re-validada** contra la gramática completa `codigoUnicoE14` (defensa contra registros viejos); `null` sin consenso (honesto). `DEDUP_CINTA_CIERTA = 2`.

**Decisiones (kit §1.1 + las declaradas del agente)**:
- **Clave del dedup = `identidadActa` (13 dígitos, formulario+PAG)**: P1 y P2 del mismo formulario son actas DISTINTAS (nunca se deduplican entre sí); dos fotos del MISMO papel comparten la clave completa.
- **Identidad SOLO impresa desde el consenso** — PROHIBIDO regex suelto sobre el texto cuando el consenso falló (una lectura errada fabricaría identidad falsa ⇒ falso dedup). Sin serie → flujo normal.
- **`DEDUP_HAMMING_MAX=6` y `dedup.ts` BYTE-IDÉNTICOS** (RED LINE 1 — la corrección es la CINTA, no el umbral; QA source-scan lo prueba).
- **DECISIÓN DECLARADA (traza en el registro)**: `dedupVisualDe` vive SOLO en `RegistroMasiva` (kit §1.2 literal — §1.3 no la restaura a `FilaMasiva`) ⇒ el runner la lee del **registro** ya en mano (`registro.dedupVisualDe`), no de la fila.
- **DECISIÓN DECLARADA (guard anti-revertir)**: la resolución de FP visual (`dedup: "sin-match"`) SOLO aplica cuando el registro SIGUE en `"visual-aplazada"`. Jamás revierte un veredicto `"identidad"` previo (p. ej. el dueño pulsó PROCESAR IGUAL sobre una dup real → re-proceso → su traza de identidad queda intacta). Sin este guard, el re-proceso forzado de una dup real re-etiquetaría el post-mortem en falso.
- **DECISIÓN DECLARADA (serie en el mapa en memoria)**: el `marcarFila` de la marca-por-identidad también estampa `serie` (el literal del kit §1.4-3 no la lista, pero su «regla general de persistencia de serie… sirve al mapa de la cola» la exige en espíritu): la 3.ª foto del mismo papel la encuentra aunque la original se haya QUITADO de la bandeja.

**Cadena dedup (`masiva/store.ts`)**: `hamming ≤ 2` → comportamiento de HOY byte a byte (DUPLICADA + reutilizar). `hamming 3..6` → **NO marcar**, traza `{ dedup: "visual-aplazada", dedupDistancia, dedupVisualDe: original.id }` en el MISMO write del hash (mismo nº de writes — D65 intacto), log `APLAZADA cinta=3-6 — identidad post-OCR decide (e63k)`, la fila sigue PENDIENTE → pipeline completo. `filaDeRegistro` restaura `serie` y `forzarDedupOff` (aditivos al final). `procesarIgual` estampa `forzarDedupOff: true` persistente (memoria + IDB) — capas 1 y 2 lo respetan siempre (el dueño mandó).

**Runner (`masiva/runner.ts`, punto ÚNICO post-OCR)**: tras la re-lectura interna (e63f) y ANTES del envío:
- `const identidad = identidadDeActa(actaDesenlace)`.
- **Regla general de serie**: con identidad leída, `serie` viaja en el `registroListo` (write LISTA) y en el `marcarFila` final — también cuando NO es dup (mapa de la cola + informe).
- **`forzarDedupOff`** → NO marcar; solo persistir serie y envío normal.
- **Marca por identidad**: OTRA fila (`f.id !== fila.id`) con `serie.slice(0,13) === identidadActa` en estado LISTA|DUPLICADA (original = `agregadaEn` mínima) → thumb propio + `guardarRegistro({ estado: "DUPLICADA", dupOf, acta: actaDesenlace (SU PROPIO desenlace), serie, dedup: "identidad", infoTitulo })` + `marcarFila(…)` + log `dedup-identidad fila=… serie=<13> original=…` + **`return`** — NO corre `registrarEnvioMasiva` NI `contarMotivoNoEnvioActa` (la capa 2 decide por CUALQUIER status del desenlace). Guard anti-zombi M8 ya corrió antes (no se duplica). DUPLICADA NUNCA borra ni bloquea PROCESAR IGUAL.
- **FP visual evitado (el caso 3992/3993)**: identidad presente, SIN original por identidad, traza aplazada en el registro → log `falso-positivo-visual evitado` + `dedup: "sin-match"` en el `registroListo` (conservando `dedupDistancia` y `dedupVisualDe` — post-mortem). La fila sigue al envío normal con SU desenlace.
- **`reutilizarResultado`** (ruta hamming ≤ 2): deriva la serie del acta COPIADA y la persiste (el mapa de identidad cubre gemelas copiadas).
- Sin identidad → flujo normal de siempre (fallback honesto).

**Informe (`informe.ts`, export solo-ADITIVO)**: `FilaInforme.serie: string | null` (al final) + union `dedup` ampliada con los 2 valores nuevos · `filaLiviana`: `serie: reg.serie ?? null` · `actaLivianaJson`: `serie` con spread condicional (ausente si no hay consenso — informes previos intactos) · TXT: `serie <15>` AL FINAL de la línea de acta (jamás reordenar) · `resumenDedup`: clave nueva `identidad` + en el bloque machine-readable `dedup` del informe.json (aditiva al final); `"visual-aplazada"` NO es match; `activo` sigue siendo `dedup != null`.

## §2 — F2: botón «Instalar app» (PWA)

`src/lib/e14/pwa-instalar.ts` nuevo — patrón E-04 al pie de la letra (`update-banner.ts`): self-contained, DOM directo, montado UNA vez desde `PwaRegister` (1 línea añadida), sobrevive la navegación SPA, cero dependencias, cero toques a scanner-core ni pantallas.
- `subscribePwaState` del core: píldora SOLO con `canPrompt && !installed && !isIos` — **iOS sin prompt → sin píldora** (no ofrecer humo); tras `appinstalled` el estado `installed` la oculta.
- Click «Instalar» → `await promptInstall()` → ocultar con `accepted | dismissed` (el core limpia `deferredPrompt` y emite). `unavailable` → la píldora se queda (honesto).
- Píldora fija **abajo-IZQUIERDA** (`left:16px; transform:none; bottom:calc(16px + env(safe-area-inset-bottom,0px))`) — NO centro-abajo: ahí vive el banner E-04. z-index 2147483647, radios/fuente/fondo copiados de E-04. Botón ✕ (aria-label «Descartar aviso de instalación») oculta POR SESIÓN (variable local, no persiste). Guards anti-duplicado (DOM id + bandera de módulo). Accesible: `role="status"`, aria-labels, tap targets ≥ 44 px.

## §3 — QA headless `scripts/qa-identidad-acta.ts` — 30/30 OK

Funciones puras, sin red, sin DOM, determinista (estilo `qa-autoenvio.ts`). Fixtures = SOLO estructura impresa: las 8 series de 15 dígitos ya citadas en la consola del dueño (kit §0.2) — cero actas reales.
1. **Gramática** con las 8 series reales → formulario 11 / acta 13 / pag correctas; sin `codigoUnico` → null; acta null/undefined → null; re-validación defensiva de crudo inválido → null.
2. **Anti-falso-positivo** (el test que la consola reprobó): `710003993010202` ≠ `710003992010202` por identidadActa E identidadFormulario (dígito 9: 3 vs 2); misma mesa/mismos votos NO interviene.
3. **Test del dueño**: dos fotos del mismo papel comparten identidadActa completa; P1 vs P2 del mismo formulario comparten formulario pero NO acta.
4. **resumenDedup** vocabulario nuevo: `identidad` cuenta y NO es match v2; `visual-aplazada` no es match; activo true con cualquiera; sin trazas → false; distancia null sin datos.
5. **Source-scan**: `DEDUP_HAMMING_MAX = 6` (dedup.ts byte-idéntico) · `DEDUP_CINTA_CIERTA = 2` · umbrales 0.82/0.6/0.55 y OPTIMA=8/ADVERTENCIA=6.5 intocados · `ort.env.wasm.proxy = true` (rapidocr — producción).

## §4 — Gates

`bun install --frozen-lockfile` OK · **tsc 0** · **lint 0** · **QA identidad 30/30** · **QA autoenvío 33/33** (sin regresión del autoenvío — la red line permanente del dueño) · **QA escaneo-ya-recortado 24/24** · **build estático OK** con `NEXT_PUBLIC_BASE_PATH=/digielect14`.

## §5 — Validación mental con el lote del dueño (kit §1.6)

| fila | hoy (consola 21-oct) | con e63k |
|---|---|---|
| **-3 delegados P2 (3992)** vs **-1 transmisión P2 (3993)** | hamming=6 → DUPLICADA de -1, reutiliza en 94 ms — **documento perdido** | banda 3-6 → **APLAZADA** (traza + dedupVisualDe=-1) → OCR completo → serie `710003992010202` ≠ `710003993010202` → **falso-positivo-visual evitado** → LISTA con SU desenlace (tipo D, dedup "sin-match" conservando distancia 6 + dedupVisualDe) → **8/8 páginas presentes** |
| misma acta re-subida (archivo gemelo) | DUPLICADA pre-OCR, gratis | IGUAL — cinta ≤ 2 intacta (hamming 0-2) |
| foto DISTINTA del mismo papel (hamming ≥ 3) | procesa y REENVÍA doble | hamming 3-6 → aplazada → capa 2 marca `dedup-identidad` con su propio desenlace y SIN reenvío (coste extra CERO — ya se procesaba); hamming > 6 → pasa sin marca → capa 2 ídem |
| PROCESAR IGUAL (dup sospechosa) | reproceso completo, pero podía re-marcar | reproceso completo + `forzarDedupOff` persistente — capas 1 y 2 jamás la re-marcan (el dueño manda) |
| instalación PWA | imposible (evento tragado) | píldora «Instalar app» → prompt nativo (Chrome/Android/desktop; iOS sin humo) |

## §6 — RED LINES (kit §4) — cumplimiento

1. `DEDUP_HAMMING_MAX=6` y `dedup.ts` BYTE-IDÉNTICOS ✓ (QA source-scan).
2. Identidad SOLO impresa desde `codigoUnico` consensuado; PROHIBIDO dedup por datos OCR y regex suelto ✓ (identidadDeActa null sin consenso — QA).
3. Serie ilegible → flujo normal (honesto); nada del kit empeora un desenlace ✓ (marcas solo AÑADEN DUPLICADA con SU desenlace; el resto del flujo es el de siempre).
4. DUPLICADA por identidad nunca borra ni bloquea `procesarIgual`; `forzarDedupOff` persistente manda sobre capas 1 y 2 ✓.
5. Export solo-ADITIVO (D57: campos nuevos al final, spreads condicionales, informes previos sin cambio de forma); trazas solo-aditivas (D51); `registrarEnvioMasiva` NO corre en la capa 2 (return) ✓.
6. PWA: cero toques a `@jg-stevan/scanner-core` ni pantallas — módulo nuevo + 1 línea en PwaRegister; iOS sin píldora ✓.
7. Commits Conventional · worklog append · REPORTE en docs/ ✓.

## §7 — Fase D del dueño (validación de campo esperada)

Re-corrida del lote 21-oct (8 escaneos + 5 fotos) sobre el preview del PR:
- **8/8 páginas** presentes en bandeja/informe (la delegados P2 ya no desaparece).
- En consola: `dedup … APLAZADA cinta=3-6` para el par 3992/3993 + `dedup-identidad … falso-positivo-visual evitado` para la fila -3; informe.txt con `serie 7100039…` al final de las líneas y `dedup sin-match` (no `v2`) en la -3.
- **Test del dueño**: misma acta 2× → gemela de archivo = DUPLICADA pre-OCR (gratis); foto distinta del mismo papel → `dedup-identidad` sin reenvío; PROCESAR IGUAL → reproceso completo sin re-marcas.
- **PWA**: en el preview (https) debe aparecer la píldora «Instalar app» abajo-izquierda → prompt nativo de Chrome; en iOS nada (correcto).
- Informe JSON: `dedup.identidad` visible (aditivo). SIM 8.2/7.0/4.3 intocable. Si algo que HOY se autoenvía deja de hacerlo → NO-GO (QA 33/33 ya lo niega en local).
