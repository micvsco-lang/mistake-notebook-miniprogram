'use strict';
/**
 * test-grab-script.js — 手机抓取脚本的测试
 * 运行：node tools/test-grab-script.js
 *
 * 分两段：
 *   A. 纯函数（必须跑）：capToAssignment 的格式转换，不需要浏览器
 *   B. 端到端（有 fixtures 才跑）：用 jsdom 加载真实的学习通作业页，
 *      真的执行一遍 BOOKMARKLET，看能不能抓出题目
 *
 * ---------------------------------------------------------------------------
 * 为什么 B 段要用真实页面，而不是造一个假 DOM
 * ---------------------------------------------------------------------------
 * 采集端解析器是靠一堆选择器 + 兜底启发式工作的（.questionLi / .TiMu / 文本标签…），
 * 造假的 DOM 只会证明「我的假 DOM 能被解析」，证明不了真页面能抓到。
 * 唯一有说服力的验证是：拿一份真实的作业页面 HTML 跑一遍。
 *
 * fixtures 是作者自己的作业，不进仓库（里面有真实姓名学号）。
 * 用环境变量指定目录，没指定就跳过 B 段：
 *   CHAOXING_FIXTURES=<放作业 HTML 的目录> node tools/test-grab-script.js
 */
const path = require('path');
const fs = require('fs');

const gs = require(path.join(__dirname, '..', 'miniprogram', 'data', 'grab-script.js'));

let pass = 0, fail = 0, skip = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ==================== A. 格式转换 ==================== */
section('手机抓取 · 格式转换（纯函数）');

ok('BOOKMARKLET 已生成且是 javascript: 开头',
  typeof gs.BOOKMARKLET === 'string' && gs.BOOKMARKLET.indexOf('javascript:') === 0
  && gs.BOOKMARKLET.length > 1000, gs.BOOKMARKLET && gs.BOOKMARKLET.length);

ok('脚本能被解析（语法自检）', (function () {
  try {
    /* eslint-disable no-new-func */
    new Function(decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, '')));
    return true;
  } catch (e) { return false; }
})());

ok('空输入返回 null', gs.capToAssignment(null) === null && gs.capToAssignment({}) === null);

const cap1 = {
  title: 'HW3 0926',
  questions: [
    { no: 1, type: '证明题', stem: '用 ε-N 定义证明 lim 1/n = 0。', myAnswer: '任取 ε>0…',
      correctAnswer: '取 N=[1/ε]+1', teacherComment: '缺少对 N 为整数的说明。',
      score: { got: 14, total: 20 }, verdict: 'partial' },
    { no: 2, type: '选择题', stem: '下列哪个收敛？', myAnswer: 'B',
      correctAnswer: 'C', teacherComment: '选错了。', score: { got: 0, total: 10 }, verdict: 'wrong' },
    { no: 3, type: '证明题', stem: '', myAnswer: '', correctAnswer: '', teacherComment: '',
      score: { got: null, total: null }, verdict: 'unmarked' }
  ]
};
const a1 = gs.capToAssignment(cap1, { now: 1000 });
ok('作业名与课程来自采集结果', a1 && a1.title === 'HW3 0926' && a1.courseId === 'c_math', a1 && a1.title);
ok('三样全空的题被丢弃', a1.questions.length === 2, a1.questions.length);
ok('题号/题型/得分透传', a1.questions[0].no === 1 && a1.questions[0].type === '证明题'
  && a1.questions[0].score === 14 && a1.questions[0].fullScore === 20);
ok('满分缺失时兜底 20', gs.capToAssignment({ questions: [{ stem: 'x', score: {} }] })
  .questions[0].fullScore === 20);
ok('判词归一：partial/wrong 保留、unmarked→unknown',
  a1.questions[0].verdict === 'partial' && a1.questions[1].verdict === 'wrong');
