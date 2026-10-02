/**
 * 拍照识别 · 客户端封装
 *
 * 链路：拍照/截图 → 阶梯压缩 → 转 base64 → 云函数 recognizeWork → 视觉模型
 *      → 结构化题目 → 规范化 → 交给 store 入库
 *
 * ---------------------------------------------------------------------------
 * 两个必须守住的点
 * ---------------------------------------------------------------------------
 * 1. **callFunction 传参上限约 1MB**。手机原图 base64 后轻松两三兆，直接传必挂。
 *    所以这里做阶梯压缩，一路降到 base64 ≤ 800KB 为止。
 * 2. **认不出就用不了，不能崩**。云开发没开、Key 没配、模型超时 —— 任何一种
 *    都必须能退回「不识别，照片直接当题干」的本地模式。个人自用的小工具，
 *    打不开比功能少严重得多。
 *
 * 依赖注入：纯逻辑（知识点映射、结果规范化、错误文案）全部写成不碰 wx 的函数，
 * 这样 tools/test-logic.js 能在 Node 里直接测。碰 wx 的只有压缩和调用两小块。
 */

const kp = require('./kp.js');

/**
 * 云开发环境 ID。留空 = 关闭云端识别，走本地降级模式。
 * 填法：微信开发者工具 → 云开发 → 环境 → 复制环境 ID（形如 cloud1-xxxxxxxxxxxxxxxx）
 *
 * 也可以运行时调 setEnv('cloud1-xxx') 切换（例如要在测试环境之间来回切）。
 *
 * ⚠️ 这里**故意留空**：环境 ID 属于个人配置，跟着仓库走对谁都没用
 * （你用我的 ID 调不动，我用你的也没意义），而且会泄露作者的环境信息。
 * 要用拍照识别就填自己的 —— 见 cloudfunctions/README.md。
 * 留空则关闭云端识别，功能会优雅降级，不影响其他部分。
 */
let CLOUD_ENV = '';

// 环境 ID 从**不进仓库的本地文件**读 —— 它是个人配置，提交上去对别人没用还泄露信息。
// 本地建 miniprogram/utils/cloud-env.local.js，写一行：module.exports = 'cloud1-xxxx';
// 没有这个文件就留空 -> 自动降级为「纯搬运」，不会报错。
try {
  /* eslint-disable global-require */
  const local = require('./cloud-env.local.js');
  if (typeof local === 'string' && local) CLOUD_ENV = local;
} catch (e) { /* 没配就是没配，走降级 */ }

/** 运行时切换云开发环境 */
function setEnv(env) {
  CLOUD_ENV = String(env || '');
  _inited = false;
}

/** callFunction 的安全余量，留 200KB 给其余参数 */
const MAX_B64 = 800 * 1024;

/**
 * 阶梯压缩方案：从大到小试，取第一个满足体积的。
 * 1280 宽对「一页作业」够看清小字；640 是保底。
 */
const PLANS = [
  { w: 1280, q: 80 },
  { w: 1000, q: 70 },
  { w: 800, q: 60 },
  { w: 640, q: 50 }
];

/* ==================== 纯逻辑（可测） ==================== */

/** 归一化：去掉空白与各种分隔符号，用于知识点名比对 */
function normName(s) {
  return String(s || '').replace(/[\s　·・\-—_（）()【】[\]]/g, '').toLowerCase();
}

/**
 * 用知识点树建「归一化名 → id」的字典。
 * 只收叶子节点 —— 章节节点不是知识点，选进来会污染掌握度统计。
 */
function buildKpDict(flatOptions) {
  const dict = {};
  (flatOptions || []).forEach((o) => {
    if (o && o.isLeaf) dict[normName(o.name)] = o.id;
  });
  return dict;
}

