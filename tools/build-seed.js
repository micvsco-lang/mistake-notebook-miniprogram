'use strict';
/**
 * build-seed.js — 把学习通抓取结果转成小程序可直接用的种子数据
 *
 * 做什么：
 *  1. 把 HTML 里内嵌的 base64 公式图落成真实图片文件（assets/sym/），自动去重
 *  2. 把题干/我的答案/正确答案/教师批语从 HTML 解析成结构化的 nodes 数组
 *     （小程序用 view/image/text 渲染，比 rich-text 更可控，公式图能按行内对齐）
 *  3. 输出待压缩的手写照片清单（tools/jobs.json）交给 compress.py 处理
 *  4. 生成 miniprogram/data/seed.js
 *
 * 运行：node tools/build-seed.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 数据来源目录：学习通抓取结果（HTML + 附件照片）。
 * 该抓取工程不在本仓库内 —— 它属于作者本地的私有工具。
 * 想重建种子数据，请把 SEED_SRC_DIR 指向你自己的抓取结果目录。
 */
const SRC_DIR = process.env.SEED_SRC_DIR || path.join(__dirname, 'seed-src');
const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const SYM_DIR = path.join(MP, 'assets', 'sym');

fs.mkdirSync(SYM_DIR, { recursive: true });

/* ============================ 图片尺寸 ============================ */
function pngSize(buf) {
  if (buf.length < 24) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpgSize(buf) {
  let i = 2;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff) { i++; continue; }
    const mk = buf[i + 1];
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd9)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}
function imgSize(buf, ext) {
  const s = ext === 'png' ? pngSize(buf) : jpgSize(buf);
  return s && s.w > 0 && s.h > 0 ? s : { w: 24, h: 24 };
}

/* ============================ 图片落盘（去重） ============================ */
const symSeen = new Map();
let symCount = 0;
const symList = [];

function saveBase64(mime, b64) {
  const buf = Buffer.from(b64, 'base64');
  const ext = /jpe?g/i.test(mime) ? 'jpg' : 'png';
  const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
  const key = ext + ':' + hash;
  if (symSeen.has(key)) return symSeen.get(key);

  // 公式图的显示尺寸按「与正文字号协调」来定，单位是 rpx：
  //   1.25 rpx/px —— 让典型的单符号公式（原图高约 24px）显示成 30rpx，正好与正文 30rpx 齐平；
  //   620rpx 宽度上限 —— 超过就会撑破卡片，长公式按宽度等比缩；
  //   88rpx 高度上限 —— 分数、矩阵这类本来就高的式子不至于把行拉散。
  const s = imgSize(buf, ext);
  const MAX_W = 620, MAX_H = 88, BASE = 1.25;
  const k = Math.min(BASE, MAX_W / s.w, MAX_H / s.h);

  const name = 'fx' + String(++symCount).padStart(3, '0') + '.' + ext;
  fs.writeFileSync(path.join(SYM_DIR, name), buf);

  const rec = {
    src: '/assets/sym/' + name,
    w: Math.max(16, Math.round(s.w * k)),
    h: Math.max(16, Math.round(s.h * k))
  };
  symSeen.set(key, rec);
  symList.push({ file: name, bytes: buf.length, raw: s, disp: rec });
  return rec;
}

/* ============================ 手写照片映射 ============================ */
const photoJobs = [];   // { src, dst, key }
const photoMap = new Map();

function mapPhoto(relSrc, key) {
  if (photoMap.has(relSrc)) return photoMap.get(relSrc);
  const abs = path.join(SRC_DIR, relSrc.replace(/^\/+/, ''));
  if (!fs.existsSync(abs)) return null;

  // 手写作答照片：宽度铺满内容区（620rpx），高度按原始比例推算。
  // 注意：compress.py 是等比压缩的，所以这里的比例与压缩后一致。
  const s = jpgSize(fs.readFileSync(abs)) || { w: 864, h: 1920 };
  const dstRel = '/assets/hw/' + key + '.jpg';
  const rec = { src: dstRel, w: 620, h: Math.round(620 * s.h / s.w), __photo: true };
  photoMap.set(relSrc, rec);
  photoJobs.push({ src: abs, dst: path.join(MP, 'assets', 'hw', key + '.jpg') });
  return rec;
}

