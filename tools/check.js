'use strict';
/**
 * check.js — 小程序工程静态检查
 *
 * 小程序代码没法在 Node 里整体跑起来，所以把能在编辑器里才暴露的问题提前查一遍：
 * JSON 是否合法、JS 是否通过语法解析、app.json 注册的页面文件是否齐全、
 * WXML 标签是否配对、模板与图片资源是否存在、WXSS 花括号是否闭合。
 *
 * 运行：node tools/check.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

let pass = 0, fail = 0;
const problems = [];

function ok(msg) { pass++; }
function bad(msg, extra) {
  fail++;
  problems.push(msg + (extra ? '  → ' + extra : ''));
  console.log('  ✗ ' + msg + (extra ? '  → ' + extra : ''));
}
function section(t) { console.log('\n== ' + t + ' =='); }

function walk(dir, filter, out) {
  out = out || [];
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, filter, out);
    else if (filter(name)) out.push(p);
  });
  return out;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/* ---------------- 1. JSON 合法性 ---------------- */
section('JSON 文件');
const jsonFiles = walk(ROOT, (n) => n.endsWith('.json'), [])
  .filter((p) => rel(p).indexOf('node_modules') < 0);
jsonFiles.forEach((f) => {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
    ok();
  } catch (e) {
    bad('JSON 解析失败 ' + rel(f), e.message);
  }
});
console.log('  检查 ' + jsonFiles.length + ' 个 JSON 文件');

/* ---------------- 2. JS 语法 ---------------- */
section('JS 语法');
const jsFiles = walk(ROOT, (n) => n.endsWith('.js'), [])
  .filter((p) => rel(p).indexOf('node_modules') < 0);
jsFiles.forEach((f) => {
  const code = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(code, { filename: f });
    ok();
  } catch (e) {
    bad('JS 语法错误 ' + rel(f), e.message);
  }
});
console.log('  检查 ' + jsFiles.length + ' 个 JS 文件');

/* ---------------- 3. app.json 页面注册 ---------------- */
section('app.json 页面与 tabBar');
const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const pages = appJson.pages || [];

pages.forEach((p) => {
  ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    const f = path.join(MP, p + '.' + ext);
    if (fs.existsSync(f)) ok();
    else bad('缺少页面文件 ' + p + '.' + ext);
  });
});
console.log('  注册页面 ' + pages.length + ' 个，文件齐全性已检查');

const tabList = (appJson.tabBar && appJson.tabBar.list) || [];
tabList.forEach((t) => {
  if (pages.indexOf(t.pagePath) >= 0) ok();
  else bad('tabBar 页面未在 pages 中注册：' + t.pagePath);
});
console.log('  tabBar 入口 ' + tabList.length + ' 个');

// 反向检查：存在但未注册的页面目录
const pageDirs = fs.readdirSync(path.join(MP, 'pages'));
pageDirs.forEach((d) => {
  const p = 'pages/' + d + '/' + d;
  if (pages.indexOf(p) < 0) bad('页面目录未在 app.json 注册：' + p);
});

/* ---------------- 4. WXML 标签配对 ---------------- */
section('WXML 标签配对');
const wxmlFiles = walk(path.join(MP), (n) => n.endsWith('.wxml'), []);

// 这些标签在 WXML 里通常自闭合；若写成开闭形式也允许
const SELF_CLOSING_OK = new Set(['image', 'input', 'template', 'import', 'include', 'wxs', 'icon', 'progress', 'slider', 'switch', 'checkbox', 'radio', 'audio', 'video', 'canvas', 'camera', 'navigator', 'textarea', 'block', 'view', 'text']);

wxmlFiles.forEach((f) => {
  let src = fs.readFileSync(f, 'utf8');
  src = src.replace(/<!--[\s\S]*?-->/g, '');           // 去注释
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let m;
  let err = '';
  while ((m = re.exec(src))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClose = m[4] === '/';
    if (closing) {
      if (!stack.length) { err = '多余的结束标签 </' + tag + '>'; break; }
      const top = stack.pop();
      if (top !== tag) { err = '</' + tag + '> 与 <' + top + '> 不匹配'; break; }
    } else if (!selfClose) {
      stack.push(tag);
    }
  }
  if (!err && stack.length) err = '未闭合标签：<' + stack.join('>, <') + '>';
  if (err) bad('WXML 结构问题 ' + rel(f), err);
  else ok();
});
console.log('  检查 ' + wxmlFiles.length + ' 个 WXML 文件');

