"""Black & white effects tuned for direct-thermal printing.

Convention: every effect takes (gray: uint8 HxW, mask: float HxW in 0..1, **params)
and returns a bool HxW array where True = black dot.
Register new effects with @effect so the CLI, UI and contact sheet pick them up.
"""
from __future__ import annotations

from typing import Callable
import numpy as np
import cv2

EFFECTS: dict[str, Callable] = {}
DESCRIPTIONS: dict[str, str] = {}


def effect(name: str, desc: str):
    def deco(fn):
        EFFECTS[name] = fn
        DESCRIPTIONS[name] = desc
        return fn
    return deco


# ---------- helpers ----------

def darkness(gray: np.ndarray, gamma: float = 1.0) -> np.ndarray:
    """0 = white paper, 1 = full black. gamma > 1 lightens (thermal dots spread/darken)."""
    return (1.0 - gray.astype(np.float32) / 255.0) ** gamma


def remove_specks(bw: np.ndarray, min_area: int = 6) -> np.ndarray:
    """Drop isolated black blobs smaller than min_area px (they print as dirt)."""
    if min_area <= 0:
        return bw
    n, lab, stats, _ = cv2.connectedComponentsWithStats(bw.astype(np.uint8), connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= min_area
    keep[0] = False
    return keep[lab]


def thicken(bw: np.ndarray, px: int) -> np.ndarray:
    if px <= 0:
        return bw
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * px + 1, 2 * px + 1))
    return cv2.dilate(bw.astype(np.uint8), k).astype(bool)


def _rotated_coords(shape, angle_deg):
    h, w = shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.deg2rad(angle_deg)
    return x * np.cos(a) + y * np.sin(a), -x * np.sin(a) + y * np.cos(a)