/* ============================ HTML → nodes ============================ */
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '\u201c', rdquo: '\u201d', lsquo: '\u2018', rsquo: '\u2019',
  hellip: '\u2026', times: '\u00d7', divide: '\u00f7', middot: '\u00b7',
  minus: '\u2212', le: '\u2264', ge: '\u2265', ne: '\u2260', radic: '\u221a',
  larr: '\u2190', rarr: '\u2192', harr: '\u2194', infin: '\u221e', isin: '\u2208',
  there4: '\u2234', permil: '\u2030', deg: '\u00b0', plusmn: '\u00b1'
};
function decodeEnt(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}

const BRK = '\u0001';

/**
 * @param {string} html
 * @param {(attrs:string)=>object|null} imgResolver 解析 <img> 的属性，返回 {src,w,h} 或 null
 */
function htmlToNodes(html, imgResolver) {
  if (!html) return [];
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, BRK)
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, BRK);

  const parts = s.split(/(<img[^>]*>)/gi);
  let nodes = [];

  const pushText = (raw) => {
    const plain = decodeEnt(raw.replace(/<[^>]+>/g, ''));
    plain.split(BRK).forEach((seg, i) => {
      if (i > 0) nodes.push({ t: 'br' });
      const v = seg.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ');
      if (v.trim()) nodes.push({ t: 't', v });
    });
  };

  parts.forEach((p) => {
    const mi = /^<img([^>]*)>$/i.exec(p);
    if (mi) {
      const rec = imgResolver(mi[1]);
      if (rec) nodes.push({ t: 'i', s: rec.src, w: rec.w, h: rec.h, p: rec.__photo ? 1 : 0 });
    } else {
      pushText(p);
    }
  });

  // 清理连续/首尾换行
  nodes = nodes.filter((n, i) => !(n.t === 'br' && (i === 0 || nodes[i - 1].t === 'br')));
  while (nodes.length && nodes[nodes.length - 1].t === 'br') nodes.pop();
  return nodes;
}

function resolverFor(photoKey) {
  return (attrs) => {
    const src = (/src\s*=\s*"([^"]*)"/i.exec(attrs) || /src\s*=\s*'([^']*)'/i.exec(attrs) || [])[1] || '';
    if (!src) return null;
    const m = /^data:image\/([a-zA-Z]+);base64,(.+)$/i.exec(src);
    if (m) return saveBase64(m[1], m[2]);
    if (/^https?:/i.test(src)) return null;               // 外链一律不带进小程序
    if (/\.gif$/i.test(src)) return null;                 // 学习通的占位 gif
    return mapPhoto(src, photoKey);                        // 手写作答照片
  };
}

const nodesText = (ns) => ns.filter((n) => n.t === 't').map((n) => n.v).join(' ').trim();

/** 纯文本 → nodes（当 html 为空、只有 text 时兜底） */
function textToNodes(t) {
  if (!t) return [];
  const out = [];
  String(t).split(/\n+/).forEach((line, i) => {
    const v = line.replace(/\s+/g, ' ').trim();
    if (!v) return;
    if (out.length) out.push({ t: 'br' });
    out.push({ t: 't', v });
  });
  return out;
}
/** 优先用 HTML 解析出的 nodes，空则退回纯文本 */
function pickNodes(nodes, text) {
  return nodes && nodes.length ? nodes : textToNodes(text);
}

