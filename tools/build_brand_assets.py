"""Export Koto icons or its social preview. Requires Pillow for authoring."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def social_preview(assets, font_path, bold_font_path):
    background, foreground = "#111317", "#F2F0E9"
    muted, amber, outline = "#ADB4BF", "#E6AF72", "#39414D"
    with Image.new("RGB", (1280, 640), background) as card:
        draw = ImageDraw.Draw(card)

        def text(position, value, size, color=foreground, bold=False):
            font = ImageFont.truetype(str(bold_font_path if bold else font_path), size)
            draw.text(position, value, font=font, fill=color)

        def box(bounds, value):
            draw.rounded_rectangle(bounds, radius=14, fill="#1B2027", outline=outline, width=2)
            font = ImageFont.truetype(str(font_path), 24)
            x0, y0, x1, y1 = bounds
            draw.text(((x0 + x1) / 2, (y0 + y1) / 2), value,
                      font=font, fill=foreground, anchor="mm")

        def arrow(points):
            draw.line(points, fill=amber, width=3)
            x, y = points[-1]
            draw.polygon([(x, y), (x - 10, y - 6), (x - 10, y + 6)], fill=amber)

        text((64, 40), "Koto", 80, bold=True)
        text((68, 140), "PERSONAL MODEL SELECTION", 18, amber, bold=True)
        text((64, 188), "Local + commercial models.", 44, bold=True)
        text((66, 250), "Learn from checked task history.", 32)
        text((66, 306), "Codex first  /  experimental  /  Apache-2.0", 22, muted)
        with Image.open(assets / "koto-icon-source.png") as master:
            with master.convert("RGBA") as source:
                with source.resize((220, 220), Image.Resampling.LANCZOS) as icon:
                    card.paste(icon, (996, 56), icon)

        box((64, 399, 332, 479), "Checked history")
        box((386, 399, 654, 479), "Local selector")
        box((770, 363, 1216, 431), "Commercial baseline")
        box((770, 457, 1216, 525), "Qualified local model")
        arrow([(332, 439), (386, 439)])
        arrow([(654, 439), (710, 439), (710, 397), (770, 397)])
        arrow([(710, 439), (710, 491), (770, 491)])
        text((66, 550), "History and learning are opt-in. Local coding requires qualification.", 19, muted)
        text((66, 590), "github.com/mehrdadxzaker/Koto", 22)
        text((968, 590), "Contributions welcome", 22, amber)
        card.save(assets / "koto-social-preview.png", optimize=True)
    print("Exported 1280 x 640 Koto social preview; source images are unchanged.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--social-preview", action="store_true",
                        help="Export only the social preview, preserving existing icons")
    parser.add_argument("--font", type=Path, help="Regular TrueType font for social-preview text")
    parser.add_argument("--bold-font", type=Path, help="Bold TrueType font for social-preview text")
    args = parser.parse_args()
    assets = Path(__file__).resolve().parents[1] / "assets"
    if args.social_preview:
        if not args.font or not args.bold_font:
            parser.error("--social-preview requires --font and --bold-font")
        social_preview(assets, args.font, args.bold_font)
        return
    with Image.open(assets / "koto-icon-source.png") as master:
        with master.convert("RGBA") as source:
            for size in (32, 64, 128, 256, 512, 1024):
                with source.resize((size, size), Image.Resampling.LANCZOS) as icon:
                    icon.save(assets / f"koto-icon-{size}.png", optimize=True)
            source.save(assets / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("Exported Koto icons and favicon; the original logo is unchanged.")


if __name__ == "__main__":
    main()
