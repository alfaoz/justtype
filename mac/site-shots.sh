#!/bin/sh
# The pictures on justtype.io/mac (repo/src/components/MacPage.jsx): a copy
# of the app built beside the everyday one, run in a throwaway profile
# (JUSTTYPE_CLEAN) as a made-up signed-in account whose server is a file
# (JUSTTYPE_FIXTURES), walked through what site/make.mjs plans by its
# snapshot mode. The words are site/*.txt and site/slates.json. The
# pictures the page shows go to the web repo's public/mac-page as WebP;
# where the writing sits in them, and the words, to its src/macShots.json.
# It takes the screen for about a minute.
set -e
cd "$(dirname "$0")"
PY=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
sh build.sh --shots
DIR="$PWD/build/shots/pictures"
rm -rf "$DIR" && mkdir -p "$DIR"
cp site/*.txt "$DIR/"
node site/make.mjs "$DIR" 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|To eliminate\|trace-warnings"
JUSTTYPE_CLEAN=1 JUSTTYPE_FIXTURES="$DIR/fixtures.json" JUSTTYPE_SHOTS="$DIR" build/shots/justtype.app/Contents/MacOS/justtype 2>/dev/null
mkdir -p ../repo/public/mac-page
"$PY" - "$DIR" ../repo <<'PY'
import sys, os, json
from PIL import Image, ImageDraw, ImageFilter
src, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'public/mac-page')
# The pictures the page shows: my slates, a row under the pointer, the
# picked slate opened, the palette over it written, the new tab empty; the
# writing itself is the page's
for old in os.listdir(out):
    os.remove(os.path.join(out, old))
for name in ['slates', 'hover', 'opened', 'palette', 'tabs']:
    image = Image.open(os.path.join(src, name + '-window.png'))
    target = os.path.join(out, name + '.webp')
    image.save(target, 'WEBP', quality=90, method=6)
    print(f'{name}: {image.width}x{image.height}, {os.path.getsize(target) // 1024} KB')
# Where the writing goes in each (the editor, the counter), and the words
report = {step['name']: step['probe'] for step in json.load(open(os.path.join(src, 'report.json')))}
texts = {name: open(os.path.join(src, name + '.txt')).read().rstrip('\n') for name in ('writer', 'math')}
texts['saved'] = open(os.path.join(src, 'saved.txt')).read()
# The math card: its glass cut out of each picture with a little room around
peeks, room = [], 14
for name, rect in report.items():
    if not name.startswith('peek-') or not rect:
        continue
    box = [round(v) for v in (rect['x'] - room, rect['y'] - room, rect['x'] + rect['width'] + room, rect['y'] + rect['height'] + room)]
    card = Image.open(os.path.join(src, name + '-window.png')).convert('RGBA').crop([v * 2 for v in box])
    # The room around the glass fades out, so its edge meets the page's own text unseen
    fade = Image.new('L', card.size, 0)
    ImageDraw.Draw(fade).rectangle([16, 16, card.width - 17, card.height - 17], fill=255)
    card.putalpha(fade.filter(ImageFilter.GaussianBlur(7)))
    card.save(os.path.join(out, name + '.webp'), 'WEBP', quality=90, method=6)
    peeks.append({'state': int(name[5:]), 'src': name + '.webp', 'x': box[0], 'y': box[1], 'width': box[2] - box[0], 'height': box[3] - box[1]})
peeks.sort(key=lambda p: p['state'])
print(f'math card: {len(peeks)} pictures, {sum(os.path.getsize(os.path.join(out, p["src"])) for p in peeks) // 1024} KB')
shots = {'size': {'width': 1280, 'height': 800}, 'first': report['opened'], 'second': report['tabs'], 'texts': texts, 'peeks': peeks}
json.dump(shots, open(os.path.join(repo, 'src/macShots.json'), 'w'), indent=2, ensure_ascii=False)
print('layout:', json.dumps({k: shots[k] for k in ('first', 'second')}))
PY
