"""Build public/images/share.jpg for Facebook / link previews (1200 x 630)."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "images" / "share.jpg"
PHOTO = ROOT / "public" / "images" / "products" / "throwing-rib-bo-001.jpg"

W, H = 1200, 630
CREAM = (11, 10, 16)
INK = (243, 239, 230)
INK_SOFT = (168, 163, 181)
X_COL = (196, 163, 255)
Y_COL = (62, 224, 138)
LINE = (196, 163, 255, 46)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = Path(r"C:\Windows\Fonts") / name
    return ImageFont.truetype(str(path), size)


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *im.size), radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def main() -> None:
    canvas = Image.new("RGB", (W, H), CREAM)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for x in range(0, W, 48):
        draw.line([(x, 0), (x, H)], fill=LINE, width=1)
    for y in range(0, H, 48):
        draw.line([(0, y), (W, y)], fill=LINE, width=1)

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((620, -80, 1280, 520), fill=(196, 163, 255, 36))
    g.ellipse((780, 280, 1320, 760), fill=(62, 224, 138, 28))
    overlay = Image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(48)), overlay)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")

    photo = Image.open(PHOTO).convert("RGB")
    card_size = 470
    photo = photo.resize((card_size, card_size), Image.Resampling.LANCZOS)
    card = rounded(photo, 28)
    shadow = Image.new("RGBA", (card_size + 48, card_size + 48), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((16, 20, card_size + 32, card_size + 36), 32, fill=(0, 0, 0, 140))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas_rgba = canvas.convert("RGBA")
    left, top = 660, 80
    canvas_rgba.alpha_composite(shadow, (left - 16, top - 12))
    canvas_rgba.alpha_composite(card, (left, top))
    canvas = canvas_rgba.convert("RGB")
    draw = ImageDraw.Draw(canvas)

    display_b = font("segoeuib.ttf", 72)
    by_font = font("segoeui.ttf", 42)
    sub = font("segoeuib.ttf", 36)
    body = font("segoeui.ttf", 26)

    x, y = 72, 168
    draw.text((x, y + 18), "by", font=by_font, fill=INK_SOFT)
    x += int(draw.textlength("by", font=by_font)) + 10
    draw.text((x, y), "3D", font=display_b, fill=INK)
    x += int(draw.textlength("3D", font=display_b))
    draw.text((x, y), "X", font=display_b, fill=X_COL)
    x += int(draw.textlength("X", font=display_b))
    draw.text((x, y), "Y", font=display_b, fill=Y_COL)
    x += int(draw.textlength("Y", font=display_b))
    draw.text((x, y), "Z", font=display_b, fill=INK)

    draw.text((72, 268), "Pottery tools", font=sub, fill=INK)
    draw.text((72, 328), "3D-printed parts for the studio.", font=body, fill=INK_SOFT)
    draw.text((72, 368), "Same shape every time.", font=body, fill=INK_SOFT)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "JPEG", quality=90, optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
