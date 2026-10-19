# REPORTE — e14-vercel-perf-v1

**Fecha:** 2026-10-19 (Bogotá) · **Rama:** `feat/e14-vercel-perf-v1` (desde main `03a2d76`) · **Estado:** PR DRAFT

## 1. Qué se cambió (whitelist §1 EXACTO)

| Archivo | Acción | Contenido |
|---|---|---|
| `vercel.json` | MOD | `installCommand: "bun install"` · `buildCommand: "BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bun run build"` · `outputDirectory: "out"` · headers `COOP: same-origin` + `COEP: require-corp` en `/(.*)` · se conserva `git.deploymentEnabled.main: false` |
| `docs/REPORTE-e14-vercel-perf-v1.md` | NUEVO | este documento |
| `docs/worklog.md` | MOD | entrada del kit (repo no tiene worklog.md en raíz — la convención es `docs/worklog.md`) |
| `docs/DECISIONS.md` | MOD | D46 |
| `docs/ROADMAP.md` | MOD | sección VERCEL-PERF |
| `AGENTS.md` | MOD | línea de registro (convención del repo: cada kit se registra) |

**Cero cambios** en `src/**`, `next.config.ts`, `public/**`, `package.json`, `bun.lock`, `.github/**` (verificado §3).

## 2. T1 — vercel.json

Reemplazo completo por el JSON literal del kit (§2-T1). Notas aplicadas tal cual:
`NEXT_PUBLIC_BASE_PATH=/digielect14` deliberado (paridad `PUBLIC_BASE` de rapidocr/divipol
+ assets del paquete npm con `basePath` de next.config — cero código tocado) y
`deploymentEnabled.main: false` conservado (deploy manual del dueño).

Commit: `feat(e14): vercel.json — demo con COOP/COEP (wasm multihilo) + build estático`

## 3. T2 — Verificación local (evidencias)

1. `bun install` OK (407 paquetes, sin cambios de lockfile).
2. `bun run lint` → **0 errores, 0 warnings**.
3. `bunx tsc --noEmit` → **0 errores** (exit 0).
4. `BUILD_STATIC=1 NEXT_PUBLIC_BASE_PATH=/digielect14 bunx next build` → OK
   (3/3 páginas estáticas; `out/index.html` + `out/_next/**` presentes, 58 MB).
5. Servidor inline `bun -e Bun.serve(:4173)` con los headers EXACTOS (comando del
   kit, sin archivos nuevos) — `curl -I` confirma `Cross-Origin-Opener-Policy:
   same-origin` y `Cross-Origin-Embedder-Policy: require-corp` en la respuesta.
6. Navegador (Chromium del sandbox) sobre `http://localhost:4173/digielect14/`:
   - `self.crossOriginIsolated` → **true** (aislamiento activo, 0 errores COEP/CORP
     en consola, 0 errores de página — nada bloqueado).
   - Escaneo de acta (SIM, pipeline real): pipeline completo **OK** — traza
     `[e14] pipeline SIMULACION/file total=10783ms … motor=worker ocrValido=true
     cabeceraE14=true completa=true score=8.2 … clasif={… nivel:AUTO,
     cod:710007453010102}`; OCR `det=1766ms cls=307ms rec=6599ms · conf 93.3%`;
     desenlace **8.2/10 ÓPTIMA + ENVIADO AUTOMÁTICAMENTE** (idéntico a la línea
     base de kits anteriores — regla de oro §0).
   - `navigator.hardwareConcurrency` del sandbox = **2** → `numThreads =
     min(4, 2) = 2` aquí; en el PC del dueño (4 cores) tomará 4.
7. Servidor detenido. Repo quedó limpio (`out/` gitignored — `git status` vacío).

**NOTA honesta sobre tiempos:** el sandbox NO es el PC del dueño (2 cores
compartidos) — los ms absolutos de aquí NO son comparables con su línea base GH
Pages (rec 23-34 s). La ganancia real (esperada ~1.5-2.5×, no 4× lineal) se mide
EN Vercel con `e14-inspector.js` (PLAN §6). Lo verificable localmente ya está:
aislamiento activo + 0 bloqueos + pipeline idéntico.

**`e14-inspector.js` NO ejecutado:** el kit lo marca «opcional pero deseable» y
es una herramienta externa del dueño (no está en el repo ni fue compartida con
el agente). La evidencia local equivale: trazas `[e14]` + desenlace idéntico.

## 4. Desviaciones

- **Ninguna funcional.** Aclaración menor documentada en §1: el kit lista
  `worklog.md` y el repo no tiene worklog en raíz — se anexó en `docs/worklog.md`
  (ubicación canónica usada por TODOS los kits anteriores). La desviación
  autorizada de antemano (COEP `credentialless`) no hizo falta: `require-corp`
  bloqueó 0 recursos.

## 5. T3 — Documentación

`docs/DECISIONS.md` **D46** (texto del kit) · `docs/ROADMAP.md` sección
VERCEL-PERF (fase 2 Electron queda como opción pendiente del dueño) ·
`docs/worklog.md` entrada completa · `AGENTS.md` línea de registro.

## 6. T4 — PR

Rama `feat/e14-vercel-perf-v1` → **PR DRAFT** «feat(e14): demo Vercel — COOP/COEP
(wasm multihilo)». PROHIBIDO merge / push a main (kit §0).

## 7. Nota para el dueño

Los pasos de deploy están en **PLAN §6** (importar el repo en Vercel o
`bunx vercel deploy --prod`; el build lee TODO de `vercel.json`). El agente NO
los ejecuta. Después: abrir `https://<proyecto>.vercel.app/digielect14/` →
inspector → `crossOriginIsolated === true` → escanear las 2-3 actas de la línea
base → `E14.informe()` → comparar con GH Pages (34-68 s / rec 23-34 s).
