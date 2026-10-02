#!/usr/bin/env node
/**
 * 多模型识别效果对比 —— 用同一张真实作业照片，横向比出哪个模型够用
 * ===========================================================================
 * 为什么需要这个脚本
 * ---------------------------------------------------------------------------
 * 「哪个模型更强」这种问题看排行榜没用。你的场景有三个很具体的特征：
 *   ① 中文手写体（不是印刷体）
 *   ② 数学符号（ε δ ∀ ∃ √ 分数）
 *   ③ 红笔批语要和正文分开
 * 这三条决定了第一名的模型未必适合你。只有用你自己的作业照片跑一遍，
 * 才能看出它到底认不认得出你写的字、分不分得清哪段是老师写的。
 *
 * 它复用云函数里的同一份提示词与知识点过滤规则（require 进来），
 * 所以这里测出来的效果 ≈ 线上真实效果，不会「线上认一套、脚本认另一套」。
 *
 * ---------------------------------------------------------------------------
 * 用法
 * ---------------------------------------------------------------------------
 *   # 1. 准备 Key（首次运行会自动生成模板）
 *   node tools/compare-vlm.js --init
 *        → 生成 tools/vlm-keys.json，把里面的 Key 填上
 *
 *   # 2. 拿一张（或多张）真实作业照片来比
 *   node tools/compare-vlm.js path/to/hw.jpg
 *   node tools/compare-vlm.js hw1.jpg hw2.jpg
 *
 *   ⚠️ **必须用真实作业照片。**
 *   别拿 tools/preview-shot.png 那类**界面预览图**当输入 —— 那是小程序 UI 的截图，
 *   模型会一字不差地把界面上的文字（题目卡片、错因分析、排序选项）抄下来，
 *   报告看着"识别成功"，实际完全不能代表真实作业的效果。
 *   2026-09-25 踩过这个坑：拿界面预览图连测几轮，把「抄界面」误读成「识别通过」，
 *   直到用真实作业图才发现公式里的 LaTeX 反斜杠会把 JSON 打垮。
 *   **测试数据必须代表真实场景，否则验证的是别的东西。**
 *
 * 只填了 Key 的模型才会被跑。没填的直接跳过，不用管。
 *
 * ---------------------------------------------------------------------------
 * 产出
 * ---------------------------------------------------------------------------
 *   tools/vlm-compare/<时间戳>.html   并排对比报告（浏览器打开，一眼看出差异）
 *   控制台汇总表
 *
 * ---------------------------------------------------------------------------
 * 成本说明
 * ---------------------------------------------------------------------------
 * 脚本会打印每个模型的实际 token 用量。乘各家单价就是这次的费用。
 * 一页作业通常是「一两千输入 token + 一两千输出 token」的量级，
 * 换算下来单页都在「分」以下。具体单价以厂商控制台为准，这里不写死
 * —— 模型价格变动频繁，写死反而会误导你。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// 复用云函数里的提示词与过滤规则 —— 单一真相源，避免两份漂移
const cloudFn = require(path.join(ROOT, 'cloudfunctions/recognizeWork/index.js'));
const SYSTEM = cloudFn.SYSTEM;

/**
 * 用哪份提示词 —— 跟线上保持一致，否则「脚本里能认、线上认不出」白测。
 *
 *   VLM_LITE=1  屏幕截图版（1158 字）
 *   VLM_LITE=2  极简版（430 字）← 长期使用的主推档
 *   不设置      完整版（1366 字，翻拍纸质用）
 *
 * 原理：云函数里 USE_SYSTEM 是按环境变量在加载时定好的，
 * 这里直接 require 同一个模块，环境变量一致结果就一致。
 * 所以只要在命令行前加 `VLM_LITE=2`，两边跑的提示词就是同一份。
 */
const PROMPT = cloudFn.USE_SYSTEM;
const LITE_LABEL = ['完整版（翻拍纸质）', '屏幕截图版', '极简版'][cloudFn.currentConfig().lite] || '完整版';
const filterKp = cloudFn.filterKp;
const PRESET = cloudFn.PROVIDERS;

const KEY_FILE = path.join(__dirname, 'vlm-keys.json');
const OUT_DIR = path.join(__dirname, 'vlm-compare');

