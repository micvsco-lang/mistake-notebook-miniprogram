#!/usr/bin/env node
/**
 * 文档体检：找出会在 GitHub / Issue 里渲染失效的 Markdown 写法
 *
 * ---------------------------------------------------------------------------
 * 为什么需要这个
 * ---------------------------------------------------------------------------
 * 这些文档的用途是**被人复制粘贴到 GitHub Issue、PR、评论里**。
 * Markdown 在渲染失败时不会报错 —— 只是把 `**` `|` 原样显示出来，很难一眼看出原因。
 * 下面 7 类问题都是实际踩过的：
 *
 *   1. 粗体内嵌反引号   **算法与 `wx` 分离**    → 整段解析崩掉，** 原样显示
 *   2. 粗体未配对       只写一个 **              → 从此处往后全部失效
 *   3. 行内代码未闭合   `crop.js 没闭合          → 往后乱掉
 *   4. 代码块未闭合     ``` 少一个              → 后面全进代码块
 *   5. 标题层级过深     ###### 太深              → Issue 里排版很怪
 *   6. 列表缩进 ≥4 空格 - 换行后接内容          → 被当成代码块，缩进丢失
 *   7. 连续空行过多                                  → 视觉断裂
 *
 * 另外顺带检查「Markdown 表格」—— 复制粘贴时竖线对齐会散架，本项目一律不用表格。
 *
 * 用法：node tools/check-docs.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 要检查的文档（用户会复制粘贴出去的） */
const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'ROADMAP-本地识图.md',
  'ISSUE-1-招募本地识图.md'
];

/**
 * 表格的严重度分档 —— **不是所有文档都怕表格**。
 *
 * README / CONTRIBUTING 是**在 GitHub 网页上直接看的**，表格渲染得很好，
 * 没必要为了「可能被人复制」而改成列表（改了大量内容，README 可读性会下降）。
 *
 * 但 ISSUE-1 / ROADMAP 是**要被复制到 Issue 正文里**的，
 * 表格在纯文本粘贴时必然散架 → 所以这两份文档里**禁止出现表格**。
 */
const TABLE_POLICY = {
  'README.md': 'warn',            // 网页阅读为主，表格没问题
  'CONTRIBUTING.md': 'warn',      // 同上
  'ROADMAP-本地识图.md': 'error', // 要被复制粘贴 → 禁止表格
  'ISSUE-1-招募本地识图.md': 'error'
};

/**
 * 把一行按「代码块围栏」切成代码段与普通段。
 * 代码块内的内容不被 Markdown 解析，里面的写法不算问题。
 */
function splitByFence(lines) {
  const out = [];
  let inFence = false;
  lines.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      out.push({ line: idx + 1, text: line, fence: true });
      return;
    }
    out.push({ line: idx + 1, text: line, fence: false, inFence });
  });
  return out;
}

/** 数一个字符串里 tick 的个数（tick = `） */
function countTick(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '`') n++;
  return n;
}

