/**
 * 数据层：本地存储 + 错题状态机
 *
 * 存储策略：全部走 wx.setStorageSync（本地）。个人自用不需要后端，
 * 换手机时用「导出 JSON → 新机导入」迁移。
 *
 * 状态机（顺序即产品逻辑，不要随意打乱）：
 *
 *   记录「我错了」 → 分析「为什么错」 → 训练「怎么练」
 *
 *   new ──提交订正──▶ analyzed ──开始训练──▶ training ──连对2次──▶ mastered
 *                                                              │
 *                                                    训练答错 └──▶ training
 *
 * 关键约束：analysis（错因与分析）必须在用户**提交了自己的订正过程**之后才解锁。
 * 这是这个品类能不能站住的关键——顺序反了，它就从「订正工具」变成了「拍题出答案」。
 */

const seed = require('../data/seed.js');
const cause = require('./cause.js');
const srs = require('./srs.js');

const KEY_LIST = 'mz.mistakes.v1';
const KEY_META = 'mz.meta.v1';

/* ---------------- 平台适配（Node 下跑测试用内存存储） ---------------- */
const P = (function () {
  if (typeof wx !== 'undefined' && wx && wx.setStorageSync) return wx;
  const mem = {};
  return {
    getStorageSync: (k) => (mem[k] === undefined ? '' : mem[k]),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; }
  };
})();

/* ---------------- 基础读写 ---------------- */
function readList() {
  const v = P.getStorageSync(KEY_LIST);
  return Array.isArray(v) ? v : [];
}
function writeList(list) {
  P.setStorageSync(KEY_LIST, list);
}
function readMeta() {
  const v = P.getStorageSync(KEY_META);
  return v && typeof v === 'object' ? v : {};
}
function writeMeta(m) {
  P.setStorageSync(KEY_META, m);
}

/* ---------------- 状态机 ---------------- */
const STATUS_TEXT = {
  new: { label: '待订正', cls: 'st-new' },
  analyzed: { label: '已分析', cls: 'st-analyzed' },
  training: { label: '巩固中', cls: 'st-training' },
  mastered: { label: '已掌握', cls: 'st-mastered' }
};

function recomputeStatus(m) {
  if (!m.correction) return 'new';
  if (srs.isMastered(m.srs)) return 'mastered';
  if (m.srs && m.srs.reps > 0) return 'training';
  return 'analyzed';
}

/**
 * 疑惑点类型白名单。
 * 背景：老师用 AI 判卷，批语本身可能出错（比如把手写 σ 认成 6 再批「符号错误」）。
 * 疑惑点 = 学生对批语的异议记录，与订正（correction）完全独立：
 * 它不影响状态机、不触发解锁，纯粹是「我对这条批语存疑」的标注。
 */
const DOUBT_TAGS = {
  ai_misjudge: { label: 'AI 批语判错', hint: '批语说我错，但我认为没错' },
  symbol: { label: '符号被认错', hint: '如手写 σ 被认成 6' },
  unclear: { label: '批语看不懂', hint: '不知道 AI 在说什么' },
  other: { label: '其他疑惑', hint: '自己写清楚' }
};

function decorate(m) {
  const out = Object.assign({}, m);
  out.statusText = (STATUS_TEXT[out.status] || STATUS_TEXT.new).label;
  out.statusCls = (STATUS_TEXT[out.status] || STATUS_TEXT.new).cls;
  out.unlocked = !!out.correction;             // 订正后才解锁解析
  out.ratio = (typeof out.score === 'number' && out.fullScore) ? out.score / out.fullScore : null;
  out.dueText = srs.dueText(out.srs);
  out.isDue = srs.isDue(out.srs);
  out.kpNames = (out.kp || []).map((id) => kpName(id));
  out.doubtCount = (Array.isArray(out.doubts) ? out.doubts : []).length;
  return out;
}

let _kp = null;
function kpName(id) {
  if (!_kp) { try { _kp = require('./kp.js'); } catch (e) { _kp = null; } }
  return _kp ? _kp.nameOf(id) : id;
}

/* ---------------- 种子导入 ---------------- */
/**
 * 把作业里的题目转成错题条目。
 *
 * 默认只收「未满分（或有批语）」的题 —— 种子数据都批改过，这样能得到一份干净的错题本。
 *
 * 但 `assign.importAll` 为真时**全量收录**：把这一份作业的每道题都搬进来。
 * 什么时候用：学习通上有大量作业压根没有教师批语（没有得分、没有判词），
 * 按「只收错题」的规则会把整份作业判定成 0 道可导入 —— 可用户明明想先把题目
 * 搬进小程序，自己写着看。抓取脚本的「全量搬运」产物就带这个标记。
 */
