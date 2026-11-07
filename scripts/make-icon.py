# 한 번만 돌린다: python -X utf8 scripts/make-icon.py → build/icon.png(512), build/icon.ico(16~256)
# 그림: 맑은 하늘(#0277bd, styles.css 기본 강조색) 둥근 사각형 위에 흰색 '펜을 쥔 손'과 펜 끝의 글씨 한 줄.
# 손·펜은 흰색으로 채우고 바탕색 테두리를 둘러, 겹치는 곳(손가락이 펜 앞, 펜이 손바닥 앞)이 선으로 갈라져 보이게 한다.
# 위치는 펜 축 기준(t: 펜 끝 0 → 펜촉 1, s: 축에서 오른쪽 아래로 떨어진 거리)으로 잡는다.
# 작은 크기(32px 이하)는 갈라지는 선을 굵게 따로 그려 뭉개지지 않게 한다. SVG를 그림으로 바꾸는 데 PyMuPDF를 쓴다(개발용, 앱에는 안 들어감).
import io
import math
import sys
import pymupdf
from PIL import Image

BLUE, WHITE = '#0277bd', '#ffffff'
A, B = (408, 82), (178, 312)          # 펜 위 끝, 펜촉 시작
L = math.dist(A, B)
U = ((B[0] - A[0]) / L, (B[1] - A[1]) / L)   # 펜 방향(왼쪽 아래)
N = (U[1], -U[0])                            # 펜에서 오른쪽 아래로


def pt(t, s=0.0):
    return (A[0] + (B[0] - A[0]) * t + N[0] * s, A[1] + (B[1] - A[1]) * t + N[1] * s)


def part(p, q, core, line):
    """바탕색 테두리를 두른 흰 캡슐(손가락·손바닥·펜): 굵은 파란 선 위에 조금 가는 흰 선"""
    xy = f'x1="{p[0]:.1f}" y1="{p[1]:.1f}" x2="{q[0]:.1f}" y2="{q[1]:.1f}"'
    return (f'<line {xy} stroke="{BLUE}" stroke-width="{core + 2 * line}" stroke-linecap="round"/>'
            f'<line {xy} stroke="{WHITE}" stroke-width="{core}" stroke-linecap="round"/>')


def svg(line):
    """line: 갈라지는 선 굵기(512 기준). 작은 크기일수록 굵게"""
    half = 23                                         # 펜 굵기의 절반
    tip = (B[0] + U[0] * 66, B[1] + U[1] * 66)        # 펜촉 끝
    nib = [pt(1, -half), pt(1, half), tip]
    hole = (B[0] + U[0] * 22, B[1] + U[1] * 22)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><clipPath id="tile"><rect x="16" y="16" width="480" height="480" rx="96"/></clipPath></defs>
<rect x="16" y="16" width="480" height="480" rx="96" fill="{BLUE}"/>
<g clip-path="url(#tile)">
  <path d="M 42 412 C 58 380, 76 380, 82 402 S 102 426, 110 396 S {tip[0] - 6:.1f} {tip[1] + 10:.1f}, {tip[0]:.1f} {tip[1]:.1f}" fill="none" stroke="{WHITE}" stroke-width="{max(16, line)}" stroke-linecap="round" stroke-linejoin="round"/>
  {part(pt(0.50, 80), pt(0.66, 330), 132, line)}
  {part(pt(0.34, 62), pt(0.52, 78), 150, line)}
  {part(pt(-0.02), pt(1.0), 2 * half, line)}
  <polygon points="{' '.join(f'{x:.1f},{y:.1f}' for x, y in nib)}" fill="{WHITE}" stroke="{BLUE}" stroke-width="{line * 0.6:.1f}" stroke-linejoin="round"/>
  <circle cx="{hole[0]:.1f}" cy="{hole[1]:.1f}" r="{max(7, line * 0.45):.1f}" fill="{BLUE}"/>
  {part(pt(0.56, 96), pt(0.74, 40), 54, line)}
  {part(pt(0.36, -30), pt(0.80, -36), 58, line)}
</g>
</svg>'''


def render(line, size):
    page = pymupdf.open(stream=svg(line).encode('utf-8'), filetype='svg')[0]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(size / 512, size / 512), alpha=True)
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA')


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'build'
    render(12, 512).save(f'{out}/icon.png')
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [render(30 if s <= 32 else 18 if s <= 64 else 12, s) for s in sizes]
    imgs[-1].save(f'{out}/icon.ico', sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
    print('ok')
