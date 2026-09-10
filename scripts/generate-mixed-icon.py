from __future__ import annotations

import struct
from io import BytesIO
from pathlib import Path

from cairosvg import svg2png
from PIL import Image


TASKBAR_ICON_SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96)
ICON_SIZES = (*TASKBAR_ICON_SIZES, 128, 256)
MSIX_TASKBAR_ICON_SIZES = (*TASKBAR_ICON_SIZES, 256)
TASKBAR_SOURCE_SIZE = 1024
TASKBAR_INK = b'fill="#232421"'
TASKBAR_ADAPTIVE_INK = (
    b'fill="#232421" stroke="#F5F3EE" stroke-width="8" '
    b'stroke-linejoin="round" paint-order="stroke fill"'
)
TASKBAR_DARK_INK = (b"#232421", b"#F5F3EE")


def render_svg(source: bytes, size: int) -> Image.Image:
    rendered = svg2png(
        bytestring=source,
        output_width=size,
        output_height=size,
    )
    return Image.open(BytesIO(rendered)).convert("RGBA")


def save_png(image: Image.Image, path: Path, size: int) -> None:
    image.resize((size, size), Image.Resampling.LANCZOS).save(
        path,
        optimize=True,
        compress_level=9,
    )


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
    taskbar_source = (build_dir / "taskbar-icon.svg").read_bytes()
    light_taskbar_icon = render_svg(taskbar_source, TASKBAR_SOURCE_SIZE)
    adaptive_taskbar_icon = render_svg(
        taskbar_source.replace(TASKBAR_INK, TASKBAR_ADAPTIVE_INK),
        TASKBAR_SOURCE_SIZE,
    )
    dark_taskbar_icon = render_svg(
        taskbar_source.replace(*TASKBAR_DARK_INK),
        TASKBAR_SOURCE_SIZE,
    )
    save_png(adaptive_taskbar_icon, build_dir / "micro-icon-source.png", TASKBAR_SOURCE_SIZE)

    frames = [
        (
            size,
            png_frame(
                adaptive_taskbar_icon if size in TASKBAR_ICON_SIZES else full_icon,
                size,
            ),
        )
        for size in ICON_SIZES
    ]
    write_ico(build_dir / "icon.ico", frames)
    save_png(adaptive_taskbar_icon, renderer_public / "icon-24.png", 24)

    msix_assets = build_dir / "msix" / "Assets"
    for size in MSIX_TASKBAR_ICON_SIZES:
        save_png(light_taskbar_icon, msix_assets / f"AppList.targetsize-{size}.png", size)
        save_png(
            dark_taskbar_icon,
            msix_assets / f"AppList.targetsize-{size}_altform-unplated.png",
            size,
        )
        save_png(
            light_taskbar_icon,
            msix_assets / f"AppList.targetsize-{size}_altform-lightunplated.png",
            size,
        )


if __name__ == "__main__":
    main()
