# REPORTE — KIT e14-informe-trazas-escaneo-v1 (D63-D)

**Fecha:** 2026-10-20 · **Agente:** AGENTE-4 (Z.ai Code) · **Rama:** `feat/e14-informe-trazas-escaneo-v1`
**Veredicto: ⛔ BLOQUEADO — la base declarada por el kit NO existe. CERO diff en `src/`. PR documental.**

---

## 1. Veredicto en una línea

El kit exige **«Base: `main` con D63-A + D63-B + D63-C integrados»**, pero a la hora de ramificar
(`origin/main` = `f78a8f6`, merge de D62) **NINGUNO de los tres kits previos existe en el repo**:
no hay ramas, no hay PRs (abiertos ni cerrados), no hay commits, no hay código con las trazas
(`skewGrados`, `deskewMs`, `limpieza`, `gateMarco`, `quadOrigen:"pagina-completa"`) ni la línea
ESCANEOS que D63-A debió dejar en `informe.txt`. Ejecutar D63-D hoy obligaría a **inventar el
contrato** (campos y rutas que definen D63-B/C) y a **duplicar la zona de D63-A** (la línea
ESCANEOS del informe) — ambas cosas prohibidas por la doctrina del repo.

## 2. Auditoría de la base (evidencia completa, 2026-10-20)

| # | Verificación | Comando / fuente | Resultado |
|---|---|---|---|
| E1 | `main` localizado | `git fetch origin` | `f78a8f6` — «Merge pull request #48 (D62)»; previo `df3afc6` (#47, D61). **Sin D63** |
| E2 | Commits D63 en TODAS las refs | `git log --all --grep="D63" -i` | **0 commits** |
| E3 | Trazas en cualquier rama remota | `git grep "skewGrados\|deskewMs\|gateMarco"` sobre las 25+ ramas `origin/*` | **0 archivos** (ni en `src/` ni en docs) |
| E4 | Campos en el contrato de diagnóstico | `src/lib/e14/types.ts` (L61-…): `DiagnosticoActa` | Solo trae hasta D61 (`tiempos.decodeMs/detectMs/persistMs/envioMs`, D57 `esperaMs`, D62 NO toca types). `captura.quadOrigen: "worker" \| "sobel" \| null` — **sin `"pagina-completa"`**; **sin** `skewGrados`/`deskewMs`/`limpieza`/`gateMarco` |
| E5 | Línea ESCANEOS de D63-A en el informe | `grep "ESCANEOS\|SCANS\|escaneo" src/lib/e14/informe.ts` | **0 apariciones** — el `informe.txt` actual no tiene la sección que D63-A debió dejar |
| E6 | PRs abiertos | API `pulls?state=open` | **0** |
| E7 | PRs cerrados | API `pulls?state=closed` | #37…#48 — ninguno D63 (los últimos merges son #47 D61 y #48 D62) |
| E8 | Ramas en GitHub | API `branches?per_page=100` | Ninguna coincide con `d63/traza/escaneo/scan` |
| E9 | Otros clones / trabajo local | filesystem + `git stash list` | Único clon `/home/z/digielect14`, 0 stashes |
| E10 | Kits recibidos en este entorno | `upload/` | Solo D57, D60, D62 y **D63-D** — **los kits D63-A/B/C nunca llegaron a ningún agente visible de este repo** |

**Conclusión de la auditoría:** el bloqueo no es de orden (no es «A/B/C están en PR, aún sin merge»):
es de **existencia**. D63-A, D63-B y D63-C no comenzaron o no llegaron a este repositorio.

## 3. Qué exige el kit y qué falta (mapeo exacto)

