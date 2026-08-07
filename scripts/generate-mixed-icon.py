from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path

from PIL import Image


ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)
MICRO_SIZES = {16, 24}


def png_frame(image: Image.Image, size: int) -> bytes:
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    output = BytesIO()
    resized.save(output, format="PNG", optimize=True, compress_level=9)
    return output.getvalue()


def write_ico(path: Path, frames: list[tuple[int, bytes]]) -> None:
    header_size = 6 + 16 * len(frames)
    offset = header_size
    entries: list[bytes] = []
    payloads: list[bytes] = []

    for size, payload in frames:
        dimension = 0 if size == 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(payload),
                offset,
            )
        )
        payloads.append(payload)
        offset += len(payload)

    with path.open("wb") as output:
        output.write(struct.pack("<HHH", 0, 1, len(frames)))
        output.writelines(entries)
        output.writelines(payloads)


def main() -> None:
    desktop_root = Path(__file__).resolve().parents[1]
    build_dir = desktop_root / "build"
    renderer_public = desktop_root / "src" / "renderer" / "public"
    full_icon = Image.open(build_dir / "icon.png").convert("RGBA")
    micro_icon = Image.open(build_dir / "micro-icon-source.png").convert("RGBA")

    frames = [
        (size, png_frame(micro_icon if size in MICRO_SIZES else full_icon, size))
        for size in ICON_SIZES
    ]
    write_ico(build_dir / "icon.ico", frames)
    micro_icon.resize((24, 24), Image.Resampling.LANCZOS).save(
        renderer_public / "icon-24.png",
        optimize=True,
        compress_level=9,
    )


if __name__ == "__main__":
    main()
