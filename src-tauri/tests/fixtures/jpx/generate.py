#!/usr/bin/env python3
"""Genera los JP2 de prueba de `src-tauri/src/jpx.rs` (sin datos de terceros).

Requisitos: `python3` y `ffmpeg` compilado con libopenjpeg
(`ffmpeg -hide_banner -encoders | grep libopenjpeg`). ffmpeg produce el
codestream JPEG 2000 con compresión sin pérdida (5/3 reversible); este script
lo envuelve en cajas JP2 (colr, pclr, cmap, cdef) para los casos que ffmpeg
no puede escribir (CMYK, paleta, canales de opacidad).

Uso, desde esta carpeta:  python3 generate.py

Los píxeles son patrones deterministas (funciones `*_pixel` más abajo). Los tests
de jpx.rs recalculan los mismos patrones para comparar: si cambias uno aquí,
cámbialo también allí y regenera.
"""

import pathlib
import struct
import subprocess
import tempfile

W, H = 64, 48
HERE = pathlib.Path(__file__).resolve().parent


def gray_pixel(x, y):
    return (x * 7 + y * 13) % 256


def gray_alpha_pixel(x, y):
    return gray_pixel(x, y), (x * 9 + y * 2) % 256


def rgb_pixel(x, y):
    return (x * 4) % 256, (y * 5) % 256, ((x + y) * 3) % 256


def rgba_pixel(x, y):
    r, g, b = rgb_pixel(x, y)
    return r, g, b, (x * 4 + y * 3) % 256


def cmyk_pixel(x, y):
    return (x * 4) % 256, (y * 5) % 256, ((x + y) * 3) % 256, (x * y) % 256


def index_pixel(x, y):
    return ((x // 16) + (y // 12)) % 4


def gray16_pixel(x, y):
    return (x * 1000 + y * 777) % 65536


PALETTE = [(200, 60, 40), (40, 160, 90), (230, 200, 60), (30, 60, 140)]


def constant_pixel(x, y):
    return 10, 200, 90


def raw(pixels, fmt):
    """Bytes en el formato `fmt` de ffmpeg (rawvideo) para `pixels(x, y)`."""
    out = bytearray()
    for y in range(H):
        for x in range(W):
            values = pixels(x, y)
            if not isinstance(values, tuple):
                values = (values,)
            for value in values:
                if fmt == "gray16le":
                    out += struct.pack("<H", value)
                else:
                    out.append(value)
    return bytes(out)


def codestream(pixels, pix_fmt, resolutions=4):
    """Codestream JPEG 2000 sin pérdida que produce ffmpeg (libopenjpeg)."""
    with tempfile.TemporaryDirectory() as tmp:
        raw_path = pathlib.Path(tmp) / "in.raw"
        out_path = pathlib.Path(tmp) / "out.j2k"
        raw_path.write_bytes(raw(pixels, pix_fmt))
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y",
                "-f", "rawvideo", "-pix_fmt", pix_fmt, "-s", f"{W}x{H}", "-i", str(raw_path),
                "-c:v", "libopenjpeg", "-format", "j2k", "-irreversible", "0",
                "-numresolution", str(resolutions), str(out_path),
            ],
            check=True,
        )
        return out_path.read_bytes()


def box(kind, payload):
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def jp2(codestream, components, bit_depth, colr, pclr=None, cmap=None, cdef=None):
    """Envuelve un codestream en un JP2 con las cajas indicadas."""
    signature = box(b"jP  ", b"\x0d\x0a\x87\x0a")
    ftyp = box(b"ftyp", b"jp2 " + struct.pack(">I", 0) + b"jp2 ")
    ihdr = box(
        b"ihdr",
        struct.pack(">IIHBBBB", H, W, components, bit_depth - 1, 7, 0, 0),
    )
    colr_box = box(b"colr", struct.pack(">BBBI", 1, 0, 0, colr))
    header = ihdr + colr_box
    if pclr is not None:
        header += pclr + cmap
    if cdef is not None:
        header += cdef
    return signature + ftyp + box(b"jp2h", header) + box(b"jp2c", codestream)


def palette_boxes(entries, columns=3):
    """Cajas pclr y cmap para una paleta de 8 bits con `columns` columnas."""
    body = struct.pack(">HB", len(entries), columns) + bytes([7] * columns)
    for entry in entries:
        body += bytes(entry[:columns])
    cmap = b"".join(struct.pack(">HBB", 0, 1, column) for column in range(columns))
    return box(b"pclr", body), box(b"cmap", cmap)


def alpha_cdef(colour_channels, alpha_channel):
    """cdef: canales de color asociados a 1..N y el canal de opacidad al final."""
    entries = [(i, 0, i + 1) for i in range(colour_channels)]
    entries.append((alpha_channel, 1, 0))
    body = struct.pack(">H", len(entries)) + b"".join(
        struct.pack(">HHH", *entry) for entry in entries
    )
    return box(b"cdef", body)


def write(name, data):
    path = HERE / name
    path.write_bytes(data)
    print(f"{name}: {len(data)} bytes")


def main():
    write("gray.jp2", jp2(codestream(gray_pixel, "gray"), 1, 8, 17))
    write(
        "gray_alpha.jp2",
        jp2(codestream(gray_alpha_pixel, "ya8"), 2, 8, 17, cdef=alpha_cdef(1, 1)),
    )
    write("rgb.jp2", jp2(codestream(rgb_pixel, "rgb24"), 3, 8, 16))
    write(
        "rgba.jp2",
        jp2(codestream(rgba_pixel, "rgba"), 4, 8, 16, cdef=alpha_cdef(3, 3)),
    )
    write("cmyk.jp2", jp2(codestream(cmyk_pixel, "rgba"), 4, 8, 12))
    pclr, cmap = palette_boxes(PALETTE)
    write("indexed.jp2", jp2(codestream(index_pixel, "gray"), 1, 8, 16, pclr, cmap))
    write("gray16.jp2", jp2(codestream(gray16_pixel, "gray16le"), 1, 16, 17))
    write("constant.jp2", jp2(codestream(constant_pixel, "rgb24"), 3, 8, 16))


if __name__ == "__main__":
    main()
