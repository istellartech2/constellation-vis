"""Rasterize Natural Earth's land boundaries for the dark monochrome globe.

Requires Pillow. Download the public-domain source, then run:
  curl -fL https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_boundary_lines_land.geojson -o /tmp/earth-borders.geojson
  python3 scripts/generate-earth-borders.py /tmp/earth-borders.geojson

Only a small, local texture is loaded by the app; no runtime map service is used.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


def generate(source: Path, output: Path) -> None:
    width, height, supersample = 4096, 2048, 2
    image = Image.new("L", (width * supersample, height * supersample))
    draw = ImageDraw.Draw(image)
    data = json.loads(source.read_text())
    for feature in data["features"]:
        geometry = feature["geometry"]
        if geometry is None:
            continue
        if geometry["type"] == "LineString":
            lines = [geometry["coordinates"]]
        elif geometry["type"] == "MultiLineString":
            lines = geometry["coordinates"]
        else:
            raise ValueError(f"Unsupported boundary geometry: {geometry['type']}")
        for line in lines:
            for (lon1, lat1), (lon2, lat2) in zip(line, line[1:]):
                # Unwrap dateline crossings, drawing the wrapped copy as well.
                if lon2 - lon1 > 180:
                    lon2 -= 360
                elif lon2 - lon1 < -180:
                    lon2 += 360
                for offset in (-360, 0, 360):
                    points = [
                        ((lon + offset + 180) / 360 * image.width,
                         (90 - lat) / 180 * image.height)
                        for lon, lat in ((lon1, lat1), (lon2, lat2))
                    ]
                    draw.line(points, fill=255, width=2 * supersample)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    image.save(output, lossless=True, method=6)
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]
                        / "public/assets/earth_country_borders_4096.webp")
    args = parser.parse_args()
    generate(args.source, args.output)