/** 图片超过这个大小就先压一下 —— 模型对单张图的 base64 都有上限 */
const MAX_IMG_BYTES = 3 * 1024 * 1024;

/** 云函数预设之外的厂商（比如你坚持要试 OpenAI） */
const EXTRA_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    console: 'platform.openai.com',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    note: '国内直连不通，需要自备代理/中转，把 endpoint 填成中转地址'
  }
};

const ALL = Object.assign({}, PRESET, EXTRA_PROVIDERS);

/* =========================================================================
 * Key 读取
 * ======================================================================= */

function keyTemplate() {
  const t = {};
  Object.keys(ALL).forEach((k) => {
    if (k === 'custom' || !ALL[k].endpoint) return;
    t[k] = {
      key: '',
      model: ALL[k].model,
      _note: ALL[k].label + ' · ' + ALL[k].console + (ALL[k].note ? ' · ' + ALL[k].note : '')
    };
  });
  return t;
}

function loadKeys() {
  if (process.argv.indexOf('--init') >= 0) {
    if (fs.existsSync(KEY_FILE)) {
      console.log('已经存在：' + KEY_FILE + '\n（没动它。想重建就先自己删掉。）');
    } else {
      fs.writeFileSync(KEY_FILE, JSON.stringify(keyTemplate(), null, 2), 'utf8');
      console.log('已生成模板：' + KEY_FILE + '\n把要试的那几家的 Key 填进去，然后重跑。');
    }
    process.exit(0);
  }

  let cfg = {};
  if (fs.existsSync(KEY_FILE)) {
    try {
      cfg = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    } catch (e) {
      console.error('vlm-keys.json 不是合法 JSON：' + e.message);
      process.exit(1);
    }
  } else {
    // 环境变量兜底：VLM_KEY_ZHIPU=xxx node tools/compare-vlm.js hw.jpg
    Object.keys(ALL).forEach((k) => {
      const v = process.env['VLM_KEY_' + k.toUpperCase()];
      if (v) cfg[k] = { key: v };
    });
  }

  const usable = {};
  Object.keys(cfg).forEach((k) => {
    const c = cfg[k] || {};
    if (!c.key || k.charAt(0) === '_') return;          // _note 这类跳过
    const p = ALL[k];
    if (!p) return;
    const endpoint = c.endpoint || p.endpoint;
    if (!endpoint) return;
    usable[k] = {
      label: c.label || p.label,
      endpoint: endpoint,
      model: c.model || p.model,
      key: c.key,
      imageStyle: c.imageStyle || 'dataurl',
      thinking: c.thinking === true && p.thinking,
      jsonMode: c.jsonMode === true,
      maxTokens: c.maxTokens || 12000,   // 始终思考型模型的思考 token 也占这个额度，别卡 4000
      timeoutMs: c.timeoutMs || 180000   // 始终思考型模型（glm-5.x）一张图要 30-60s+，别卡在 60s
    };
  });

  if (!Object.keys(usable).length) {
    console.error('没有可用的模型 Key。\n');
    console.error('先跑一次：node tools/compare-vlm.js --init');
    console.error('它会生成 ' + KEY_FILE + '，把 Key 填上再重跑。');
    console.error('\n也可以临时用环境变量：VLM_KEY_ZHIPU=你的key node tools/compare-vlm.js 作业.jpg');
    process.exit(1);
  }
  return usable;
}

/* =========================================================================
 * 图片准备：太大就压
 * ======================================================================= */

const PY_COMPRESS = [
  'import sys',
  'from PIL import Image',
  'im = Image.open(sys.argv[1]).convert("RGB")',
  'w = int(sys.argv[3])',
  'if im.width > w:',
  '    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)',
  'im.save(sys.argv[2], "JPEG", quality=int(sys.argv[4]), optimize=True)'
].join('\n');

/**
 * 找可用的 Python（压缩大图用）。
 * 优先 VLM_PY 环境变量，否则依次尝试 PATH 里的 python / python3。
 */
function pyCandidates() {
  return [
    process.env.VLM_PY,
    'python',
    'python3'
  ].filter(Boolean);
}

