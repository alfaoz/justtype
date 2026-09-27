# The DMG's background: the app's own look (the dark ground, IBM Plex Mono,
# the "+ just type" mark with a caret after it, as if just typed) and a
# dashed guide from the app to Applications, like the palette's snap lines.
# Drawn at 1x and 2x for the Finder window release.sh sizes to 640 x 400.
# Usage: python3 background.py <out-dir>
import os, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'Resources', 'Fonts')
W, H = 640, 400
APP_X, APPS_X, ICON_Y = 170, 470, 196   # icon centres, kept in step with settings.py


def draw(scale):
    w, h = W * scale, H * scale
    px = lambda v: int(round(v * scale))
    # Ground: a hair lighter at the top, a soft light behind the mark
    ground = Image.new('L', (1, h))
    for y in range(h):
        ground.putpixel((0, y), int(12 - 7 * (y / h)))
    img = Image.merge('RGB', [ground.resize((w, h))] * 3)
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse([px(W / 2 - 230), px(-120), px(W / 2 + 230), px(190)], fill=22)
    glow = glow.filter(ImageFilter.GaussianBlur(px(70)))
    img = Image.composite(Image.new('RGB', (w, h), (40, 40, 40)), img, glow)

    # A little grain, so the dark reads as paper, not a flat fill
    random.seed(7)
    noise = Image.effect_noise((w, h), 6).point(lambda v: 128 + (v - 128) // 3)
    img = Image.blend(img, Image.merge('RGB', [noise] * 3), 0.035)

    d = ImageDraw.Draw(img)
    medium = ImageFont.truetype(os.path.join(FONTS, 'IBMPlexMono-Medium.ttf'), px(27))
    regular = ImageFont.truetype(os.path.join(FONTS, 'IBMPlexMono-Regular.ttf'), px(11.5))

    # The mark, centred, and the caret after it
    mark = '+ just type'
    box = d.textbbox((0, 0), mark, font=medium)
    mw = box[2] - box[0]
    caret_gap, caret_w = px(7), max(2, px(2))
    left = (w - (mw + caret_gap + caret_w)) // 2
    top = px(52)
    d.text((left - box[0], top), mark, font=medium, fill=(236, 236, 236))
    asc, desc = medium.getmetrics()
    cx = left + mw + caret_gap
    d.rectangle([cx, top + px(4), cx + caret_w - 1, top + asc + desc - px(9)], fill=(236, 236, 236))

    # The guide: dashed, faint, ending in a chevron
    y = px(ICON_Y)
    x0, x1 = px(APP_X + 78), px(APPS_X - 86)
    x = x0
    while x < x1:
        d.rectangle([x, y, min(x + px(4), x1) - 1, y + max(1, px(1)) - 1], fill=(92, 92, 92))
        x += px(10)
    chev = px(6)
    stroke = max(2, px(1.4))
    d.line([(x1 + px(2), y - chev), (x1 + px(2) + chev, y), (x1 + px(2), y + chev)], fill=(130, 130, 130), width=stroke, joint='curve')

    # What to do, in a word
    hint = 'drag justtype into applications'
    hb = d.textbbox((0, 0), hint, font=regular)
    d.text(((w - (hb[2] - hb[0])) // 2 - hb[0], px(326)), hint, font=regular, fill=(112, 112, 112))
    return img


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else HERE
    os.makedirs(out, exist_ok=True)
    draw(1).save(os.path.join(out, 'background.png'))
    draw(2).save(os.path.join(out, 'background@2x.png'))
    print('drawn', out)
