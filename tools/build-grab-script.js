'use strict';
/**
 * build-grab-script.js — 生成手机端抓取脚本（书签脚本）
 * 运行：node tools/build-grab-script.js
 *
 * ---------------------------------------------------------------------------
 * 做了什么
 * ---------------------------------------------------------------------------
 * 把「学习通作业页 → 结构化题目」的采集逻辑打成一个可以在手机浏览器里
 * 一键执行的脚本，产物写回 miniprogram/data/grab-script.js 的
 * BOOKMARKLET 字段（标记区间内，可反复重建）。
 *
 * 拼装三层：
 *   ① 采集端解析器（页面里 DOM 解析，暴露 window.__CXC__）
 *   ② capToAssignment（复用 grab-script.js 里的那份，单一真源）
 *   ③ 运行壳：执行 → 复制到剪贴板 → 页面上显示结果
 *
 * ---------------------------------------------------------------------------
 * 两个实现细节，别改错
 * ---------------------------------------------------------------------------
 * 1. **为什么整体 URL 编码**：脚本要粘进浏览器书签，换行在多行文本里可能被
 *    吃掉，而一旦换行没了，代码里的 `//` 行注释会把后面整段吞掉。
 *    encodeURIComponent 之后换行变成 %0A，点击书签时才解码 —— 注释安全、
 *    不用写压缩器、也不用担心字符串里的 http:// 被误判成注释。
 * 2. **注入前先 delete window.__CXC__**：采集端开头有
 *    `if (window.__CXC__) return;` 的幂等守卫，同一个标签页重复执行时
 *    不先清掉就会拿到旧代码（改了解析器却不生效，排查起来很费时间）。
 *
 * ---------------------------------------------------------------------------
 * 采集端从哪来
 * ---------------------------------------------------------------------------
 * 采集端（浏览器插件/解析器）是作者本地的私有工程，不在本仓库。
 * 用环境变量指定路径；没指定就按默认位置找，找不到会给出明确提示而不是静默失败。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'miniprogram', 'data', 'grab-script.js');

const PARSER = process.env.CHAOXING_PARSER
  || path.join(ROOT, '..', '学习通作业助手', 'extension', 'parser.js');

if (!fs.existsSync(PARSER)) {
  console.error('找不到采集端解析器：' + PARSER);
  console.error('用环境变量指定：  CHAOXING_PARSER=<path/to/parser.js> node tools/build-grab-script.js');
  process.exit(1);
}

const parserRaw = fs.readFileSync(PARSER, 'utf8');
if (parserRaw.indexOf('window.__CXC__') < 0) {
  console.error('这个文件看起来不是采集端解析器（没有 window.__CXC__）：' + PARSER);
  process.exit(1);
}

/**
 * 去掉注释，只为缩短书签长度（中文注释经 URL 编码后每个字要 9 个字符）。
 *
 * ⚠️ **只在行首判定，绝不改写代码行**：早期版本会在行内找 `//` 并砍掉后半行，
 * 结果把 `"https://..."` 这类字符串里的斜杠当成注释，代码被拦腰截断，
 * 而且语法自检还碰巧通过（砍完仍是一段合法但残缺的代码），排查花了不少时间。
 * 现在只处理两种：整行注释（去缩进后以 // 开头）、块注释（以 /* 开头，可跨行）。
 * 行尾注释和字符串一律不动 —— 换行本来就会被保留，不需要靠删注释来保命。
 *
 * 保守起见：删完仍要过语法自检（见下），删坏了就退回原文。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let state = 'code';                 // code | line | block | str
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'str') {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }   // 转义字符整体保留
      if (c === quote) state = 'code';
      i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i += 1; continue;
    }
    // block：保留换行，行号不漂移，报错时还能对上源码
    if (c === '*' && d === '/') { state = 'code'; i += 2; continue; }
    if (c === '\n') out += c;
    i += 1;
  }
  return out;
}

// 语法自检：能 parse 才用压缩版，否则老实用原文（坏代码比长代码糟糕得多）
let parserSrc = parserRaw;
try {
  const stripped = stripComments(parserRaw);
  /* eslint-disable no-new-func */
  new Function(stripped);
  parserSrc = stripped;
} catch (e) {
  console.warn('（去注释后语法自检未通过，改用未压缩版本）');
}

// 复用 data/grab-script.js 里已写好的转换逻辑 —— 不在这里抄第二份
const gs = require(OUT);

