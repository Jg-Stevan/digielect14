# -*- coding: utf-8 -*-
"""laminas.py — Paso 6 del kit FILTROS-1: material visual para la decisión
ESTÉTICA del dueño (el agente NO decide).

  · Por foto: lámina comparativa lado a lado (original | texto-claro | gris)
    con etiquetas grandes + franja de zoom de zonas críticas (cabecera E-14,
    fila ZONA/PUESTO/MESA, código 1D).
  · galeria.html simple (lado a lado, sin JS complejo).

Uso:  python3 laminas.py <out_dir>
      (requiere out/recortes.json + variantes/*.png)
"""

from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np

ESCALA_ZOOM = 2.2
FRANJA_H = 260
ETIQUETAS = {"original": "ORIGINAL", "texto-claro": "TEXTO-CLARO", "gris": "GRIS"}
COLS = ["original", "texto-claro", "gris"]
VERDE = (40, 130, 60)
NEGRO = (25, 25, 25)


def _etiqueta(img: np.ndarray, texto: str) -> np.ndarray:
    barra = np.full((56, img.shape[1], 3), 245, dtype=np.uint8)
    cv2.putText(barra, texto, (14, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.15, NEGRO, 3, cv2.LINE_AA)
    return barra


def _normaliza_alturas(imgs: list[np.ndarray]) -> list[np.ndarray]:
    h = min(i.shape[0] for i in imgs)
    out = []
    for im in imgs:
        if im.shape[0] != h:
            esc = h / im.shape[0]
            im = cv2.resize(im, (int(im.shape[1] * esc), h), interpolation=cv2.INTER_AREA)
        out.append(im)
    return out


def _zoom_franja(variantes: dict[str, np.ndarray]) -> np.ndarray:
    """Franja de zoom: 3 zonas críticas, cada una lado a lado entre los 3
    filtros (cabecera E-14 / fila ZONA-PUESTO-MESA / código 1D)."""
    zonas = [(0.00, 0.22, "CABECERA E-14"), (0.28, 0.42, "ZONA / PUESTO / MESA"), (0.00, 0.10, "CODIGO 1D")]
    franjas = []
    for y0, y1, nombre in zonas:
        trozos = []
        for c in COLS:
            im = variantes[c]
            hh = im.shape[0]
            yy0, yy1 = int(hh * y0), int(hh * y1)
            trozo = im[yy0:yy1, :]
            esc = FRANJA_H * ESCALA_ZOOM / max(1, trozo.shape[0])
            trozo = cv2.resize(trozo, (int(trozo.shape[1] * esc), int(FRANJA_H * ESCALA_ZOOM)), interpolation=cv2.INTER_CUBIC)
            trozos.append(trozo)
        hmax = max(t.shape[0] for t in trozos)
        trozos = [cv2.copyMakeBorder(t, 0, hmax - t.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255)) for t in trozos]
        blanco = np.full((trozos[0].shape[0], 8, 3), 255, dtype=np.uint8)
        fila_img = np.hstack([trozos[0], blanco, trozos[1], blanco, trozos[2]])
        etiqueta = np.full((40, fila_img.shape[1], 3), 245, dtype=np.uint8)
        cv2.putText(etiqueta, nombre, (14, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, NEGRO, 2, cv2.LINE_AA)
        sep = np.full((10, fila_img.shape[1], 3), 200, dtype=np.uint8)
        franjas.append((np.vstack([etiqueta, fila_img, sep]), fila_img.shape[1]))
    wmax = max(w for _, w in franjas)
    filas = []
    for img, w in franjas:
        if w < wmax:
            pad = np.full((img.shape[0], wmax - w, 3), 255, dtype=np.uint8)
            img = np.hstack([img, pad])
        filas.append(img)
    return np.vstack(filas)


def laminas_de_foto(out_dir: str, stem: str) -> str:
    pdir = os.path.join(out_dir, "laminas")
    os.makedirs(pdir, exist_ok=True)
    variantes = {}
    for c in COLS:
        p = os.path.join(out_dir, "variantes", f"{stem}-{c}.png")
        im = cv2.imread(p, cv2.IMREAD_COLOR)
        if im is None:
            raise FileNotFoundError(p)
        variantes[c] = im
    h = min(v.shape[0] for v in variantes.values())
    lado = _normaliza_alturas([variantes[c] for c in COLS])
    con_etiquetas = [np.vstack([_etiqueta(v, ETIQUETAS[c]), v]) for c, v in zip(COLS, lado)]
    sep = np.full((con_etiquetas[0].shape[0], 10, 3), 200, dtype=np.uint8)
    lam = np.hstack([con_etiquetas[0], sep, con_etiquetas[1], sep, con_etiquetas[2]])
    max_w = 4200
    if lam.shape[1] > max_w:
        esc = max_w / lam.shape[1]
        lam = cv2.resize(lam, (max_w, int(lam.shape[0] * esc)), interpolation=cv2.INTER_AREA)
    ruta = os.path.join(pdir, f"lamina-{stem}.png")
    cv2.imwrite(ruta, lam)
    zoom = _zoom_franja(variantes)
    ruta_z = os.path.join(pdir, f"zoom-{stem}.png")
    if zoom.shape[1] > max_w:
        esc = max_w / zoom.shape[1]
        zoom = cv2.resize(zoom, (max_w, int(zoom.shape[0] * esc)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(ruta_z, zoom)
    print(f"[FILTROS-1] lámina {ruta} ({lam.shape[1]}x{lam.shape[0]}) + zoom {ruta_z}")
    return ruta


def galeria(out_dir: str, stems: list[str]) -> str:
    pdir = os.path.join(out_dir, "laminas")
    html = [
        "<!doctype html><html lang='es'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>FILTROS-1 · Galería comparativa E-14</title>",
        "<style>",
        "body{font-family:system-ui,sans-serif;margin:0;background:#f4f4f2;color:#1c1c1c}",
        "header{padding:18px 22px;background:#fff;border-bottom:1px solid #ddd}",
        "h1{font-size:19px;margin:0 0 4px} p{margin:0;color:#666;font-size:13px}",
        "section{margin:22px;padding:14px;background:#fff;border:1px solid #ddd;border-radius:10px}",
        "h2{font-size:15px;margin:0 0 10px}",
        ".fila{display:flex;gap:10px;flex-wrap:wrap}",
        "figure{margin:0;flex:1 1 300px;min-width:280px}",
        "img{width:100%;height:auto;border:1px solid #ccc;border-radius:6px;display:block}",
        "figcaption{font-size:12px;color:#555;padding:6px 2px;text-transform:uppercase;letter-spacing:.06em}",
        ".zoom img{width:100%}",
        "</style></head><body>",
        "<header><h1>FILTROS-1 · Comparativa de filtros del app sobre fotos reales</h1>",
        "<p>Decisión visual del dueño: elige el filtro más agradable a la vista (el agente NO decide).",
        "Motores y métricas: ver resultados.txt / resultados.json del ZIP.</p></header>",
    ]
    for stem in stems:
        html.append(f"<section><h2>{stem}</h2><div class='fila'>")
        for c in COLS:
            html.append(
                f"<figure><img src='variantes/{stem}-{c}.png' alt='{stem} — {ETIQUETAS[c]}'>"
                f"<figcaption>{ETIQUETAS[c]}</figcaption></figure>"
            )
        html.append("</div></section>")
        html.append(f"<section class='zoom'><h2>{stem} — zoom zonas críticas</h2>")
        html.append(f"<img src='laminas/zoom-{stem}.png' alt='zoom de zonas críticas de {stem}'>")
        html.append(f"<img style='margin-top:10px' src='laminas/lamina-{stem}.png' alt='lámina comparativa de {stem}'>")
        html.append("</section>")
    html.append("</body></html>")
    ruta = os.path.join(out_dir, "galeria.html")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write("\n".join(html))
    print(f"[FILTROS-1] galería {ruta}")
    return ruta


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    out_dir = argv[1]
    reg = os.path.join(out_dir, "out", "recortes.json")
    with open(reg, "r", encoding="utf-8") as f:
        recortes = json.load(f)
    stems = [r["stem"] for r in recortes]
    for stem in stems:
        laminas_de_foto(out_dir, stem)
    galeria(out_dir, stems)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
