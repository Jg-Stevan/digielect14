# -*- coding: utf-8 -*-
"""ocr_engines.py — Los 2 motores del kit FILTROS-1 §3:

  · rapidocr-v4   — RapidOCR PP-OCRv4, «mismo setup del lab (det+cls+rec,
                    det_limit_side_len=1920)». La CARGA del modelo se mide
                    SEPARADA de la inferencia (kit §8.1: en móvil fue
                    det 1.1–3.1 s + rec 5.0–6.9 s): clase con sesión reutilizada
                    entre fotos (inferencia pura) + reporte de carga aparte.
  · tesseract-tuned — Tesseract a resolución completa. ADVERTENCIA de
                    proveniencia: la config exacta que logró 39/56 en el lab
                    previo se perdió con el sandbox (scripts no commiteados).
                    Perfil reconstruido: spa (tessdata_best) · --oem 1 (LSTM)
                    · --psm 6 · DPI del recorte. Documentado como aproximación
                    en README.md §Desviaciones.

RapidOCR: se usa el paquete rapidocr_onnxruntime==1.4.4 (el mismo del bench
del dueño; los modelos PP-OCRv4 vienen embebidos en el paquete — kit §2.2
prohíbe commitear ONNX al repo). det limit 1920/max = informe §4.3 («det limit
1920/max = bench del dueño»).
"""

from __future__ import annotations

import os
import subprocess
import time
from typing import Optional

TESSDATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "tessdata")


class RapidOCRV4:
    """Sesión única reutilizable. Primera llamada reporta la carga aparte."""

    def __init__(self, det_limit_side_len: int = 1920):
        self.carga_ms: Optional[int] = None
        t0 = time.perf_counter()
        from rapidocr_onnxruntime import RapidOCR  # import pesado = parte de la carga

        self.engine = RapidOCR(det_limit_side_len=det_limit_side_len, det_limit_type="max")
        # Warm-up real (construcción de sesiones ONNX perezosa):
        import numpy as np

        blanco = np.full((64, 64, 3), 255, dtype=np.uint8)
        self.engine(blanco)
        self.carga_ms = int((time.perf_counter() - t0) * 1000)

    def inferir(self, bgr: "np.ndarray") -> tuple[str, float]:
        """Devuelve (texto, conf_media_0_100). NO recarga modelos."""
        import numpy as np

        t0 = time.perf_counter()
        resultado, elapse = self.engine(bgr)
        ms = int((time.perf_counter() - t0) * 1000)
        lineas, confs = [], []
        if resultado:
            for caja, txt, conf in resultado:
                lineas.append(txt)
                confs.append(float(conf))
        texto = "\n".join(lineas)
        conf_media = (sum(confs) / len(confs) * 100.0) if confs else 0.0
        return texto, conf_media, ms

    @staticmethod
    def reordenar_por_y(texto: str) -> str:
        """RapidOCR entrega cajas en orden de lectura; el texto ya viene
        ordenado por el motor — se respeta tal cual (igual que el informe)."""
        return texto


class TesseractTuned:
    """Tesseract CLI a resolución completa (perfil «tuned» reconstruido)."""

    LANG = "spa"

    def __init__(self):
        if not os.path.isdir(TESSDATA_DIR):
            raise FileNotFoundError(
                f"Falta {TESSDATA_DIR} — corre lab/setup_env.sh (descarga spa.traineddata de tessdata_best)."
            )

    def inferir(self, bgr: "np.ndarray") -> tuple[str, float, int]:
        import cv2

        t0 = time.perf_counter()
        ok, png = cv2.imencode(".png", bgr)
        if not ok:
            raise RuntimeError("no pude codificar PNG para tesseract")
        env = dict(os.environ)
        env["TESSDATA_PREFIX"] = TESSDATA_DIR
        # --psm 6: bloque uniforme de texto (la ficha E-14 es una columna).
        proc = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", self.LANG, "--oem", "1", "--psm", "6", "tsv"],
            input=png.tobytes(),
            capture_output=True,
            env=env,
            check=False,
        )
        ms = int((time.perf_counter() - t0) * 1000)
        texto, conf = self._tsv_a_texto(proc.stdout.decode("utf-8", "replace"))
        return texto, conf, ms

    @staticmethod
    def _tsv_a_texto(tsv: str) -> tuple[str, float]:
        """TSV → texto por líneas (orden de lectura del TSV) + conf media."""
        lineas: dict[tuple, list] = {}
        confs = []
        for row in tsv.splitlines()[1:]:
            cols = row.split("\t")
            if len(cols) < 12:
                continue
            try:
                level = int(cols[0])
                conf = float(cols[10])
            except ValueError:
                continue
            if level != 5:
                continue
            palabra = cols[11].strip()
            if not palabra:
                continue
            key = (int(cols[2]), int(cols[3]), int(cols[4]))  # block/par/line
            lineas.setdefault(key, []).append(palabra)
            if conf >= 0:
                confs.append(conf)
        texto = "\n".join(" ".join(palabras) for palabras in lineas.values())
        conf_media = sum(confs) / len(confs) if confs else 0.0
        return texto, conf_media


def motores_disponibles() -> dict:
    out = {}
    try:
        import rapidocr_onnxruntime  # noqa: F401

        out["rapidocr-v4"] = True
    except Exception:
        out["rapidocr-v4"] = False
    out["tesseract-tuned"] = os.path.isfile("/usr/bin/tesseract") and os.path.isdir(TESSDATA_DIR)
    return out
