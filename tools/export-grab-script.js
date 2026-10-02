'use strict';
/**
 * export-grab-script.js — 导出一份「能发到手机」的脚本文本
 * 运行：node tools/export-grab-script.js [输出路径]
 *
 * 为什么需要它：脚本有 5 万多字符，不可能手打到手机上，而装书签/快捷指令
 * 又必须在手机端完成 —— 先把脚本变成一份纯文本，发到微信「文件传输助手」，
 * 在手机上长按复制，再粘进书签或快捷指令，这条路才走得通。
 */
const fs = require('fs');
const path = require('path');
const gs = require(path.join(__dirname, '..', 'miniprogram', 'data', 'grab-script.js'));

const out = process.argv[2]
  || path.join(__dirname, '..', '..', '抓作业-手机脚本.txt');

/**
 * 自动注入版（安卓 Via 浏览器的「自定义 JS」/油猴用）：跟书签版是同一份代码，
 * 只把 __AUTO 翻成 true —— 它会对每个页面生效，所以要开页面门禁 + 等题目渲染完。
 */
const jsOut = process.argv[3] || out.replace(/\.txt$/i, '-自动版.js');
const src = decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, ''));
if (src.indexOf('var __AUTO = false;') < 0) {
  console.error('脚本里找不到 __AUTO 标记，自动注入版没法生成（BOOKMARKLET 版本不对？）');
  process.exit(1);
}
// 必须带油猴元数据块：Via 的「导入脚本」按 UserScript 格式解析，
// 没有 // ==UserScript== 头会直接报「解析脚本失败」。
const autoSrc = gs.USER_SCRIPT_META + src.replace('var __AUTO = false;', 'var __AUTO = true;');
fs.writeFileSync(jsOut, autoSrc, 'utf8');
console.log('已写出：' + jsOut + '（自动注入版，给 Via / 油猴用）');

const lines = [];
lines.push('错题订正 · 手机抓取脚本');
lines.push('（把这整段 javascript: 开头的文字粘进手机浏览器的书签或快捷指令里）');
lines.push('');
lines.push('——— 怎么用 ———');
gs.STEPS.forEach((s) => lines.push(s));
lines.push('');
gs.WAYS.forEach((w) => {
  lines.push('【' + w.name + '】' + w.tag);
  w.steps.forEach((s, i) => lines.push('  ' + (i + 1) + '. ' + s));
  lines.push('');
});
lines.push('——— 从学习通 App 里出发 ———');
lines.push(gs.FROM_APP.replace(/\*\*/g, ''));
lines.push('');
lines.push('——— 浏览器 ———');
lines.push(gs.BROWSERS);
lines.push('');
lines.push('——— 为什么微信里不行 ———');
lines.push(gs.WHY_NOT_WECHAT);
lines.push('');
lines.push('——— 注意 ———');
gs.NOTES.forEach((n) => lines.push('· ' + n));
lines.push('');
lines.push('——— 脚本本体（从下面这一整行开始，全部复制） ———');
lines.push('');
lines.push(gs.BOOKMARKLET);
lines.push('');

fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('已写出：' + out);
console.log('脚本长度：' + gs.BOOKMARKLET.length + ' 字符');
