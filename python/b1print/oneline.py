"""One-line drawing via TSP art.

1. Scatter points where the image should be dark ('tone') or along its edges ('contour').
2. Relax them with a few weighted Lloyd iterations so they spread evenly.
3. Connect all points into one open path (nearest neighbour + 2-opt).
4. Draw the path as a single continuous stroke; also return SVG.
"""
from __future__ import annotations

import time
import numpy as np
import cv2
from scipy.spatial import cKDTree

from .effects import darkness, xdog, remove_specks


def _weights(gray, mask, source, gamma):
    if source == "contour":
        pre = cv2.bilateralFilter(gray, 7, 40, 7)
        e = remove_specks(xdog(pre), 12).astype(np.float32)
        return cv2.GaussianBlur(e, (0, 0), 0.8)
    w = darkness(gray, gamma)
    w[w < 0.08] = 0  # paper stays empty
    return w


def _sample(w, n, rng):
    flat = w.ravel().astype(np.float64)
    if flat.sum() == 0:
        return np.zeros((0, 2))
    idx = rng.choice(flat.size, size=n, replace=False if n < (flat > 0).sum() else True,
                     p=flat / flat.sum())
    ys, xs = np.divmod(idx, w.shape[1])
    return np.column_stack([xs, ys]).astype(np.float64) + rng.random((n, 2))


def _lloyd(w, pts, iters):
    ys, xs = np.nonzero(w > 0.02)
    if len(xs) == 0 or len(pts) == 0:
        return pts
    pix = np.column_stack([xs, ys]).astype(np.float64) + 0.5
    pw = w[ys, xs].astype(np.float64)
    for _ in range(iters):
        _, idx = cKDTree(pts).query(pix)
        tot = np.bincount(idx, pw, len(pts))
        ok = tot > 0
        cx = np.bincount(idx, pw * pix[:, 0], len(pts))
        cy = np.bincount(idx, pw * pix[:, 1], len(pts))
        pts[ok, 0] = cx[ok] / tot[ok]
        pts[ok, 1] = cy[ok] / tot[ok]
    return pts


def _nearest_neighbour(pts):
    n = len(pts)
    order = np.empty(n, dtype=int)
    left = np.ones(n, dtype=bool)
    cur = int(np.argmin(pts[:, 0] + pts[:, 1]))  # start near top-left
    for k in range(n):
        order[k] = cur
        left[cur] = False
        if k == n - 1:
            break
        cand = np.flatnonzero(left)
        d = ((pts[cand] - pts[cur]) ** 2).sum(1)
        cur = int(cand[np.argmin(d)])
    return pts[order]


def _two_opt(p, time_limit=6.0):
    p = p.copy()
    n = len(p)
    t0 = time.time()
    improved = True
    while improved and time.time() - t0 < time_limit:
        improved = False
        for i in range(1, n - 2):
            a, b = p[i - 1], p[i]
            c, d = p[i + 1:n - 1], p[i + 2:n]
            ab = np.hypot(*(a - b))
            delta = (np.hypot(*(a - c).T) + np.hypot(*(b - d).T)
                     - ab - np.hypot(*(c - d).T))
            j = int(np.argmin(delta))
            if delta[j] < -1e-6:
                jj = i + 1 + j
                p[i:jj + 1] = p[i:jj + 1][::-1]
                improved = True
            if time.time() - t0 > time_limit:
                break
    return p


def _chaikin(p, iters):
    for _ in range(iters):
        q = 0.75 * p[:-1] + 0.25 * p[1:]
        r = 0.25 * p[:-1] + 0.75 * p[1:]
        p = np.vstack([p[:1], np.column_stack([q, r]).reshape(-1, 2), p[-1:]])
    return p


def to_svg(path, size, line_px):
    w, h = size
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in path)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w / 8:.1f}mm" height="{h / 8:.1f}mm">'
            f'<rect width="100%" height="100%" fill="white"/>'
            f'<path d="{d}" fill="none" stroke="black" stroke-width="{line_px}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></svg>')


def oneline(gray, mask, *, source: str = "contour", points: int = 0, line_px: float = 1.6,
            smooth: int = 2, relax: int = 12, gamma: float = 2.2, seed: int = 7,
            time_limit: float = 6.0, **_):
    """Returns (bool ink array, svg string). points=0 picks a density from the label size."""
    h, w = gray.shape
    if not points:
        points = int(w * h / (70 if source == "tone" else 110))
    rng = np.random.default_rng(seed)
    wt = _weights(gray, mask, source, gamma)
    pts = _lloyd(wt, _sample(wt, points, rng), relax)
    if len(pts) < 3:
        return np.zeros_like(gray, bool), to_svg(pts, (w, h), line_px)
    path = _chaikin(_two_opt(_nearest_neighbour(pts), time_limit), smooth)

    s = 4  # supersample for smooth lines, then binarise
    big = np.zeros((h * s, w * s), np.uint8)
    cv2.polylines(big, [np.round(path * s).astype(np.int32)], False, 255,
                  max(1, round(line_px * s)), cv2.LINE_AA)
    ink = cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA) > 100
    return ink, to_svg(path, (w, h), line_px)
