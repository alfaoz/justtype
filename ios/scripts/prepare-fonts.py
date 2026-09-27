"""Unpack the app's existing Fontsource WOFF fonts for native UIKit use."""
from pathlib import Path
import shutil
import struct
import zlib

root = Path(__file__).resolve().parents[2]
source = root / 'repo/node_modules/@fontsource/ibm-plex-mono'
target = root / 'ios/ios/App/App/Fonts'
target.mkdir(exist_ok=True)

for weight, style in [(400, 'Regular'), (500, 'Medium')]:
    woff = (source / f'files/ibm-plex-mono-latin-{weight}-normal.woff').read_bytes()
    assert woff[:4] == b'wOFF'
    count = struct.unpack_from('>H', woff, 12)[0]
    power = 2 ** (count.bit_length() - 1)
    sfnt = bytearray(woff[4:8] + struct.pack('>HHHH', count, power * 16, power.bit_length() - 1, count * 16 - power * 16))
    sfnt.extend(bytes(count * 16))
    head_offset = None
    for index in range(count):
        tag, offset, compressed, length, checksum = struct.unpack_from('>4sIIII', woff, 44 + index * 20)
        data = woff[offset:offset + compressed]
        if compressed < length:
            data = zlib.decompress(data)
        assert len(data) == length
        if tag == b'head':
            head_offset = len(sfnt)
            data = data[:8] + bytes(4) + data[12:]
        struct.pack_into('>4sIII', sfnt, 12 + index * 16, tag, checksum, len(sfnt), length)
        sfnt.extend(data)
        sfnt.extend(bytes(-length % 4))
    assert head_offset is not None
    total = sum(struct.unpack(f'>{len(sfnt) // 4}I', sfnt)) & 0xFFFFFFFF
    struct.pack_into('>I', sfnt, head_offset + 8, (0xB1B0AFBA - total) & 0xFFFFFFFF)
    assert sum(struct.unpack(f'>{len(sfnt) // 4}I', sfnt)) & 0xFFFFFFFF == 0xB1B0AFBA
    (target / f'IBMPlexMono-{style}.ttf').write_bytes(sfnt)
shutil.copyfile(source / 'LICENSE', target / 'LICENSE')
