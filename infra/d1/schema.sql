-- WAVE3 §A.1 — ORDEN-WAVE3-remoto-rescate-obs-v1 (feat/ledger-remoto-envios-v1)
-- Ledger REMOTO de envíos (idempotencia REAL — la garantía vive FUERA del
-- navegador: el gap real del lote 9 fue doble envío tras borrar IndexedDB y
-- cambiar de origen, workers.dev → pages.dev).
-- PRIVACIDAD dura: al servidor JAMÁS viaja el payload QR completo — solo su
-- SHA-256 (llave EXACTA, sin fuzzy), la serie y metadatos mínimos.
-- Aplicar: bunx wrangler d1 execute e14-envios-remoto --remote --file=infra/d1/schema.sql
CREATE TABLE IF NOT EXISTS envios (
  payload_hash TEXT PRIMARY KEY,  -- SHA-256 del payload QR (llave EXACTA, sin fuzzy)
  serie         TEXT,             -- identidad leída (puede venir null)
  fila_id       TEXT,             -- fila origen (post-mortem)
  origen_url    TEXT,             -- pages.dev | workers.dev (diagnóstico cross-origen)
  ts            INTEGER NOT NULL  -- epoch ms del registro
);
