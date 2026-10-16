# REPORTE — KIT e14-actas-vivas-paginas-v1 (Task ID 118)

**Rama:** `feat/actas-vivas-paginas` · **Base:** `main` @ `2063443` (merge del PR #6, ordenado por el dueño ANTES — esta rama toca `ReviewView.tsx` y `scanner-core-bridge.ts` que #6 movió) · **PR:** nuevo (ABIERTO, SIN merge — regla fija)
**Commits:** código (FASES A/B/C en una rama) · docs (este reporte + worklog + AGENTS.md)
**Gates:** lint 0 · tsc 0 (ripple del nullable de `pagina` SECO — cero casts de fuerza) · build estático 3/3 · `rg "avanzarSimulacion" store.ts` → 0 escrituras a `archivadas|puestoActual|historial|completadas|actasSesion` (D6) · intocables: `packages/`/npm/`divipol.json`/`evaluarGate`/`scoreDeCalidad`/`calidadDeActa` (PR #6) SIN TOCAR (git diff: 6 archivos esperados)

---

## §0 Resumen (QA del dueño 16-oct, evidencia real)

Tres hallazgos del dueño, tres fases independientes ejecutadas en la misma rama:

1. **SIM no hacía nada visible** → FASE A: `mesasIniciales()` se recreaba en cada
   render de ACTAS (el mock nunca avanzaba). Ahora el guion vive en el STORE y un
   tick de 5 s «sube» un acta hasta completar el puesto.
2. **Mesa imposible de completar** (pág 2 del acta FRANKFURT archivada en
   TRANSMISIÓN **P1**) → FASE B: la página del papel es DATO — si el OCR/1D no la
   lee se declara DESCONOCIDA (`null`) y el hueco va al primer hueco LIBRE; NUNCA
   se asume P1 en silencio.
3. **Actas recortadas sin señal** (captura con la parte inferior pisada sin
   advertencia) → FASE C: OCR de secciones («SUMA TOTAL»/«FIRMA» según página) +
   hueco con estado OK/RESCANEO.

## FASE A — SIMULACIÓN VIVA: cada 5 s sube un acta ✓

**Principio D6 INTOCABLE, verificado:** `avanzarSimulacion` SOLO escribe
`mesas`/`simUltima`/`simCompleta` (rg: 0 coincidencias con los 5 campos reales).

- `store.ts`:
  - Campos nuevos `simCompleta: boolean` / `simUltima: string | null` + acción
    `avanzarSimulacion` (guion completo → `simCompleta: true`, el tick se
    detiene SOLO).
  - **Extracción** `marcarPaginaOK(mesas, objetivo)` (nivel módulo, junto a
    `proximaPagina`/`recalcularMesa`) — la lógica inline de `registrarEnvio`
    (marcaba la `paginaObjetivo` OK y recalculaba la mesa) pasa a usarla: cero
    duplicación, cero cambio de comportamiento. El envío REAL y el tick del SIM
    comparten el MISMO camino.
  - `alternarModoSimulacion`: ENCENDER → `{ modoSimulacion: true, mesas:
    mesasIniciales(), simCompleta: false, simUltima: null }` (guion FRESCO);
    APAGAR → solo `modoSimulacion: false`.
- `ActasView.tsx`:
  - `mesasMostradas = enSimulacion ? mesas : mesasDelPuesto` (REEMPLAZA
    `mesasIniciales()` recreada por render). Import de `mesasIniciales` FUERA.
  - Tick: `setInterval(avanzarSimulacion, 5000)` con cleanup; se detiene al
    `simCompleta` (sin ticks colgando).
  - Feedback bajo «MESAS SIMULADAS (3)»: línea mono `ÚLTIMA: {simUltima ?? "—"}`
    + `PROGRESO: {ocupadas} DE {total} PÁGINAS` (calculado del guion vivo).
  - Fila verde **«PUESTO COMPLETADO ✓»** al completar (estilo bloque ENVIADO:
    `bg-brand-greendark/60 border border-brand-green/60`).
  - Píldora SIM: `animate-pulse-sync` cuando `enSimulacion && !simCompleta`.
  - Doctrina «real manda» intacta: `enSimulacion = !puestoReal && modoSimulacion`
    sin cambio.

**Verificación en navegador** (dev :3001, headless, cero errores de consola):
- Seed inicial 4 DE 12 PÁGINAS · `ÚLTIMA: —`.
- Ticks: 4→7→12. Orden verificado: m2-D2 (EN_PROCESO primero) → m2-T1 → m2-T2
  → m3 ×4 (PENDIENTES) → m1-T2 (RESCANEO al FINAL — prioridad de
  `proximaPagina` correcta) ≈ 8 ticks. `ÚLTIMA: MESA 01 · TRANSMISIÓN P2 ✓`.
- Las 3 mesas COMPLETADA 100% + fila **PUESTO COMPLETADO ✓** en el DOM.
- Timer se detiene SOLO (12/12 estable tras 7 s sin ticks).
- OFF→ON reinicia el guion: `ÚLTIMA: —` + `PROGRESO: 4 DE 12` (AC-SIM2 ✓).

## FASE B — Página desconocida ≠ PÁG 1 ✓

- `clasificador.ts`: respaldo 1D REESCRITO — helper `paginaDesdeCodigo1D`
  (d12-13 índice · d14-15 total, reglas `idx>=1 && tot>=idx && tot<=9`) y los
  candidatos se prueban **EN ORDEN**: gana el PRIMERO cuya aritmética cuadre.
  Exigir UN único código limpio era frágil (códigos remanentes del OCR dejaban
  `pagina: null` aun con el código bueno presente). Ninguno cuadra → `null`.
- `types.ts` L55: `Acta.pagina: { index; total } | null` (nullable). Ripple
  SECO: los consumidores ya eran null-safe (`?.` + `??`); ajustados a mano los
  3 que no: `ReviewView` (chip), `store.tituloPaginaActual`, `construirActa`.
- `scanner-core-bridge.ts` `construirActa`: la página viaja COMO VENGA de la
  clasificación (null incluido) — eliminado el `?? { index: 1, total: 2 }` que
  mentía P1. Sin clasificación conserva el objetivo seed (hoy).
- `store.ts` `archivarHueco`: `clasif.pagina == null` → **primer hueco LIBRE**
  de ese tipo en `archivadas[clave].huecos` (P1 libre → P1 · si no P2 libre →
  P2 · si no → P1 con `duplicado: true` = reemplaza, semántica de hoy). Con
  página conocida → exactamente igual que hoy.
- `store.ts` `tituloPaginaActual`: página desconocida → **«PÁG ?»** en el
  historial (honesto).
- `ReviewView.tsx`: `paginaIdentificada = clasificacion != null && acta.pagina
  != null` → clasificación sin página leída → chip **«PÁG - DE -»** (el
  fallback ya existía; hoy por fin se activa). Con página leída → PÁG X DE Y.
- Traza de auditoría: `fmtClasif` añade `pag:2/2` leída · `pag:?` desconocida.

**Sanity numérico** (bun, fuera del repo): Frankfurt `710007453010202` → **2/2**
✓ · El Cairo `710003903010102` → **1/2** ✓ · candidato roto `710000000000000`
delante del bueno → gana el bueno (2/2) ✓ · ninguno → `null` ✓.

## FASE C — Hueco con estado (OK/RESCANEO) + acta RECORTADA ✓

- `store.ts`: `HuecoArchivado.estado: "OK" | "RESCANEO"`; `archivarHueco(…,
  conRescate)` → `estado = conRescate ? "RESCANEO" : "OK"`. Re-archivo del
  mismo hueco reemplaza clasificación Y estado (la más reciente manda — ya
  existía). Llamadores: `registrarEnvio` y `guardarUbicacion` pasan
  `conRescate = (acta.status === "ADVERTENCIA")` del acta que se archiva.
- `ActasView.tsx` builder: estado de la página desde `h.estado` — el chip
  **«P# ⚠ Rescaneo»** (ya renderizaba RESCANEO) queda VIVO; `ocupadas` cuenta
  SOLO `OK` → mesa con una página RESCANEO queda EN PROCESO (invita al
  re-escaneo; el re-archivo la sube a ✓).
- `clasificador.ts` export nuevo `faltaSeccionInferior(texto, pagina)`:
  `true` SOLO si `pagina != null` Y (P1 sin `/SUMA\s*TOTAL/i` · · P≥2 sin
  `/FIRMA/i`). Página DESCONOCIDA → `false` SIEMPRE (conservador).
- `scanner-core-bridge.ts` — AMBOS pipelines (escaneo Y recorte):
  - `const recortada = faltaSeccionInferior(texto, clasificacion.pagina)` tras
    clasificar; si `recortada` → `score = Math.min(score, TECHO_ESCUDO_FONDO)`
    (7.9 = ADVERTENCIA, NO rechazo). En el ESCANEO el cap va DESPUÉS de la
    inyección SIM (mismo sitio que el escudo D10 — el recorte físico manda
    sobre cualquier score).
  - El acta lleva `recortada: boolean` (campo nuevo en `Acta` + `construirActa`
    + `actaActualizada` del recorte, re-evaluada en cada re-proceso).
  - RECORTE: `clasificarCabecera` movida ANTES de `medirZonaVotos` (solo
    depende de `texto` — ya estaba en vuelo).
  - **Gate de votos SOLO P1**: `marcadoresOk = completa ? (pagina?.index === 2
    ? true : marcadores.hayVotos) : true` — la pág 2 (constancias) no tiene
    zona de votos (hoy pasaba por la tinta de las líneas impresas: de la
    suerte). Página desconocida → se mide (conservador). Log:
    `votos=skip-pag2` cuando aplique.
  - Logs de auditoría: `recortada=1` cuando flaggee (diagnóstico en campo).
- `ReviewView.tsx` `pillFlotante` (rama ADVERTENCIA): si `acta.recortada` →
  **«ACTA RECORTADA»** (tono warn) con PRIORIDAD sobre las razones del
  medidor (y sobre LECTURA PARCIAL — decisión §Observaciones 1).

**Sanity numérico** (bun, fuera del repo): P1 sin «SUMA TOTAL» → `true` ✓ · con
→ `false` ✓ · P2 sin «FIRMA» → `true` ✓ · con → `false` ✓ · `null` → `false`
SIEMPRE ✓.

## ACs del kit — estado real

| AC | Veredicto | Evidencia |
|---|---|---|
| AC-SIM1 (tick 5 s, ~8 ticks, detiene SOLO) | ✓ | Navegador: 4→7→12, 3 mesas COMPLETADA, PUESTO COMPLETADO ✓, 12/12 estable |
| AC-SIM2 (OFF→ON reinicia guion) | ✓ | Navegador: `ÚLTIMA: —` + `4 DE 12` tras re-encender |
| AC-SIM3 (D6 bit a bit) | ✓ | `rg avanzarSimulacion store.ts` → 0 escrituras reales |
| AC-SIM4 (puesto real manda) | ✓ | Código: guard `enSimulacion` sin cambio |
| AC-SIM5 (RESUMEN sin cambios) | ✓ | `git diff` no toca ResumenView |
| AC-PG1 (Frankfurt ≠ P1 mentiroso) | ✓ | Sanity 1D 2/2; hueco → primer libre si no lee |
| AC-PG2 (2 capturas sin página → P1, P2) | ✓ | Código: libre → P1 luego P2 |
| AC-PG3 (página legible manda) | ✓ | Código: conocida → índice exacto |
| AC-PG4 (3 assets SIM sin regresión) | ◐ | Código íntegro; chip b/n «Ver/Pag» debe seguir leyéndose — **verificación en vivo del dueño** |
| AC-RC1 (P1 sin SUMA TOTAL → 7.9 + pill + RESCANEO) | ✓ | Sanity señales + código cap/gate/llamadores |
| AC-RC2 (P2 sin FIRMA → ídem) | ✓ | Sanity señales |
| AC-RC3 (assets SIM + fotos reales SIN bandera) | ◐ | Sanity señales 9/9; cero falsos positivos depende del OCR real — **verificación en vivo del dueño** |
| AC-RC4 (página desconocida jamás condena) | ✓ | Sanity: `null` → `false` |
| AC-RC5 (re-archivo OPTIMA → ✓ y COMPLETADA) | ✓ | Código: reemplazo de clasificación+estado |
| Globales (lint/tsc/D6/intocables/body/NO merge) | ✓ | Gates arriba |

## §Observaciones y decisiones (para auditoría del dueño)

1. **Píldora RECORTADA sobre LECTURA PARCIAL**: el kit pedía prioridad sobre
   LEVE DESFOQUE/CONTRASTE/LUMINOSIDAD; decidido ponerla PRIMERA de la rama
   ADVERTENCIA (también sobre LECTURA PARCIAL): el defecto FÍSICO (falta papel)
   es lo urgente de comunicar. Reversible en 1 línea si el dueño prefiere.
2. **Cap recortada tras la inyección SIM**: mismo tratamiento que el escudo de
   fondo — un SIM que flaggeara recortado jamás saldría ÓPTIMA (los 3 assets
   no deben flaggearse: AC-RC3 en vivo).
3. **Gate votos skip-pag2 SOLO con página leída = 2**: desconocida → se mide
   (conservador — no se regala el veto por un OCR débil de página).
4. **`nombreExportacion` conserva `?? 1`** para el nombre de archivo (página
   desconocida → `pag1`): el export exige nombre concreto; la honestidad vive
   en chip/hueco/historial. Pendiente de decisión del dueño.
5. **`alternarModoSimulacion` ENCENDER reinicia `mesas`** (guion) según spec
   verbatim — con puesto real archivado la VISTA real no cambia (AC-SIM4 ✓);
   el guion reiniciado es la tabla de trabajo del escáner (comportamiento
   preexistente del board).

## §Pendiente del dueño

- QA en Vercel preview: SIM vivo con el toggle; acta FRANKFURT pág 2 real
  (hueco P2 o primer libre con «PÁG - DE -» — jamás P1 mintiendo); recorte
  real → pill ACTA RECORTADA + hueco ⚠ Rescaneo + re-escaneo lo sube a ✓.
- AC-PG4/AC-RC3 en vivo (los 3 assets SIM + fotos reales del dueño).
- Decisiones abiertas de reportes anteriores: contingencia C4 vs RECHAZADA
  (SIN_VOTOS), copy chip «10.0», re-calibración del umbral de votos.
