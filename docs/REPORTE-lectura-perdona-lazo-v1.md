# REPORTE — KIT e14-lectura-perdona-lazo-v1 (T-A · «la lectura perdona al fiducial»)

Fecha: 2026-10-17 · Ejecutado por: Z.ai Code · Rama: `fix/lectura-perdona-lazo` desde main `4aa2e06`

## 1. La regla (§3 — implementada verbatim)

`lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion)` en `src/lib/e14/senal-lectura.ts`
(código verbatim del kit §4-A, PURO sin DOM/imports):

- Por CADA esquina faltante, evidencia de SU lado — tope (`tl`/`tr`): `/E\s*-\s*14/i` o
  `/\b\d{15}\b/` · fondo (`bl`/`br`): `!faltaSeccion` Y `/KIT[::\s.]*\d+/i`.
- Perdón = **TODAS** las faltantes tienen evidencia (`every` — pitfall §9.4).
- `esquinas === null` o 4/4 → `false` (n/d jamás condena ni rescata — pitfall §9.3).

## 2. Alcance ejecutado (§2 CAMBIA — 100%, nada más)

| # | Archivo | Cambio |
|---|---|---|
| 1 | `src/lib/e14/senal-lectura.ts` | `lazoPerdonadoPorLectura` NUEVO al final del módulo (JSDoc del kit) — el módulo sigue dependencia-cero. |
| 2 | `src/lib/e14/scanner-core-bridge.ts` | Import añadido al bloque del kit score-lectura. **AMBOS pipelines**: `const faltaSeccion = faltaSeccionInferior(texto, clasificacion.pagina)` (extraída — el bridge ya la computaba inline, costo 0) + `const lazoPerdonado = lazoPerdonadoPorLectura(esquinas, texto, faltaSeccion)` (misma `esquinas` que alimenta `ladoEsquinaFaltante` — escaneo L955 con guard SIM / recorte L1462) + `const recortada = faltaSeccion \|\| (ladoEsquina !== null && !lazoPerdonado)`. **Trazas ×2**: token atómico ` lazo=perdonado` después de ` lado=…` → `… recortada=1 lado=inf-izq lazo=perdonado esquinas=FALTA_bl …`. |
| 3 | `scripts/qa-lectura-perdona.ts` | NUEVO — 10 casos §5 (13 aserciones) + contador `N/N` + exit 1. |

El cap `if (recortada) score = Math.min(score, TECHO_ESCUDO_FONDO)` **INTACTO** (misma línea,
mismo valor, misma posición — pitfall §9.2). `faltaSeccionInferior` nunca perdonada. Guard
INCOMPLETA intacto. Copy del aviso 118 intacto. Cero cambios en core npm, chips o score de disparo.

## 3. Validación (§6)

| Gate | Resultado |
|---|---|
| §6.1 QA headless | **13/13 OK, exit 0** — los 10 casos del §5 (casos 5/6/8 con AMBAS aserciones): zip1 real → perdón · zip2 real → cap se queda · 4/4 → false · null → false · tope E-14 → true / sin cabecera → false · doble falta ambos → true / una evidencia → false · SUMA sin KIT → false · pag2 FIRMA → true / sin FIRMA → false · SIM ESQUINAS_OK → false · post-banda sello suma evidencia → true |
| §6.2 lint + tsc | **lint 0 · tsc 0** |
| build | **OK** (`/` estático) |
| §6.3 SIM (dev :3001, 412×850 — REGLA-PREVIEW respetada) | chips **8.2 / 7.0 / 4.3 idénticos** (desenlaces OPTIMA/ADVERTENCIA/RECHAZADA) · **CERO `lazo=perdonado` en SIM** (no-op demostrado en vivo: `esquinas=sim` → `ESQUINAS_OK` → `faltan=[]` → helper false) · el chip 7.0 MANTIENE `recortada=1` (faltaSeccion del texto as-is — la señal de secciones NUNCA se perdona, pitfall §9.1 verificado en runtime) |
| §6.5 CI del PR | verificado al pushear (4/4 esperado — solo toca los 3 archivos del alcance) |

### 3-a. §6.4 reproducción de campo — **COMPLETADA (2026-10-17 18:3x, tras re-subida de los 2 ZIPs)**

Los 2 ZIPs de campo llegaron al sandbox y se re-corrieron por la **vía archivo** (input IMPORTAR → `alElegirArchivo` → fuente ARCHIVO) en dev :3001 sobre esta rama @ `2b99886` — pipeline completo del puesto (worker + rapidocr + banda + score + gate). El quad salió **idéntico a campo** en ambos (ver §4), así que ni siquiera aplica la nota de tolerancia del quad.

**zip1 — mesa-001 (el caso objetivo): ADVERTENCIA 7.9 (campo) → OPTIMA 8.5 auto-envío (repro)**

- Traza del bridge (completa, TODOS los tokens):

