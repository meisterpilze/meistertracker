#!/usr/bin/env python3
"""
Generate the default neutral PWA icons shipped with Meistertracker.

These are intentionally generic (a stylised mushroom on a flat background)
and contain no Meisterpilze brand marks — forks should swap them out via
make_icons.py with their own logo.

Usage:
    python3 scripts/make_default_icons.py

Writes:
    icon-192.png
    icon-512.png
    favicon.ico
"""
from PIL import Image, ImageDraw


def draw_mushroom(size: int) -> Image.Image:
    """Draw a flat-style mushroom centred on a square canvas."""
    bg = (240, 244, 240, 255)  # near-white with a faint green tint
    cap = (148, 100, 76, 255)  # warm brown (cap)
    cap_dot = (240, 244, 240, 255)  # spots match background for contrast
    stem = (250, 246, 235, 255)  # off-white (stem)
    stem_shadow = (210, 200, 180, 255)
    outline = (60, 50, 45, 255)

    img = Image.new("RGBA", (size, size), bg)
    d = ImageDraw.Draw(img)

    # All coordinates are scaled to the canvas size.
    s = size
    cx = s // 2

    # Cap — a half-ellipse covering the upper portion.
    cap_w = int(s * 0.66)
    cap_h = int(s * 0.42)
    cap_x = (s - cap_w) // 2
    cap_y = int(s * 0.18)
    d.pieslice(
        [cap_x, cap_y, cap_x + cap_w, cap_y + cap_h * 2],
        start=180,
        end=360,
        fill=cap,
        outline=outline,
        width=max(2, s // 96),
    )
    # Flat bottom for the cap (the pieslice's chord is already the diameter).

    # Stem — rounded rectangle.
    stem_w = int(s * 0.24)
    stem_h = int(s * 0.30)
    stem_x = cx - stem_w // 2
    stem_y = cap_y + cap_h
    d.rounded_rectangle(
        [stem_x, stem_y, stem_x + stem_w, stem_y + stem_h],
        radius=stem_w // 4,
        fill=stem,
        outline=outline,
        width=max(2, s // 96),
    )
    # Stem base shadow line for a touch of depth.
    base_y = stem_y + stem_h - max(2, s // 48)
    d.line(
        [stem_x + stem_w // 6, base_y, stem_x + stem_w - stem_w // 6, base_y],
        fill=stem_shadow,
        width=max(2, s // 128),
    )

    # Cap spots — three off-centre dots.
    spot_r = int(s * 0.045)
    spot_positions = [
        (int(cx - cap_w * 0.22), int(cap_y + cap_h * 0.55)),
        (int(cx + cap_w * 0.05), int(cap_y + cap_h * 0.40)),
        (int(cx + cap_w * 0.28), int(cap_y + cap_h * 0.65)),
    ]
    for (px, py) in spot_positions:
        d.ellipse(
            [px - spot_r, py - spot_r, px + spot_r, py + spot_r],
            fill=cap_dot,
            outline=outline,
            width=max(1, s // 192),
        )

    return img


def main():
    for size in (192, 512):
        out = f"icon-{size}.png"
        draw_mushroom(size).save(out, "PNG", optimize=True)
        print(f"  wrote {out}")

    # Favicon: multi-resolution ICO (16, 32, 48).
    fav_sizes = [(16, 16), (32, 32), (48, 48)]
    base = draw_mushroom(64)
    base.save(
        "favicon.ico",
        format="ICO",
        sizes=fav_sizes,
    )
    print("  wrote favicon.ico (16/32/48)")


if __name__ == "__main__":
    main()
