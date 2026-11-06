"""Load, clean and fit an image to a label canvas. Output is always 8-bit grayscale ('L')."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageOps
import cv2

try:  # iPhone photos
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

_SESSIONS: dict = {}


def load(path_or_img) -> Image.Image:
    img = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    img = ImageOps.exif_transpose(img)  # respect phone rotation
    return img.convert("RGBA")


def remove_background(img: Image.Image, model: str = "u2net") -> Image.Image:
    """Return RGBA with transparent background. Requires `rembg` (model downloads on first use)."""
    from rembg import new_session, remove
    if model not in _SESSIONS:
        _SESSIONS[model] = new_session(model)
    return remove(img, session=_SESSIONS[model], post_process_mask=True)


def flatten(img: Image.Image) -> tuple[Image.Image, np.ndarray]:
    """Composite RGBA over white. Returns (grayscale L image, alpha mask 0..1)."""
    alpha = np.asarray(img.getchannel("A"), dtype=np.float32) / 255.0
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    gray = Image.alpha_composite(bg, img).convert("L")
    return gray, alpha


def crop_to_subject(gray: Image.Image, alpha: np.ndarray, pad: float = 0.04):
    ys, xs = np.where(alpha > 0.1)
    if len(xs) == 0 or alpha.min() > 0.99:  # nothing removed, keep full frame
        return gray, alpha
    p = int(pad * max(gray.size))
    x0, x1 = max(xs.min() - p, 0), min(xs.max() + p, gray.width)
    y0, y1 = max(ys.min() - p, 0), min(ys.max() + p, gray.height)
    return gray.crop((x0, y0, x1, y1)), alpha[y0:y1, x0:x1]


def enhance(gray: np.ndarray, clahe: float = 2.0) -> np.ndarray:
    """Local contrast boost; makes thermal output far less muddy."""
    if clahe <= 0:
        return gray
    return cv2.createCLAHE(clipLimit=clahe, tileGridSize=(8, 8)).apply(gray)


def fit(gray: Image.Image, alpha: np.ndarray, size: tuple[int, int], margin_px: int = 12,
        mode: str = "contain"):
    """Scale onto a white canvas of `size`. mode: 'contain' (whole image) or 'cover' (fill, crop)."""
    W, H = size
    bw, bh = W - 2 * margin_px, H - 2 * margin_px
    s = (min if mode == "contain" else max)(bw / gray.width, bh / gray.height)
    nw, nh = max(1, round(gray.width * s)), max(1, round(gray.height * s))
    g = gray.resize((nw, nh), Image.LANCZOS)
    a = Image.fromarray((alpha * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("L", (W, H), 255)
    mask = Image.new("L", (W, H), 0)
    ox, oy = (W - nw) // 2, (H - nh) // 2
    canvas.paste(g, (ox, oy))
    mask.paste(a, (ox, oy))
    return np.asarray(canvas), np.asarray(mask, dtype=np.float32) / 255.0


def prepare(src, size, *, remove_bg=True, bg_model="u2net", clahe=2.0, margin_px=12,
            fit_mode="contain"):
    """Full pipeline -> (gray uint8 HxW, subject mask float HxW)."""
    img = load(src)
    if remove_bg:
        img = remove_background(img, bg_model)
    gray, alpha = flatten(img)
    if remove_bg:
        gray, alpha = crop_to_subject(gray, alpha)
    g = enhance(np.asarray(gray), clahe)
    # re-whiten the background after CLAHE so it stays paper-white
    g = np.where(alpha > 0.5, g, 255).astype(np.uint8) if remove_bg else g
    return fit(Image.fromarray(g), alpha, size, margin_px, fit_mode)