```
[e14] pipeline ARCHIVO/file total=9338ms (decode=670 detect=221 proceso=1537 calidad=146 ocr=6675 motor=worker ocrValido=true cabeceraE14=true completa=true senal=true vacia=false votos=7.6% lado=inf-izq lazo=perdonado esquinas=FALTA_bl borde=N|S|E|O tintaFilo=false franja=[0.5,0.0,0.0,5.3] fondo=false quad=[0.383,0.262 0.633,0.280 0.610,0.863 0.357,0.868] score=8.5 filtro=bw ocrIn=original ocr=rapidocr conf=0.94 det=1162ms rec=5117ms lectura=FUERTE anclas=9 piso=true clasif={dep:88,mun:335,zon:05,std:02,mesa:001,pag:1/2,tipo:T,nivel:AUTO,cod:710003993010102} crop=887x2586 metricas={sharpness:100 brightness:64 contrast:70 contEff:83.125 level:excellent})
```

- `lazo=perdonado` vivo · **SIN `recortada=1` y SIN cap 7.9** · score **8.5** (≥8.3 ✓) · `piso=true` · `nivel:AUTO` · UI: badge **«8.5/10 ÓPTIMA»** con KIT 399 · TRANSMISIÓN · MESA 001. CRITERIO §6.4-1: el desenlace ya NO es ADVERTENCIA por lazo ✓ (el mismo `esquinas=FALTA_bl` de campo ahora se perdona con la lectura FUERTE de 9 anclas).
- Nota: esta traza es la PRIMERA en campo real con `lazo=perdonado` y `piso=true` a la vez — la línea del log final del merge debe conservar ambos tokens.

**zip2 — mesa-002 (control): RECHAZADA 6.4 INCOMPLETA — SIN CAMBIO ✓**

- Traza:

```
[e14] pipeline ARCHIVO/file total=7260ms (decode=574 detect=380 proceso=1205 calidad=40 ocr=4986 motor=worker ocrValido=true cabeceraE14=true completa=false senal=true vacia=false votos=13.6% recortada=1 lado=inf-izq esquinas=FALTA_bl+br borde=N|S|E|O tintaFilo=true franja=[3.5,8.3,0.6,34.9] fondo=false quad=[0.362,0.333 0.694,0.333 0.694,0.601 0.362,0.601] score=6.4 filtro=bw ocrIn=original ocr=rapidocr conf=0.95 det=1008ms rec=3769ms lectura=FUERTE anclas=9 piso=false clasif={sin-clasificar} crop=1062x1144 metricas={sharpness:100 brightness:67 contrast:72 contEff:87.5 level:excellent})
```

- `esquinas=FALTA_bl+br` (doble falta) + texto SIN `SUMA TOTAL` (cortado en INCINERADOS) → `faltaSeccion=true` → `pieDentro=false` → **NO perdona** (caso 2 del §5 en runtime real) · `recortada=1` se queda · **6.4 RECHAZADA** con banner «ACTA INCOMPLETA — ALÉJATE UN POCO» idéntico a campo. Pitfall §9.1 verificado con la señal de secciones: aunque `lectura=FUERTE anclas=9`, la falta de SECCIÓN nunca se perdona.

**Veredicto:** la REGLA queda demostrada en las 2 vías — headless (13/13, §6.1) Y desenlace real de campo reproducido (esta sección).

## 4. Impacto esperado (evidencia del kit §1)

La sesión de campo del 2026-10-17 (auto-envío 25%) habría quedado **50%** con esta regla: el zip1
(ADVERTENCIA 7.9 por lazo inf-izq con sharpness 100 + lectura FUERTE 9/10 anclas + piso 8.5) pasa a
OPTIMA → auto-envío. El zip2 sigue siendo RECHAZADA INCOMPLETA 6.4 (correcto). **La repro §3-a lo
confirmó en vivo con los fixtures: zip1 8.5 ÓPTIMA / zip2 6.4 RECHAZADA, quad byte a byte idéntico
a campo en ambos.**

## 5. Contrato de entrega

- [x] PR `fix/lectura-perdona-lazo` → main, CI verde.
- [x] `scripts/qa-lectura-perdona.ts` con salida **13/13** (los 10 casos del §5; casos 1-2 con los
  textos OCR reales de los ZIPs según las citas del kit).
- [x] `docs/REPORTE-lectura-perdona-lazo-v1.md` (este) + kit verbatim (md5 `2ea71442a2ed00dc11996af817204617`) + worklog + AGENTS.md.
- [x] §6.4 con fixtures — **COMPLETADA §3-a** (re-subida recibida; zip1 OPTIMA 8.5 con `lazo=perdonado`; zip2 RECHAZADA 6.4 sin cambio; determinismo quad byte a byte).

## 6. Nota de merge (§8 del kit)

Este kit se mergea **DESPUÉS** del T-B (PR #15 ya actualizado con el des-stub, CI 4/4). Ambos tocan
la línea del log del bridge: al merge, la línea final debe llevar TODOS los tokens:
`… lectura=… anclas=… piso=… diag=1 lazo=perdonado …` (orden del dueño en chat: «mantener TODOS los
tokens»). Este kit nació de main `4aa2e06` (SIN el des-stub) → el conflicto de la línea del log es
ESPERADO y se resuelve en unión.
