# REPORTE — kit e14-identificacion-codigo-v1 (Task 120)

Rama `feat/identificacion-codigo` desde main `74b12d2` (PR #6 `2063443` + PR #7 kit 118 `74b12d2` mergeados — §1 CUMPLIDO; el kit estuvo DETENIDO por §1 hasta que el dueño ordenó «merguea» sobre el PR #7, documentado en worklog 13:15). **PR ABIERTO SIN MERGE** (regla fija).

Insumos: `docs/INSTRUCCIONES-e14-identificacion-codigo-v1.md` + `docs/research/PATRON-identificacion-actas-e14.md` (ANALISIS, Task 119 — committeados en `9763dfc`).

---

## 1. FASE C — `codigoUnicoE14()` (clasificador.ts)

Verbatim del kit §2 tras `ANCLA_CODIGO_1D`, con `// Fuente:` citando el ANALISIS §1. Gramática cerrada: `7100 | KIT(4) | TIPO(1: 2=DELEGADOS, 3=TRANSMISION) | VER(2) | PAG(2) | TOTAL(2)` — prefijo, d9 ∈ {2,3}, kit ≥ 1, ver 1-99, `1 ≤ pag ≤ tot ≤ 9`. + `tipoDeDigito(d)` → TipoCopia.

**Script QA `scripts/qa-codigo-unico.ts`** (SOLO QA, fuera del bundle, `bun scripts/qa-codigo-unico.ts`) — salida íntegra:

```
=== QA codigoUnicoE14 — gramática 7100|KIT(4)|TIPO(1)|VER(2)|PAG(2)|TOT(2) ===

FIXTURES (12 códigos oficiales del ANALISIS §1):

código           | kit  | d9 | tipo         | ver | pág/tot | acta                        | OK
----------------------------------------------------------------------------------------------------------------------
710009822010102 |  982 | 2  | DELEGADOS    |  1  |   1/2    | ROMA 001 DELEGADOS p1       | ✓
710009822010202 |  982 | 2  | DELEGADOS    |  1  |   2/2    | ROMA 001 DELEGADOS p2       | ✓
710003993010102 |  399 | 3  | TRANSMISION  |  1  |   1/2    | EL CAIRO 001 TRANSMISIÓN p1 | ✓
710003993010202 |  399 | 3  | TRANSMISION  |  1  |   2/2    | EL CAIRO 001 TRANSMISIÓN p2 | ✓
710003992010102 |  399 | 2  | DELEGADOS    |  1  |   1/2    | EL CAIRO 001 DELEGADOS p1   | ✓
710003992010202 |  399 | 2  | DELEGADOS    |  1  |   2/2    | EL CAIRO 001 DELEGADOS p2   | ✓
710012652010102 | 1265 | 2  | DELEGADOS    |  1  |   1/2    | BARCELONA-GIRONA 001 DELEGADOS p1 | ✓
710012652010202 | 1265 | 2  | DELEGADOS    |  1  |   2/2    | BARCELONA-GIRONA 001 DELEGADOS p2 | ✓
710007262010102 |  726 | 2  | DELEGADOS    |  1  |   1/2    | BERLIN 008 DELEGADOS p1     | ✓
710007262010202 |  726 | 2  | DELEGADOS    |  1  |   2/2    | BERLIN 008 DELEGADOS p2     | ✓
710007273010102 |  727 | 3  | TRANSMISION  |  1  |   1/2    | BERLIN 009 TRANSMISIÓN p1   | ✓
710007273010202 |  727 | 3  | TRANSMISION  |  1  |   2/2    | BERLIN 009 TRANSMISIÓN p2   | ✓

NEGATIVOS (3):

710003992010103 (d15 2→3: TOTAL=3, d9 intacto=2) → kit 399 · DELEGADOS · 1/3: ✓
71000982201010X (no numérico)      → null: ✓
810003992010102 (prefijo malo)     → null: ✓

=== RESULTADO: 15 OK · 0 FAIL ===
12/12 fixtures + 3 negativos — gramática VERIFICADA.
```

**ADAPTACIÓN documentada (negativo 1):** la nota del kit decía «`710003992010103` (d9=3 … el PARSEO da T)» — errata de conteo: en ese string el dígito cambiado respecto al fixture DELEGADOS `…102` es el **d15 (TOTAL 02→03)**; el d9 sigue siendo `2`. La aserción sigue la gramática verificada 12/12 del propio kit (parsea kit 399 · D · 1/3, sin flip a T) y la vía d9→T queda cubierta por los fixtures 3-4 (`7100039930…` → TRANSMISION). El mapeo de posición queda así probado contra la trampa d9/d15.

## 2. FASE D — cruces en `clasificarCabecera`

1. **Consenso (D.1):** todos los candidatos de `codigos1D` se parsean; ≥1 y TODOS acuerdan (kit, tipoDigito, pagina, total) → `consenso`; difieren → `consenso = null` + aviso/traza `CODIGO_1D_INCONSISTENTE` (las reglas viejas siguen — sanity 7).
2. **Display (D.2):** `ClasificacionE14` añade `codigoUnico?: CodigoUnicoE14 | null` y `avisos?: string[]` (opcionales — cero ripple en construcciones manuales del panel).
3. **TIPO (D.3):** lógica intacta (banda primaria; d9 respaldo 0.9). Banda Y consenso presentes y `tipoDeDigito(d9) ≠ banda` → **banda sigue ganando** (nivel sin cambio), `confianzas.tipo = 0.75` + `BANDA_CODIGO_DISCREPAN` (sanity 6: banda D + `…3993…` → DELEGADOS, conf 0.75, AUTO intacto).
4. **PÁGINA (D.4):** VerPag Y consenso y discrepancan → **gana el consenso** + `VERPAG_CODIGO_DISCREPAN`. VerPag ausente → consenso. Sin consenso → fallback viejo del 118 intacto. **Caso real resuelto:** Frankfurt P2 «Ver: 01 Pag: 2 de 2» + `710007453010202` → 2/2 con aviso (el mVerPag preexistente usa el grupo del «Ver» como index — quirk documentado, NO tocado por §6; el cruce lo corrige honestamente).
5. **KIT (D.5):** pie primario intacto; pie ausente + consenso → `kit = consenso.kit` — `nombreExportacion` deja de fabricar `SINKIT` (sanity 3: `E14_399_88_335_05_02_001_TRANSMISION-1`).
6. **MESA (D.6):** ancla intacta; SOLO si `mesaLeida === null` → registro kit→mesa (FASE E) con guardas → `mesa = registro.mesa` + `MESA_POR_KIT`. `mesaValidaLeida` SIGUE exigiendo lectura de cabecera → **máx SUGERIDA, NUNCA AUTO** (sanity 4). Mesa leída que difiere del registro → NO se sobreescribe + `MESA_KIT_DISCREPAN` (sanity 5).

## 3. FASE E — registro kit→mesa (`src/lib/e14/kits.ts` NUEVO)

Verbatim del kit §4: `REGISTRO_KITS` (6 actas oficiales visor + Frankfurt 745 por OCR del dueño, con `fuente`) + `kitEnRegistro(mun, kit)` (null sin mun/kit finito). Guardas implementadas en D.6: municipio resuelto coincide; `zona`/`puesto` resueltos que contradigan el registro → NO aplicar + `KIT_OTRA_RUTA` (sanity 8: kit 726 contra ruta Frankfurt 15/02); ruta completa → `1 ≤ mesa ≤ p.t` (regla 5) o no aplica + `KIT_MESA_FUERA_RANGO`. AMPLIAR solo con actas oficiales verificadas.

## 4. FASE F — `marcasEsquina()` (`src/lib/e14/integridad.ts` NUEVO)

Verbatim del kit §5 (núcleo < 0.45 CON anillo > 0.75; umbrales con `// Fuente:`, a calibrar con captura real G-D). Integración en AMBOS pipelines (helper `esquinasDeActa` sobre `fotoProcesada` — ADAPTACIÓN: el kit dice «crop ya enderezado, mismo input que calidadDeActa»; la procesada ES ese crop, sin duplicar lógica):

- Falta una esquina → **MISMO canal del kit 118**: `recortada = faltaSeccionInferior(...) || lado !== null` → techo 7.9 + pill existente, que ahora lleva el **LADO**: «ACTA RECORTADA · SUP-IZQ» (`Acta.recorteLado` NUEVO en types.ts; el pill-texto existente GANA — §5).
- 4/4 presentes → nada visible nuevo; traza `esquinas=OK`.
- No medible (decode fallido / sin foto) → `esquinasDeActa` devuelve null → `esquinas=n/d`, **JAMÁS condena** (política «sin señal honesta no se condena»).
- **SIM: no mide** (`esquinas=sim`) — MISMO patrón del guard `completa` (`opciones.simular ? true : …`): los assets de la demo no tienen las marcas calibradas y §6 del kit exige chips 8.2/7.0/4.3 intactos. Verificado en vivo: chip óptimo 8.2 con `esquinas=sim`.
- El QR queda FUERA (ANALISIS §6: blob opaco de 32 bytes — huella futura; sin jsQR/zxing, §6).

## 5. Trazas nuevas (log `[e14]`)

`cod:<crudo>` + `av:<AVISOS>` en `clasif={…}` (fmtClasif) · `esquinas=OK|FALTA_tl[+tr+bl+br]|sim|n/d` · `lado=<lado>` cuando condena — en AMBOS logs (pipeline + recorte). AVISOS: `CODIGO_1D_INCONSISTENTE` · `BANDA_CODIGO_DISCREPAN` · `VERPAG_CODIGO_DISCREPAN` · `MESA_POR_KIT` · `MESA_KIT_DISCREPAN` · `KIT_OTRA_RUTA` · `KIT_MESA_FUERA_RANGO`.

## 6. Gates §7

- `bunx tsc --noEmit` = **0** · `bun run lint` = **0** · build estático **3/3**.
- npm diff = **0** (packages/scanner-core + scanner-ui, divipol.json, bun.lock, package.json, public/ — 0 archivos tocados; diff completo = 4 archivos: clasificador.ts, scanner-core-bridge.ts, ReviewView.tsx, types.ts + 3 NUEVOS: kits.ts, integridad.ts, scripts/qa-codigo-unico.ts).
- Script QA: **15/15** (12 fixtures + 3 negativos) — salida íntegra en §1.
- Sanity numérico FUERA del repo (bun + divipol.json real, `/home/z/e14-kit120/sanity.ts`): **27/27** — consenso, Frankfurt 2/2, SINKIT fin, MESA_POR_KIT + SUGERIDA, MESA_KIT_DISCREPAN, banda conf 0.75, INCONSISTENTE + fallback viejo, KIT_OTRA_RUTA, no-regresión sin código.
- Navegador (dev :3001, 412×850, **0 errores de consola**): chip óptimo SIM **8.2** auto-enviada con `esquinas=sim` (§6 intacto) · acta fabricada Berlin SIN mesa → chip «KIT 726 · DELEGADOS · 1/2 · CÓDIGO» + chip «MESA 008 · POR KIT», nivel SUGERIDA → EN_RH (panel, como hoy) · con MESA leída + sin marcas → **ADVERTENCIA 7.9 + pill «ACTA RECORTADA · SUP-IZQ»** · con MESA + 4 marcas → `esquinas=OK`, sin techo, **9.6 ÓPTIMA auto-enviada**. Capturas fuera del repo.

## 7. QA física del dueño (no bloquea el PR)

- **G-A** Reprecio Frankfurt p2 → hueco en P2 (118) + chip «KIT 745 · TRANSMISION · 2/2» si el OCR lee el código.
- **G-B** Foto El Cairo delegados p1 → aviso ausente + export SIN `SINKIT` cuando el pie falle pero el código se lea.
- **G-C** Cabecera tapada (dedo sobre «MESA:») con código legible → chip «MESA POR KIT» + mesa 008 (Berlin 726).
- **G-D** Recorte simulado esquina sup-izq → pill «ACTA RECORTADA · SUP-IZQ», techo 7.9, resto sin cambio.

## 8. Pendiente/Bloqueado

- AUDITORÍA DEL DUEÑO antes del merge (regla dura). QA físico G-A..G-D en Vercel preview/teléfono.
- Decisión abierta de reportes anteriores (C4, copy chip «10.0», re-calibración umbral votos) — sin cambio.
- Registro kit→mesa: ampliar SOLO con actas oficiales del visor (campo `fuente` obligatorio).
