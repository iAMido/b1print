"""Streamlit UI: streamlit run app.py  (open on your phone via the Network URL on the same Wi-Fi)."""
import io

import streamlit as st

from b1print import presets
from b1print.effects import available, DESCRIPTIONS, render
from b1print.oneline import oneline
from b1print.output import to_image
from b1print.preprocess import prepare

st.set_page_config(page_title="B1 Print Studio", layout="wide")
st.title("B1 Print Studio")
st.caption("Photo to black & white label art for the NIIMBOT B1 (203 DPI)")

with st.sidebar:
    label_key = st.selectbox("Label (mm)", list(presets.LABELS), index=0)
    custom = st.text_input("...or custom WxH mm", "")
    rotate = st.checkbox("Portrait on this label (rotate 90°)")
    remove_bg = st.checkbox("Remove background", True)
    bg_model = st.selectbox("Background model", ["u2net", "u2netp", "isnet-general-use", "u2net_human_seg"],
                            help="u2netp is fastest; u2net_human_seg is best for people")
    cover = st.checkbox("Fill label (crop)", False)
    margin = st.slider("Margin (mm)", 0.0, 5.0, 1.5, 0.5)
    clahe = st.slider("Local contrast", 0.0, 4.0, 2.0, 0.5)
    invert = st.checkbox("Invert (white on black)")
    chosen = st.multiselect("Effects", available(), default=available())
    st.divider()
    st.subheader("Fine tuning")
    gamma = st.slider("Dither lightness (gamma)", 0.8, 2.5, 1.25, 0.05,
                      help="Thermal dots spread, so prints come out darker than the screen. Raise to lighten.")
    detail = st.slider("Line detail (lower = more lines)", 0.006, 0.04, 0.015, 0.001, format="%.3f")
    line_px = st.slider("Line thickness boost (px)", 0, 3, 0)
    ol_source = st.radio("One-line follows", ["contour", "tone"], horizontal=True)
    ol_density = st.slider("One-line points", 300, 4000, 1000, 100)

up = st.file_uploader("Photo", type=["jpg", "jpeg", "png", "webp", "heic"])
if not up:
    st.info("Upload a photo to see the variants.")
    st.stop()

label = presets.parse_label(custom) if custom else presets.LABELS[label_key]
size = label.size_px[::-1] if rotate else label.size_px


@st.cache_data(show_spinner="Preparing image (first background removal downloads a model)...")
def _prep(data, size, remove_bg, bg_model, cover, margin, clahe):
    return prepare(io.BytesIO(data), size, remove_bg=remove_bg, bg_model=bg_model, clahe=clahe,
                   margin_px=round(margin * presets.PX_PER_MM), fit_mode="cover" if cover else "contain")


gray, mask = _prep(up.getvalue(), size, remove_bg, bg_model, cover, margin, clahe)
params = dict(gamma=gamma, detail=detail, line_px=line_px)

cols = st.columns(3)
for i, name in enumerate(chosen):
    with cols[i % 3]:
        svg = None
        if name == "oneline":
            ink, svg = oneline(gray, mask, source=ol_source, points=ol_density)
        else:
            ink = render(name, gray, mask, **params)
        img = to_image(ink, invert)
        if rotate:
            img = img.rotate(90, expand=True)
        st.image(img.convert("L").resize((img.width * 2, img.height * 2), 0), caption=name,
                 use_container_width=True)
        st.caption(DESCRIPTIONS[name])
        buf = io.BytesIO()
        img.save(buf, "PNG", dpi=(presets.DPI, presets.DPI))
        st.download_button("PNG", buf.getvalue(), f"{name}.png", "image/png", key=f"png_{name}")
        if svg:
            st.download_button("SVG", svg, f"{name}.svg", "image/svg+xml", key="svg")