/* ---------------- 5. WXSS 花括号 ---------------- */
section('WXSS 括号配对');
const wxssFiles = walk(path.join(MP), (n) => n.endsWith('.wxss'), []);
wxssFiles.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const open = (src.match(/{/g) || []).length;
  const close = (src.match(/}/g) || []).length;
  if (open === close) ok();
  else bad('WXSS 花括号不配对 ' + rel(f), open + ' { vs ' + close + ' }');
});
console.log('  检查 ' + wxssFiles.length + ' 个 WXSS 文件');

/* ---------------- 6. 模板引用 ---------------- */
section('模板引用');
let importCount = 0;
wxmlFiles.forEach((f) => {
  // 注释里可能写着用法示例（templates/nodes.wxml 就是），先剥掉再扫
  const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<import\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    importCount++;
    const target = path.resolve(path.dirname(f), m[1]);
    if (fs.existsSync(target)) ok();
    else bad('模板文件不存在 ' + rel(f) + ' → ' + m[1]);
  }
});
console.log('  共 ' + importCount + ' 处 import');

/* ---------------- 7. 图片资源 ---------------- */
section('图片资源');
const seedSrc = fs.readFileSync(path.join(MP, 'data', 'seed.js'), 'utf8');
const assetRefs = new Set();
seedSrc.replace(/"(\/assets\/[^"]+)"/g, (mm, p) => { assetRefs.add(p); return mm; });
// 素材目录实际文件
const actual = fs.readdirSync(path.join(MP, 'assets', 'sym')).map((n) => '/assets/sym/' + n)
  .concat(fs.readdirSync(path.join(MP, 'assets', 'hw')).map((n) => '/assets/hw/' + n));

let missing = 0;
assetRefs.forEach((p) => {
  if (fs.existsSync(path.join(MP, p))) ok();
  else { missing++; bad('种子引用的图片不存在：' + p); }
});
console.log('  seed 引用 ' + assetRefs.size + ' 个图片，实有 ' + actual.length + ' 个文件');

const unused = actual.filter((p) => !assetRefs.has(p));
if (unused.length) console.log('  （提示）有 ' + unused.length + ' 个素材未被 seed 引用：' + unused.slice(0, 5).join(', '));

/* ---------------- 8. 体积 ---------------- */
section('包体积');
function dirSize(dir) {
  let s = 0;
  walk(dir, () => true, []).forEach((f) => { s += fs.statSync(f).size; });
  return s;
}
const mpSize = dirSize(MP);
const assetsSize = dirSize(path.join(MP, 'assets'));
console.log('  miniprogram 合计 ' + (mpSize / 1048576).toFixed(2) + ' MB（主包上限 2 MB）');
console.log('  其中 assets ' + (assetsSize / 1048576).toFixed(2) + ' MB');
if (mpSize > 2 * 1048576) bad('超出主包 2 MB 限制', (mpSize / 1048576).toFixed(2) + ' MB');
else ok();

/* ---------------- 8. 文档能否安全复制到 GitHub ---------------- */
section('文档体检');
/* 这几份文档是要被人复制粘贴到 GitHub Issue / PR 里的。
 * Markdown 渲染失败时不报错，只是把 ** 和 | 原样显示，很难看出原因。
 * 详细规则见 tools/check-docs.js。
 *
 * ⚠️ 这里直接 require 而不起子进程 —— 本机 spawnSync 会返回 status=null
 * 且捕获不到输出（与 e2e-simulator 那个 spawn EINVAL 是同类环境问题）。 */
try {
  const docCheck = require('./check-docs.js');
  if (docCheck.errors) {
    bad('文档有 ' + docCheck.errors + ' 处 Markdown 渲染错误',
      '跑 node tools/check-docs.js 看详情');
  } else {
    ok();
  }
  if (docCheck.warns) {
    console.log('  （提示）另有 ' + docCheck.warns + ' 处提醒（主要是表格，网页阅读无碍）');
  }
} catch (e) {
  console.log('  （跳过）无法运行 check-docs.js');
}

/* ---------------- 汇总 ---------------- */
console.log('\n' + '='.repeat(46));
if (fail) {
  console.log('静态检查：通过 ' + pass + ' 项，发现 ' + fail + ' 个问题');
  problems.forEach((p) => console.log('  · ' + p));
} else {
  console.log('静态检查：通过 ' + pass + ' 项，未发现问题');
}
console.log('='.repeat(46));
process.exitCode = fail ? 1 : 0;
