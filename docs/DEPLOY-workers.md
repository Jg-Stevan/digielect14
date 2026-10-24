# DEPLOY WORKERS DIRECTO — Worker `digielect14e` construye desde este repo

**Qué es:** el proyecto Workers de Cloudflare (`digielect14e`, URL
`https://digielect14e.julistevan02.workers.dev/`) construye y despliega
directamente desde `Jg-Stevan/digielect14` (Opción A de
`ORDEN-SYNC-MIRROR-WORKERS-v1.md`). Ya no depende del mirror `digielect14e`
(repo aparte que había que sincronizar en cada wave — fuente del drift del
build `#8e8effe` que construyó código viejo).

**Fecha:** 2026-10-24 · rama `chore/deploy-workers-directo-v1`

---

## §1 Qué cambió en el repo (una sola vez)

| Archivo | Cambio | Por qué |
|---|---|---|
| `wrangler.jsonc` | **NUEVO** (generado por `opennextjs-cloudflare migrate` v1.20.13, nombre fijado a `digielect14e`) | Config canónica del Worker: `main` `.open-next/worker.js`, assets binding `ASSETS`, images binding `IMAGES`, self-reference `WORKER_SELF_REFERENCE`, flags `nodejs_compat` + `global_fetch_strictly_public` |
| `open-next.config.ts` | **NUEVO** (default, sin R2 incremental cache) | Requerido por `opennextjs-cloudflare build` (falla sin él) |
| `wrangler.toml` | **ELIMINADO** | Era config de PAGES (`pages_build_output_dir`); `migrate`/`wrangler deploy` lo rechazan ("static site or next-on-pages project"). Pages CLI sigue viva con `--project-name` (ver `DEPLOY-cloudflare.md` §2) |
| `package.json` | + scripts `preview`/`deploy`/`upload`/`cf-typegen` + devDeps `@opennextjs/cloudflare ^1.20.13` y `wrangler ^4.152.0` | Mismo estado que inyectaba el build del mirror (verificado en el bundle vivo: scripts + versiones idénticas) |
| `next.config.ts` | + `initOpenNextCloudflareForDev()` al final | Hook de dev de OpenNext (no afecta `next build`) |
| `public/_headers` | + regla cache `/_next/static/*` immutable (append; COOP/COEP intactos) | Caching de estáticos recomendado por OpenNext |
| `knip.json` | + `open-next.config.ts` en `entry` | Evita ruido en el baseline informativo de knip |
| `.gitignore` | + `.open-next`, `.wrangler`, `.dev.vars*` | Artefactos locales de build |

**No cambió:** `src/**` (cero toques), `package.json` name (sigue `digitalizador-e14` — el nombre del Worker vive en `wrangler.jsonc`), workflows GH, la receta Pages (solo pasó el nombre del proyecto a flag).

## §2 Receta CLI (deploy manual)

```bash
git switch main && git pull origin main
bun install
bun run deploy          # = opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

Con token (sin `wrangler login`):

```bash
export CLOUDFLARE_ACCOUNT_ID=d6515fed257a88a14348718d0a45f4be
export CLOUDFLARE_API_TOKEN=<token con permisos Workers Scripts Write>
bun run deploy
```

Primera vez: `bunx opennextjs-cloudflare` necesita `open-next.config.ts` + `wrangler.jsonc` — ya están committeados; no volver a correr `migrate` (regeneraría el nombre genérico).

## §3 Conexión dashboard (automatizar en cada push)

1. dash.cloudflare.com → **Workers & Pages → digielect14e → Settings → Build → Connect** (o *Builds → Repository*).
2. Repo: `Jg-Stevan/digielect14`, rama de producción `main`.
3. Build/Deploy commands: los del preset Next.js/OpenNext (`npx opennextjs-cloudflare build` + `npx opennextjs-cloudflare deploy`) funcionan tal cual con la config committeada.
4. Desconectar el mirror `Jg-Stevan/digielect14e` del proyecto (y opcionalmente archivar ese repo).
5. Cada push a `main` → build verde → deploy automático. El mirror deja de ser necesario.

## §4 Verificación post-deploy

1. `curl -sI https://digielect14e.julistevan02.workers.dev/` → 200.
2. Marcadores wave-2 en el chunk lazy (`/_next/static/chunks/*.js`):
   `tiemposHeredados`, `Reuso excluido de percentiles`, `orientacionProbeMini`,
   `capa3-ya-enviada`, `Tier:` — presentes = está sirviendo el código actual.
3. Lote chico real → informe TXT con `- Tier:` y `- Reuso excluido de percentiles...`;
   protocolo repetidas H1 (re-agregar sin borrar → `YA-ENVIADA`, `capa3-ya-enviada > 0`).

## §5 Reglas duras

- `wrangler.jsonc`: NO renombrar `name`/`service` (rompe el deploy y el self-reference).
- `PROBE_MINI_ANCLAS_MIN = 2` / `PROBE_MINI_CONF_MIN = 0.6`: intactos (igual que en el gate).
- Dos fuentes de verdad NO: este repo es la única fuente del Worker. El mirror `digielect14e` queda congelado/obsoleto a partir de aquí.

## §5 — Binding D1 del ledger remoto (wave3 §A.1 — feat/ledger-remoto-envios-v1)

El Worker lleva el binding `DB_ENVIOS_E14` → D1 `e14-envios-remoto`
(database_id `c5a7be23-bdd3-403b-a550-bcc0316d4a77`, committeado en
`wrangler.jsonc`). La tabla vive en `infra/d1/schema.sql` (aplicada en
remoto; re-aplicar con:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account>
export CLOUDFLARE_API_TOKEN=<token con Workers Scripts Write + D1:Edit>
bunx wrangler d1 execute e14-envios-remoto --remote --file=infra/d1/schema.sql
```

### NOTA pages.dev
Añadir el binding `DB_ENVIOS_E14` en dash → Pages → digielect14 →
Settings → Functions → D1 bindings (si falta, la API responde 500 y el
cliente sigue como hoy — degradación honesta). La route vive en
`src/app/api/e14/envios/route.ts` (implementación en `handler.ts`): el
export estático BUILD_STATIC=1 — GH Pages / out/ — la OMITE sin error
(Next 16 marca POST/DELETE como ƒ Dynamic y no la exporta — el out/ no
trae /api) y el build de servidor la incluye (app-paths-manifest). Sin
segment config (`dynamic`) en la route: force-dynamic ROMPE el export y
un valor condicional no es parseable — hallazgo empírico del PR.

### Reglas duras del ledger (kit §1/§F)
- Al servidor JAMÁS viaja el payload QR completo — solo su SHA-256 + serie
  + filaId + origen.
- `forzarDedupOff` salta TAMBIÉN el remoto (RL-e65b-6).
- `DELETE ?confirmacion=e14-reset-pruebas` SOLO manual (PanelDev, doble
  confirmación) — ni vaciar local ni MODO PRUEBAS borran el remoto.
- Todo fallo de red/D1 → la fila sigue su curso como hoy (el remoto es una
  red EXTRA, jamás una dependencia).
- El registro remoto nace SOLO tras el envío local exitoso (jamás antes);
  offline → nace al drenar (`refrescarEnviosTrasDrenaje`).
