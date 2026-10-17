# -*- coding: utf-8 -*-
"""reporte.py — Paso 5 del kit FILTROS-1: resultados.txt (mismo estilo del
informe de telemetría: tablas, ranking, tiempos, CER, recomendación) a partir
de out/resultados.json.

Criterio de elección lectura/coherencia (kit §5):
  1º anclas totales (desempate: líneas GT) · 2º CER promedio · 3º tiempo mediana.
Reporta ganador general Y ganador por motor.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from collections import defaultdict

FILTROS = ["original", "texto-claro", "gris"]
MOTORES = ["rapidocr-v4", "tesseract-tuned"]


def _fmt(x, suf=""):
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.1f}{suf}"
    return f"{x}{suf}"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    out_dir = argv[1]
    od = os.path.join(out_dir, "out")
    ruta = os.path.join(od, "resultados.json")
    if not os.path.isfile(ruta):
        ruta = os.path.join(od, "resultados-humo.json")
    with open(ruta, "r", encoding="utf-8") as f:
        res = json.load(f)
    celdas = res["celdas"]
    humo = res.get("modo") == "humo"
    L: list[str] = []
    L.append("INFORME FILTROS-1 — Comparativa 2 motores × 3 filtros sobre fotos reales E-14")
    L.append("=" * 78)
    L.append(f"Modo: {res.get('modo')} · inferencias: {len(celdas) * 3} (3 runs por celda, MEDIANAS)")
    L.append(f"Carga de modelo RapidOCR (medida aparte, kit §8.1): {res.get('carga_rapidocr_ms')} ms")
    if res.get("sanidad"):
        s = res["sanidad"]
        L.append(f"Sanidad kit §1: rapidocr anclas {s['rapidocr_anclas_totales']}/56 · CER máx {s['cer_max']}% → {'OK' if s['ok'] else 'FALLO — setup mal, revisar antes de continuar'}")
    L.append("")

    # ── tabla por combinación motor × filtro (agregado sobre fotos) ──────────
    L.append("RANKING POR COMBINACIÓN motor × filtro" + (" (HUMO: 1 foto)" if humo else " (4 fotos)"))
    L.append("-" * 78)
    combo: dict[tuple, list] = defaultdict(list)
    for c in celdas:
        combo[(c["motor"], c["filtro"])].append(c)

    def llave(items):
        anclas = sum(i["metrics"]["anclas"]["hits"] for i in items)
        lineas = sum(i["metrics"].get("lineas", {}).get("rec", 0) for i in items)
        cers = [i["metrics"]["cer"] for i in items if "cer" in i["metrics"]]
        cer_prom = statistics.mean(cers) if cers else None
        t = statistics.median(i["ms_mediana"] for i in items)
        return anclas, lineas, cer_prom, t

    filas = []
    for (motor, filtro), items in combo.items():
        a, ln, cer_p, t = llave(items)
        filas.append((a, ln, cer_p, t, motor, filtro, len(items)))
    filas.sort(key=lambda f: (-f[0], -f[1], f[2] if f[2] is not None else 9999, f[3]))
    L.append(f"{'motor':<16} {'filtro':<13} {'anclas':>8} {'líneas':>8} {'CER prom':>9} {'t mediana':>10}")
    for a, ln, cer_p, t, motor, filtro, n in filas:
        L.append(f"{motor:<16} {filtro:<13} {a:>8} {ln:>8} {_fmt(cer_p, '%'):>9} {_fmt(t, ' ms'):>10}")
    L.append("")

    # ── ganador general y por motor (kit §5) ─────────────────────────────────
    if not humo:
        L.append("GANADOR LECTURA/COHERENCIA")
        L.append("-" * 78)
        a, ln, cer_p, t, motor, filtro, _ = filas[0]
        L.append(f"General: {motor} + {filtro} — anclas {a}/56 · líneas {ln} · CER {_fmt(cer_p, '%')} · {_fmt(t, ' ms')}")
        for m in MOTORES:
            sub = [f for f in filas if f[4] == m]
            if sub:
                a, ln, cer_p, t, _, filtro, _ = sub[0]
                L.append(f"Mejor con {m}: {filtro} — anclas {a} · líneas {ln} · CER {_fmt(cer_p, '%')} · {_fmt(t, ' ms')}")
        L.append("")

    # ── detalle por celda ────────────────────────────────────────────────────
    L.append("DETALLE POR CELDA (mediana de 3 runs)")
    L.append("-" * 78)
    for c in celdas:
        m = c["metrics"]
        an = f"anclas {m['anclas']['hits']}/{m['anclas']['total']}"
        if m["anclas"]["miss"]:
            an += f" (miss: {', '.join(m['anclas']['miss'])})"
        extra = ""
        if "cer" in m:
            extra += f" · CER {m['cer']}%"
        if "lineas" in m:
            extra += f" · líneas {m['lineas']['rec']}/{m['lineas']['total']}"
        num = m.get("num", {})
        if num.get("ok") is not None:
            extra += f" · números {num['ok']}/5 ({', '.join(num['lista']) or 'ninguno'})"
        ms3 = [r["ms"] for r in c["runs"]]
        stab = f"runs {min(ms3)}-{max(ms3)} ms (Δ{max(ms3) - min(ms3)})"
        L.append(f"  {c['foto']} · {c['filtro']:<12} · {c['motor']:<15} → {_fmt(c['ms_mediana'], ' ms')} · conf {_fmt(c['conf_mediana'], '/100')} · {an}{extra}")
        L.append(f"    {stab} · chars {c['runs'][0]['chars']} · palabras {c['runs'][0]['palabras']}")
    L.append("")

    # ── tiempos de filtro (construcción de la variante) ──────────────────────
    reg = os.path.join(out_dir, "out", "recortes.json")
    if os.path.isfile(reg):
        with open(reg, "r", encoding="utf-8") as f:
            recortes = json.load(f)
        L.append("TIEMPOS DE CONSTRUCCIÓN DE FILTRO (variantes.py, mediana no aplica: 1 por foto)")
        L.append("-" * 78)
        for r in recortes:
            for filtro, v in r["variantes"].items():
                L.append(f"  {r['stem']:<34} {filtro:<12} {v['ms_filtro']:>6} ms · {v['bytes_jpg']//1024} KB jpg · crop {v['dims'][0]}×{v['dims'][1]} ({r['crop'].get('metodo')}, {r['crop'].get('ms_crop')} ms)")
        L.append("")

    L.append("NOTAS")
    L.append("-" * 78)
    L.append("· bw DESCARTADO por el kit (corrompió datos: KIT 399→300, dígito del 1D cambiado).")
    L.append("· 'texto-claro' NO degenera en binarización dura: es el modo 'text' del worker")
    L.append("  (F-TEXT-CLEAN: LUT sigmoidal + afilado selectivo, papel ≥ 0.92 → blanco).")
    L.append("· CER/anclas/líneas: normalización idéntica al informe (gt/gt.py, fuente analisis-texto.ts).")
    if humo:
        L.append("· MODO HUMO: valida el rig con 1 foto — NO son los números oficiales del kit.")
    destino = os.path.join(out_dir, "out", "resultados-humo.txt" if humo else "resultados.txt")
    with open(destino, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print(f"[FILTROS-1] reporte {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