def otsu(gray, mask) -> float:
    """Otsu level computed on the subject only, so a white removed background doesn't skew it."""
    px = gray[mask > 0.5] if (mask > 0.5).sum() > 100 and mask.min() < 0.5 else gray.ravel()
    t, _ = cv2.threshold(px.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return t


# ---------- tone effects (dithering / screens) ----------

@effect("threshold", "Clean hard threshold (Otsu). Best for logos, text, high-contrast photos.")
def threshold(gray, mask, offset: int = 0, min_area: int = 8, **_):
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    return remove_specks(blur < (otsu(blur, mask) + offset), min_area)


@effect("floyd", "Floyd-Steinberg dithering. Full tonal range, finest grain.")
def floyd(gray, mask, gamma: float = 1.3, **_):
    from PIL import Image
    g = (255 * (1 - darkness(gray, gamma))).astype(np.uint8)
    return ~np.asarray(Image.fromarray(g).convert("1"), dtype=bool)


@effect("atkinson", "Atkinson dithering (classic Mac look). Crisper highlights, usually the best photo mode on thermal.")
def atkinson(gray, mask, gamma: float = 1.2, **_):
    img = (255 * (1 - darkness(gray, gamma))).astype(np.float32)
    h, w = img.shape
    out = np.zeros((h, w), dtype=bool)
    # process row by row; error spreads 1/8 to 6 neighbours (only 6/8 is diffused)
    pad = np.zeros((h + 2, w + 4), dtype=np.float32)
    pad[:h, 2:w + 2] = img
    for y in range(h):
        row = pad[y]
        for x in range(2, w + 2):
            old = row[x]
            new = 0.0 if old < 128 else 255.0
            out[y, x - 2] = new == 0.0
            e = (old - new) / 8.0
            row[x + 1] += e
            row[x + 2] += e
            pad[y + 1, x - 1] += e
            pad[y + 1, x] += e
            pad[y + 1, x + 1] += e
            pad[y + 2, x] += e
    return out


@effect("halftone", "Newspaper-style dot screen at 45 degrees. Retro, survives thermal blur well.")
def halftone(gray, mask, cell: float = 5.0, angle: float = 45, gamma: float = 1.1, **_):
    d = darkness(cv2.GaussianBlur(gray, (0, 0), cell / 3), gamma)
    u, v = _rotated_coords(gray.shape, angle)
    screen = (np.cos(2 * np.pi * u / cell) + np.cos(2 * np.pi * v / cell) + 2) / 4  # 0..1
    return d > screen


@effect("engraving", "Engraving / woodcut lines: line thickness follows darkness.")
def engraving(gray, mask, period: float = 5.0, angle: float = 30, wave: float = 2.5,
              gamma: float = 1.0, **_):
    d = darkness(cv2.GaussianBlur(gray, (0, 0), 1.0), gamma)
    _, v = _rotated_coords(gray.shape, angle)
    v = v + wave * np.sin(d * np.pi)  # lines bend with the shading, like a burin cut
    profile = np.abs(np.sin(np.pi * v / period))  # 0 at line centre, 1 between lines
    return remove_specks(d > profile, 3)


# ---------- line effects ----------

def xdog(gray, sigma=1.0, thresh=0.015, k=1.6):
    """Difference-of-Gaussians ink lines: dark side of every edge becomes a stroke."""
    g = gray.astype(np.float32) / 255.0
    d = cv2.GaussianBlur(g, (0, 0), sigma) - cv2.GaussianBlur(g, (0, 0), sigma * k)
    return d < -thresh  # True = ink


@effect("lineart", "Ink line drawing (XDoG). Clean contours, very little ink, prints sharp.")
def lineart(gray, mask, sigma: float = 1.0, detail: float = 0.015, line_px: int = 0,
            min_area: int = 12, **_):
    """detail: lower = more lines (0.008 busy .. 0.03 minimal)."""
    pre = cv2.bilateralFilter(gray, 7, 40, 7)  # flatten texture, keep edges
    bw = xdog(pre, sigma=sigma, thresh=detail)
    bw = remove_specks(bw, min_area)
    return thicken(bw, line_px)


@effect("sketch", "Pencil sketch: dodge-blend shading, then Atkinson for texture.")
def sketch(gray, mask, blur: float = 8.0, **_):
    inv_blur = cv2.GaussianBlur(255 - gray, (0, 0), blur)
    dodge = cv2.divide(gray, 255 - inv_blur, scale=256)
    dodge = cv2.normalize(dodge, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    return atkinson(dodge, mask, gamma=1.6)


@effect("stencil", "Bold stencil / pop-art blobs. Smooth shapes, no grain.")
def stencil(gray, mask, smooth: float = 2.5, offset: int = 0, min_area: int = 40, **_):
    g = cv2.bilateralFilter(gray, 9, 60, 9)
    g = cv2.GaussianBlur(g, (0, 0), smooth)
    bw = g < (otsu(g, mask) + offset)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    bw = cv2.morphologyEx(bw.astype(np.uint8), cv2.MORPH_OPEN, k)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k).astype(bool)
    bw = remove_specks(bw, min_area)
    holes = remove_specks(~bw, min_area)  # also fill tiny white holes
    return ~holes


# ---------- mask-based effects (need background removal) ----------

def _has_mask(mask):
    return mask.min() < 0.5 < mask.max()


@effect("silhouette", "Solid black silhouette of the subject (needs background removal).")
def silhouette(gray, mask, **_):
    if not _has_mask(mask):
        return threshold(gray, mask)
    return remove_specks(mask > 0.5, 30)


@effect("sticker", "Line art plus a thick die-cut style outline around the subject.")
def sticker(gray, mask, border_px: int = 3, gap_px: int = 4, **_):
    inner = lineart(gray, mask)
    if not _has_mask(mask):
        return inner
    m = (mask > 0.5).astype(np.uint8)
    k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    outer = cv2.dilate(m, k(gap_px + border_px)).astype(bool)
    ring = outer & ~cv2.dilate(m, k(gap_px)).astype(bool)
    return ring | (inner & (m > 0))


def render(name: str, gray: np.ndarray, mask: np.ndarray, **params) -> np.ndarray:
    if name == "oneline":
        from .oneline import oneline
        return oneline(gray, mask, **params)[0]
    return EFFECTS[name](gray, mask, **params)


def available() -> list[str]:
    return [*EFFECTS, "oneline"]


DESCRIPTIONS["oneline"] = "Single continuous line (TSP art). Also exports SVG."
