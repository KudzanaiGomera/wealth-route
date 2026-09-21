"""One-off icon generator, stdlib only (struct/zlib) \u2014 no Pillow/build step
needed to match the rest of this project's zero-dependency stance.
Draws a plain "WR" monogram, in white, on a solid emerald square, at every
size the PWA / favicon setup needs. The letters come from a classic 5x7
dot-matrix font (same glyph data used by countless LED/LCD displays), which
stays crisp and legible from 16x16 favicons up to 512x512 install icons since
each pixel is computed directly rather than upscaled from a fixed bitmap.
Run once with `python scripts/generate-icons.py`; re-run only if the brand
color changes.
"""
import struct
import zlib

BG = (14, 107, 87)      # #0e6b57 (--accent, light theme) - green background
MARK = (255, 255, 255)  # white "WR" lettering

# Classic 5x7 font, one column per byte, bit N (0=top row .. 6=bottom row) set
# means that pixel is lit. This is the same glyph data used by Adafruit's
# GFX "Font5x7" and many LED-matrix libraries.
W_COLS = [0x7F, 0x20, 0x18, 0x20, 0x7F]
R_COLS = [0x7F, 0x09, 0x19, 0x29, 0x46]
GAP_COLS = [0x00]
GLYPH_COLS = W_COLS + GAP_COLS + R_COLS
GRID_W = len(GLYPH_COLS)  # 11
GRID_H = 7


def glyph_lit(gx, gy):
    if gx < 0 or gx >= GRID_W or gy < 0 or gy >= GRID_H:
        return False
    return bool((GLYPH_COLS[gx] >> gy) & 1)


def make_png(size, path, maskable=False):
    # Maskable icons need their content inside a centered ~80% safe zone;
    # non-maskable can use the full canvas.
    margin = int(size * 0.1) if maskable else 0
    inner = size - 2 * margin

    # Fit the 11x7 letter grid at ~72% of the inner box width, centered,
    # preserving its aspect ratio so the letters never look stretched.
    glyph_w = inner * 0.72
    cell = glyph_w / GRID_W
    glyph_h = cell * GRID_H
    gx0 = margin + (inner - glyph_w) / 2
    gy0 = margin + (inner - glyph_h) / 2

    pixels = bytearray()
    for y in range(size):
        row = bytearray()
        for x in range(size):
            color = BG
            gx = int((x - gx0) / cell)
            gy = int((y - gy0) / cell)
            if glyph_lit(gx, gy):
                color = MARK
            row += bytes(color) + b'\xff'  # RGBA, fully opaque
        pixels += row

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw += b'\x00' + bytes(pixels[y * stride:(y + 1) * stride])

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(png)
    print(f'wrote {path} ({size}x{size})')


if __name__ == '__main__':
    make_png(16, 'favicon-16.png')
    make_png(32, 'favicon-32.png')
    make_png(192, 'icon-192.png')
    make_png(512, 'icon-512.png')
    make_png(512, 'icon-512-maskable.png', maskable=True)
