# Country boundary texture

`earth_country_borders_4096.webp` is a 4096 × 2048 equirectangular data mask
(white lines on black), used only by the dark monochrome Earth shader.
It contains land boundaries, without coastlines, labels, or maritime boundaries.

Source: Natural Earth, Admin 0 – Boundary Lines, 1:50m, version 5.1.2.
Natural Earth data is in the public domain.

- https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-boundary-lines-2/
- https://www.naturalearthdata.com/about/terms-of-use/
- https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_boundary_lines_land.geojson

To regenerate, use the download and generation commands in
`scripts/generate-earth-borders.py`. Pillow is needed only for regeneration,
not for the app or its build. The app loads the bundled texture without
contacting a map service. The texture uses no color space conversion.