function tryCompress(file) {
  const out = path.join(os.tmpdir(), 'vlm-cmp-' + Date.now() + '.jpg');
  for (const py of pyCandidates()) {
    try {
      execFileSync(py, ['-c', PY_COMPRESS, file, out, '1280', '80'], { stdio: 'ignore' });
      if (fs.existsSync(out)) return out;
    } catch (e) { /* 换下一个 python 试 */ }
  }
  return null;
}

function prepareImage(file) {
  if (!fs.existsSync(file)) {
    console.error('找不到图片：' + file);
    process.exit(1);
  }
  const size = fs.statSync(file).size;
  let use = file;
  if (size > MAX_IMG_BYTES) {
    const small = tryCompress(file);
    if (small) {
      console.log('  图片 ' + (size / 1048576).toFixed(1) + 'MB → 已压到 '
        + (fs.statSync(small).size / 1048576).toFixed(1) + 'MB（1280px / q80）');
      use = small;
    } else {
      console.log('  ⚠ 图片 ' + (size / 1048576).toFixed(1) + 'MB 偏大，而且没找到可用的 python+Pillow 来压。');
      console.log('    如果模型报「图片过大」，先用系统截图工具把作业部分截出来再跑。');
    }
  }
  return { path: use, base64: fs.readFileSync(use).toString('base64') };
}

/* =========================================================================
 * 调用一个模型
 * ======================================================================= */

const TYPES = cloudFn.TYPES;

function numLike(v, max) {
  const n = typeof v === 'string' ? Number(String(v).replace(/[^\d.]/g, '')) : v;
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return null;
  if (n > (max || 1000)) return null;
  return n;
}
const strLike = (v, cap) => String(v == null ? '' : v).replace(/\s+$/g, '').slice(0, cap || 4000);

async function callOne(name, cfg, base64, whitelist, courseHint, hint) {
  const url = cfg.imageStyle === 'raw' ? base64 : 'data:image/jpeg;base64,' + base64;
  const kpBlock = whitelist.length
    ? whitelist.map((n) => '- ' + n).join('\n')
    : '（未提供知识点清单，kpNames 一律返回空数组）';

  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: url } },
          {
            type: 'text',
            text: '【知识点清单】\n' + kpBlock
              + (courseHint ? '\n\n【所属课程】' + courseHint : '')
              + (hint ? '\n\n【用户补充说明】' + hint : '')
              + '\n\n请转录这张已批改作业的照片，按要求输出 JSON。'
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: cfg.maxTokens
  };
  // 跟云函数共用同一份判定：GLM-4.6V 系可关（关掉快 4 倍），
  // GLM-5.3 系不能关、只能调 low/high/max —— 发错会直接 400。
  // 细节见云函数里的 buildThinking() 注释。
  const preset = PRESET[name] || {};
  if (preset.thinking) Object.assign(body, cloudFn.buildThinking(cfg.model));
  if (cfg.jsonMode) body.response_format = { type: 'json_object' };

  const t0 = Date.now();
  let httpStatus = 0;
  let text = '';
  let usage = null;
  /*
   * 限流自动重试。
   *
   * 为什么必须加：智谱免费档实测会返回 `429 · 该模型当前访问量过大`（错误码 1305）——
   * 这不是配置错误，就是免费池子人多。同一张图隔几秒重试一次就成功了。
   * 如果不重试，用户看到的就是「没有报告」，然后以为是自己的 Key 填错了，
   * 白白去查配置。**这种"看起来像配置问题、其实是排队"的报错最耗人。**
   *
   * 只对可重试的状态码重试：429（限流）和 5xx（服务端抖动）。
   * 401/403 是 Key 真错，重试一万次也一样，立刻返回。
   */
  const RETRY_WAITS = [4000, 10000];
  try {
    for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt++) {
      if (attempt > 0) {
        const w = RETRY_WAITS[attempt - 1];
        console.log('      被限流，' + (w / 1000) + ' 秒后重试（第 ' + (attempt + 1) + ' 次）…');
        await new Promise((r) => setTimeout(r, w));
      }
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs)   // 每次都要新 signal，不能复用
      });
      httpStatus = res.status;
      const raw = await res.text();
      if (res.status === 200) {
        const outer = JSON.parse(raw);
        text = (outer.choices && outer.choices[0] && outer.choices[0].message
          && outer.choices[0].message.content) || '';
        usage = outer.usage || null;
        break;
      }
      text = '';
      const retriable = (res.status === 429 || res.status >= 500);
      const last = attempt === RETRY_WAITS.length;
      if (!retriable || last) {
        const hint = res.status === 429
          ? '（该模型访问量过大，是免费池排队，不是你的 Key 有问题。稍后再试，或换个模型）'
          : '';
        return {
          name: name, label: cfg.label, model: cfg.model,
          ok: false, status: httpStatus, ms: Date.now() - t0,
          error: 'HTTP ' + res.status + ' · ' + raw.slice(0, 200) + hint
        };
      }
    }
  } catch (e) {
    return {
      name: name, label: cfg.label, model: cfg.model,
      ok: false, status: 0, ms: Date.now() - t0,
      error: (e && e.name === 'TimeoutError' ? '超时（' + cfg.timeoutMs + 'ms）' : (e && e.message) || '未知错误')
    };
  }

  const parsed = cloudFn.extractJson(text);
  const ms = Date.now() - t0;
  if (!parsed) {
    return {
      name: name, label: cfg.label, model: cfg.model,
      ok: false, status: httpStatus, ms: ms, usage: usage,
      error: '没能从输出里解析出 JSON',
      rawTail: String(text).slice(0, 400)
    };
  }

  const rawList = Array.isArray(parsed.questions) ? parsed.questions
    : (Array.isArray(parsed) ? parsed : []);

  const questions = rawList.slice(0, 20).map((q, i) => {
    q = q || {};
    const full = numLike(q.fullScore, 200);
    let score = numLike(q.score, 200);
    if (score !== null && full !== null && score > full) score = null;
    return {
      no: numLike(q.no, 999) || (i + 1),
      type: TYPES.indexOf(q.type) >= 0 ? q.type : '解答题',
      gist: strLike(q.gist, 60),
      stem: strLike(q.stem, 4000),
      myAnswer: strLike(q.myAnswer, 4000),
      rightAnswer: strLike(q.rightAnswer, 4000),
      comment: strLike(q.comment, 2000),
      score: score,
      fullScore: full,
      kpNames: filterKp(q.kpNames, whitelist),
      confidence: ['high', 'medium', 'low'].indexOf(q.confidence) >= 0 ? q.confidence : 'medium'
    };
  }).filter((q) => q.stem || q.myAnswer || q.comment);

  return {
    name: name, label: cfg.label, model: cfg.model,
    ok: true, status: httpStatus, ms: ms, usage: usage, questions: questions,
    health: health(questions)
  };
}

