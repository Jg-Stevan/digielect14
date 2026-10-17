# -*- coding: utf-8 -*-
"""bench.py — Pasos 3-5 del kit FILTROS-1: matriz 2 motores × 3 filtros × 4
fotos × 3 runs = 72 inferencias, medianas, métricas y ranking.

Uso:
  python3 bench.py <out_dir>                                   # corrida oficial
  python3 bench.py <out_dir> --humo <foto.jpg>                 # smoke 1 foto (18 inf.)
  python3 bench.py <out_dir> --gen-gt <foto.jpg>               # consenso GT EG → lab/gt/

Insumos:
  <out_dir>/variantes/*.jpg   (los 3 filtros por foto, de variantes.py)
  lab/fotos/manifest.json     ([{"archivo": "...", "gt": "F"|"EG"}] — si falta,
                              la GT se resuelve sola por código 1D en el texto)
  lab/gt/EG-P1.txt            (GT de líneas EG generada por --gen-gt; opcional)

Sanidad del kit §1: RapidOCR con anclas < 40/56 o CER > 50% → exit 3 (detener).
"""

from __future__ import annotations

import json
import os
import statistics
import sys
from typing import Optional

import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gt.gt import (  # noqa: E402
    ANCLAS_F_P1,
    GT_ANCLAS,
    GT_F_LINES,
    anclas_gt,
    cer,
    gt_de_texto,
    lineas_gt,
    numeros_exactos,
)
from ocr_engines import RapidOCRV4, TesseractTuned, motores_disponibles  # noqa: E402

MOTORES = ["rapidocr-v4", "tesseract-tuned"]
FILTROS = ["original", "texto-claro", "gris"]
RUNS = 3
LOG = "[FILTROS-1]"


def log(msg: str) -> None:
    print(f"{LOG} {msg}", flush=True)


def gt_lineas_para(gt_key: str, lab_dir: str) -> Optional[list[str]]:
    """GT de líneas: F → GT_F_LINES (Apéndice B); EG → lab/gt/EG-P1.txt si ya
    fue generada (kit §3: consenso UNA vez, reuso futuro)."""
    if gt_key == "F":
        return GT_F_LINES
    ruta = os.path.join(lab_dir, "gt", "EG-P1.txt")
    if os.path.isfile(ruta):
        with open(ruta, "r", encoding="utf-8") as f:
            return [ln.rstrip("\n") for ln in f if ln.strip()]
    return None


def evaluar_celda(texto: str, gt_key: str, gt_lines: Optional[list[str]]) -> dict:
    """Métricas de una celda (kit §5). gt_key "P1HUMO" = subset de anclas F
    válido para la página 1 (sin Ver-Pag/CONSTANCIAS/FIRMA) — solo humo."""
    if gt_key == "P1HUMO":
        hits, miss = 0, []
        tabla = dict(GT_ANCLAS["F"])
        for nombre in ANCLAS_F_P1:
            if tabla[nombre].search(texto):
                hits += 1
            else:
                miss.append(nombre)
        n_ok, _, ok_list = numeros_exactos(texto, "F")
        return {"anclas": {"hits": hits, "total": len(ANCLAS_F_P1), "miss": miss}, "num": {"ok": n_ok, "lista": ok_list}}
    hits, total, miss = anclas_gt(texto, gt_key)
    n_ok, _, ok_list = numeros_exactos(texto, gt_key)
    out = {"anclas": {"hits": hits, "total": total, "miss": miss}, "num": {"ok": n_ok, "lista": ok_list}}
    if gt_lines:
        out["cer"] = round(cer(texto, gt_lines), 1)
        rec, tot, falladas = lineas_gt(texto, gt_lines)
        out["lineas"] = {"rec": rec, "total": tot, "falladas": falladas}
    return out