/* ---------------- 运行壳 ---------------- */
const RUNNER = `
// __AUTO=false：书签脚本（用户主动点，任何页面都给反馈）
// __AUTO=true ：浏览器「自定义 JS / 用户脚本」自动注入版（安卓 Via、油猴），
//               会对**每个页面**生效，所以必须做页面门禁，否则开个百度也弹窗。
// 这个标记由 build/export 阶段替换，别在源码里改。
var __AUTO = false;

var __host = location.hostname || '';
var __isCx = __host.indexOf('chaoxing.com') >= 0;
var __isWork = /(\\/work\\/|dowork|intoexamorwork)/i.test(location.pathname + location.search);
// 登录页一定要放行：从 App 复制链接到浏览器第一次打开多半停在登录页，
// 这时如果因为「不是作业页」而静默，用户只会以为脚本坏了。
var __isLoginPage = /passport|\\/login|login\\.html/i.test(location.href)
  || !!document.querySelector('#pwd, #phone, input[name="pwd"], #loginForm, .login-box, .passport');
if (__isCx && !__isWork && !__isLoginPage) return;   // 学习通但不是作业页、也不是登录页：静默
if (!__isCx && __AUTO) return;                       // 自动注入且不在学习通：静默

var __cap = null;
var __err = '';

function __run() {
// 出错也要让用户看见原因 —— 静默失败在真机上根本没法排查
try { __cap = window.__CXC__ ? window.__CXC__.extractSync() : null; }
catch (e) { __err = (e && e.message) ? e.message : String(e); }
// 作业名：采集端常常取不到（作业页标题栏结构多变），在页面上再捞一次，最后才用兜底
var __TITLE_SEL = ['.mark_title', '.zt_title', '#workTitle', '.workTitle', '.mark_title_wrap', 'h1'];
var __t = '';
for (var __i = 0; __i < __TITLE_SEL.length; __i++) {
  var __e = document.querySelector(__TITLE_SEL[__i]);
  if (__e && (__e.textContent || '').trim()) { __t = (__e.textContent || '').trim().slice(0, 60); break; }
}
if (!__t) __t = (document.title || '').replace(/[《》]/g, '').trim().slice(0, 60);
var __data = __err ? null : capToAssignment(__cap, { now: Date.now(), title: __t || '学习通作业' });

function __el(tag, style, text) {
  var n = document.createElement(tag);
  if (style) n.setAttribute('style', style);
  if (text != null) n.textContent = text;
  return n;
}

var __box = __el('div', 'position:fixed;z-index:2147483647;left:0;right:0;top:0;background:#fff;color:#16181d;padding:14px;box-shadow:0 4px 16px rgba(0,0,0,.18);font:14px/1.6 -apple-system,system-ui,sans-serif;max-height:70%;overflow:auto');

if (__err) {
  __box.appendChild(__el('div', 'font-weight:600;margin-bottom:6px', '脚本执行出错了'));
  __box.appendChild(__el('div', 'color:#666', __err));
} else if (!__data) {
  // 从学习通 App 复制链接到浏览器打开时，最常见的失败就是「浏览器里没登录」——
  // App 的登录态不会自动带过来，页面会停在登录页。这种情况值得单独给一句人话。
  __box.appendChild(__el('div', 'font-weight:600;margin-bottom:6px',
    __isLoginPage ? '这是学习通的登录页' : '这一页没搬到题目'));
  __box.appendChild(__el('div', 'color:#666', __isLoginPage
    ? '学习通 App 的登录态带不到浏览器里 —— 请先在这个浏览器登录一次学习通（登录后通常能保持很久），再打开作业页重新执行脚本。'
    : '确认三点：① 当前是「作业详情页」（不是作业列表）；② 页面已完全加载完；③ 用的是登录后的浏览器。'));
} else {
  var __json = JSON.stringify(__data);
  var __imgs = 0, __photos = 0;
  var __wrong = __data.questions.filter(function (q) {
    return q.verdict === 'wrong' || q.verdict === 'partial'
      || (typeof q.score === 'number' && q.score < q.fullScore);
  }).length;
  // 顺带报一下搬了多少张图 —— 「图片有没有丢」是这条链路最容易出问题的地方，
  // 让用户在页面上就能一眼确认，不用等导进小程序才发现公式变空白。
  (__data.questions || []).forEach(function (q) {
    (q.stem || []).forEach(function (n) { if (n.t === 'i') __imgs++; });
    ((q.myAnswer && q.myAnswer.nodes) || []).forEach(function (n) { if (n.t === 'i') __photos++; });
    ((q.comment && q.comment.nodes) || []).forEach(function (n) { if (n.t === 'i') __imgs++; });
    ((q.rightAnswer && q.rightAnswer.nodes) || []).forEach(function (n) { if (n.t === 'i') __imgs++; });
  });

  __box.appendChild(__el('div', 'font-weight:600;margin-bottom:6px',
    '搬到 ' + __data.questions.length + ' 道题（含 ' + __imgs + ' 张公式图、' + __photos + ' 张手写照片），' + __wrong + ' 道非满分'));
  var __tip = __el('div', 'color:#666', '已原样搬运，未做任何识别与分析。下面内容已自动复制，去小程序「粘贴导入」里粘贴即可。若没复制成功，手动全选复制。');
  __box.appendChild(__tip);

  var __ta = document.createElement('textarea');
  __ta.value = __json;
  // 加 id 是为了能在自动化测试里稳稳取到它（页面本身常有别的 textarea）
  __ta.id = '__cxg_json';
  __ta.setAttribute('style', 'width:100%;height:130px;margin-top:8px;font:12px/1.4 monospace');
  __box.appendChild(__ta);

  // iOS 快捷指令环境：它注入了 completion()，把结果直接交回快捷指令，
  // 快捷指令再自动存进剪贴板 —— 用户在分享菜单点一下就跑完，不用建书签。
  var __isShortcut = typeof completion === 'function';
  if (__isShortcut) {
    try { completion(__json); } catch (e) {}
  }

  var __copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(__json).then(function () {
        __tip.textContent = __isShortcut
          ? '结果已交给快捷指令（' + __data.questions.length + ' 道题），切回小程序「粘贴导入」粘贴。'
          : 'JSON 已复制到剪贴板（' + __data.questions.length + ' 道题），去小程序「粘贴导入」粘贴吧。';
      }, function () { __ta.select(); });
    } else { __ta.select(); __copied = !!document.execCommand('copy'); }
  } catch (e) { try { __ta.select(); } catch (e2) {} }
}
  var __close = document.createElement('button');
  __close.textContent = '关闭';
  __close.setAttribute('style', 'margin-top:10px;padding:6px 16px;font-size:14px');
  __close.onclick = function () { __box.parentNode && __box.parentNode.removeChild(__box); };
  __box.appendChild(__close);

  (document.body || document.documentElement).appendChild(__box);
}

// —— 触发时机 ——
// 自动注入（Via 的自定义 JS / 油猴）通常跑在页面渲染早期，直接抓会抓到空页面。
// 所以等题目元素出现再抓，最多等 8 秒；书签模式是用户主动点的，页面早已就绪，直接跑。
function __hasQ() {
  return document.querySelectorAll('.questionLi, .TiMu, .TiMu_new, [class*="questionLi"], [class*="TiMu"]').length > 0;
}

if (!__AUTO || __hasQ()) {
  __run();
} else {
  var __t0 = Date.now();
  var __timer = setInterval(function () {
    if (__hasQ() || Date.now() - __t0 > 8000) { clearInterval(__timer); __run(); }
  }, 300);
}
`;

