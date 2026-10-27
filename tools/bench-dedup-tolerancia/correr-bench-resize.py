#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Driver headless del banco P3 — KIT e14-dhash-resize-v1 (Task 2-b, SOLO EVIDENCIA).

Corre tools/bench-dedup-tolerancia/bench-resize.html en Chromium headless
(Playwright), ejecuta el corpus sintético A/B (FULL vs RESIZE64 — verbatim del
parche P3) y escribe los outputs en resultados/ con nombres estables:

    resultados/bench-dhash-resize-resultado.json
    resultados/bench-dhash-resize-resultado.md

Uso (desde la RAÍZ del repo o desde tools/bench-dedup-tolerancia/):

    python3 tools/bench-dedup-tolerancia/correr-bench-resize.py

Requisitos del sandbox: playwright (python) + chromium instalados. NO cambia
nada de producción (src/ y public/ intactos). Las FOTOS REALES del dueño
corren desde el botón de la página (este driver solo cubre el sintético —
mismo alcance del kit B7: el corpus real es pendiente del dueño).
"""
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
PAGINA = AQUI / "bench-resize.html"
SALIDAS = AQUI / "resultados"


def main() -> int:
    if not PAGINA.exists():
        print(f"FAIL · no existe la página del banco: {PAGINA}")
        return 1
    SALIDAS.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        pagina = browser.new_page()
        errores_console: list[str] = []
        pagina.on(
            "pageerror",
            lambda exc: errores_console.append(f"pageerror: {exc}"),
        )
        pagina.on(
            "console",
            lambda msg: errores_console.append(f"console.{msg.type}: {msg.text}")
            if msg.type == "error"
            else None,
        )
        pagina.goto(PAGINA.as_uri())
        pagina.wait_for_function("typeof window.__correrSintetico === 'function'", timeout=30_000)

        # Correr el sintético A/B (la página hace el log visible y el veredicto):
        pagina.evaluate("() => window.__correrSintetico()")
        pagina.wait_for_function("window.__listo === true", timeout=180_000)

        resultado = pagina.evaluate("() => window.__benchJson")
        md = pagina.evaluate("() => window.__generarMd(window.__benchJson)")
        browser.close()

    if not resultado or not resultado.get("veredicto"):
        print("FAIL · el banco no produjo veredicto")
        return 1

    ruta_json = SALIDAS / "bench-dhash-resize-resultado.json"
    ruta_md = SALIDAS / "bench-dhash-resize-resultado.md"
    ruta_json.write_text(json.dumps(resultado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    ruta_md.write_text(md + "\n", encoding="utf-8")

    s = (resultado.get("sintetico", {}).get("fotoActa") or {}).get("resumen", {})
    st = (resultado.get("sintetico", {}).get("actaLike") or {}).get("resumen", {})
    t = resultado.get("sintetico", {}).get("timing12MP", {})
    diag = resultado.get("veredicto", {})
    go = diag.get("go")
    print("── BANCO P3 — dhash FULL vs RESIZE64 (corrida headless) ──")
    print("[PRIMARIO fotoActa 12 MP — corpus del veredicto]")
    print(f"maxHammingSelfCruce          = {s.get('maxHammingSelfCruce')} (meta ≤ 4)")
    print(f"maxHammingGemelasCruce       = {s.get('maxHammingGemelasCruce')} (meta ≤ 4)")
    print(f"maxHammingGemelasIntraFull   = {s.get('maxHammingGemelasIntraFull')} (sanity ≤ 6 — corpus válido: {s.get('sanityFullSano')})")
    print(f"maxHammingGemelasIntraResize = {s.get('maxHammingGemelasIntraResize64')} (sanity ≤ 6)")
    print(f"minHammingNoGemelasCruce     = {s.get('minHammingNoGemelasCruce')} (meta > 12)")
    print("[DIAGNÓSTICO evidence-only resizeProp64 (aspect preservado)]")
    print(f"maxHammingSelfCruceProp      = {s.get('maxHammingSelfCruceProp')} (meta ≤ 4)")
    print(f"maxHammingGemelasCruceProp   = {s.get('maxHammingGemelasCruceProp')} (meta ≤ 4)")
    print("[STRESS actaLike 1000×2920 (NO decide)]")
    print(f"maxHammingSelfCruce          = {st.get('maxHammingSelfCruce')} · sanity FULL sano: {st.get('sanityFullSano')}")
    print("[Timing+RAM 12 MP — DESKTOP headless (no representativo del dueño)]")
    print(f"p50 full/resize64/prop64     = {t.get('full', {}).get('p50Ms')}ms / {t.get('resize64', {}).get('p50Ms')}ms / {t.get('resizeProp64', {}).get('p50Ms')}ms")
    for r in diag.get("razones", []):
        print(f"· {r}")
    for c in errores_console:
        print(f"WARN console: {c}")
    print(f"VEREDICTO SINTÉTICO (fotoActa): {'GO' if go else 'NO-GO'}")
    print(f"Outputs: {ruta_json}")
    print(f"         {ruta_md}")
    return 0 if go else 2


if __name__ == "__main__":
    sys.exit(main())
