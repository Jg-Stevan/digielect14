# -*- coding: utf-8 -*-
"""crop_acta.py — Recorte del acta a resolución nativa (kit FILTROS-1 §4).

NOTA DE PROVENIENCIA (kit §2.3): el kit pide reutilizar «el mismo pipeline de
crop del lab previo». Los scripts del lab previo (comparativa de motores,
"off-line, CPU del servidor de pruebas") vivían SOLO en el sandbox anterior y
se perdieron con su reinicio — NO fueron commiteados a ningún repo (verificado
en la historia completa de digielect14, web-scanner, web-scanner-monorepo-viejo
y digielect). Este módulo es una RE-IMPLEMENTACIÓN honesta del paso que esos
scripts hacían: aislar el papel (página E-14, retrato sobre fondo oscuro) y
recortarlo a resolución nativa, igual que los recorte-* del dispositivo
(~900×2700). Consecuencia documentada: los números de la corrida pueden
desviarse levemente del lab previo por diferencias del borde del crop; el
gate de sanidad del kit (RapidOCR 45–52/56 · CER ≤ 50%) es el árbitro.

Método (OpenCV): blur → threshold de papel brillante → contorno de mayor área
→ minAreaRect → warpPerspective (INTER_CUBIC) al tamaño nativo del rect.
Fallback: foto completa (sin crop) si no hay candidato plausible.
"""

from __future__ import annotations

import cv2
import numpy as np


def _ordenar_esquinas(pts: np.ndarray) -> np.ndarray:
    """TL, TR, BR, BL (convención TL,TR,BR,BL de get_mini_boxes del app)."""
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def crop_acta(bgr: np.ndarray) -> tuple[np.ndarray, dict]:
    """Devuelve (recorte_bgr, info). Nunca lanza: fallback = foto completa."""
    h, w = bgr.shape[:2]
    info = {"metodo": "full", "quad": None, "foto": [w, h]}
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    # El papel E-14 es brillante sobre mesa oscura (caso real del dueño).
    _, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    contornos, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        return bgr, info
    c = max(contornos, key=cv2.contourArea)
    area_pct = cv2.contourArea(c) / (w * h)
    if area_pct < 0.15:
        return bgr, info  # sin papel dominante evidente → full
    rect = cv2.minAreaRect(c)
    box = cv2.boxPoints(rect)
    box = _ordenar_esquinas(box)
    (tw, th) = rect[1]
    if tw < 40 or th < 40:
        return bgr, info
    tw, th = int(round(tw)), int(round(th))
    src = box.astype(np.float32)
    dst = np.array([[0, 0], [tw - 1, 0], [tw - 1, th - 1], [0, th - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    rec = cv2.warpPerspective(bgr, M, (tw, th), flags=cv2.INTER_CUBIC)
    # El acta E-14 fotografiada en vertical es un strip más alto que ancho.
    if rec.shape[0] < rec.shape[1]:
        rec = cv2.rotate(rec, cv2.ROTATE_90_COUNTERCLOCKWISE)
    info.update({"metodo": "minAreaRect+warp", "quad": box.tolist(), "crop": [rec.shape[1], rec.shape[0]], "area_pct": round(area_pct, 3)})
    return rec, info