ok('总分与得分是求和', a1.score === 14 && a1.fullScore === 30, [a1.score, a1.fullScore]);
ok('知识点留空（导入后自行标注）', a1.questions[0].kp.length === 0);
ok('gist 取题干前 14 字', a1.questions[0].gist.length <= 14, a1.questions[0].gist);
ok('富文本节点与纯文本同时给出',
  a1.questions[0].stem[0].t === 't' && a1.questions[0].stemText.indexOf('ε-N') >= 0
  && a1.questions[0].comment.text.indexOf('整数') >= 0);
ok('未知题型回落解答题',
  gs.capToAssignment({ questions: [{ stem: 'x', type: '完形填空' }] }).questions[0].type === '解答题');
ok('id 带 phone 前缀且可复现',
  gs.capToAssignment(cap1, { now: 1000 }).id === 'as_phone_1000');
ok('可指定课程（线代作业）',
  gs.capToAssignment(cap1, { courseId: 'c_linalg' }).courseId === 'c_linalg');
ok('操作指引 4 步、注意事项非空', gs.STEPS.length === 4 && gs.NOTES.length >= 3);

/* ---------- A2. 全量搬运：nodes 优先于纯文本 ---------- */
section('手机抓取 · 全量搬运（nodes 透传）');

ok('采集端给了 nodes 就原样用，不再退回纯文本', (function () {
  const a = gs.capToAssignment({ questions: [{
    stem: '文字版题干',
    stemNodes: [{ t: 't', v: '已知 A=' }, { t: 'i', s: 'https://x/a.png', w: 285, h: 30, f: 1 }, { t: 't', v: '，求值' }]
  }] });
  const s = a.questions[0].stem;
  return s.length === 3 && s[0].t === 't' && s[1].t === 'i' && s[2].t === 't';
})());

ok('公式图保留 f 标记与尺寸（小程序按 rpx 定宽渲染）', (function () {
  const q = gs.capToAssignment({ questions: [{
    stemNodes: [{ t: 'i', s: 'https://x/f.png', w: 285, h: 30, f: 1 }]
  }] }).questions[0];
  return q.stem[0].f === 1 && q.stem[0].w === 285 && q.stem[0].h === 30;
})());

ok('公式图没尺寸时兜底给一个（否则小程序里塌成点）', (function () {
  const q = gs.capToAssignment({ questions: [{
    stemNodes: [{ t: 'i', s: 'https://x/f.png', f: 1 }]
  }] }).questions[0];
  return q.stem[0].w > 0 && q.stem[0].h > 0;
})());

ok('手写照片标 p=1（走 widthFix 等比缩放）', (function () {
  const q = gs.capToAssignment({ questions: [{
    myAnswerNodes: [{ t: 'i', s: 'https://x/photo.jpg' }]
  }] }).questions[0];
  return q.myAnswer.nodes[0].p === 1 && q.myAnswer.photo === true;
})());

ok('**只有照片、没有文字的题不会被丢掉**', (function () {
  const a = gs.capToAssignment({ questions: [
    { stem: '', myAnswer: '', myAnswerNodes: [{ t: 'i', s: 'https://x/p.jpg' }] }
  ] });
  return a && a.questions.length === 1;
})());

ok('**文字只在 nodes 里（没有 stem 字段）的题也不会被丢掉**', (function () {
  // 真踩过：判定只看纯文本字段 + 图片，这种「题干全在 nodes 里」的题会被静默滤掉
  const a = gs.capToAssignment({ questions: [
    { stem: '', stemNodes: [{ t: 't', v: '用定义证明下列极限' }, { t: 'br' }] }
  ] });
  return a && a.questions.length === 1 && a.questions[0].stem.length === 1;
})());

ok('真空题仍然被丢掉（别因为放宽判定把垃圾也收进来）', (function () {
  const a = gs.capToAssignment({ questions: [
    { stem: '', myAnswer: '', correctAnswer: '', teacherComment: '' },
    { stem: '', stemNodes: [{ t: 'br' }, { t: 'br' }] }
  ] });
  return a === null;
})());

ok('首尾换行被清理、连续换行合并', (function () {
  const q = gs.capToAssignment({ questions: [{
    stemNodes: [{ t: 'br' }, { t: 't', v: 'a' }, { t: 'br' }, { t: 'br' }, { t: 't', v: 'b' }, { t: 'br' }]
  }] }).questions[0];
  return q.stem.length === 3 && q.stem[0].v === 'a' && q.stem[1].t === 'br' && q.stem[2].v === 'b';
})());