/** 把模型返回的知识点名映射回预置树里的 id；映射不上的一律丢弃 */
function mapKp(names, dict) {
  const out = [];
  (Array.isArray(names) ? names : []).forEach((n) => {
    const id = dict[normName(n)];
    if (id && out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

/**
 * 把云函数返回的题目规范化成 store 能直接用的形状。
 * 纯函数：不碰 wx、不碰时间戳。
 */
function normalizeQuestion(q, dict, fallbackNo) {
  q = q || {};
  const score = (typeof q.score === 'number' && isFinite(q.score)) ? q.score : null;
  let full = (typeof q.fullScore === 'number' && isFinite(q.fullScore) && q.fullScore > 0)
    ? q.fullScore : null;
  // ⚠️ 这里**不再兜底 20**。曾经写死 20，结果是「null/20」这种跟实际评分体系对不上的值
  // （工科数学分析按 100 分制均分，6 题就是 16.6/题）。
  // 留 null 交给核对页按「本份总分 ÷ 题数」推算，或者用户手填。
  if (score !== null && full !== null && score > full) full = Math.max(full, score);

  const stemText = String(q.stem || '').trim();
  return {
    no: q.no || fallbackNo || 1,
    type: q.type || '解答题',
    gist: String(q.gist || '').trim(),
    stemText: stemText,
    myAnswerText: String(q.myAnswer || '').trim(),
    rightText: String(q.rightAnswer || '').trim(),
    commentText: String(q.comment || '').trim(),
    score: score,
    fullScore: full,
    kp: mapKp(q.kpNames, dict),
    kpNames: Array.isArray(q.kpNames) ? q.kpNames : [],
    // 各栏在原图上的矩形区域（归一化 0~1）。没有就是 null，界面回退到整图。
    boxes: q.boxes || null,
    confidence: q.confidence || 'medium',
    // 三样全空说明这张照片里没提取到能用
    empty: !stemText && !String(q.myAnswer || '').trim() && !String(q.comment || '').trim()
  };
}

/** 批量规范化 */
function normalizeResult(result, dict) {
  const list = (result && Array.isArray(result.questions)) ? result.questions : [];
  return list.map((q, i) => normalizeQuestion(q, dict, i + 1))
    .filter((q) => !q.empty);
}

/** 把云函数的错误码翻成人话 —— 用户看到的每一句都必须是可行动的 */
function friendlyError(res) {
  const code = (res && res.code) || '';
  const map = {
    NO_KEY: '云函数还没配 Key。去云开发控制台 → 云函数 → recognizeWork → 配置 → 环境变量，加一个 VLM_API_KEY。',
    NO_IMAGE: '没拿到图片数据，重拍一张试试。',
    TOO_LARGE: '图片太大了，换张清晰一点但分辨率低些的。',
    NETWORK: '连不上模型服务，检查一下网络，或者稍后再试。',
    UNPARSABLE: '模型返回的内容读不懂，换张更清楚的照片试试。',
    TRUNCATED: '这一页内容太多，模型说到一半被截断了。一次少拍几道题，或把云函数的 VLM_MAX_TOKENS 调大。',
    BAD_RESPONSE: '模型服务返回异常，稍后再试。'
  };
  if (map[code]) return map[code];
  if (code.indexOf('UPSTREAM_401') === 0 || code.indexOf('UPSTREAM_403') === 0) {
    return 'Key 被拒绝了。检查 VLM_API_KEY 有没有填错或已过期。';
  }
  if (code.indexOf('UPSTREAM_429') === 0) {
    return '调用太频繁或额度用完，等一会儿再试。';
  }
  if (code.indexOf('UPSTREAM_') === 0) {
    return '模型服务报错（' + code.replace('UPSTREAM_', 'HTTP ') + '），稍后再试。';
  }
  return (res && res.msg) || '识别失败，原因不明。';
}

/* ==================== 云端可用性 ==================== */

function hasWx() {
  return typeof wx !== 'undefined' && wx && wx.cloud;
}

/** 云开发是否可用（用户填了环境 ID 且运行环境支持） */
function isReady() {
  return !!(CLOUD_ENV && hasWx());
}

let _inited = false;
function ensureInit() {
  if (!isReady()) return false;
  if (_inited) return true;
  try {
    wx.cloud.init({ env: CLOUD_ENV, traceUser: false });
    _inited = true;
  } catch (e) {
    _inited = false;
  }
  return _inited;
}

/* ==================== 图片处理（碰 wx） ==================== */

function compressOnce(src, w, q) {
  return new Promise((resolve) => {
    if (!wx.compressImage) return resolve(src);
    wx.compressImage({
      src: src,
      quality: q,
      compressedWidth: w,          // 只给宽，高按比例自动缩放
      success: (r) => resolve(r.tempFilePath || src),
      // 老基础库不认 compressedWidth 时，退回原图继续走
      fail: () => resolve(src)
    });
  });
}

function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'base64',
      success: (r) => resolve(r.data),
      fail: (e) => reject(new Error('读取图片失败：' + (e && e.errMsg ? e.errMsg : '')))
    });
  });
}

