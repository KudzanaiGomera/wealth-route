"""One-off icon generator, stdlib only (struct/zlib/binascii) \u2014 no Pillow/
build step needed to match the rest of this project's zero-dependency stance.
Draws the same wave + dot brand mark used in the topbar SVG, flat-colored,
onto a solid emerald square, at each size PWA installability needs.
Run once with `python scripts/generate-icons.py`; re-run only if the brand
color/mark changes.
"""
import struct
import zlib

BG = (14, 107, 87)       # #0e6b57 (--accent, light theme)
MARK = (246, 244, 238)   # #f6f4ee (--bg, light theme) - the wave/dot mark color


def make_png(size, path, maskable=False):
    pixels = bytearray()
    # Maskable icons need their content inside a centered ~80% safe zone;
    # non-maskable can use the full canvas.
    margin = int(size * 0.1) if maskable else 0
    inner = size - 2 * margin

    for y in range(size):
        row = bytearray()
        for x in range(size):
            color = BG
            ix, iy = x - margin, y - margin
            if 0 <= ix < inner and 0 <= iy < inner:
                # Normalize to a 0..1 box matching the 24x24 viewBox the topbar SVG uses.
                nx, ny = ix / inner, iy / inner
                # Wave: a shallow sine arc through the lower-middle band.
                import math
                wave_y = 0.62 + 0.18 * math.sin(nx * math.pi * 1.6)
                on_wave = abs(ny - wave_y) < 0.045
                # Accent dot: near the wave's right end, like the SVG's circle.
                dx, dy = nx - 0.86, ny - 0.66
                on_dot = (dx * dx + dy * dy) ** 0.5 < 0.09
                if on_wave or on_dot:
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
    make_png(192, 'icon-192.png')
    make_png(512, 'icon-512.png')
    make_png(512, 'icon-512-maskable.png', maskable=True)
