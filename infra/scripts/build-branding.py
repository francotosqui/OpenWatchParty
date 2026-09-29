#!/usr/bin/env python3
"""Rebuild the transparent branding assets from the master artwork.

Outputs:
    docs/readme-logo.png   README hero image (1360x800)
    docs/app-icon.png      application icon (350x350)

Sources:
    assets/branding/source-logo-monitor.png   master artwork used here
    assets/branding/source-logo-circular.png  alternative design, unused

Why this script exists
----------------------
The master artwork is drawn on an opaque white background with hard, barely
anti-aliased edges.  Cutting the background out with a simple threshold (or a
"remove white background" tool) leaves the anti-aliased blend pixels opaque:
a light fringe along every edge, plus stair-stepped outlines.  Both are very
visible on dark themes.

Pipeline
--------
1. supersample the source 4x (bilinear) so every edge becomes a smooth ramp;
2. find the solid ("core") pixels:
     - artwork pieces: pixels that are neither connected-to-border white nor
       within r_band of it, which preserves enclosed whites such as the bubble
       dots, the white bar under the monitor and the ring nodes,
     - text pieces: glyph pixels (whiteness < 0.9) eroded by r_core, which
       preserves glossy gradients such as the highlight on "Open";
3. propagate the nearest core colour into the surrounding pixels (colour
   bleed) so anti-aliased pixels keep the colour of the shape they belong to;
4. alpha per pixel is 1 - t with t = (w - w_fg) / (1 - w_fg), where w is the
   pixel whiteness and w_fg the whiteness of the bled colour.  Compositing
   the result back onto white reproduces the source image exactly, while
   solid areas stay fully opaque;
5. downsample with premultiplied-alpha averaging for clean anti-aliased edges.

Usage:
    infra/scripts/build-branding.py            regenerate the assets
    infra/scripts/build-branding.py --check    verify the assets are up to date
"""

import argparse
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError as exc:  # pragma: no cover - depends on the environment
    sys.exit(f"error: {exc.name} is required; install numpy and Pillow")

ROOT = Path(__file__).resolve().parents[2]

SOURCE = ROOT / "assets" / "branding" / "source-logo-monitor.png"
README_LOGO = ROOT / "docs" / "readme-logo.png"
APP_ICON = ROOT / "docs" / "app-icon.png"

SUPERSAMPLE = 4  # supersampling factor used throughout

# Geometry of the master artwork, in source pixels (left, top, right, bottom).
ILLUSTRATION_BOX = (95, 180, 1000, 685)
TEXT_BOX = (90, 718, 1362, 927)
ICON_BOX = (1038, 268, 1388, 618)

# README canvas and placement of the two pieces on it.
README_CANVAS = (1360, 800)
ILLUSTRATION_AT = (215, 30)
TEXT_AT = (45, 558)

