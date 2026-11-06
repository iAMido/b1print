# Thermal-print rules
- Canvas is 1-bit at 203 DPI; width never exceeds 384 px (rotate option renders portrait and rotates on export).
- Resize to label size BEFORE dithering; dithering then rescaling destroys the pattern.
- Export PNG only (never JPEG: compression adds grey pixels).
- Dots spread on paper: bias dithers lighter (gamma > 1); Atkinson is the default photo mode.
- Strokes under 2 px may vanish: expose line thickness rather than thin defaults. Remove specks under ~6 px.
- Avoid > 60% black coverage (banding, curl, battery); prefer outlines/patterns.
