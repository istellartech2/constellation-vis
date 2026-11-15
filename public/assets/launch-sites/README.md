# Launch-site imagery: source, license and regeneration

High-resolution patches draped over the globe around major launch sites
while the camera is close (see "Launch-site imagery" in
`docs/trajectory-layer.md`). `index.json` lists the sites and the credit the
app displays; each `<id>.jpg` is an equirectangular (EPSG:4326) image of the
`bounds` box in `index.json`, north up, 2048 × 2048 px (~39 m per pixel).

Sites: starbase, cape-canaveral, vandenberg, tanegashima, uchinoura,
hokkaido-spaceport, kourou, baikonur, wenchang, jiuquan, mahia, sriharikota.

## Source

- Service: EOX::Maps WMS `https://tiles.maps.eox.at/wms`, layer
  `s2cloudless` ("Sentinel-2 cloudless layer for 2016 by EOX - 4326"), a
  global cloud-free mosaic of Copernicus Sentinel-2 data.
- License, from that layer's abstract in the WMS/WMTS capabilities:
  "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains
  modified Copernicus Sentinel data 2016) released under Creative Commons
  Attribution 4.0 International License"
  ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
- EOX's [License Non-Commercial](https://cloudless.eox.at/license-non-commercial)
  page also lists 2016 as CC BY 4.0 (only 2018–2025 are CC BY-NC-SA 4.0). Its
  2016 row gives the credit as "(Contains modified Copernicus Sentinel data
  2016 & 2017)"; this project uses the layer abstract's wording ("data 2016").
- The 2017 layer (`s2cloudless-2017`, also CC BY 4.0) was the first choice,
  but it only covers Europe, North Africa and the Middle East; elsewhere its
  WMS returns a flat land/sea fallback map.
- These images keep their CC BY 4.0 license; they are not covered by the
  project's Apache-2.0 license.

## Required credit

The app shows, whenever a patch is drawn (bottom-right corner):

> 画像: EOxCloudless 2016 (cloudless.eox.at) by EOX IT Services GmbH, Copernicus Sentinel データ (2016) を加工, CC BY 4.0

with links to https://cloudless.eox.at and the license; narrow screens show a
shorter one-line form, with the exact English credit above as its tooltip.
Reproduce the credit wherever these images are reused.

## Request and processing

`scripts/fetch-launch-site-imagery.ts` makes one request per site,
sequentially with a 1.5 s pause and a generic User-Agent:

```
SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=s2cloudless&STYLES=
&SRS=EPSG:4326&BBOX=<west>,<south>,<east>,<north>&WIDTH=2048&HEIGHT=2048&FORMAT=image/jpeg
```

The box is 80 km × 80 km centred on the site (half-size 40 km ÷ 111.19 km/°
in latitude, and that ÷ cos(lat) in longitude). WMS 1.1.1 keeps lon,lat
axis order for EPSG:4326. The service crops and resamples the mosaic; images
over 900 KB are re-encoded with Pillow (JPEG quality 88 → 60 until under
budget; only baikonur needed it). The changes are cropping, resampling and
recompression.

Known content limits of the 2016 mosaic: open ocean far from the coast is
outside the Sentinel-2 acquisition area and shows the service's flat navy
fill (curved edges in the Starbase, Cape Canaveral, Mahia and other coastal
images); some residual clouds remain over the sea and coast near Tanegashima
and Taiki (hokkaido-spaceport).

## Regenerate

Requires Bun and, for recompression, Python 3 with Pillow. Raw responses
are cached outside the repository (default `$TMPDIR/launch-site-imagery`),
so re-running only re-encodes; `--refetch` downloads again.

```sh
bun scripts/fetch-launch-site-imagery.ts --only starbase   # check one first
bun scripts/fetch-launch-site-imagery.ts                  # all sites
```

A response that is not a 2048² JPEG, or is implausibly small (the fallback
map), skips that site with a warning. To change edition, edit the `EDITION`
block (layer, year, credit, license) at the top of the script; the app reads
the credit and year from `index.json`. Update this README and
`docs/THIRD-PARTY.md` to match.
