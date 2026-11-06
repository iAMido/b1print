"""b1print: turn any photo into black & white label art for the NIIMBOT B1."""
from .presets import LABELS, parse_label, DPI
from .preprocess import prepare
from .effects import render, available, DESCRIPTIONS
from .output import to_image, contact_sheet

__all__ = ["LABELS", "parse_label", "DPI", "prepare", "render", "available",
           "DESCRIPTIONS", "to_image", "contact_sheet"]