def fotos_oficiales(out_dir: str, lab_dir: str):
    """[(stem, gt_key|None, {filtro: ruta_jpg})] desde out/recortes.json."""
    reg = os.path.join(out_dir, "out", "recortes.json")
    if not os.path.isfile(reg):
        raise FileNotFoundError(f"{reg} — corre variantes.py primero")
    manifest: dict[str, str] = {}
    mpath = os.path.join(lab_dir, "fotos", "manifest.json")
    if os.path.isfile(mpath):
        with open(mpath, "r", encoding="utf-8") as f:
            manifest = {m["archivo"]: m.get("gt") for m in json.load(f)}
    with open(reg, "r", encoding="utf-8") as f:
        recortes = json.load(f)
    vdir = os.path.join(out_dir, "variantes")
    fotos = []
    for r in recortes:
        stem, gt = r["stem"], manifest.get(r["foto"])
        rutas = {f: os.path.join(vdir, f"{stem}-{f}.jpg") for f in FILTROS}
        faltan = [p for p in rutas.values() if not os.path.isfile(p)]
        if faltan:
            raise FileNotFoundError(f"variantes faltantes para {stem}: {faltan}")
        fotos.append((stem, gt, rutas))
    return fotos


def main(argv: list[str]) -> int:
    out_dir = argv[1]
    lab_dir = os.path.dirname(os.path.abspath(__file__))
    modo = "oficial"
    foto_humo: Optional[str] = None
    if "--humo" in argv:
        modo = "humo"
        foto_humo = argv[argv.index("--humo") + 1]
        stem_humo = os.path.splitext(os.path.basename(foto_humo))[0]
        fotos = [(stem_humo, None, {f: os.path.join(out_dir, "variantes", f"{stem_humo}-{f}.jpg") for f in FILTROS})]
    elif "--gen-gt" in argv:
        return gen_gt(out_dir, lab_dir, argv[argv.index("--gen-gt") + 1])
    else:
        fotos = fotos_oficiales(out_dir, lab_dir)

    disp = motores_disponibles()
    faltan = [m for m, ok in disp.items() if not ok]
    if faltan:
        log(f"ERROR motores no disponibles: {faltan} — corre lab/setup_env.sh")
        return 2

    total_inf = len(fotos) * len(MOTORES) * len(FILTROS) * RUNS
    log(f"fotos: {len(fotos)} · matriz {len(MOTORES)}×{len(FILTROS)}×{len(fotos)}×{RUNS} = {total_inf} inferencias")

    rapid = RapidOCRV4(1920)
    log(f"carga rapidocr-v4 (medida APARTE, kit §8.1): {rapid.carga_ms} ms")
    tess = TesseractTuned()

    registros = []
    for stem, gt_manifest, rutas in fotos:
        for filtro in FILTROS:
            img = cv2.imread(rutas[filtro], cv2.IMREAD_COLOR)
            if img is None:
                log(f"ERROR leyendo {rutas[filtro]}")
                return 2
            for motor in MOTORES:
                runs = []
                texto = ""
                for r in range(RUNS):
                    if motor == "rapidocr-v4":
                        texto, conf, ms = rapid.inferir(img)
                    else:
                        texto, conf, ms = tess.inferir(img)
                    runs.append({"ms": ms, "conf": round(conf, 1), "chars": len(texto), "palabras": len(texto.split())})
                    log(f"celda {stem}/{filtro}/{motor} run{r + 1}: {ms} ms conf={conf:.1f} chars={len(texto)}")
                # GT: manifest → auto por código 1D → humo P1
                gt_final = gt_manifest or gt_de_texto(texto)
                if modo == "humo":
                    gt_final = "P1HUMO" if not gt_final else gt_final
                gt_lines = gt_lineas_para(gt_final, lab_dir) if gt_final in ("F", "EG") else None
                metrics = evaluar_celda(texto, gt_final or "", gt_lines)
                med_ms = statistics.median(x["ms"] for x in runs)
                med_conf = statistics.median(x["conf"] for x in runs)
                registros.append({
                    "foto": stem, "filtro": filtro, "motor": motor, "gt": gt_final,
                    "runs": runs, "ms_mediana": med_ms, "conf_mediana": med_conf,
                    "texto": texto, "metrics": metrics,
                })
                extra = f" · CER {metrics['cer']}%" if "cer" in metrics else ""
                log(f"celda {stem}/{filtro}/{motor} → mediana {med_ms:.0f} ms · anclas {metrics['anclas']['hits']}/{metrics['anclas']['total']}{extra}")

    resumen: dict = {
        "modo": modo,
        "carga_rapidocr_ms": rapid.carga_ms,
        "sanidad": None,
        "celdas": [{k: v for k, v in r.items() if k != "texto"} for r in registros],
        "textos": {f"{r['foto']}/{r['filtro']}/{r['motor']}": r["texto"] for r in registros},
    }

    if modo == "oficial":
        rap = [r for r in registros if r["motor"] == "rapidocr-v4"]
        rap_anclas = sum(r["metrics"]["anclas"]["hits"] for r in rap)
        cers = [r["metrics"]["cer"] for r in rap if "cer" in r["metrics"]]
        ok_anclas = rap_anclas >= 40
        ok_cer = all(c <= 50.0 for c in cers) if cers else False
        resumen["sanidad"] = {
            "rapidocr_anclas_totales": rap_anclas, "umbral_anclas": 40,
            "cer_max": max(cers) if cers else None, "ok": ok_anclas and ok_cer,
        }
        log(f"SANIDAD: rapidocr anclas {rap_anclas}/56 · cer_max {resumen['sanidad']['cer_max']} → {'OK' if resumen['sanidad']['ok'] else 'FALLO (kit §1: detener)'}")
        guardar(resumen, out_dir)
        if not resumen["sanidad"]["ok"]:
            return 3
    else:
        guardar(resumen, out_dir)
    return 0


