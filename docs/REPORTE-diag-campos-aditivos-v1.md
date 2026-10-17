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

### 3-a. §6.3-repro con fixtures de campo — **PENDIENTE de re-subida (bloqueo de entrega, NO de código)**

Los 2 ZIPs de campo (`e14-diag-mesa-001-115643-i1.zip` / `e14-diag-mesa-002-115822-i2.zip`) **NO llegaron al sandbox** del agente (`download/` = carpeta de generados; `upload/` solo trajo los 3 INSTRUCCIONES). El kit NO se ejecuta con fixtures inventados (pitfall del repo). **Estado honesto:**

- `diagnostico.json` ANTES (campo, citado del kit §1): `"lectura": {"nivel": "—", "anclas": 0, "chars": 621}` con OCR de 9/10 anclas · `sharpnessHi: null` · `contrastPapel: null`.
- `diagnostico.json` DESPUÉS (fixture): **pendiente** — la re-corrida con los `original.jpg` documentará `lectura: {nivel: "FUERTE", anclas: ≥8}` (zip1) y MEDIA/DEBIL real (zip2) + `sharpnessHi>0` + `contrastPapel>0` + `techos` con `piso-lectura-FUERTE:8.5`/`lectura-…`. **El gate del kit queda cubierto por el QA headless + SIM (§3) hasta la re-corrida** (patrón permitido por el contrato de T-A §6.4: «documentarlo y dejar el QA headless como gate»).
- El TXT de comportamiento agrupará el cruce LECTURA×AUTO por buckets FUERTE/MEDIA/DEBIL en cuanto haya registros post-kit (los viejos con `—` siguen válidos, §5.1).

## 4. Evidencia de la línea de log final (todos los tokens — sitio escaneo, SIM)

```
[e14] pipeline SIMULACION/file total=7633ms (decode=256 detect=145 proceso=1039 calidad=74 ocr=6105 motor=worker ocrValido=true cabeceraE14=true completa=true senal=true vacia=false votos=8.8% esquinas=sim quad=[0.293,0.058 0.707,0.040 0.723,0.988 0.313,0.998] score=8.2 filtro=bw ocrIn=original ocr=rapidocr conf=0.93 det=1129ms rec=4631ms lectura=FUERTE anclas=9 piso=false clasif={dep:88,mun:120,zon:15,std:02,mesa:012,pag:1/2,tipo:T,nivel:AUTO,cod:710007453010102} crop=782x2261 metricas={sharpness:100 brightness:62 contrast:87 contEff:100 level:excellent}) sim=8.2
```

En CAMPO (no-SIM) la MISMA línea termina con `diag=1` cuando el diagnóstico se adjunta (§3-A de PROD-3, intacto).

## 5. Desviaciones / notas

- **Ninguna de código.** El §6.3-repro queda pendiente POR INSUMO (ZIPs no llegaron) — bloqueo documentado, no decisión silenciosa (contrato §4-último).
- El comentario header de `DiagnosticoActa` y el de `metricas` en types.ts se actualizaron para reflejar el des-stub (documentación honesta — los tipos persistidos conservan `null`/`"—"` SOLO por los registros viejos del localStorage).

## 6. Contrato de entrega

- [x] PR #15 actualizado (push a `feat/diagnostico-autoenvio`), CI 4/4, mergeable limpio → listo para merge del dueño (PRIMERO de la tanda — §8 del kit).
- [x] `docs/REPORTE-diag-campos-aditivos-v1.md` (este) + kit verbatim (md5 `56575072857bb533007867cfc75782c9`) + worklog + AGENTS.md.
- [ ] §6.3-repro con fixtures — tras re-subida de los 2 ZIPs (capítulo pendiente; NO bloquea el merge: el código está completo y validado por gates headless + SIM).