/* ============================ 人工标注：知识点与错因 ============================ */
/* 依据：学习通教师批语原文 + 逐题得分。错因代码体系见 utils/cause.js */
const CONFIRMED = [
  {
    no: 1, kp: ['kb_def', 'kb_unbounded'], verdict: 'correct',
    flaws: [],
    gist: '用符号写出集合无上界、无下界的定义',
    note: '量词结构与不等关系都正确，是唯一满分题。'
  },
  {
    no: 2, kp: ['kb_sup', 'kb_inf'], verdict: 'partial',
    flaws: [{ code: 'C2', detail: '下确界证明不完整：只验证了「1 是下界且 1 属于 A」，缺少「任意小于 1 的数都不是下界」这一步——而下确界的定义要求同时验证「是下界」与「是最大的下界」。' }],
    gist: '讨论数集上下确界是否存在并证明',
    note: '上确界不存在的证明逻辑成立；下确界证明缺关键一步。'
  },
  {
    no: 3, kp: ['kb_sup', 'kb_dense'], verdict: 'wrong',
    flaws: [
      { code: 'C3', detail: '构造量 ε=[M−√2]+1 逻辑不严谨，未完成「任意有理数上界都不是最小上界」的核心论证，既没推出矛盾也没构造出更小的有理上界。' },
      { code: 'C4', detail: '未对 M²<2 与 M²>2 分类讨论，而这是证明 A={x∈Q | x²<2} 在 Q 内无上确界的标准路径。' }
    ],
    gist: '证明 A={x∈Q | x²<2} 在有理数集内无上确界',
    note: '只拿到识别出「A 有上界」的 6 分，主论证缺失。这是最需要补的一道。'
  },
  {
    no: 4, kp: ['kb_local_bound', 'kb_neighborhood'], verdict: 'partial',
    flaws: [{ code: 'C6', detail: '符号书写不规范（∈ 被写成 6）、邻域表述有笔误；无下界部分的点列构造没有明确写出「取余弦为 −1 的点」，推导不够清晰。' }],
    gist: '证明函数在去心邻域内无上界、无下界',
    note: '构造点列的思路正确，失分集中在书写规范与表述严谨度。'
  },
  {
    no: 5, kp: ['kb_sup', 'kb_inf'], verdict: 'partial',
    flaws: [{ code: 'C6', detail: '下确界证明中 n₀ 的取法书写有疏漏。' }],
    gist: '讨论数集上下确界并证明',
    note: '结论与主体验证都对，仅一处书写疏漏。'
  }
];

/* ============================ 主流程 ============================ */
const raw = JSON.parse(fs.readFileSync(path.join(SRC_DIR, '作业数据.json'), 'utf8'));
const hw1 = raw.assignments.find((w) => /HW1/.test(w.workTitle));
if (!hw1) throw new Error('作业数据里找不到 HW1');

const courseName = (/《(.+?)》/.exec(hw1.noticeTitle || '') || [, '高等数学分析（工科数学分析）'])[1];
const questions = [];