function questionsToMistakes(assign) {
  const out = [];
  const all = !!assign.importAll;
  (assign.questions || []).forEach((q) => {
    const graded = q.verdict === 'partial' || q.verdict === 'wrong' ||
      (typeof q.score === 'number' && q.score < q.fullScore);
    if (!all && !graded) return;
    out.push({
      id: 'm_' + assign.id + '_q' + q.no,
      asId: assign.id,
      courseId: assign.courseId,
      courseName: courseNameOf(assign.courseId),
      assignTitle: assign.title,
      no: q.no,
      type: q.type,
      gist: q.gist,
      score: q.score,
      fullScore: q.fullScore,
      stem: q.stem,
      stemText: q.stemText,
      myAnswer: q.myAnswer,
      rightAnswer: q.rightAnswer,
      comment: q.comment,
      kp: q.kp || [],
      flaws: q.flaws || [],
      verdict: q.verdict,
      analysisNote: q.analysisNote || '',
      doubts: [],
      status: 'new',
      correction: null,
      analysis: null,
      srs: srs.fresh(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  });
  return out;
}

function courseNameOf(id) {
  const c = (seed.courses || []).find((x) => x.id === id);
  if (c) return c.name;
  if (!_kp) { try { _kp = require('./kp.js'); } catch (e) { _kp = null; } }
  return _kp ? (_kp.FLAT[id] ? _kp.FLAT[id].name : '') : '';
}

/** 首次运行（或种子升级）时导入；已存在的条目保留用户进展，只补数据字段 */
function ensureInit(force) {
  const meta = readMeta();
  const list = readList();
  const need = force || !list.length || meta.seedVersion !== seed.version;
  if (!need) return { imported: 0, total: list.length };

  const incoming = [];
  (seed.assignments || []).forEach((a) => {
    incoming.push.apply(incoming, questionsToMistakes(a));
  });

  const byId = {};
  list.forEach((m) => { byId[m.id] = m; });

  let imported = 0;
  incoming.forEach((nm) => {
    const old = byId[nm.id];
    if (old) {
      // 保留用户的订正/分析/复习进展，只更新题目内容
      nm.correction = old.correction;
      nm.analysis = old.analysis;
      nm.srs = old.srs || nm.srs;
      nm.doubts = old.doubts || [];      // 疑惑点是用户标的，种子升级不丢
      nm.status = recomputeStatus(nm);
      nm.createdAt = old.createdAt || nm.createdAt;
    } else {
      imported += 1;
    }
    byId[nm.id] = nm;
  });

  const merged = Object.keys(byId).map((k) => byId[k]);
  writeList(merged);
  writeMeta(Object.assign({}, meta, {
    seedVersion: seed.version,
    initializedAt: meta.initializedAt || Date.now()
  }));
  return { imported: imported, total: merged.length };
}

/* ---------------- 查询 ---------------- */
function all() {
  return readList().map(decorate);
}

function get(id) {
  const m = readList().find((x) => x.id === id);
  return m ? decorate(m) : null;
}

/**
 * @param {object} opt {status, course, kp, keyword, onlyDue}
 */
function query(opt) {
  opt = opt || {};
  let list = all();
  if (opt.status && opt.status !== 'all') list = list.filter((m) => m.status === opt.status);
  if (opt.course) list = list.filter((m) => m.courseId === opt.course);
  if (opt.kp) list = list.filter((m) => (m.kp || []).indexOf(opt.kp) >= 0);
  if (opt.onlyDue) list = list.filter((m) => m.isDue);
  if (opt.keyword) {
    const k = String(opt.keyword).toLowerCase();
    list = list.filter((m) =>
      (m.gist || '').toLowerCase().indexOf(k) >= 0 ||
      (m.stemText || '').toLowerCase().indexOf(k) >= 0 ||
      (m.assignTitle || '').toLowerCase().indexOf(k) >= 0 ||
      m.kpNames.join(' ').toLowerCase().indexOf(k) >= 0);
  }
  // 低分优先、然后按题号
  list.sort((a, b) => (a.ratio === null ? 9 : a.ratio) - (b.ratio === null ? 9 : b.ratio) || a.no - b.no);
  return list;
}

/* ---------------- 写入 ---------------- */
function update(id, patch) {
  const list = readList();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const m = Object.assign({}, list[i], patch);
  m.status = recomputeStatus(m);
  m.updatedAt = Date.now();
  list[i] = m;
  writeList(list);
  return decorate(m);
}

/**
 * 提交订正过程 —— 这一步是「解锁解析」的闸门
 * @param {string} id
 * @param {{text:string, photos:string[]}} payload
 */
function submitCorrection(id, payload) {
  const text = ((payload && payload.text) || '').trim();
  const photos = (payload && payload.photos) || [];
  if (!text && !photos.length) {
    return { ok: false, msg: '订正内容不能为空：写几句你错在哪、正确该怎么走，或拍一张订正稿。' };
  }
  const m = get(id);
  if (!m) return { ok: false, msg: '找不到这道题' };

  const correction = { text: text, photos: photos, submittedAt: Date.now() };
  const analysis = m.analysis || analyzeItem(Object.assign({}, m, { correction: correction }));
  const saved = update(id, { correction: correction, analysis: analysis });
  return { ok: true, item: saved, analysis: analysis };
}

/** 生成错因分析（优先用人工标注，其次规则引擎） */
function analyzeItem(m) {
  const r = cause.analyze({
    score: m.score,
    fullScore: m.fullScore,
    comment: m.comment,
    flaws: m.flaws,
    kp: m.kp
  });
  return { causes: r.causes, advice: r.advice, source: r.source, at: Date.now() };
}

/** 重新分析（例如用户改了知识点之后） */
function reanalyze(id) {
  const m = get(id);
  if (!m) return null;
  const analysis = analyzeItem(m);
  return update(id, { analysis: analysis });
}

/** 人工改判错因 */
function setCauses(id, causes) {
  const m = get(id);
  if (!m) return null;
  const analysis = Object.assign({}, m.analysis || {}, {
    causes: causes,
    advice: cause.adviceFor(causes, m.kp),
    source: 'manual',
    at: Date.now()
  });
  return update(id, { analysis: analysis });
}

/** 调整知识点 */
function setKp(id, kpIds) {
  const m = get(id);
  if (!m) return null;
  const next = update(id, { kp: kpIds });
  return reanalyze(id) || next;
}

/**
 * 整组写入疑惑点。
 *
 * ⚠️ 疑惑点与解锁闸门无关：不改 correction、不改 analysis、不影响 status
 *（recomputeStatus 只看 correction/srs，doubts 天然不参与）。
 * 这条要一直守住 —— 标疑惑是「对批语提异议」，不是「完成订正」。
 *
 * @param {string} id
 * @param {Array<{id?:string, tag:string, text?:string, at?:number}>} doubts
 *        整组传入（UI 层先算好最终数组再调，语义最简单：所见即所存）。
 *        tag 不在 DOUBT_TAGS 白名单里的一律降级为 other —— 与知识点、
 *        错因同一条铁律：不允许自由命名污染统计。
 */
function setDoubts(id, doubts) {
  const m = get(id);
  if (!m) return null;
  const now = Date.now();
  const clean = (Array.isArray(doubts) ? doubts : []).slice(0, 20).map((d, i) => ({
    id: (d && d.id) ? String(d.id) : 'd' + now + '_' + i,
    tag: (d && DOUBT_TAGS[d.tag]) ? d.tag : 'other',
    text: String((d && d.text) || '').trim().slice(0, 300),
    at: (d && typeof d.at === 'number' && isFinite(d.at)) ? d.at : now
  }));
  return update(id, { doubts: clean });
}

/** 记录一次训练结果，推进状态机与复习排程 */
function recordDrill(id, pass) {
  const m = get(id);
  if (!m) return null;
  const nextSrs = srs.next(m.srs, !!pass, Date.now());
  return update(id, { srs: nextSrs });
}

/* ---------------- 统计 ---------------- */
function stats() {
  const list = all();
  const byStatus = { new: 0, analyzed: 0, training: 0, mastered: 0 };
  list.forEach((m) => { byStatus[m.status] = (byStatus[m.status] || 0) + 1; });

  const allCauses = [];
  list.forEach((m) => {
    if (m.analysis && m.analysis.causes) allCauses.push.apply(allCauses, m.analysis.causes);
  });

  const kpMap = {};
  list.forEach((m) => {
    (m.kp || []).forEach((k) => {
      if (!kpMap[k]) kpMap[k] = { id: k, name: kpName(k), total: 0, mastered: 0, lost: 0 };
      kpMap[k].total += 1;
      if (m.status === 'mastered') kpMap[k].mastered += 1;
      kpMap[k].lost += (m.fullScore || 20) - (typeof m.score === 'number' ? m.score : 0);
    });
  });

  const kpStats = Object.keys(kpMap).map((k) => {
    const x = kpMap[k];
    return {
      id: x.id, name: x.name, total: x.total, mastered: x.mastered, lost: x.lost,
      rate: x.total ? Math.round(x.mastered / x.total * 100) : 0
    };
  }).sort((a, b) => b.lost - a.lost);

  const due = list.filter((m) => m.isDue && m.status !== 'mastered').length;
  const totalLost = list.reduce((s, m) => s + ((m.fullScore || 20) - (typeof m.score === 'number' ? m.score : 0)), 0);
  const avgRatio = list.length
    ? list.reduce((s, m) => s + (m.ratio === null ? 0 : m.ratio), 0) / list.length
    : 0;

  return {
    total: list.length,
    byStatus: byStatus,
    due: due,
    totalLost: totalLost,
    avgRatio: avgRatio,
    causes: cause.distribution(allCauses),
    kpStats: kpStats
  };
}

/* ---------------- 导入 / 导出 ---------------- */
/** 导入一份作业 JSON（格式与 seed 的 assignments[i] 一致） */
function importAssignment(assign) {
  if (!assign || !assign.questions) return { ok: false, msg: '数据里没有 questions 字段' };
  const list = readList();
  const byId = {};
  list.forEach((m) => { byId[m.id] = m; });

  const id = assign.id || ('as_' + Date.now());
  const incoming = questionsToMistakes(Object.assign({}, assign, { id: id }));
  let added = 0, skipped = 0;
  incoming.forEach((nm) => {
    if (byId[nm.id]) { skipped += 1; return; }
    byId[nm.id] = nm;
    added += 1;
  });
  writeList(Object.keys(byId).map((k) => byId[k]));
  return { ok: true, added: added, skipped: skipped, total: Object.keys(byId).length };
}

/** 手动录入一道错题 */
function addManual(item) {
  const list = readList();
  const id = 'm_manual_' + Date.now();
  const photos = (item.myArt || []).filter(Boolean);
  const m = {
    id: id,
    asId: 'manual',
    courseId: item.courseId || 'c_math',
    courseName: courseNameOf(item.courseId || 'c_math'),
    assignTitle: item.assignTitle || '手动录入',
    no: list.filter((x) => x.asId === 'manual').length + 1,
    type: item.type || '解答题',
    gist: item.gist || '',
    score: typeof item.score === 'number' ? item.score : null,
    fullScore: item.fullScore || 20,
    stem: item.stem || [],
    stemText: item.stemText || '',
    myAnswer: {
      nodes: photos.map((s) => ({ t: 'i', s: s, w: 620, h: 0, p: 1 })),
      text: '',
      photo: photos.length > 0
    },
    rightAnswer: { nodes: [], text: item.rightText || '' },
    comment: { nodes: [], text: item.commentText || '' },
    kp: item.kp || [],
    flaws: [],
    verdict: 'unknown',
    analysisNote: '',
    doubts: [],
    status: 'new',
    correction: null,
    analysis: null,
    srs: srs.fresh(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  list.push(m);
  writeList(list);
  return decorate(m);
}

/* ---------------- 拍照录入 ---------------- */

/** 文字 → 富文本节点数组 */
function textNodes(text) {
  const t = String(text || '').trim();
  return t ? [{ t: 't', v: t }] : [];
}

/**
 * 批量写入「拍照录入」的错题。
 *
 * 同一张照片走两条路都到这里：
 *   识别成功 → 题干是识别出的文字，原图另存到 origin，随时能对照
 *   没识别 / 不识别 → 题干就是那张照片本身
 *
 * ⚠️ 这些题一律以 status='new' + correction=null 落库。
 *    「先订正、才解锁分析」那道闸门在 submitCorrection 里，这里绝不能绕过 ——
 *    拍照只是把题目搬进来的方式变了，不该改变产品顺序。
 *
 * @param {Array} items 每项 {no,type,gist,stemText,myAnswerText,rightText,commentText,score,fullScore,kp,photo,confidence}
 * @param {{assignTitle?:string, courseId?:string}} opts
 */
function addRecognized(items, opts) {
  const list = readList();
  opts = opts || {};
  const assignTitle = opts.assignTitle || '拍照录入';
  let seq = list.filter((x) => x.asId === 'photo').length;
  const created = [];

  (items || []).forEach((it) => {
    if (!it) return;
    seq += 1;

    const photo = it.photo || '';
    const stemText = String(it.stemText || '').trim();
    const myText = String(it.myAnswerText || '').trim();
    const rightText = String(it.rightText || '').trim();
    const commentText = String(it.commentText || '').trim();
    const kpIds = (it.kp || []).slice();

    // 题干：识别出文字就用文字；没有文字就退化成那张照片
    /*
     * 题干就是题干 —— **没识别出文字就留空，不要拿图去顶**。
     *
     * 这里原来写的是「有照片就把照片塞进 stem」（图当题干）。后果：
     * 纯搬运入库的题，图会出现在**题目栏**里 —— 用户明确要求过图放原图栏、
     * 别占题目栏（他反复说「题目栏还是原图」就是这个）。
     * 图始终存在 photo（-> origin.photo），详情页的「原始照片」栏负责展示它，
     * 而且没有题干时会**自动展开**，不会藏起来。
     */
    const stem = stemText ? textNodes(stemText) : [];

    const courseId = it.courseId || opts.courseId
      || (kpIds.length ? courseOfKp(kpIds[0]) : 'c_math');

    const m = {
      id: 'm_photo_' + Date.now() + '_' + seq,
      asId: 'photo',
      source: 'photo',
      courseId: courseId,
      courseName: courseNameOf(courseId),
      assignTitle: assignTitle,
      no: (typeof it.no === 'number' && it.no > 0) ? it.no : seq,
      type: it.type || '解答题',
      gist: String(it.gist || '').trim(),
      score: (typeof it.score === 'number' && isFinite(it.score)) ? it.score : null,
      fullScore: (typeof it.fullScore === 'number' && it.fullScore > 0) ? it.fullScore : 20,
      stem: stem,
      stemText: stemText,
      myAnswer: {
        nodes: textNodes(myText),
        text: myText,
        photo: false
      },
      rightAnswer: { nodes: textNodes(rightText), text: rightText },
      comment: { nodes: textNodes(commentText), text: commentText },
      kp: kpIds,
      flaws: [],
      verdict: 'unknown',
      analysisNote: '',
      confidence: it.confidence || 'medium',
      doubts: [],
      // 原始照片单独存：识别可能有误，必须能随时对照原件
      origin: photo ? { photo: photo } : null,
      status: 'new',
      correction: null,
      analysis: null,
      srs: srs.fresh(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    list.push(m);
    created.push(decorate(m));
  });

  writeList(list);
  return { added: created.length, items: created };
}

/** 由知识点 id 反查它属于哪门课（知识点树的第一层就是课程） */
function courseOfKp(kpId) {
  if (!_kp) { try { _kp = require('./kp.js'); } catch (e) { _kp = null; } }
  if (!_kp) return 'c_math';
  const one = _kp.FLAT[kpId];
  if (!one || !one.path || !one.path.length) return 'c_math';
  const c = (seed.courses || []).find((x) => x.name === one.path[0]);
  return c ? c.id : 'c_math';
}

function exportJson() {
  return JSON.stringify({ list: readList(), meta: readMeta(), at: Date.now() }, null, 2);
}

function importFullJson(jsonText) {
  let data;
  try { data = JSON.parse(jsonText); } catch (e) { return { ok: false, msg: 'JSON 解析失败：' + e.message }; }
  if (!data || !Array.isArray(data.list)) return { ok: false, msg: '不是本小程序导出的备份（缺少 list）' };
  writeList(data.list);
  if (data.meta) writeMeta(data.meta);
  return { ok: true, total: data.list.length };
}

function resetAll() {
  P.removeStorageSync(KEY_LIST);
  P.removeStorageSync(KEY_META);
  return ensureInit(true);
}

module.exports = {
  STATUS_TEXT,
  DOUBT_TAGS,
  ensureInit, all, get, query, update,
  submitCorrection, analyzeItem, reanalyze, setCauses, setKp, setDoubts, recordDrill,
  stats, importAssignment, addManual, addRecognized, exportJson, importFullJson, resetAll,
  textNodes, courseOfKp,
  recomputeStatus, decorate
};
