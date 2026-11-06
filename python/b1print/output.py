"""Turn ink arrays into printable 1-bit PNGs and build a comparison contact sheet."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .presets import DPI


def to_image(ink: np.ndarray, invert: bool = False) -> Image.Image:
    """bool (True = black) -> 1-bit PIL image with DPI metadata so the Niimbot app sizes it right."""
    if invert:
        ink = ~ink
    img = Image.fromarray(np.where(ink, 0, 255).astype(np.uint8)).convert("1", dither=Image.NONE)
    img.info["dpi"] = (DPI, DPI)
    return img


def save(img: Image.Image, path) -> None:
    img.save(path, dpi=(DPI, DPI))


def _font(size):
    for f in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def contact_sheet(items: list[tuple[str, Image.Image]], cols: int = 3, scale: int = 2) -> Image.Image:
    """Grid of variants, upscaled with NEAREST so you see the real dots."""
    w, h = items[0][1].size
    tw, th = w * scale, h * scale
    pad, cap = 16, 30
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + pad + cap) + pad), (235, 235, 235))
    draw = ImageDraw.Draw(sheet)
    font = _font(18)
    for i, (name, img) in enumerate(items):
        r, c = divmod(i, cols)
        x = pad + c * (tw + pad)
        y = pad + r * (th + pad + cap)
        draw.text((x, y), f"{i + 1}. {name}", fill=(30, 30, 30), font=font)
        tile = ImageOps.expand(img.convert("RGB").resize((tw, th), Image.NEAREST), 1, (160, 160, 160))
        sheet.paste(tile, (x - 1, y + cap - 1))
    return sheet