/* ---------------- 拼装 ---------------- */
const code = [
  '(function () {',
  'try { delete window.__CXC__; } catch (e) {}',
  parserSrc,
  'var TYPES = ' + JSON.stringify(gs.TYPES) + ';',
  'var VERDICT_MAP = ' + JSON.stringify(gs.VERDICT_MAP) + ';',
  'var textNodes = ' + gs.textNodes.toString() + ';',
  'var pickNodes = ' + gs.pickNodes.toString() + ';',
  'var hasImgNodes = ' + gs.hasImgNodes.toString() + ';',
  'var hasTextNodes = ' + gs.hasTextNodes.toString() + ';',
  gs.capToAssignment.toString(),
  RUNNER,
  '})();'
].join('\n');

// 出门前再自检一次：整段代码必须能被解析（编码不影响语法，但拼装可能出错）
try {
  /* eslint-disable no-new-func */
  new Function(code);
} catch (e) {
  console.error('生成的脚本语法有问题，已中止写入：' + e.message);
  process.exit(1);
}

const bookmarklet = 'javascript:' + encodeURIComponent(code);

/* ---------------- 写回标记区间 ---------------- */
const out = fs.readFileSync(OUT, 'utf8');
const START = '/* ==BOOKMARKLET-START== */';
const END = '/* ==BOOKMARKLET-END== */';
const si = out.indexOf(START);
const ei = out.indexOf(END);
if (si < 0 || ei < 0) {
  console.error('grab-script.js 里找不到标记区间（' + START + ' / ' + END + '）');
  process.exit(1);
}

const block = START + '\n/* 由 tools/build-grab-script.js 生成，勿手改 */\n'
  + 'var BOOKMARKLET = ' + JSON.stringify(bookmarklet) + ';\n';
const next = out.slice(0, si) + block + out.slice(ei);
fs.writeFileSync(OUT, next, 'utf8');

console.log('采集端：' + PARSER);
console.log('脚本长度：' + code.length + ' 字符（编码后 ' + bookmarklet.length + '）');
console.log('已写入：' + path.relative(ROOT, OUT));
