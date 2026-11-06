"""Printer and label presets for the NIIMBOT B1 (203 DPI, 48 mm / 384 px printhead)."""
from dataclasses import dataclass

DPI = 203
PX_PER_MM = DPI / 25.4  # ~7.99
PRINTHEAD_PX = 384      # 48 mm


@dataclass(frozen=True)
class Label:
    name: str
    width_mm: float   # across the roll (max 50; printable 48)
    height_mm: float  # along the roll

    @property
    def size_px(self) -> tuple[int, int]:
        w = min(round(self.width_mm * PX_PER_MM), PRINTHEAD_PX)
        h = round(self.height_mm * PX_PER_MM)
        return w, h


LABELS: dict[str, Label] = {
    "50x30": Label("50x30", 50, 30),   # starter roll
    "50x50": Label("50x50", 50, 50),
    "50x80": Label("50x80", 50, 80),
    "40x30": Label("40x30", 40, 30),
    "40x60": Label("40x60", 40, 60),
    "30x20": Label("30x20", 30, 20),
    "30x15": Label("30x15", 30, 15),
}


def parse_label(spec: str) -> Label:
    """Accept a preset key ('50x30') or any 'WxH' in mm."""
    if spec in LABELS:
        return LABELS[spec]
    w, h = (float(v) for v in spec.lower().split("x"))
    return Label(spec, w, h)
