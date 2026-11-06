import numpy as np
import pytest

from b1print.effects import available, render
from b1print.oneline import oneline
from b1print.output import to_image, contact_sheet
from b1print.presets import parse_label


@pytest.fixture
def sample():
    h, w = 120, 192
    y, x = np.mgrid[0:h, 0:w]
    gray = (255 * x / w).astype(np.uint8)          # gradient
    gray[30:90, 60:130] = 30                         # dark box
    mask = np.zeros((h, w), np.float32)
    mask[20:100, 50:140] = 1
    return gray, mask


@pytest.mark.parametrize("name", available())
def test_effect_shape_and_type(sample, name):
    gray, mask = sample
    ink = render(name, gray, mask)
    assert ink.shape == gray.shape and ink.dtype == bool
    assert 0 < ink.mean() < 1, f"{name} produced a blank or solid image"


def test_oneline_svg(sample):
    ink, svg = oneline(*sample, points=300)
    assert svg.startswith("<svg") and "<path" in svg


def test_label_sizes():
    assert parse_label("50x30").size_px == (384, 240)   # clamped to 48 mm printhead
    assert parse_label("30x20").size_px == (240, 160)


def test_output_is_1bit(sample):
    img = to_image(render("atkinson", *sample))
    assert img.mode == "1"
    contact_sheet([("a", img), ("b", img)])