ok('gist 取自题干第一个文字节点（题干为空时）', (function () {
  const q = gs.capToAssignment({ questions: [{
    stem: '', stemNodes: [{ t: 'i', s: 'x.png', f: 1 }, { t: 't', v: '已知矩阵 A 求逆' }]
  }] }).questions[0];
  return q.gist === '已知矩阵 A 求逆';
})());

/* ---------- A3. 原样搬运 = 不按得分挑题 ---------- */
section('手机抓取 · 原样搬运语义（importAll）');

ok('抓取产物带 importAll（整份作业全要）',
  a1.importAll === true, a1.importAll);
ok('可显式关掉，退回「只收错题」',
  gs.capToAssignment(cap1, { onlyWrong: true }).importAll === false);

const plainCap = { title: '没批语的作业', questions: [
  { no: 1, stem: '题一', score: { got: null, total: null }, verdict: 'unknown' },
  { no: 2, stem: '题二', score: { got: null, total: null }, verdict: 'unknown' }
] };
ok('**没批语、没得分的题也照搬**（否则整份作业会被滤成 0 道）',
  gs.capToAssignment(plainCap).questions.length === 2);

const SRC = decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, ''));
ok('脚本支持 iOS 快捷指令的 completion 回调（免建书签）',
  SRC.indexOf('typeof completion') >= 0 && SRC.indexOf('completion(') >= 0);
ok('脚本里带着 pickNodes（nodes 透传逻辑真的被打包了）',
  SRC.indexOf('function pickNodes') >= 0);
ok('脚本里带着 nodesFrom（采集端原样摊平的实现）',
  SRC.indexOf('function nodesFrom') >= 0);

/* ==================== B. 端到端（真实页面） ==================== */
section('手机抓取 · 真实页面端到端');

const fxDir = process.env.CHAOXING_FIXTURES || '';
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }

if (!JSDOM) {
  console.log('  - 跳过：没装 jsdom（npm i jsdom 后可跑）');
  skip += 1;
} else if (!fxDir || !fs.existsSync(fxDir)) {
  console.log('  - 跳过：没给真实作业页目录（设 CHAOXING_FIXTURES=<目录> 后可跑）');
  skip += 1;
} else {
  const htmls = fs.readdirSync(fxDir).filter((f) => /\.html?$/i.test(f));
  if (!htmls.length) {
    console.log('  - 跳过：目录里没有 .html 文件');
    skip += 1;
  } else {
    const code = decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, ''));
    let grabbed = 0;
    let nodesWithImg = 0;        // 有多少份作品真的把图片搬进了 nodes
    let nodesChecked = 0;
    htmls.forEach((f) => {
      const dom = new JSDOM(fs.readFileSync(path.join(fxDir, f), 'utf8'), {
        url: 'https://mooc1-api.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=1&classId=1&workId=1',
        runScripts: 'outside-only',
        pretendToBeVisual: true
      });
      let data = null, err = '', shortcutGot = null;
      try {
        // 模拟 iOS 快捷指令：它会在运行前注入 completion()，脚本应当把 JSON 交回来
        dom.window.completion = function (v) { shortcutGot = v; };
        dom.window.eval(code);
        const ta = dom.window.document.getElementById('__cxg_json');
        if (ta && ta.value) data = JSON.parse(ta.value);
      } catch (e) { err = e.message; }
      dom.window.close();
      if (data && data.questions.length) {
        grabbed += 1;
        ok(f + ' → 抓到 ' + data.questions.length + ' 道题', true);
        if (shortcutGot) {
          let sOk = false, sN = 0;
          try { sN = JSON.parse(shortcutGot).questions.length; sOk = true; } catch (e) {}
          ok('  ↳ 快捷指令收到同样的结果', sOk && sN === data.questions.length, [sOk, sN]);
        }
        // 这一份里有没有任何一道题把图片搬进了 nodes（题干公式图 / 手写照片都算）
        const hasImg = data.questions.some((q) => {
          const scan = (ns) => (ns || []).some((n) => n.t === 'i' && n.s);
          return scan(q.stem) || scan(q.myAnswer && q.myAnswer.nodes)
            || scan(q.comment && q.comment.nodes) || scan(q.rightAnswer && q.rightAnswer.nodes);
        });
        nodesChecked += 1;
        if (hasImg) nodesWithImg += 1;
      } else {
        // 有些页面本来就不是作业详情页（附件页、列表页），抓不到是正常的，标出来给人看
        console.log('  - ' + f + ' 没抓到题' + (err ? '（' + err + '）' : '（可能不是作业详情页）'));
      }
    });
    ok('至少在一份真实作业页上抓到了题', grabbed > 0, grabbed + '/' + htmls.length);
    // 「全量搬运」的核心承诺：公式图/手写照片必须作为节点搬进小程序，而不是被丢掉
    ok('**真实页面上图片确实进了 nodes**', nodesWithImg > 0, nodesWithImg + '/' + nodesChecked + ' 份');
  }
}

