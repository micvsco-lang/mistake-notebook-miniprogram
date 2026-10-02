'use strict';
/**
 * diag-capture.js — 看一眼采集器到底抓到了什么（开发期诊断工具，不是测试）
 * 运行：CHAOXING_FIXTURES=<目录> node tools/diag-capture.js [文件名]
 *
 * 为什么要有它：抓取链路的失败模式大多是「静默丢东西」—— 图片没了、公式变成空白、
 * 批语漏了，界面上看不出异常。把它打出来肉眼对一遍，比猜快得多。
 */
const path = require('path');
const fs = require('fs');
const gs = require(path.join(__dirname, '..', 'miniprogram', 'data', 'grab-script.js'));
const { JSDOM } = require('jsdom');

const fxDir = process.env.CHAOXING_FIXTURES;
if (!fxDir) { console.error('要设 CHAOXING_FIXTURES=<放作业 HTML 的目录>'); process.exit(1); }
const only = process.argv[2];
const htmls = fs.readdirSync(fxDir).filter((f) => /\.html?$/i.test(f) && (!only || f.indexOf(only) >= 0));

const code = decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, ''));

/** 把 nodes 渲染成一行紧凑的可读串，方便肉眼扫 */
function showNodes(nodes) {
  if (!nodes || !nodes.length) return '（空）';
  return nodes.map((n) => {
    if (n.t === 't') return '「' + String(n.v).replace(/\s+/g, '␣').slice(0, 50) + '」';
    if (n.t === 'i') return '🖼' + (n.w ? n.w + 'x' + n.h : '?') + (n.f ? '公式' : '');
    return '⏎';
  }).join(' ');
}

htmls.forEach((f) => {
  const dom = new JSDOM(fs.readFileSync(path.join(fxDir, f), 'utf8'), {
    url: 'https://mooc1-api.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=1&classId=1&workId=1',
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  let data = null;
  try {
    dom.window.eval(code);
    const ta = dom.window.document.getElementById('__cxg_json');
    if (ta && ta.value) data = JSON.parse(ta.value);
  } catch (e) { console.error(f + ' 出错：' + e.message); }
  dom.window.close();
  if (!data) { console.log('\n###### ' + f + ' —— 没抓到\n'); return; }

  console.log('\n###### ' + f + ' —— ' + data.title + '（' + data.questions.length + ' 题，' + data.score + '/' + data.fullScore + '）');
  data.questions.forEach((q) => {
    console.log('\n  第 ' + q.no + ' 题 · ' + q.type + ' · ' + q.score + '/' + q.fullScore + ' · ' + q.verdict);
    console.log('    题干: ' + showNodes(q.stem));
    console.log('    作答: ' + showNodes(q.myAnswer && q.myAnswer.nodes) + '  photo=' + !!(q.myAnswer && q.myAnswer.photo));
    console.log('    答案: ' + showNodes(q.rightAnswer && q.rightAnswer.nodes));
    console.log('    批语: ' + showNodes(q.comment && q.comment.nodes));
    const imgs = [];
    (function collect(ns) { (ns || []).forEach((n) => { if (n.t === 'i') imgs.push(n.s.split('/').pop().slice(0, 24)); }); })(q.stem);
    (function collect(ns) { (ns || []).forEach((n) => { if (n.t === 'i') imgs.push(n.s.split('/').pop().slice(0, 24)); }); })(q.myAnswer && q.myAnswer.nodes);
    console.log('    图片: ' + (imgs.length ? imgs.join(' , ') : '（无）'));
  });
});