def gen_gt(out_dir: str, lab_dir: str, foto_variantes_stem: str) -> int:
    """Kit §3: GT de líneas de la foto EG por CONSENSO de rapidocr+raw full-res
    y tesseract-full-res, validado contra anclas/campos → lab/gt/EG-P1.txt."""
    ruta = os.path.join(out_dir, "variantes", f"{foto_variantes_stem}-original.jpg")
    if not os.path.isfile(ruta):
        log(f"ERROR falta la variante original: {ruta}")
        return 2
    img = cv2.imread(ruta, cv2.IMREAD_COLOR)
    rapid = RapidOCRV4(1920)
    t_rap, _, _ = rapid.inferir(img)
    tess = TesseractTuned()
    t_tes, _, _ = tess.inferir(img)
    hits_rap = anclas_gt(t_rap, "EG")[0]
    hits_tes = anclas_gt(t_tes, "EG")[0]
    base, base_txt = (t_rap, t_rap) if hits_rap >= hits_tes else (t_tes, t_tes)
    l_rap = [ln.strip() for ln in t_rap.splitlines() if ln.strip()]
    l_tes = [ln.strip() for ln in t_tes.splitlines() if ln.strip()]
    consenso: list[str] = []
    usados = set()
    for ln in l_rap:
        mejor, mejor_sim = None, 0.0
        for lt in l_tes:
            from gt.gt import sim, norm

            s = sim(norm(ln), norm(lt))
            if s > mejor_sim:
                mejor, mejor_sim = lt, s
        if mejor_sim >= 0.8 and mejor not in consenso:
            consenso.append(ln)  # versión de rapidocr cuando ambos acuerdan
            usados.add(mejor)
        else:
            consenso.append(ln)
    for lt in l_tes:
        if lt not in usados and lt not in consenso:
            consenso.append(lt)  # líneas que solo tesseract vio
    hits = anclas_gt("\n".join(consenso), "EG")
    log(f"GT EG consenso: {len(consenso)} líneas · anclas {hits[0]}/{hits[1]} · campos {numeros_exactos(chr(10).join(consenso), 'EG')}")
    destino = os.path.join(lab_dir, "gt", "EG-P1.txt")
    with open(destino, "w", encoding="utf-8") as f:
        f.write("\n".join(consenso) + "\n")
    log(f"guardado {destino} — revísala antes de la corrida oficial (kit §3: validada contra anclas y campos)")
    return 0


def guardar(resumen: dict, out_dir: str) -> None:
    od = os.path.join(out_dir, "out")
    os.makedirs(od, exist_ok=True)
    nombre = "resultados-humo.json" if resumen["modo"] == "humo" else "resultados.json"
    with open(os.path.join(od, nombre), "w", encoding="utf-8") as f:
        json.dump(resumen, f, ensure_ascii=False, indent=2)
    log(f"guardado {nombre}")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