| Tarea del kit D63-D | Requiere del upstream | Estado |
|---|---|---|
| **T1** — línea de ACTAS: añadir AL FINAL `origen`, `skewGrados`, `gateMarco` (solo si no son null) | Campos en `DiagnosticoActa` escritos por D63-B/C (productores en `scanner-core-bridge.ts`/`bridge.ts` — zona AJENA) + semántica de `origen` (¿es `captura.quadOrigen` —que la línea ACTAS **ya imprime** como `quad …` (L439)— o un `origen` nuevo foto-vs-escaneo?) | ⛔ Campos no existen; semántica de `origen` no deducible sin el kit B/C |
| **T2** — extender la línea ESCANEOS «la que dejó D63-A» con: deskew medio de escaneos corregidos, conteo `quadOrigen:"pagina-completa"`, gateMarco por resultado (`completo a - cortado b - no-encontrado c`) | La línea ESCANEOS base (trabajo de D63-A **dentro de `informe.ts`**) + `deskewMs` por acta + el valor `"pagina-completa"` en la unión de `quadOrigen` + la clasificación `gateMarco` | ⛔ Nada de eso existe. Crear la línea base = escribir el entregable de D63-A = duplicación garantizada |
| **T3** — no tocar nada más (contrato D57) | — | Se respeta por defecto: 0 diff en `src/` |

Dato relevante del código actual (para el desbloqueo): la agregación `DETECCION (quadOrigen)`
(L418-426 txt y L520-523 json) usa claves fijas `["worker","sobel","null"]`; cuando D63-B/C
introduzcan `"pagina-completa"`, `conteo()` la agregará dinámicamente (la función suma claves
nuevas), pero la impresión txt fija el orden de las claves sembradas — el kit D63-D deberá
decidir si `"pagina-completa"` se siembra también ahí o solo en la línea ESCANEOS.

## 4. Por qué NO se implementa «de todos modos» (doctrina)

1. **Zonas (kit §1):** «TUYA: solo el generador del informe. AJENA: todo lo demás». Los campos
   viven en `types.ts` + productores (`scanner-core-bridge.ts`/`bridge.ts`) — AJENOS. Tocarlos
   para fabricar las trazas sería invadir D63-B/C.
2. **«Jamás inventar» (filosofía del repo):** implementar T1/T2 leyendo campos con rutas
   SUPUESTAS (`captura.skewGrados`, `gate.gateMarco`, …) es inventar el contrato ajeno. El
   fallo sería silencioso (el informe simplemente nunca imprimiría nada) y el dueño podría
   mergear creyendo T1 listo.
3. **Conflicto garantizado:** cuando D63-A aterrice añadirá la línea ESCANEOS a `informe.txt`;
   si yo la creo hoy, el merge de A chocará o duplicará la sección. Cuando D63-B/C aterricen
   declararán los campos reales; un augment/lectura defensiva mía podría chocar (interface
   merging con propiedades duplicadas = error TS).
4. **Validación imposible (kit §3):** «correr lote mixto (fotos + escaneos del dueño) → informe
   muestra las trazas solo donde hay datos» no puede ejecutarse: no existe productor de escaneos
   con deskew. La validación §3.2 («líneas previas byte a byte iguales») pasaría trivialmente
   (sin datos no se imprime nada) — **un pase que no prueba nada**.

## 5. Plan de desbloqueo (para el dueño / orquestador)

**Paso 1 — Entregar/ejecutar D63-A, D63-B y D63-C** (subir sus kits a los agentes correspondientes
o verificar en qué entorno quedaron). Este agente NO los tiene y NO los fabricará.

**Paso 2 — Gate de desbloqueo de D63-D** (re-ejecutar la auditoría §2; el kit queda DESBLOQUEADO
cuando TODO esto sea verdadero en `origin/main`):

- [ ] `git grep skewGrados origin/main -- src/` ≥ 1 hit y el campo visible en `DiagnosticoActa`
- [ ] `git grep deskewMs origin/main -- src/` ≥ 1 hit (ídem)
- [ ] `git grep gateMarco origin/main -- src/` ≥ 1 hit (ídem) — con su unión de valores
      (`completo | cortado | no-encontrado | …`)
- [ ] `captura.quadOrigen` admite `"pagina-completa"` (types.ts)
- [ ] `informe.txt` contiene la línea/sección ESCANEOS de D63-A
- [ ] Definida la semántica de `origen` del T1 (si es `quadOrigen`, la línea ACTAS ya imprime
  `quad …` — decidir si T1 renombra/añade o si `origen` es otro campo distinto)

**Paso 3 — Re-ejecutar D63-D** (la rama `feat/e14-informe-trazas-escaneo-v1` queda RESERVADA por
este PR; la siguiente sesión puede empujar el código sobre esta misma rama/PR).

