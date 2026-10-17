# -*- coding: utf-8 -*-
"""zip_pack.py — Paso 7 del kit FILTROS-1: comparativa-filtros-e14-YYYYMMDD.zip
(< 30 MB) con /variantes · /laminas · galeria.html · resultados.json/.txt ·
/textos (24 .txt = 4 fotos × 3 filtros × 2 motores).

Uso: python3 zip_pack.py <out_dir> <destino.zip>
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import zipfile

MAX_MB = 30
TXT_CHARS = 1200  # mismo techo del TXT del informe (los completos van en JSON)


def _txt_de_celda(texto: str) -> str:
    return texto[:TXT_CHARS]


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    out_dir, destino = argv[1], argv[2]
    fecha = datetime.date.today().strftime("%Y%m%d")
    if destino.endswith(".zip"):
        destino = destino[:-4]
    destino = f"{destino}-{fecha}.zip" if not destino.endswith(f"-{fecha}") else destino

    con_resultados = os.path.isfile(os.path.join(out_dir, "out", "resultados.json"))
    nombre_res = "resultados" if con_resultados else "resultados-humo"
    with open(os.path.join(out_dir, "out", f"{nombre_res}.json"), "r", encoding="utf-8") as f:
        res = json.load(f)

    total = 0
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        # /variantes (12 imágenes oficiales o las del humo)
        vdir = os.path.join(out_dir, "variantes")
        for fn in sorted(os.listdir(vdir)):
            if fn.endswith(".jpg"):
                z.write(os.path.join(vdir, fn), arcname=f"variantes/{fn}")
                total += os.path.getsize(os.path.join(vdir, fn))
        # /laminas + galería (si ya se generaron)
        ldir = os.path.join(out_dir, "laminas")
        if os.path.isdir(ldir):
            for fn in sorted(os.listdir(ldir)):
                z.write(os.path.join(ldir, fn), arcname=f"laminas/{fn}")
                total += os.path.getsize(os.path.join(ldir, fn))
        gal = os.path.join(out_dir, "galeria.html")
        if os.path.isfile(gal):
            z.write(gal, arcname="galeria.html")
            total += os.path.getsize(gal)
        # resultados JSON + TXT
        z.write(os.path.join(out_dir, "out", f"{nombre_res}.json"), arcname=f"{nombre_res}.json")
        total += os.path.getsize(os.path.join(out_dir, "out", f"{nombre_res}.json"))
        ruta_txt = os.path.join(out_dir, "out", f"{nombre_res}.txt")
        if os.path.isfile(ruta_txt):
            z.write(ruta_txt, arcname=f"{nombre_res}.txt")
            total += os.path.getsize(ruta_txt)
        # /textos — salida OCR cruda por celda (oficial: 24)
        for clave, texto in res.get("textos", {}).items():
            nombre = clave.replace("/", "__") + ".txt"
            data = _txt_de_celda(texto)
            z.writestr(f"textos/{nombre}", data)
            total += len(data.encode("utf-8"))

    mb = os.path.getsize(destino) / 1e6
    print(f"[FILTROS-1] ZIP {destino} — {mb:.1f} MB (límite {MAX_MB})")
    if mb > MAX_MB:
        print("[FILTROS-1] ERROR: ZIP supera 30 MB (kit §7)")
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