# Radii, expressed in supersampled pixels.
R_BAND_ART = 12    # artwork: width of the de-fringed boundary band (3 px at 1x)
R_BLEED_ART = 24   # artwork: colour bleed reach (6 px at 1x)
R_BLEED_TXT = 16   # text: colour bleed reach (4 px at 1x)
R_CORE_TXT = 4     # text: erosion used to select solid glyph pixels (1 px at 1x)


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Grow a boolean mask by ``radius`` pixels (4-connectivity)."""
    current = mask.copy()
    for _ in range(radius):
        grown = current.copy()
        grown[1:, :] |= current[:-1, :]
        grown[:-1, :] |= current[1:, :]
        grown[:, 1:] |= current[:, :-1]
        grown[:, :-1] |= current[:, 1:]
        current = grown
    return current


def erode(mask: np.ndarray, radius: int) -> np.ndarray:
    """Shrink a boolean mask by ``radius`` pixels (4-connectivity)."""
    return ~dilate(~mask, radius)


def white_background(whiteness: np.ndarray, threshold: float = 0.9) -> np.ndarray:
    """Near-white pixels connected to the border, i.e. the actual background."""
    binary = np.where(whiteness >= threshold, 255, 0).astype(np.uint8)
    # Images created by fromarray() can be read-only, which makes floodfill a no-op.
    image = Image.fromarray(binary, "L").copy()
    ImageDraw.floodfill(image, (0, 0), 128, thresh=1)
    return np.asarray(image) == 128


def bleed_colors(colors: np.ndarray, core: np.ndarray, radius: int):
    """Propagate the nearest core colour into the surrounding pixels."""
    known = core.copy()
    bleed = colors * known[..., None]
    for _ in range(radius):
        if known.all():
            break
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted_known = np.roll(known, (dy, dx), (0, 1))
            shifted_bleed = np.roll(bleed, (dy, dx), (0, 1))
            take = shifted_known & ~known
            known |= take
            bleed[take] = shifted_bleed[take]
    return np.where(known[..., None], bleed, colors), known


def process(piece: Image.Image, mode: str) -> tuple[np.ndarray, np.ndarray]:
    """Turn a white-background piece into (colours, alpha) at SUPERSAMPLE scale."""
    upscaled = piece.resize(
        (piece.width * SUPERSAMPLE, piece.height * SUPERSAMPLE), Image.BILINEAR
    )
    pixels = np.asarray(upscaled).astype(np.float32)
    whiteness = pixels.min(axis=2) / 255.0

    if mode == "artwork":
        background = white_background(whiteness)
        band = dilate(background, R_BAND_ART) & ~background
        core = ~background & ~band
    elif mode == "text":
        # Glyphs are everything that is not (nearly) white; eroding the mask
        # by a pixel keeps the colour of solid glyph pixels only.
        core = erode(whiteness < 0.9, R_CORE_TXT)
        background = np.zeros_like(core)
    else:
        raise ValueError(f"unknown mode: {mode}")

    bleed = R_BLEED_ART if mode == "artwork" else R_BLEED_TXT
    colors, known = bleed_colors(pixels, core, bleed)
    colors = np.where(core[..., None], pixels, colors)

    # Unmix the white background: t is the fraction of white in the pixel.
    foreground = colors.min(axis=2) / 255.0
    denominator = 1.0 - foreground
    t = np.ones_like(whiteness)
    unmixable = denominator > 1e-3
    t[unmixable] = (whiteness[unmixable] - foreground[unmixable]) / denominator[unmixable]
    t = np.clip(t, 0.0, 1.0)
    alpha = 1.0 - t

    alpha = np.where(core, 1.0, alpha)
    alpha = np.where(background, 0.0, alpha)
    alpha = np.where(~core & ~known, 0.0, alpha)
    colors = np.where(alpha[..., None] > 1e-4, colors, 0.0)
    return colors, alpha


def downsample(colors: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Area-average colours and alpha (premultiplied, so edges stay clean)."""
    height, width = alpha.shape
    out_height, out_width = height // SUPERSAMPLE, width // SUPERSAMPLE
    premultiplied = (colors * alpha[..., None]).reshape(
        out_height, SUPERSAMPLE, out_width, SUPERSAMPLE, 3
    ).sum(axis=(1, 3))
    alpha_sum = alpha.reshape(
        out_height, SUPERSAMPLE, out_width, SUPERSAMPLE
    ).sum(axis=(1, 3))
    averaged_alpha = alpha_sum / (SUPERSAMPLE * SUPERSAMPLE)
    averaged_colors = np.where(
        alpha_sum[..., None] > 1e-6,
        premultiplied / np.maximum(alpha_sum[..., None], 1e-6),
        0.0,
    )
    return np.clip(averaged_colors, 0, 255), np.clip(averaged_alpha, 0, 1)


def to_image(colors: np.ndarray, alpha: np.ndarray) -> Image.Image:
    rgba = np.dstack(
        [np.round(colors).astype(np.uint8), np.round(alpha * 255).astype(np.uint8)]
    )
    return Image.fromarray(rgba, "RGBA")


def render_piece(source: Image.Image, box: tuple[int, int, int, int], mode: str) -> Image.Image:
    return to_image(*downsample(*process(source.crop(box), mode)))


def compose(
    size: tuple[int, int], layers: list[tuple[Image.Image, tuple[int, int]]]
) -> Image.Image:
    canvas = np.zeros((size[1], size[0], 4), dtype=np.float32)
    for image, (left, top) in layers:
        layer = np.asarray(image).astype(np.float32)
        opacity = layer[..., 3:4] / 255.0
        height, width = layer.shape[:2]
        region = canvas[top : top + height, left : left + width]
        region[..., :3] = layer[..., :3] * opacity + region[..., :3] * (1.0 - opacity)
        region[..., 3:4] = layer[..., 3:4] + region[..., 3:4] * (1.0 - opacity)
    colors = canvas[..., :3]
    alpha = canvas[..., 3:4] / 255.0
    colors = np.where(alpha > 1e-6, colors / np.maximum(alpha, 1e-6), 0.0)
    return to_image(np.clip(colors, 0, 255), alpha[..., 0])


def build() -> dict[Path, Image.Image]:
    """Render every branding asset in memory."""
    source = Image.open(SOURCE).convert("RGB")
    illustration = render_piece(source, ILLUSTRATION_BOX, "artwork")
    text = render_piece(source, TEXT_BOX, "text")
    readme = compose(
        README_CANVAS, [(illustration, ILLUSTRATION_AT), (text, TEXT_AT)]
    )
    icon = render_piece(source, ICON_BOX, "artwork")
    return {README_LOGO: readme, APP_ICON: icon}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify that the assets on disk are up to date instead of writing them",
    )
    args = parser.parse_args()

    if not SOURCE.exists():
        print(f"error: missing source artwork: {SOURCE.relative_to(ROOT)}", file=sys.stderr)
        return 1

    assets = build()

    if args.check:
        stale = []
        for path, image in assets.items():
            relative = path.relative_to(ROOT)
            if not path.exists():
                stale.append(f"{relative} is missing")
                continue
            current = np.asarray(Image.open(path).convert("RGBA"))
            if np.array_equal(current, np.asarray(image)):
                print(f"ok: {relative}")
            else:
                stale.append(f"{relative} is not up to date")
        for message in stale:
            print(f"error: {message}", file=sys.stderr)
        return 1 if stale else 0

    for path, image in assets.items():
        image.save(path, optimize=True)
        print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
