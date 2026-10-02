# -*- coding: utf-8 -*-
"""
compress.py — 压缩手写作答照片，使其能进小程序包

输入：tools/jobs.json（由 tools/build-seed.js 生成）
输出：miniprogram/assets/hw/*.jpg
运行：python tools/compress.py
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, 'tools', 'jobs.json')
MAX_W = 1000
QUALITY = 70

with open(JOBS, encoding='utf-8') as f:
    jobs = json.load(f)

if not jobs:
    print('jobs.json 为空，先运行 node tools/build-seed.js')
    raise SystemExit(1)

before = after = 0
for j in jobs:
    src, dst = j['src'], j['dst']
    if not os.path.exists(src):
        print('  缺失 %s' % src)
        continue
    im = Image.open(src)
    if im.mode != 'RGB':
        im = im.convert('RGB')
    w, h = im.size
    if w > MAX_W:
        im = im.resize((MAX_W, max(1, round(h * MAX_W / w))), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    b, a = os.path.getsize(src), os.path.getsize(dst)
    before += b
    after += a
    print('  %-14s %4dx%-4d -> %4dx%-4d  %5.0f KB -> %4.0f KB'
          % (os.path.basename(dst), w, h, im.size[0], im.size[1], b / 1024, a / 1024))

print('')
print('照片合计: %.2f MB -> %.2f MB  (压缩到 %.0f%%)'
      % (before / 1048576, after / 1048576, after / before * 100))