/** 自动体检：一眼能看出来的问题先标出来，省得人眼一行行翻 */
function health(qs) {
  const h = {
    count: qs.length,
    noStem: 0, noAnswer: 0, noComment: 0,
    boxes: 0,          // 出现「□」占位 = 有字没认出来
    chars: 0,
    conf: { high: 0, medium: 0, low: 0 }
  };
  qs.forEach((q) => {
    if (!q.stem) h.noStem++;
    if (!q.myAnswer) h.noAnswer++;
    if (!q.comment) h.noComment++;
    const all = q.stem + q.myAnswer + q.rightAnswer + q.comment;
    h.boxes += (all.match(/□/g) || []).length;
    h.chars += all.replace(/\s/g, '').length;
    h.conf[q.confidence] = (h.conf[q.confidence] || 0) + 1;
  });
  return h;
}

/* =========================================================================
 * 报告
 * ======================================================================= */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 把「空字段」和「有认不出的字」标出来，人眼不用自己去数 */
function field(label, val, opts) {
  opts = opts || {};
  const v = String(val || '');
  const cls = !v ? 'empty' : (v.indexOf('□') >= 0 ? 'boxed' : '');
  const shown = v ? esc(v).replace(/\n/g, '<br>').replace(/□/g, '<mark>□</mark>')
    : '<span class="nil">（模型没提取到' + label + '）</span>';
  return '<div class="fld ' + cls + '"><div class="fld-l">' + label + '</div>'
    + '<div class="fld-v">' + shown + '</div></div>';
}