/* ==================== C. 登录页识别 ==================== */
section('手机抓取 · 登录页识别');

if (!JSDOM) {
  console.log('  - 跳过：没装 jsdom（npm i jsdom 后可跑）');
  skip += 1;
} else {
  // 从学习通 App 复制链接到浏览器打开时，最常见就是停在登录页。
  // 这里测的是运行壳的提示逻辑（不是采集解析），所以造一个最小登录页是合理的。
  const cases = [
    ['登录域名 + 登录表单', 'https://passport.chaoxing.com/login',
      '<html><body><form id="loginForm"><input id="phone"><input id="pwd"></form></body></html>'],
    ['作业域名但跳回了登录页', 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork',
      '<html><body><div class="passport"><input name="pwd"></div></body></html>']
  ];
  const src = decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, ''));
  cases.forEach(([label, url, html]) => {
    const dom = new JSDOM(html, { url: url, runScripts: 'outside-only' });
    let text = '';
    try {
      dom.window.eval(src);
      text = (dom.window.document.body.textContent || '').replace(/\s+/g, ' ');
    } catch (e) { text = 'EX:' + e.message; }
    dom.window.close();
    ok(label + ' → 提示去浏览器登录',
      text.indexOf('登录页') >= 0 && text.indexOf('浏览器登录') >= 0, text.slice(0, 60));
  });
}

/* ==================== D. 自动注入模式（安卓 Via / 油猴） ==================== */
section('手机抓取 · 自动注入模式');

if (!JSDOM) {
  console.log('  - 跳过：没装 jsdom（npm i jsdom 后可跑）');
  skip += 1;
} else {
  const base = decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, ''));
  // 与 tools/export-grab-script.js 的产出保持一致：油猴头 + __AUTO=true
  const auto = gs.USER_SCRIPT_META + base.replace('var __AUTO = false;', 'var __AUTO = true;');
  ok('能生成自动注入版（__AUTO=true）', auto.indexOf('var __AUTO = true;') >= 0);
  // Via 的「导入脚本」按 UserScript 格式解析，没这个头会直接报「解析脚本失败」（实测踩过）
  ok('带油猴元数据块（Via 导入必需）',
    auto.indexOf('// ==UserScript==') === 0 && auto.indexOf('@match') >= 0
    && auto.indexOf('@grant') >= 0, auto.slice(0, 40));

  function runOn(url, html) {
    const dom = new JSDOM(html, { url: url, runScripts: 'outside-only', pretendToBeVisual: true });
    let text = '';
    try {
      dom.window.eval(auto);
      text = (dom.window.document.body.textContent || '').replace(/\s+/g, ' ');
    } catch (e) { text = 'EX:' + e.message; }
    dom.window.close();          // 关掉才不会留着 8 秒的等待定时器
    return text;
  }
  const quiet = (t) => t.indexOf('搬到') < 0 && t.indexOf('没搬到') < 0 && t.indexOf('登录页') < 0;

  // 自动注入对**每个页面**都生效，所以门禁是硬要求：开个百度也弹窗会让人卸载浏览器
  ok('非学习通页面：静默', quiet(runOn('https://www.baidu.com', '<html><body><p>搜索</p></body></html>')));
  ok('学习通非作业页（课程首页）：静默',
    quiet(runOn('https://mooc1.chaoxing.com/mooc-ans/mooc2/home', '<html><body><p>课程首页</p></body></html>')));

  const fxFile = fxDir && fs.existsSync(fxDir) ? path.join(fxDir, 'work01.html') : '';
  if (!fxFile || !fs.existsSync(fxFile)) {
    console.log('  - 跳过：没有真实作业页，验证不了自动抓取');
    skip += 1;
  } else {
    const t = runOn('https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=1',
      fs.readFileSync(fxFile, 'utf8'));
    ok('学习通作业页：自动抓取生效', t.indexOf('搬到') >= 0, t.slice(0, 50));
    ok('结果里报了公式图数量（图片有没有丢，页面上就能看见）',
      /含 \d+ 张公式图/.test(t), t.slice(0, 80));
  }
}

