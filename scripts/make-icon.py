# 아이콘 원본은 build/icon-source.png(1024px, 둥근 사각형 바깥은 투명)이다. 그림은 Codex 이미지 생성으로 그렸다.
# 투명 배경으로 생성하면 타일 위 광택·그림자까지 배경으로 알고 구멍을 내서, 캔버스 전체가 단색 배경인 그림을 받아
# 배경을 #0277bd(styles.css 기본 강조색)로 맞추고 둥근 모서리는 여기서 자른다.
#   새 그림으로 바꿀 때: python -X utf8 scripts/make-icon.py --from <생성한 PNG>  (원본을 다시 만들고 아래까지 진행)
#   원본에서 아이콘만 다시 만들 때: python -X utf8 scripts/make-icon.py → build/icon.png(512), build/icon.ico(16~256)
# 개발용 스크립트라 앱에는 안 들어간다(Pillow, numpy 필요).
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BUILD = Path(__file__).resolve().parent.parent / 'build'
TILE = np.array([0x02, 0x77, 0xBD], float)
SIZES = (16, 24, 32, 48, 64, 128, 256)
SIDE, MARGIN, RADIUS = 1024, 32, 0.20   # 여백 32/1024는 옛 아이콘(16/512)과 같아 작업 표시줄에서 크기가 그대로 보인다


def master_from_render(path: Path) -> Image.Image:
    arr = np.asarray(Image.open(path).convert('RGB')).astype(float)
    e = 16
    edge = np.concatenate([arr[:e].reshape(-1, 3), arr[-e:].reshape(-1, 3),
                           arr[:, :e].reshape(-1, 3), arr[:, -e:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    dist = np.linalg.norm(arr - bg, axis=-1)
    # 생성 그림의 배경은 #0277bd에서 조금 비켜 있다. 배경 화소는 정확히 맞추고, 손·펜과 섞인 가장자리 화소는
    # 배경이 섞인 만큼만 옮겨야 옛 배경색이 테두리처럼 남지 않는다.
    w = np.clip((dist - 8) / 24, 0, 1)[..., None]
    out = arr + (TILE - bg) * (1 - w)
    out[dist <= 8] = TILE
    side = SIDE - 2 * MARGIN
    tile = Image.fromarray(out.clip(0, 255).astype(np.uint8)).resize((side, side), Image.Resampling.LANCZOS)
    tile = tile.convert('RGBA')
    mask = Image.new('L', (side * 4, side * 4), 0)   # 4배로 그려 줄여야 모서리 곡선이 매끈하다
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side * 4 - 1, side * 4 - 1), radius=int(side * RADIUS * 4), fill=255)
    tile.putalpha(mask.resize((side, side), Image.Resampling.LANCZOS))
    canvas = Image.new('RGBA', (SIDE, SIDE), (0, 0, 0, 0))
    canvas.paste(tile, (MARGIN, MARGIN), tile)
    return canvas


def at(src: Image.Image, size: int) -> Image.Image:
    im = src.resize((size, size), Image.Resampling.LANCZOS)
    if size > 32:
        return im
    # 32px 이하로 줄이면 윤곽이 흐려져 펜과 손이 한 덩어리로 보여서 살짝 날을 세운다(투명도는 그대로)
    sharp = im.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1, percent=70, threshold=1))
    sharp.putalpha(im.getchannel('A'))
    return sharp


def main() -> None:
    args = sys.argv[1:]
    if args[:1] == ['--from']:
        master_from_render(Path(args[1])).save(BUILD / 'icon-source.png')
        args = args[2:]
    out = Path(args[0]) if args else BUILD
    src = Image.open(BUILD / 'icon-source.png').convert('RGBA')
    at(src, 512).save(out / 'icon.png')
    imgs = [at(src, s) for s in SIZES]
    imgs[-1].save(out / 'icon.ico', sizes=[(s, s) for s in SIZES], append_images=imgs[:-1])
    print('ok')


if __name__ == '__main__':
    main()