function buildHtml(ctx) {
  const results = ctx.results;
  const maxNo = Math.max(0, ...results.map((r) => (r.questions || []).length));

  const cards = results.map((r) => {
    if (!r.ok) {
      return '<div class="card bad"><h3>' + esc(r.label) + ' <code>' + esc(r.model) + '</code></h3>'
        + '<div class="stat">耗时 ' + (r.ms / 1000).toFixed(1) + 's ｜ <span class="err">失败</span></div>'
        + '<pre class="errbox">' + esc(r.error) + '\n' + esc(r.rawTail || '') + '</pre></div>';
    }
    const h = r.health;
    const u = r.usage || {};
    const tok = (u.prompt_tokens != null || u.completion_tokens != null)
      ? ' ｜ tokens ' + (u.prompt_tokens || '?') + ' → ' + (u.completion_tokens || '?')
      : '';
    const warnings = [];
    if (h.noStem) warnings.push('题干缺 ' + h.noStem + ' 处');
    if (h.noAnswer) warnings.push('解答缺 ' + h.noAnswer + ' 处');
    if (h.noComment) warnings.push('批语缺 ' + h.noComment + ' 处');
    if (h.boxes) warnings.push('有 ' + h.boxes + ' 个「□」未认出');

    return '<div class="card"><h3>' + esc(r.label) + ' <code>' + esc(r.model) + '</code></h3>'
      + '<div class="stat">耗时 <b>' + (r.ms / 1000).toFixed(1) + 's</b>'
      + ' ｜ 识别出 <b>' + h.count + '</b> 道题 ｜ 共 ' + h.chars + ' 字' + tok + '</div>'
      + '<div class="stat dim">置信度 high ' + h.conf.high + ' · medium ' + h.conf.medium
      + ' · low ' + h.conf.low + '</div>'
      + (warnings.length
        ? '<div class="warn">⚠ ' + esc(warnings.join(' ｜ ')) + '</div>'
        : '<div class="ok">✓ 无明显缺漏</div>')
      + '</div>';
  }).join('');

  let body = '';
  for (let i = 0; i < maxNo; i++) {
    const blocks = results.map((r) => {
      const q = r.ok ? (r.questions || [])[i] : null;
      if (!q) {
        return '<div class="col miss"><div class="miss-t">' + esc(r.label) + '</div>'
          + (r.ok ? '<div class="nil">这道题没识别出来（该模型只识别出 ' + (r.questions || []).length + ' 道）</div>'
            : '<div class="nil">该模型调用失败</div>') + '</div>';
      }
      return '<div class="col"><div class="miss-t">' + esc(r.label) + ' <code>' + esc(r.model) + '</code></div>'
        + '<div class="stat dim">' + esc(q.type) + ' ｜ 考点「' + esc(q.gist) + '」 ｜ '
        + (q.score != null ? '得分 ' + q.score + (q.fullScore != null ? '/' + q.fullScore : '') : '得分未识别')
        + ' ｜ 置信度 ' + esc(q.confidence)
        + (q.kpNames.length ? ' ｜ 知识点 ' + esc(q.kpNames.join('、')) : ' ｜ 知识点未命中')
        + '</div>'
        + field('题干', q.stem)
        + field('我的解答', q.myAnswer)
        + field('教师批语', q.comment)
        + field('标准解答', q.rightAnswer)
        + '</div>';
    }).join('');
    body += '<section class="q"><h2>第 ' + (i + 1) + ' 题</h2><div class="cols">' + blocks + '</div></section>';
  }

  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<title>识别效果对比</title><style>'
    + ':root{--bg:#f5f6f8;--card:#fff;--line:#e4e7ec;--txt:#1f2329;--dim:#7b8494;'
    + '--ok:#0a8f4d;--warn:#c47f00;--err:#d03050;--brand:#2b6cff}'
    + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);'
    + 'font:15px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}'
    + 'header{background:#fff;border-bottom:1px solid var(--line);padding:20px 28px;position:sticky;top:0;z-index:9}'
    + 'header h1{margin:0 0 6px;font-size:19px}header .meta{color:var(--dim);font-size:13px}'
    + 'main{padding:22px 28px 60px;max-width:1800px}'
    + '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-bottom:26px}'
    + '.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}'
    + '.card.bad{border-color:#f2c8d0;background:#fff6f7}'
    + '.card h3{margin:0 0 8px;font-size:15px}.card code{font-size:12px;color:var(--dim);background:#f0f2f5;'
    + 'padding:1px 6px;border-radius:4px}'
    + '.stat{font-size:13px;color:#41464f}.stat.dim{color:var(--dim);margin-top:3px}'
    + '.warn{margin-top:8px;font-size:13px;color:var(--warn)}.ok{margin-top:8px;font-size:13px;color:var(--ok)}'
    + '.err{color:var(--err);font-weight:600}'
    + '.errbox{white-space:pre-wrap;font-size:12px;color:var(--err);background:#fff;'
    + 'border:1px solid #f2c8d0;border-radius:6px;padding:8px;margin:8px 0 0;overflow:auto;max-height:160px}'
    + '.q{margin-bottom:26px}.q h2{font-size:16px;margin:0 0 10px;padding-left:10px;border-left:3px solid var(--brand)}'
    + '.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}'
    + '.col{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:0}'
    + '.col.miss{background:#fafbfc;border-style:dashed}'
    + '.miss-t{font-size:13px;font-weight:600;margin-bottom:6px;color:#41464f}'
    + '.miss-t code{font-weight:400}'
    + '.fld{border-top:1px dashed var(--line);padding:7px 0 5px}'
    + '.fld:first-of-type{border-top:none}'
    + '.fld-l{font-size:11px;color:var(--dim);letter-spacing:.5px;margin-bottom:2px}'
    + '.fld-v{font-size:13.5px;white-space:normal;word-break:break-word}'
    + '.fld.empty .fld-v,.nil{color:#a8b0bd;font-style:italic;font-size:13px}'
    + '.fld.boxed{background:#fffaf0;border-radius:5px;padding-left:6px;padding-right:6px}'
    + 'mark{background:#ffe08a;color:#8a5a00;border-radius:3px;padding:0 2px}'
    + '</style></head><body>'
    + '<header><h1>识别效果对比 · ' + esc(ctx.title) + '</h1>'
    + '<div class="meta">图片：' + esc(ctx.imgName) + ' ｜ 参战模型 ' + results.length + ' 个 ｜ '
    + esc(ctx.at) + ' ｜ 提示词：' + esc(LITE_LABEL) + '（' + PROMPT.length + ' 字，与线上一致）</div></header>'
    + '<main><div class="cards">' + cards + '</div>'
    + (body || '<p class="nil">所有模型都没识别出题目，看上面各卡片的失败原因。</p>')
    + '</main></body></html>';
}

