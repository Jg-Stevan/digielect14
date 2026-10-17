# -*- coding: utf-8 -*-
"""variantes.py — Paso 2 del kit FILTROS-1: por foto, recorte nativo y las 3
variantes original / texto-claro / gris con los filtros del app (JPEG q90 +
PNG para láminas).

Uso:
  python3 variantes.py <foto.jpg> <out_dir>
Salida (out_dir/variantes):
  <stem>-original.jpg/.png · <stem>-texto-claro.jpg/.png · <stem>-gris.jpg/.png
  + <out_dir>/out/recortes.json (dims y método de crop por foto).
"""

from __future__ import annotations

import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crop_acta import crop_acta  # noqa: E402
from filtros_app import aplicar_filtro  # noqa: E402

Q_JPEG = 90  # kit §6.2 (JPEG q85–90; q90 elegido, mismo valor en galería)


def generar_variantes(foto_path: str, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    bgr = cv2.imread(foto_path, cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"No pude leer {foto_path}")
    t0 = time.perf_counter()
    rec, info_crop = crop_acta(bgr)
    info_crop["ms_crop"] = int((time.perf_counter() - t0) * 1000)

    rgb = cv2.cvtColor(rec, cv2.COLOR_BGR2RGB)
    stem = os.path.splitext(os.path.basename(foto_path))[0]
    vdir = os.path.join(out_dir, "variantes")
    os.makedirs(vdir, exist_ok=True)
    resumen = {"foto": os.path.basename(foto_path), "stem": stem, "crop": info_crop, "variantes": {}}
    for nombre in ("original", "texto-claro", "gris"):
        t0 = time.perf_counter()
        rgb_f = aplicar_filtro(rgb, nombre)
        ms_filtro = int((time.perf_counter() - t0) * 1000)
        jpg = os.path.join(vdir, f"{stem}-{nombre}.jpg")
        png = os.path.join(vdir, f"{stem}-{nombre}.png")
        cv2.imwrite(jpg, cv2.cvtColor(rgb_f, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, Q_JPEG])
        cv2.imwrite(png, cv2.cvtColor(rgb_f, cv2.COLOR_RGB2BGR))
        resumen["variantes"][nombre] = {
            "jpg": os.path.relpath(jpg, out_dir),
            "png": os.path.relpath(png, out_dir),
            "ms_filtro": ms_filtro,
            "dims": [rgb_f.shape[1], rgb_f.shape[0]],
            "bytes_jpg": os.path.getsize(jpg),
        }
        print(f"[FILTROS-1] variante {stem}/{nombre} filtro={ms_filtro}ms dims={resumen['variantes'][nombre]['dims']} jpg={resumen['variantes'][nombre]['bytes_jpg']}B", flush=True)
    return resumen


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    foto, out_dir = argv[1], argv[2]
    res = generar_variantes(foto, out_dir)
    reg = os.path.join(out_dir, "out", "recortes.json")
    os.makedirs(os.path.dirname(reg), exist_ok=True)
    existente: list = []
    if os.path.isfile(reg):
        with open(reg, "r", encoding="utf-8") as f:
            existente = json.load(f)
    existente = [r for r in existente if r["foto"] != res["foto"]] + [res]
    with open(reg, "w", encoding="utf-8") as f:
        json.dump(existente, f, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