/**
 * 阶梯压缩，返回满足体积上限的 base64。
 * 从最大的方案往下试，第一个过线的就用。
 */
async function compressToBase64(filePath) {
  let best = null;
  for (let i = 0; i < PLANS.length; i++) {
    const p = PLANS[i];
    /* eslint-disable no-await-in-loop */
    const tmp = await compressOnce(filePath, p.w, p.q);
    const b64 = await readBase64(tmp);
    if (best === null || b64.length < best.length) best = b64;
    if (b64.length <= MAX_B64) return { ok: true, base64: b64, plan: p };
  }
  return { ok: false, base64: best, msg: '这张图压到最小还是太大，换个角度重拍，或者只截题目那部分。' };
}

/* ==================== 对外主流程 ==================== */

/**
 * 识别一张照片。
 * @param {string} filePath 本地图片路径
 * @param {{kpNames:string[], courseHint:string, hint:string, symbolNotes:string, dict:object}} opts
 *   symbolNotes —— 手写符号对照（data/symbols.js 的 PROMPT_NOTES），可选。
 *   传了云函数会注入提示词，让模型按上下文取标准符号而不是照抄手写形状。
 * @returns {Promise<{ok:boolean, questions?:Array, msg?:string}>}
 */
function recognize(filePath, opts) {
  opts = opts || {};
  if (!isReady()) {
    return Promise.resolve({
      ok: false,
      code: 'NO_CLOUD',
      msg: '还没开通云开发，识别用不了。可以先用「不识别，直接入库」把照片存进来。'
    });
  }
  if (!ensureInit()) {
    return Promise.resolve({ ok: false, code: 'NO_CLOUD', msg: '云开发初始化失败，检查环境 ID 填对没有。' });
  }

  return compressToBase64(filePath).then((c) => {
    if (!c.ok) return { ok: false, code: 'TOO_LARGE', msg: c.msg };
    return wx.cloud.callFunction({
      name: 'recognizeWork',
      data: {
        image: c.base64,
        kpNames: opts.kpNames || [],
        courseHint: opts.courseHint || '',
        hint: opts.hint || '',
        symbolNotes: opts.symbolNotes || ''
      }
    }).then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) return { ok: false, code: r.code, msg: friendlyError(r) };
      const questions = normalizeResult(r, opts.dict || {});
      if (!questions.length) {
        return { ok: false, code: 'EMPTY', msg: '这张照片里没提取到题目。可能拍糊了、没对准，或者整页都是空白/批改痕迹。' };
      }
      return { ok: true, questions: questions, model: r.model };
    });
  }).catch((err) => {
    const m = (err && err.errMsg) || (err && err.message) || '';
    if (m.indexOf('FunctionName') >= 0 || m.indexOf('not found') >= 0) {
      return { ok: false, code: 'NO_FUNC', msg: '云函数 recognizeWork 还没部署。在开发者工具里右键它 → 上传并部署。' };
    }
    return { ok: false, code: 'UNKNOWN', msg: '识别失败：' + (m || '未知原因') };
  });
}

module.exports = {
  MAX_B64,
  PLANS,
  setEnv,
  isReady,
  ensureInit,
  recognize,
  compressToBase64,
  // 纯逻辑，供测试
  normName,
  buildKpDict,
  mapKp,
  normalizeQuestion,
  normalizeResult,
  friendlyError
};
