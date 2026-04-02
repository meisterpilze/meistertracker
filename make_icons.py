#!/usr/bin/env python3
"""
Run this script once after placing your logo file in the meisterpilze folder.
Usage: python3 make_icons.py logo.png
       python3 make_icons.py logo.jpg
       python3 make_icons.py  (auto-detects logo.png / logo.jpg)
"""
import sys
import os

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system("pip install Pillow")
    from PIL import Image

def make_icons(logo_path):
    img = Image.open(logo_path).convert("RGBA")

    for size in [192, 512]:
        # Create a white-background square canvas
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        # Fit the logo inside with padding
        pad = int(size * 0.12)
        inner = size - pad * 2
        logo = img.copy()
        logo.thumbnail((inner, inner), Image.LANCZOS)
        # Centre it
        x = (size - logo.width) // 2
        y = (size - logo.height) // 2
        canvas.paste(logo, (x, y), logo if logo.mode == 'RGBA' else None)
        # Save as PNG
        out = f"icon-{size}.png"
        canvas.save(out, "PNG")
        print(f"  Created {out} ({size}x{size}px)")

    print("\nDone! Copy icon-192.png and icon-512.png into your meisterpilze folder.")
    print("The app will now show your logo when installed on phones and PCs.")

# Auto-detect logo file
if len(sys.argv) > 1:
    path = sys.argv[1]
elif os.path.exists("logo.png"):
    path = "logo.png"
elif os.path.exists("logo.jpg"):
    path = "logo.jpg"
else:
    print("Usage: python3 make_icons.py <your-logo-file>")
    print("Place your logo in the meisterpilze folder as logo.png or logo.jpg first.")
    sys.exit(1)

print(f"Processing {path}...")
make_icons(path)
