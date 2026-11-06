# 한 번만 돌린다: python -X utf8 scripts/make-sample.py
# → resources/sample/봄비/정답표.json, 원본/봄비.txt, transcripts/p01~p03.json, pages/p01~p03.jpg
# 글·문항·답은 모두 자작(저작권 없음). 답안지는 손글씨가 아니라 '인쇄 글자'로 만든 가짜다.
import json
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join('resources', 'sample', '봄비')
TEXT = """봄비 오는 날

아침부터 가는 봄비가 내렸다. 민수는 우산을 챙기지 않아 교문까지 뛰었다. 교실에 들어서자 창가 자리에 앉은 지연이가 수건을 건넸다. "감기 걸리겠다." 민수는 고맙다고 말하면서도 괜히 퉁명스럽게 받았다.
점심시간에 비가 그쳤다. 운동장에는 물웅덩이가 세 개 생겼고, 1학년 아이들이 그 둘레를 돌며 놀았다. 민수는 지연이에게 수건을 돌려주며 처음으로 먼저 웃었다. 지연이는 "내일도 비 온대. 우산 챙겨."라고만 했다.
집으로 가는 길에 민수는 문구점에서 파란 우산을 샀다. 하나는 자기 것, 하나는 여분이었다. 다음 날 아침, 비는 오지 않았다.
"""
KEY = {
    "세트": "샘플 1학년 봄비 오는 날", "글": "봄비 오는 날(글눈 샘플)", "학기": "샘플 학기",
    "대상": {"학년": 1, "반": [1], "인원": {"1": 3}},
    "확인": {"완료": True, "일시": "2026-11-06T00:00:00.000Z"},
    "채점규칙": {"맞춤법": "인정", "넓은말": "불인정", "핵심어": "모두"},
    "정량": [
        {"id": "1-1", "문항": 1, "설명": "민수에게 수건을 건넨 사람", "정답": "지연", "허용": ["지연이"], "유형": "단답형"},
        {"id": "2-1", "문항": 2, "설명": "운동장에 생긴 물웅덩이 __개", "정답": "3", "허용": ["세", "셋"], "유형": "빈칸형"},
        {"id": "2-2", "문항": 2, "설명": "그 둘레를 돌며 논 __학년", "정답": "1", "허용": ["일"], "유형": "빈칸형"},
        {"id": "3-1", "문항": 3, "설명": "민수가 산 물건과 색", "정답": "파란 우산", "핵심": ["파란", "우산"], "유형": "문장형"},
        {"id": "4-1", "문항": 4, "설명": "민수가 우산을 두 개 산 까닭", "정답": "하나는 자기 것, 하나는 여분으로 두려고", "핵심": ["여분"], "유형": "문장형"},
    ],
    "정성": [{"id": "E1", "문항": 5, "설명": "민수가 처음으로 먼저 웃은 까닭을 자기 생각으로"}],
}
QUESTIONS = [
    ("1-1", "1. 민수에게 수건을 건넨 사람은?"),
    ("2-1", "2. 운동장의 물웅덩이는 ( ① )개, 둘레를 돌며 논 아이들은 ( ② )학년.   ①"),
    ("2-2", "   ②"),
    ("3-1", "3. 민수가 집으로 가는 길에 산 물건을 색과 함께 쓰시오."),
    ("4-1", "4. 민수가 우산을 두 개 산 까닭은?"),
    ("E1", "5. 민수가 처음으로 먼저 웃은 까닭을 자기 생각으로 쓰시오."),
]
# (답, 판정) / 정성은 (응답, 답). 합계: p01 6, p02 3, p03 4
PAGES = [
    {"정량": {"1-1": ("지연", "O"), "2-1": ("3", "O"), "2-2": ("1", "O"), "3-1": ("파란 우산", "O"), "4-1": ("하나는 여분으로 두려고", "O")},
     "E1": (True, "지연이가 수건을 건네준 것이 고마워서 마음이 풀렸기 때문이다.")},
    {"정량": {"1-1": ("지연", "O"), "2-1": ("2", "X"), "2-2": ("1", "O"), "3-1": ("파란색 우산", "O"), "4-1": ("", "빈칸")},
     "E1": (False, "")},
    {"정량": {"1-1": ("지연이", "O"), "2-1": ("세", "O"), "2-2": ("1", "O"), "3-1": ("우산", "X"), "4-1": ("그냥 사고 싶어서", "X")},
     "E1": (True, "비가 그쳐서 기분이 좋아졌기 때문이다.")},
]
NOTE = "글눈 샘플: 인쇄 글자로 만든 가짜 답안지"
INFO = {"엔진": "사람", "모델": "샘플", "effort": "-", "규칙": "샘플", "일시": "2026-11-06T00:00:00.000Z"}

os.makedirs(os.path.join(OUT, '원본'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'pages'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'transcripts'), exist_ok=True)
with open(os.path.join(OUT, '원본', '봄비.txt'), 'w', encoding='utf-8') as f: f.write(TEXT)
with open(os.path.join(OUT, '정답표.json'), 'w', encoding='utf-8') as f: json.dump(KEY, f, ensure_ascii=False, indent=1)

W, H = 1654, 2339
font = ImageFont.truetype(r'C:\Windows\Fonts\malgun.ttf', 40)
bold = ImageFont.truetype(r'C:\Windows\Fonts\malgunbd.ttf', 52)
for i, p in enumerate(PAGES, start=1):
    t = {"page": i, "학년": 1, "반": 1, "번호": i, "이름": None, "식별확신": "확실",
         "정량": {k: {"답": a, "판정": j} for k, (a, j) in p["정량"].items()},
         "정성": {"E1": {"응답": p["E1"][0], "답": p["E1"][1]}},
         "비고": [NOTE], "전사정보": INFO}
    with open(os.path.join(OUT, 'transcripts', f'p{i:02d}.json'), 'w', encoding='utf-8') as f: json.dump(t, f, ensure_ascii=False, indent=1)

    im = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(im)
    d.text((W / 2, 140), '봄비 오는 날 - 글 내용 확인(글눈 샘플)', font=bold, fill='black', anchor='mm')
    d.text((W - 140, 230), f'1학년  1반  {i}번   이름: ________', font=font, fill='black', anchor='rm')
    d.text((140, 300), '이 답안지는 인쇄 글자로 만든 샘플입니다.', font=font, fill=(120, 120, 120))
    y = 420
    for uid, q in QUESTIONS:
        if uid == '2-2':
            d.text((140, y), q, font=font, fill='black')
        else:
            y += 40
            d.text((140, y), q, font=font, fill='black')
        y += 70
        ans = p["E1"][1] if uid == 'E1' else p["정량"][uid][0]
        d.line((180, y + 58, W - 140, y + 58), fill=(180, 180, 180), width=2)
        if ans: d.text((200, y), ans, font=font, fill=(20, 40, 140))
        y += 110
    im.save(os.path.join(OUT, 'pages', f'p{i:02d}.jpg'), quality=85)
print('ok')