/* ==================== E. 与小程序存储的整链路 ==================== */
section('手机抓取 · 真实页面 → 小程序存储（整链路）');

if (!JSDOM || !fxDir || !fs.existsSync(fxDir)) {
  console.log('  - 跳过：需要 jsdom 与真实作业页');
  skip += 1;
} else {
  const f = path.join(fxDir, 'work02.html');
  if (!fs.existsSync(f)) {
    console.log('  - 跳过：没有 work02.html');
    skip += 1;
  } else {
    // 这一段测的是「抓到的包喂给 store 之后，图片还在不在」——
    // 中间的 capToAssignment / pickNodes 都可能悄悄吃掉节点，所以必须端到端验一次，
    // 光验 BOOKMARKLET 的产物证明不了小程序侧拿得到图。
    const mem = {};
    const realWx = global.wx;
    global.wx = {
      getStorageSync: (k) => (mem[k] === undefined ? '' : mem[k]),
      setStorageSync: (k, v) => { mem[k] = v; },
      removeStorageSync: (k) => { delete mem[k]; }
    };
    let store = null, pkg = null, err2 = '';
    try {
      store = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'store.js'));
      const dom = new JSDOM(fs.readFileSync(f, 'utf8'), {
        url: 'https://mooc1-api.chaoxing.com/mooc-ans/mooc2/work/dowork', runScripts: 'outside-only', pretendToBeVisual: true
      });
      dom.window.eval(decodeURIComponent(gs.BOOKMARKLET.replace(/^javascript:/, '')));
      const ta = dom.window.document.getElementById('__cxg_json');
      if (ta && ta.value) pkg = JSON.parse(ta.value);
      dom.window.close();
    } catch (e) { err2 = e.message; }
    if (realWx === undefined) delete global.wx; else global.wx = realWx;

    ok('抓取产物能直接喂给 store（格式不变形）', !!pkg && !!store && !err2, err2);
    if (pkg && store) {
      const r = store.importAssignment(pkg);
      ok('整份作业被导入（importAll 生效）', r.ok && r.added === pkg.questions.length, r);
      const list = store.all();
      const withStemImg = list.filter((m) => (m.stem || []).some((n) => n.t === 'i')).length;
      const withAnsImg = list.filter((m) => ((m.myAnswer || {}).nodes || []).some((n) => n.t === 'i')).length;
      ok('**入库后题干里的公式图还在**', withStemImg > 0, withStemImg + '/' + list.length);
      ok('**入库后作答里的手写照片还在**', withAnsImg > 0, withAnsImg + '/' + list.length);
      ok('入库后订正闸门仍是锁的（status=new）', list.every((m) => m.status === 'new'));
      ok('入库后判词为 unknown（没批语时不瞎猜）', list.every((m) => m.verdict === 'unknown'));
    }
  }
}

console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项' + (skip ? '，跳过 ' + skip + ' 段' : ''));
console.log('='.repeat(46));
process.exitCode = fail ? 1 : 0;
