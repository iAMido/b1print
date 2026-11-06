"""Command line: python -m b1print photo.jpg [-l 50x30] [-e atkinson lineart ...]"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from . import presets
from .effects import available, render, DESCRIPTIONS
from .output import to_image, contact_sheet, save
from .preprocess import prepare


def main(argv=None):
    p = argparse.ArgumentParser(prog="b1print", description="B&W label art for the NIIMBOT B1")
    p.add_argument("image", nargs="?")
    p.add_argument("-l", "--label", default="50x30", help=f"preset {list(presets.LABELS)} or WxH mm")
    p.add_argument("-e", "--effects", nargs="+", default=["all"], help="effect names or 'all'")
    p.add_argument("-o", "--out", default="out")
    p.add_argument("--keep-bg", action="store_true", help="skip background removal")
    p.add_argument("--bg-model", default="u2net",
                   help="rembg model: u2net (default), u2netp (fast), isnet-general-use, u2net_human_seg")
    p.add_argument("--cover", action="store_true", help="fill the label (crop) instead of fitting")
    p.add_argument("--rotate", action="store_true", help="portrait art on a landscape label")
    p.add_argument("--margin", type=float, default=1.5, help="margin in mm")
    p.add_argument("--invert", action="store_true", help="white on black")
    p.add_argument("--source", default="contour", choices=["tone", "contour"], help="oneline point source")
    p.add_argument("--list", action="store_true", help="list effects and exit")
    a = p.parse_args(argv)

    if a.list or not a.image:
        for n in available():
            print(f"{n:11s} {DESCRIPTIONS[n]}")
        return

    label = presets.parse_label(a.label)
    size = label.size_px
    if a.rotate:
        size = size[::-1]
    names = available() if a.effects == ["all"] else a.effects
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = Path(a.image).stem

    t = time.time()
    gray, mask = prepare(a.image, size, remove_bg=not a.keep_bg, bg_model=a.bg_model,
                         margin_px=round(a.margin * presets.PX_PER_MM),
                         fit_mode="cover" if a.cover else "contain")
    print(f"prepared {size[0]}x{size[1]} px in {time.time() - t:.1f}s")

    items = []
    for n in names:
        t = time.time()
        if n == "oneline":
            from .oneline import oneline
            ink, svg = oneline(gray, mask, source=a.source)
            (out / f"{stem}_{n}.svg").write_text(svg)
        else:
            ink = render(n, gray, mask)
        img = to_image(ink, a.invert)
        if a.rotate:
            img = img.rotate(90, expand=True)
        save(img, out / f"{stem}_{n}.png")
        items.append((n, img))
        print(f"  {n:11s} {time.time() - t:5.1f}s")
    contact_sheet(items).save(out / f"{stem}_sheet.png")
    print(f"done -> {out}/  (open {stem}_sheet.png to compare)")


if __name__ == "__main__":
    main()
