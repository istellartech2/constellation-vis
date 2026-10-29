"""Rebuild Earth textures from pinned NASA and Natural Earth sources.

See public/assets/earth/README.md for downloads, hashes and licenses.
Requires Pillow. Inputs are kept outside the repository.
"""
import argparse
import hashlib
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None  # The pinned global source rasters are large.
ROOT = Path(__file__).resolve().parents[1] / 'public' / 'assets' / 'earth'
SOURCES = {
    'blue.jpg': 'dea8b4dc8a4f93f5f8bce0c8c85a508a178e7901e9ed8e6bf86e6ce7ef6d61e2',
    'night.jpg': '76428afb33e80d6112a8f0c110af4e5e52316e3a1858561a3b8c931779eca723',
    'land.geojson': '1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416',
    'natural-earth.zip': 'dae6ad77c963976f44afb3a3916febf36f44c42da1690854b9fa1dac74694e54',
}


def save(img, name, width, quality=88):
    result = img.resize((width, width // 2), Image.Resampling.LANCZOS)
    result.save(ROOT / name, 'WEBP', quality=quality, method=4)
    print(name, result.size, flush=True)


def land_mask(path):
    # Natural Earth polygons are equirectangular and already split at the dateline.
    mask = Image.new('L', (8192, 4096), 255)
    draw = ImageDraw.Draw(mask)
    data = json.loads(path.read_text())
    def points(ring):
        return [((lon + 180) * mask.width / 360, (90 - lat) * mask.height / 180) for lon, lat, *_ in ring]
    for feature in data['features']:
        geo = feature['geometry']
        if not geo:
            continue
        polygons = [geo['coordinates']] if geo['type'] == 'Polygon' else geo['coordinates']
        for poly in polygons:
            draw.polygon(points(poly[0]), fill=0)
            for ring in poly[1:]:
                draw.polygon(points(ring), fill=255)
    return mask


def clouds():
    # Deterministic, synthetic visual decoration, not meteorological observations.
    rng = random.Random(20261029)
    result = Image.new('L', (2048, 1024), 0)
    for w, weight in [(32, .50), (64, .26), (128, .15), (256, .09)]:
        raw = Image.frombytes('L', (w, w // 2), rng.randbytes(w * (w // 2)))
        layer = raw.resize(result.size, Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(2))
        result = Image.blend(result, layer, weight)
    return result.point(lambda x: max(0, min(255, (x - 57) * 4)))


def main(source):
    for name, expected in SOURCES.items():
        digest = hashlib.sha256((source / name).read_bytes()).hexdigest()
        if digest != expected:
            raise ValueError(f'{name}: unexpected SHA-256 {digest}')
    import zipfile
    with zipfile.ZipFile(source / 'natural-earth.zip') as archive:
        archive.extract('NE1_LR_LC.tif', source)
    with Image.open(source / 'blue.jpg') as im:
        for w, tier in ((4096, '4k'), (8192, '8k')):
            save(im, f'day-blue-marble-{tier}.webp', w)
    mask = land_mask(source / 'land.geojson')
    with Image.open(source / 'NE1_LR_LC.tif') as im:
        for w, tier in ((4096, '4k'), (8192, '8k')):
            natural = im.resize((w, w // 2), Image.Resampling.LANCZOS).convert('RGB')
            ocean = Image.new('RGB', natural.size, (37, 86, 117))
            water = mask.resize(natural.size, Image.Resampling.LANCZOS)
            natural = Image.composite(ocean, natural, water)
            natural.save(ROOT / f'day-natural-{tier}.webp', 'WEBP', quality=88, method=4)
            print(f'day-natural-{tier}.webp', natural.size, flush=True)
    with Image.open(source / 'night.jpg') as im:
        for w, tier in ((2048, '2k'), (8192, '8k')):
            save(im, f'night-lights-{tier}.webp', w)
    for w, tier in ((2048, '2k'), (8192, '8k')):
        save(mask, f'ocean-mask-{tier}.webp', w, 95)
    save(clouds(), 'clouds-2k.webp', 2048, 90)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='directory containing the four pinned source files')
    main(parser.parse_args().source)
