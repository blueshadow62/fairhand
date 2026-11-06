# 한 번만 돌린다: python -X utf8 scripts/make-icon.py → build/icon.png(512), build/icon.ico
from PIL import Image, ImageDraw, ImageFont
S = 512
im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((16, 16, S - 16, S - 16), radius=96, fill=(47, 91, 211, 255))
font = ImageFont.truetype(r'C:\Windows\Fonts\malgunbd.ttf', 300)
# textbbox의 위쪽 여백까지 빼야 글자 자체가 가운데에 온다
l, t, r, b = d.textbbox((0, 0), '글', font=font)
d.text(((S - (r - l)) / 2 - l, (S - (b - t)) / 2 - t), '글', font=font, fill='white')
im.save('build/icon.png')
im.save('build/icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('ok')