hw1.questions.forEach((q) => {
  const confirmed = CONFIRMED.find((c) => c.no === q.i);
  const photoKey = 'hw1-q' + q.i;

  const stemNodes = pickNodes(htmlToNodes(q.stemHtml, resolverFor(photoKey)), q.stemText);
  const myNodes = htmlToNodes(q.myAnswer && q.myAnswer.html, resolverFor(photoKey));

  // rightAnswer 常见为空（教师用图片/文本另附）
  const rightNodesRaw = htmlToNodes(q.rightAnswer && q.rightAnswer.html, resolverFor(photoKey));
  const rightText = (q.rightAnswer && q.rightAnswer.text) || nodesText(rightNodesRaw);
  const rightNodes = pickNodes(rightNodesRaw, rightText);

  const commentRaw = htmlToNodes((q.comment && q.comment.html) || '', resolverFor(photoKey));
  const commentText = (q.comment && q.comment.text) || nodesText(commentRaw);
  const commentNodes = pickNodes(commentRaw, commentText);

  // 每题满分：总分 100 / 5 题；与逐题得分 20+15+6+17+18=76 自洽
  const scored = parseInt(String(q.score || '').replace(/[^\d]/g, ''), 10);
  const full = 20;

  questions.push({
    no: q.i,
    type: q.type || '解答题',
    score: Number.isFinite(scored) ? scored : null,
    fullScore: full,
    gist: confirmed ? confirmed.gist : '',
    stem: stemNodes,
    stemText: nodesText(stemNodes) || String(q.stemText || '').replace(/\s+/g, ' ').trim(),
    myAnswer: { nodes: myNodes, text: nodesText(myNodes), photo: myNodes.some((n) => n.p === 1) },
    rightAnswer: { nodes: rightNodes, text: rightText },
    comment: { nodes: commentNodes, text: commentText },
    kp: confirmed ? confirmed.kp : [],
    flaws: confirmed ? confirmed.flaws : [],
    verdict: confirmed ? confirmed.verdict : 'unknown',
    analysisNote: confirmed ? confirmed.note : ''
  });
});

const totalScore = questions.reduce((s, q) => s + (q.score || 0), 0);

const seed = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: '学习通收件箱抓取（本人账号，只读）',
  courses: [
    { id: 'c_math', name: courseName, term: '2026秋' },
    { id: 'c_linalg', name: '线性代数', term: '2026秋' }
  ],
  assignments: [{
    id: 'as_hw1_0921',
    courseId: 'c_math',
    title: hw1.workTitle,
    noticeTitle: hw1.noticeTitle,
    fullScore: hw1.fullScore || 100,
    score: totalScore,
    sourceUrl: hw1.sourceUrl,
    capturedAt: '2026-09-23',
    questionCount: questions.length,
    questions
  }]
};

/* 写 seed.js */
const jsLines = [
  '/* eslint-disable */',
  '// ⚠️ 由 tools/build-seed.js 自动生成，请勿手改。',
  '// 数据来源：学习通收件箱（本人账号）2026-09-23 抓取。',
  '// 知识点与错因标注依据教师批语原文，逐题人工校对。',
  '',
  'module.exports = ' + JSON.stringify(seed, null, 2) + ';',
  ''
];
fs.writeFileSync(path.join(MP, 'data', 'seed.js'), jsLines.join('\n'), 'utf8');

/* 写图片压缩任务清单 */
fs.writeFileSync(path.join(ROOT, 'tools', 'jobs.json'),
  JSON.stringify(photoJobs, null, 2), 'utf8');

/* 报告 */
console.log('课程: ' + courseName);
console.log('作业: ' + hw1.workTitle + '  得分 ' + totalScore + '/' + seed.assignments[0].fullScore);
console.log('题目: ' + questions.length + ' 道');
questions.forEach((q) => {
  console.log('  Q' + q.no + ' [' + q.verdict + '] ' + (q.score !== null ? q.score : '?') + '/' + q.fullScore +
    '  题干节点=' + q.stem.length + ' 答案节点=' + q.myAnswer.nodes.length +
    ' 批语节点=' + q.comment.nodes.length + ' 错因=' + q.flaws.length + ' 照片=' + (q.myAnswer.photo ? 'Y' : 'N'));
});
console.log('');
console.log('符号图: ' + symCount + ' 张，合计 ' + (symList.reduce((s, x) => s + x.bytes, 0) / 1024).toFixed(1) + ' KB');
console.log('待压缩手写照片: ' + photoJobs.length + ' 张');
photoJobs.forEach((j) => console.log('  ' + path.basename(j.dst) + '  ←  ' + (fs.statSync(j.src).size / 1024).toFixed(0) + ' KB'));
const seedBytes = fs.statSync(path.join(MP, 'data', 'seed.js')).size;
console.log('');
console.log('seed.js: ' + (seedBytes / 1024).toFixed(1) + ' KB');