### 5.1 Sketch de implementación (DOCUMENTACIÓN — no aplicado, ninguna línea en `src/`)

Sobre el `informe.ts` de `f78a8f6` (números de línea reales), la forma del cambio cuando la base
llegue (los nombres/rutas EXACTOS los manda el código que traigan D63-B/C):

```
FilaInforme (L57-103)      → añadir: origen (string|null), skewGrados (number|null),
                             gateMarco (string|null)   [nombres exactos = kit B/C]
filaLiviana (L175-218)     → mapearlos desde diag (L208 zona quadOrigen)
actaLivianaJson (L321-343) → añadir con el patrón condicional de orientacionProbeMs
                             (L339-341: solo cuando existan — JSON estable para parsers)
renderTxt ACTAS (L430-442) → añadir AL FINAL del array trozos (tras `f.error`):
                             f.origen   ? `origen ${f.origen}`   : null
                             f.skewGrados != null ? `skew ${f.skewGrados}°` : null
                             f.gateMarco ? `gateMarco ${f.gateMarco}` : null
                             (jamás reordenar los trozos existentes — kit T1/T3)
Línea ESCANEOS de D63-A    → EXTENDER con: deskew medio (media SOLO de escaneos con
                             deskewMs), conteo quadOrigen:"pagina-completa", gateMarco
                             por resultado «completo a - cortado b - no-encontrado c»
```

### 5.2 Muestra de línea de acta ANTES / DESPUÉS (PLANTILLA honesta — no es una corrida real)

ANTES (formato real de hoy, `f78a8f6`):

```
1. [LISTA/OPTIMA] 171125_1512_acta.jpg - score 8.5 - P0 - nivel OPTIMA - lectura FUERTE - gate completa - quad worker - 5120ms
```

DESPUÉS (plantilla — los corchetes son los huecos que solo D63-B/C pueden llenar; sin dato, el
token NO se imprime — kit T1 «honestidad»):

```
1. [LISTA/OPTIMA] 171125_1512_acta.jpg - score 8.5 - P0 - nivel OPTIMA - lectura FUERTE - gate completa - quad worker - 5120ms - origen pagina-completa - skew -1.8° - gateMarco completo
```

(La validación «byte a byte» del kit §3.2 se verifica con diff de informes ANTES/DESPUÉS del
cambio, corrida sobre la misma cola — pendiente de la base.)

## 6. Qué SÍ entrega este PR (honestidad del entregable)

- Esta auditoría con evidencia reproducible (§2) y el plan de desbloqueo ejecutable (§5).
- La rama `feat/e14-informe-trazas-escaneo-v1` **RESERVADA** desde `f78a8f6` — la ejecución
  futura del código puede empujar aquí sin re-ramificar (lección D62 del worklog de sesión:
  detectar trabajo previo ANTES de implementar; aquí el hallazgo fue el inverso: el trabajo
  previo NO existe y el kit lo exige).
- CERO diff en `src/` y `public/` — `git diff --name-status origin/main` = solo `docs/` +
  esta línea en AGENTS.md.
- Daño PRE-EXISTENTE localizado y NO tocado: marcadores de conflicto sin resolver del merge
  PR #46 en `docs/DECISIONS.md` (~L58-63) y `AGENTS.md` (~L70-71) — ya reportados por la
  sesión D62; los appends de este PR van al final, fuera de la zona dañada.

## 7. Gates de este PR (documental)

- `bunx tsc --noEmit` → 0 errores (el código no cambió).
- `bun run lint` → 0 errores.
- `next build` estático (`BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14`) → OK.
- CI esperada: checks ✅ · Vercel ✅ · parity ❌ HEREDADA de D57 (main también la falla —
  ver REPORTE D60 §9; 0 relación con este PR documental).

## 8. Continuidad

- Worklog de repo (`docs/worklog.md`): entrada D63-D con esta auditoría.
- `docs/DECISIONS.md`: fila D63-D = BLOQUEADO (0 código) — append al final.
- `docs/ROADMAP.md`: sección INFORME-TRAZAS-ESCANEO con checklist de desbloqueo.
- Worklog de sesión del agente: Task ID `D63-D` registrado.
- **El agente NUNCA mergea.** Desbloqueo y merge son del dueño.