/* =========================================================================
 * 主流程
 * ======================================================================= */

/** 知识点白名单直接从预置树里取 —— 保证和 App 里勾的是同一批 */
function kpWhitelist() {
  try {
    const kp = require(path.join(ROOT, 'miniprogram/utils/kp.js'));
    return kp.flatOptions().filter((o) => o.isLeaf).map((o) => o.name);
  } catch (e) {
    console.log('（读知识点树失败，本次不传白名单：' + e.message + '）');
    return [];
  }
}

async function main() {
  if (process.argv.indexOf('--init') >= 0 || process.argv.indexOf('-i') >= 0) {
    loadKeys();          // 内部处理 --init 并退出
  }

  const args = process.argv.slice(2).filter((a) => a.charAt(0) !== '-');
  if (!args.length) {
    console.log('用法：node tools/compare-vlm.js <作业照片> [更多照片...]');
    console.log('首次使用先跑：node tools/compare-vlm.js --init');
    process.exit(0);
  }

  const usable = loadKeys();
  const whitelist = kpWhitelist();

  // 把收到的图片信息打在最前面 —— 拖放失败时这里是唯一的线索
  // （用户拖放没生效的话，脚本走的是「用法提示」分支，压根到不了这一步）
  const imgPath = args[0] || '';
  console.log('\n图片：' + imgPath
    + (fs.existsSync(imgPath)
      ? '（' + (fs.statSync(imgPath).size / 1024).toFixed(0) + ' KB）'
      : '  ← 文件不存在！'));
  console.log('参战模型：' + Object.keys(usable).map((k) => usable[k].label + '/' + usable[k].model).join('、'));
  console.log('知识点白名单：' + whitelist.length + ' 个叶子节点\n');

  const img = prepareImage(args[0]);
  const hint = process.env.VLM_HINT || '';
  const courseHint = process.env.VLM_COURSE || '';

  const results = [];
  for (const name of Object.keys(usable)) {
    const cfg = usable[name];
    process.stdout.write('  跑 ' + cfg.label + ' (' + cfg.model + ') ... ');
    /* eslint-disable no-await-in-loop */
    const r = await callOne(name, cfg, img.base64, whitelist, courseHint, hint);
    results.push(r);
    if (r.ok) {
      console.log('✓ ' + (r.ms / 1000).toFixed(1) + 's，' + r.health.count + ' 道题');
    } else {
      console.log('✗ ' + r.error);
      // 解析类失败必须把原始输出亮出来 —— 否则用户只会看到「没有报告」，
      // 而真正的原因（模型说了句废话、或输出被截断）全被吞掉了。
      if (r.rawTail) {
        console.log('     模型实际返回的开头：');
        console.log('     ' + String(r.rawTail).replace(/\n/g, '\n     ').slice(0, 500));
      }
    }
  }

  // 控制台汇总
  console.log('\n' + '='.repeat(72));
  console.log('汇总（详细对照见 HTML 报告）');
  console.log('='.repeat(72));
  console.log(pad('模型', 26) + pad('耗时', 9) + pad('题数', 6) + pad('字数', 8) + '体检');
  console.log('-'.repeat(72));
  results.forEach((r) => {
    if (!r.ok) {
      console.log(pad(r.label, 26) + pad((r.ms / 1000).toFixed(1) + 's', 9) + pad('-', 6) + pad('-', 8) + '失败：' + r.error);
      return;
    }
    const w = [];
    if (r.health.noStem) w.push('题干缺' + r.health.noStem);
    if (r.health.noAnswer) w.push('解答缺' + r.health.noAnswer);
    if (r.health.noComment) w.push('批语缺' + r.health.noComment);
    if (r.health.boxes) w.push('□×' + r.health.boxes);
    console.log(pad(r.label, 26) + pad((r.ms / 1000).toFixed(1) + 's', 9)
      + pad(String(r.health.count), 6) + pad(String(r.health.chars), 8)
      + (w.length ? w.join(' ') : '无缺漏'));
  });
  console.log('='.repeat(72));

  const d = new Date();
  const stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, stamp + '.html');
  fs.writeFileSync(htmlPath, buildHtml({
    title: d.toLocaleString('zh-CN'),
    at: d.toLocaleString('zh-CN'),
    imgName: path.basename(args[0]),
    results: results
  }), 'utf8');

  console.log('\n报告：' + htmlPath);
  console.log('（各模型按题号并排对照；黄色 = 模型没提取到，橙色 = 有字没认出来）');
  console.log('\n怎么读这份报告：');
  console.log('  ① 先看「教师批语」那一栏 —— 分不清红笔和正文的模型，这一栏会空或者混进题干');
  console.log('  ② 再看题干里的数学符号有没有还原（ε δ ∑ √ 分数）');
  console.log('  ③ 最后看「□」的数量，那是它没认出来的字');

  openInBrowser(htmlPath);
}

/**
 * 跑完直接用系统默认浏览器打开报告。
 *
 * 为什么加这一步：脚本是从 .cmd 双击/拖放启动的，那种场景下用户根本没在看终端，
 * 只打印一句「报告在 xxx」等于没说 —— 他还得自己去翻 vlm-compare 目录。
 * 打不开（比如跑在无桌面的环境里）也无所谓，静默失败就行，别把脚本搞崩。
 */
function openInBrowser(filePath) {
  if (process.argv.indexOf('--no-open') >= 0) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('explorer', [filePath], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execFileSync('open', [filePath], { stdio: 'ignore' });
    } else {
      execFileSync('xdg-open', [filePath], { stdio: 'ignore' });
    }
    console.log('\n已用默认浏览器打开报告。');
  } catch (e) {
    console.log('\n（自动打开浏览器没成功，手动打开上面那个路径就行）');
  }
}

const pad2 = (n) => (n < 10 ? '0' : '') + n;

/** 中文按两个字符宽对齐，否则控制台表格会歪 */
function pad(s, len) {
  s = String(s);
  let w = 0;
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 2 : 1;
  return s + ' '.repeat(Math.max(1, len - w));
}

main().catch((e) => {
  console.error('\n脚本出错：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