/** 找出所有 **...** 片段 */
function findBoldPairs(s) {
  const out = [];
  const re = /\*\*([^*]+)\*\*/g;
  let m;
  /* eslint-disable no-cond-assign */
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

function checkDoc(name) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) {
    return { name: name, missing: true, issues: [] };
  }
  const text = fs.readFileSync(file, 'utf-8');
  const lines = text.split(/\r?\n/);
  const parts = splitByFence(lines);
  const issues = [];

  parts.forEach((p) => {
    // 围栏本身只检查奇偶（放最后统一查）
    if (p.fence) return;
    // 代码块内不管
    if (p.inFence) return;

    const line = p.text;
    const at = '行 ' + p.line;

    // 1. 粗体内嵌反引号
    findBoldPairs(line).forEach((inner) => {
      if (inner.indexOf('`') >= 0) {
        issues.push({ at: at, kind: '粗体内嵌反引号（会让整段渲染失效）', level: 'error', text: line.trim() });
      }
    });

    // 2. 粗体未配对
    if ((line.match(/\*\*/g) || []).length % 2 === 1) {
      issues.push({ at: at, kind: '粗体未配对（只写了一个 **）', level: 'error', text: line.trim() });
    }

    // 3. 行内代码未闭合
    if (countTick(line) % 2 === 1) {
      issues.push({ at: at, kind: '行内代码未闭合（反引号落单）', level: 'error', text: line.trim() });
    }

    // 5. 标题层级过深
    const h = line.match(/^(#{1,6})\s/);
    if (h && h[1].length > 4) {
      issues.push({ at: at, kind: '标题层级过深（Issue 里排版很怪）', level: 'error', text: line.trim() });
    }

    // 6. 列表项缩进 >= 4 空格
    const li = line.match(/^(\s*)-\s/);
    if (li && li[1].length >= 4) {
      issues.push({ at: at, kind: '列表缩进 >=4 空格（会被当成代码块）', level: 'error', text: line.trim() });
    }

    // 8. Markdown 表格（复制粘贴会散架）
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const policy = TABLE_POLICY[name] || 'warn';
      issues.push({
        at: at,
        kind: policy === 'error'
          ? '表格（本文档会被复制粘贴，禁止用表格）'
          : '表格（本文档主要在网页阅读，粘到 Issue 时需改列表）',
        level: policy,
        text: line.trim()
      });
    }
  });

  // 4. 代码块围栏闭合
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    issues.push({ at: '全文', kind: '代码块未闭合（``` 数量为奇数）', level: 'error', text: '' });
  }

  // 7. 连续空行过多
  const parts2 = text.split(/\r?\n/);
  for (let i = 0; i + 2 < parts2.length; i++) {
    if (parts2[i] === '' && parts2[i + 1] === '' && parts2[i + 2] === '') {
      issues.push({ at: '行 ' + (i + 1), kind: '连续空行过多（>=3）', level: 'warn', text: '' });
      break;
    }
  }

  return { name: name, missing: false, issues: issues };
}

const results = DOCS.map(checkDoc);

/** 严重问题：会让 Markdown 渲染失效，必须修 */
const errors = results.reduce((n, r) => n + r.issues.filter((i) => i.level !== 'warn').length, 0);
/** 提醒：按文档用途决定要不要改 */
const warns = results.reduce((n, r) => n + r.issues.filter((i) => i.level === 'warn').length, 0);

/* 被别的脚本（check.js）require 时，只导出结果、不打印、不退出 */
if (require.main !== module) {
  module.exports = { errors: errors, warns: warns, results: results };
} else {
  report();
  process.exit(errors ? 1 : 0);
}

function report() {
  console.log('');
  console.log('==============================================');
  console.log('  文档体检（能否安全复制到 GitHub）');
  console.log('==============================================');

  results.forEach((r) => {
    if (r.missing) {
      console.log('  ?   ' + r.name + ' —— 文件不存在，跳过');
      return;
    }
    const errs = r.issues.filter((i) => i.level !== 'warn');
    const wns = r.issues.filter((i) => i.level === 'warn');

    if (!errs.length && !wns.length) {
      console.log('  OK  ' + r.name);
      return;
    }
    if (!errs.length) {
      console.log('  --  ' + r.name + '（无渲染错误，' + wns.length + ' 处提醒）');
      wns.forEach((i) => {
        console.log('       [' + i.kind + '] ' + i.at);
      });
      return;
    }
    console.log('  X   ' + r.name);
    errs.forEach((i) => {
      console.log('       [' + i.kind + '] ' + i.at);
      if (i.text) console.log('         ' + i.text);
    });
    if (wns.length) {
      console.log('       另有 ' + wns.length + ' 处提醒（表格等，见上方分类说明）');
    }
  });

  console.log('');
  console.log('渲染错误 ' + errors + ' 处（必须修） · 提醒 ' + warns + ' 处（按用途决定）');
  console.log('');
  console.log('说明：README / CONTRIBUTING 主要在 GitHub 网页上阅读，表格没问题；');
  console.log('     ROADMAP 与 ISSUE-1 会被复制粘贴到 Issue，这两份里不能有表格。');
  console.log('');
}
