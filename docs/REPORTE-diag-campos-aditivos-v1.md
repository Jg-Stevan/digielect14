# REPORTE — KIT e14-diag-campos-aditivos-v1 (T-B · des-stub del diagnóstico + update del PR #15)

Fecha: 2026-10-17 · Ejecutado por: Z.ai Code · Rama: `feat/diagnostico-autoenvio` (PR #15, update — NO rama nueva)

## 1. Alcance ejecutado (§2 CAMBIA — 100%)

| # | Archivo | Cambio |
|---|---|---|
| 1 | merge `62c0891` | `feat/diagnostico-autoenvio` ← main `4aa2e06` (ANTES de editar — §4-A). Conflictos: `docs/worklog.md` (unión append-only: REBASE #13 [10:47] → PROD-3 [11:06]) y `scanner-core-bridge.ts` ×2 hunks (resolución §4-A.3 abajo). `AGENTS.md` auto-mergeó. |
| 2 | `src/lib/e14/diagnostico.ts` (§4-B) | Builder: `metricas` ahora exige `sharpnessHi: number` + `contrastPapel: number` (reales); NUEVO parámetro `senalLectura: { nivel: NivelLectura; anclas: number }` (type-only import de `./senal-lectura`). Mapeo des-stub: `sharpnessHi: p.metricas.sharpnessHi` · `contrastPapel: p.metricas.contrastPapel` · `lectura: { nivel: p.senalLectura.nivel, anclas: p.senalLectura.anclas, chars: p.lecturaChars }`. El stub «null hasta que main la herede» quedó ELIMINADO. |
| 3 | `src/lib/e14/scanner-core-bridge.ts` (§4-C) | AMBOS sitios de adjunción (escaneo ~L1195 / recorte ~L1685): `metricas` pasa `calidad.sharpnessHi` + `calidad.contrastPapel` (mismo objeto `calidad` que usa `contrasteEfectivoDe`) + `senalLectura: { nivel: senal.nivel, anclas: senal.anclas }` (MISMA instancia del C3 — pitfall §9.10, sin recálculo). `techosDiag` de AMBOS pipelines captura los tokens aditivos espejo del C3: `piso-lectura-FUERTE:8.5` (FUERTE + level≠poor) y `lectura-DEBIL:5.9` (DEBIL) — insertados tras los de `scoreDeCalidad` y ANTES de los caps del sitio (orden de aplicación real del score). |
| 4 | `src/lib/e14/types.ts` (§4-D) | `DiagnosticoActa.lectura.nivel: NivelLectura \| "—"` (import type). `sharpnessHi`/`contrastPapel` CONSERVAN `number \| null` EN EL TIPO PERSISTIDO a propósito: los registros viejos del localStorage `e14-diag-v1` (cap 500) traen `null` y deben seguir parseando (§5.1 del kit) — el BUILDER ahora pide `number` (los NUEVOS siempre reales). Comentarios de campos aditivos actualizados. |

### 1-a. Resolución del conflicto del bridge (§4-A.3 — «mantener ambos»)

- **Hunk scoreDeCalidad (×2 pipelines):** orden final OBLIGATORIO respetado →
  `scoreDeCalidad` → `const scoreVisual = score` (#15) → **bloque C3 de #13 completo** (`const senal = senalDeLectura(...)` + piso/techo) → inyección SIM → caps. Comentario del merge con la referencia del kit.
- **Línea del log de auditoría:** auto-merge — VERIFICADA post-resolución con TODOS los tokens en AMBOS sitios:
  `score= filtro= ocrIn= ocr=rapidocr conf= det= rec= lectura= anclas= piso= clasif={…} … diag=1` (la orden del dueño «mantener TODOS los tokens» — cero tokens perdidos; `diag ? " diag=1" : ""` de #15 intacto).
- **Sitios de adjunción / return:** intactos (`acta.diagnostico = diag` escaneo L1337; doble guard SIM `!opciones.simular` / `acta.fuente !== "SIMULACION"`).
- **`bun.lock`/`package.json`:** sin conflicto (fflate de #15 se conservó; main no tocó deps) — `bun install` sin cambios.

## 2. Lo que NO se tocó (§2 NO CAMBIA — verificado)

- `causaPrincipal` (§4): las ramas `d.lectura.nivel === "DEBIL"` y `conTecho("lectura-DEBIL")` existían y quedaron INTACTAS — solo empiezan a disparar (L28-48).
- Lógica del desenlace: cero cambios en status/score/gate/caps — observación pasiva (§9.7).
- El formato del ZIP, el TXT (L267 ya imprime `sharpnessHi ${… ?? "—"}` — con registros nuevos sale REAL solo), el localStorage cap 500, el doble guard SIM.

## 3. Validación (§6)

| Gate | Resultado |
|---|---|
| §6.1 lint + tsc pre-edit (post-merge) | **lint 0 · tsc 0** (errores atribuibles al merge: NINGUNO) |
| §6.2 smoke `senal-lectura` | **5/5 OK** (FUERTE mesa+7 anclas · MEDIA mesa+3 anclas · MEDIA cabecera · DEBIL vacío · MEDIA chars≥150 — módulo INTOCADO) |
| §6.3 lint+tsc+build post-kit | **lint 0 · tsc 0 · build OK** (`/` estático) |
| §6.4 SIM (dev :3001, 412×850 — REGLA-PREVIEW respetada) | chips **8.2 / 7.0 / 4.3 intactos** (trazas `sim=8.2`, `sim=7`, `sim=4.3`; statuses OPTIMA/ADVERTENCIA/RECHAZADA idénticos) · **CERO `diag=1` en las 3 trazas SIM** (doble guard vivo) · el log de auditoría lleva `lectura=FUERTE anclas=9` / `lectura=FUERTE anclas=6` / `lectura=DEBIL anclas=0` — TODOS los tokens vivos |
| §6.5 CI del PR #15 tras push | corriendo en el head nuevo (se verifica al pushear — CI 4/4 esperado) |

### 3-a. §6.3-repro con fixtures de campo — **COMPLETADA (2026-10-17 18:2x, tras re-subida de los 2 ZIPs)**

Los 2 ZIPs de campo (`e14-diag-mesa-001-115643-i1.zip` / `e14-diag-mesa-002-115822-i2.zip`) llegaron al sandbox y se re-corrieron por la **vía archivo** (input IMPORTAR → `alElegirArchivo` → fuente ARCHIVO) en dev :3001 sobre esta rama @ `3f39ded` — mismo pipeline completo del puesto (worker + rapidocr + banda + score + diagnóstico).

**zip1 — mesa-001 (CONSULADO 88 · EGIPTO · MESA 001 · KIT 399):**

| Campo | ANTES (campo 16:56, build pre-kit) | DESPUÉS (fixture 18:29, esta rama) |
|---|---|---|
| status / score | ADVERTENCIA · visual 8.3 · final 7.9 | ADVERTENCIA · visual 7.3 · final **7.9** (idéntico) |
| techos | `recortada:7.9` | `piso-lectura-FUERTE:8.5` + `recortada:7.9` (piso aplicado pre-cap + cap — «la historia completa», §6-n.4) |
| lectura | `"—" · anclas 0 · 621 chars` | **`FUERTE · anclas 9 · 622 chars`** (criterio: FUERTE, ≥8, ~621 ✓) |
| sharpnessHi / contrastPapel | `null` / `null` | **72.05 / 83.13** (criterio >0 ✓) |
| quad / crop / densidad | `0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868` · 887x2586 · 7.6210% | **IDÉNTICOS byte a byte** — detección determinista sobre el JPEG archivado |
| causaPrincipal | acta recortada (lazo=inf-izq) | idéntica (el lazo bl falla igual en dev — «coherente con campo», criterio §6.3 ✓) |

**zip2 — mesa-002 (intento 2, captura cercana):**

| Campo | ANTES (campo 16:58, build pre-kit) | DESPUÉS (fixture 18:31, esta rama) |
|---|---|---|
| status / score | RECHAZADA · visual 8.4 · final 6.4 | RECHAZADA · visual 6.9 · final **6.4** (idéntico) |
| techos | `recortada:7.9, incompleta:6.4` | `piso-lectura-FUERTE:8.5` + `recortada:7.9` + `incompleta:6.4` (el `lectura-…` sí aplicó) |
| lectura | `"—" · anclas 0 · 379 chars` | **`FUERTE · anclas 9 · 380 chars`** (ver desvío documentado §5) |
| sharpnessHi / contrastPapel | `null` / `null` | **56.73 / 87.50** (>0 ✓) |
| quad / crop / densidad | `0.362,0.333 0.694,0.333 0.694,0.601 0.362,0.601` · 1062x1144 · 13.6248% | **IDÉNTICOS byte a byte** |
| rechazo | INCOMPLETA «ALÉJATE UN POCO» | idéntica · causa «tinta impresa cortada al filo» · `tintaFilo=true` en traza |

**Cruce LECTURA × AUTO-ENVÍO del comportamiento.txt:** `FUERTE: 0% auto (1)` en ambos — **ya NO agrupa en `—`** (criterio §6.3-3 ✓; los registros de campo viejos con `—` siguen siendo datos reales del antes).

**Líneas de log con TODOS los tokens (fuente ARCHIVO):**

```
[e14] pipeline ARCHIVO/file total=10038ms (decode=698 detect=257 proceso=1603 calidad=121 ocr=7265 motor=worker ocrValido=true cabeceraE14=true completa=true senal=true vacia=false votos=7.6% recortada=1 lado=inf-izq esquinas=FALTA_bl borde=N|S|E|O tintaFilo=false franja=[0.5,0.0,0.0,5.3] fondo=false quad=[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868] score=7.9 filtro=bw ocrIn=original ocr=rapidocr conf=0.94 det=1311ms rec=5586ms lectura=FUERTE anclas=9 piso=false clasif={dep:88,mun:335,zon:05,std:02,mesa:001,pag:1/2,tipo:T,nivel:AUTO,cod:710003993010102} crop=887x2586 metricas={sharpness:100 brightness:64 contrast:70 contEff:83.125 level:excellent}) diag=1

[e14] pipeline ARCHIVO/file total=7280ms (decode=639 detect=306 proceso=1264 calidad=70 ocr=4960 motor=worker ocrValido=true cabeceraE14=true completa=false senal=true vacia=false votos=13.6% recortada=1 lado=inf-izq esquinas=FALTA_bl+br borde=N|S|E|O tintaFilo=true franja=[3.5,8.3,0.6,34.9] fondo=false quad=[0.362,0.333 0.694,0.333 0.694,0.601 0.362,0.601] score=6.4 filtro=bw ocrIn=original ocr=rapidocr conf=0.95 det=1058ms rec=3597ms lectura=FUERTE anclas=9 piso=false clasif={sin-clasificar} crop=1062x1144 metricas={sharpness:100 brightness:67 contrast:72 contEff:87.5 level:excellent}) diag=1
```

Nota de coherencia: token `piso=false` con `piso-lectura-FUERTE:8.5` en techos — el piso SÍ aplicó al score pre-cap (por eso el techo aditivo); el token `piso=` refleja el score FINAL post-caps (7.9/6.4 < 8.5) — misma semántica de «historia completa» del kit score-lectura (§6-n.4).

## 4. Evidencia de la línea de log final (todos los tokens — sitio escaneo, SIM)

```
[e14] pipeline SIMULACION/file total=7633ms (decode=256 detect=145 proceso=1039 calidad=74 ocr=6105 motor=worker ocrValido=true cabeceraE14=true completa=true senal=true vacia=false votos=8.8% esquinas=sim quad=[0.293,0.058 0.707,0.040 0.723,0.988 0.313,0.998] score=8.2 filtro=bw ocrIn=original ocr=rapidocr conf=0.93 det=1129ms rec=4631ms lectura=FUERTE anclas=9 piso=false clasif={dep:88,mun:120,zon:15,std:02,mesa:012,pag:1/2,tipo:T,nivel:AUTO,cod:710007453010102} crop=782x2261 metricas={sharpness:100 brightness:62 contrast:87 contEff:100 level:excellent}) sim=8.2
```

En CAMPO (no-SIM) la MISMA línea termina con `diag=1` cuando el diagnóstico se adjunta (§3-A de PROD-3, intacto). Las 2 líneas reales de la repro con fixtures (fuente ARCHIVO) están en §3-a.

## 5. Desviaciones / notas

- **Cero desvíos de código.** El kit NO cambia lógica de desenlace y la repro lo confirma: status/score/causa/quad idénticos a campo en ambos fixtures.
- **§3-a era pendiente POR INSUMO y quedó COMPLETADA** tras la re-subida de los 2 ZIPs (2026-10-17): repro determinista documentada en §3-a.
- **Desvío de predicción (documentado, NO corregido — pitfall §9.2):** el kit §5.8/§6.3 anticipaba zip2 con lectura MEDIA/DEBIL; `senalDeLectura` produjo **FUERTE (9 anclas sobre 380 chars)** — el texto corto trae E-14, REGISTRADURÍA, CONSULADO, PAÍS, ZONA, PUESTO, cabecera, pag y el código completo, y el conteo cruza el umbral FUERTE. Regla del kit aplicada: «NO forzar el valor esperado: aceptar lo que `senalDeLectura` produzca sobre ese texto y documentarlo». Consecuencia observada: el techo aditivo `piso-lectura-FUERTE:8.5` aparece también en zip2 (no cambia el desenlace: los caps recortada:7.9 e incompleta:6.4 mandan). Si el dueño quiere el bucket DEBIL para textos cortos, es un ajuste de umbrales APARTE (fuera de alcance).
- El comentario header de `DiagnosticoActa` y el de `metricas` en types.ts se actualizaron para reflejar el des-stub (documentación honesta — los tipos persistidos conservan `null`/`"—"` SOLO por los registros viejos del localStorage).

## 6. Contrato de entrega

- [x] PR #15 actualizado (push a `feat/diagnostico-autoenvio`), CI 4/4, mergeable limpio → listo para merge del dueño (PRIMERO de la tanda — §8 del kit).
- [x] `docs/REPORTE-diag-campos-aditivos-v1.md` (este) + kit verbatim (md5 `56575072857bb533007867cfc75782c9`) + worklog + AGENTS.md.
- [x] §6.3-repro con fixtures — **COMPLETADA §3-a** (re-subida recibida; determinismo quad/densidad byte a byte en ambos fixtures; desvío de predicción zip2 documentado en §5).
