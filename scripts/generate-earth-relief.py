"""Build the small land-relief bump map used to shade terrain on the globe.

Requires Pillow. Download the public-domain NASA source, then run:
  curl -fL https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_5400x2700.jpg -o /tmp/earth-elev.jpg
  python3 scripts/generate-earth-relief.py /tmp/earth-elev.jpg

The source is NASA Blue Marble: Next Generation topography (GEBCO 2008
elevation, land only: black is sea level, white is the highest terrain).
"""

import argparse
import hashlib
from pathlib import Path

from PIL import Image, ImageFilter

SOURCE_SHA256 = "97828a87bcb6549a527232455e478c5f9e4556f761b37d620a46446da17593ab"


def generate(source: Path, output: Path) -> None:
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError(f"{source}: unexpected SHA-256 {digest}")
    with Image.open(source) as im:
        relief = im.convert("L").resize((2048, 1024), Image.Resampling.LANCZOS)
    # Soften JPEG blocks, which a bump map would otherwise turn into ridges,
    # and lift low terrain so plains and plateaus show, not only the highest peaks.
    relief = relief.filter(ImageFilter.GaussianBlur(0.8)).point(lambda x: round(255 * (x / 255) ** 0.7))
    relief.save(output, "WEBP", quality=82, method=6)
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]
                        / "public/assets/earth/relief-2k.webp")
    args = parser.parse_args()
    generate(args.source, args.output)
