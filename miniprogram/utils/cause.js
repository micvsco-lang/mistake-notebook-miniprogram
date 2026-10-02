/**
 * 错因体系与规则分析引擎
 *
 * 说明：个人自用版不依赖任何后端。这里用「批语关键词 + 得分特征」的规则引擎做错因归类，
 * 结果是**候选 + 置信度**，用户可以在详情页一键改判（改判结果会回写到数据里，
 * 以后接云函数做 AI 分析时，这些人工改判正好是校准样本）。
 */

/** 错因代码表 */
const CAUSES = {
  C1: {
    code: 'C1',
    name: '概念理解偏差',
    short: '概念不清',
    desc: '对定义、定理本身的理解有误，用错了对象或范围。',
    symptom: '结论方向就错了，或把两个相近概念混用。',
    remedy: '回到定义原文，逐字抄写一遍，再自己举一个正例和一个反例。'
  },
  C2: {
    code: 'C2',
    name: '证明结构不完整',
    short: '缺关键步骤',
    desc: '漏掉了定义要求的某个必要条件，结论虽然对，但论证链断了。',
    symptom: '「只证了是界，没证最小性」「只验了一侧」这类失分。',
    remedy: '把定义拆成编号的检查项，每写一步就打一个勾，缺一项就补。'
  },
  C3: {
    code: 'C3',
    name: '逻辑推理不严谨',
    short: '推理不严',
    desc: '构造量或推导不成立，没能推出矛盾或没构造出所需对象。',
    symptom: '给出了一个「看起来合理」的构造，但代入后推不下去。',
    remedy: '先写出结论的否定命题，再逼出矛盾；构造量必须验证它真的落在范围内。'
  },
  C4: {
    code: 'C4',
    name: '分类讨论遗漏',
    short: '漏分类',
    desc: '没有覆盖全部情形，只用一种情况代替了所有情况。',
    symptom: '标准解法要分两种以上情形，你只做了一种。',
    remedy: '动笔前先问：参数可能落在哪几个区间？逐个列出再分别处理。'
  },
  C5: {
    code: 'C5',
    name: '计算与符号错误',
    short: '算错',
    desc: '思路对但运算、代入出错。',
    symptom: '步骤方向正确，结果是错的。',
    remedy: '把关键式子单独抄一行再代入，回代验算一次。'
  },
  C6: {
    code: 'C6',
    name: '表述与书写不规范',
    short: '书写问题',
    desc: '符号写错、笔误、表述不到位，影响论证的清晰度。',
    symptom: '∈ 写成 6、上下标漏写、量词没写全。',
    remedy: '写完后逐行读一遍，专门检查符号与量词，再补上交待清楚的过渡句。'
  },
  C7: {
    code: 'C7',
    name: '审题偏差',
    short: '看错题',
    desc: '答非所问，或误读了题目条件／要求。',
    symptom: '要求证明却只做了计算，或漏看了关键条件。',
    remedy: '读题时把「证明/计算」「是否存在」等动词圈出来，先复述一遍题目要求。'
  }
};

const ALL_CODES = Object.keys(CAUSES);

/** 关键词 → 错因代码，按特异性从高到低匹配 */
const RULES = [
  { code: 'C4', kw: ['分类讨论', '分情况', '两种情况', '未讨论', '缺少讨论', '分 M', '按 M'] },
  { code: 'C6', kw: ['书写', '笔误', '不规范', '符号写', '表述不', '交待不清', '不够清晰', '漏写'] },
  { code: 'C3', kw: ['不严谨', '逻辑不', '矛盾', '不成立', '推不下去', '无法推出', '未完成', '没有完成', '构造的'] },
  { code: 'C2', kw: ['不完整', '缺少', '没有完整', '未结合', '不够充分', '仅说明', '只说明', '只验证'] },
  { code: 'C5', kw: ['计算错', '算错', '代入错', '运算'] },
  { code: 'C7', kw: ['审题', '看错题', '答非所问', '误解题意', '要求是'] },
  { code: 'C1', kw: ['概念', '定义理解', '混淆', '不理解'] }
];

/**
 * 分析一道题
 * @param {object} q 题目（含 score/fullScore/comment.text 或 nodes/flaws/kp）
 * @returns {{causes:Array, advice:string, source:string}}
 */
function analyze(q) {
  const score = typeof q.score === 'number' ? q.score : null;
  const full = typeof q.fullScore === 'number' && q.fullScore > 0 ? q.fullScore : 20;
  const ratio = score === null ? null : score / full;

  // 1) 如果已经带了人工标注的错因（种子数据），直接用
  if (q.flaws && q.flaws.length) {
    const causes = q.flaws.map((f) => ({
      code: f.code,
      detail: f.detail,
      confidence: 1,
      evidence: '教师批语'
    }));
    return { causes, advice: adviceFor(causes, q.kp), source: 'annotation' };
  }

  // 2) 满分 → 无错因
  if (ratio !== null && ratio >= 1) {
    return { causes: [], advice: '这道题拿到了满分，把它放进巩固训练保持手感即可。', source: 'rule' };
  }

  // 3) 规则匹配批语
  const text = commentPlainText(q);
  const hits = [];
  RULES.forEach((r) => {
    const kws = r.kw.filter((k) => text.indexOf(k) >= 0);
    if (kws.length) {
      hits.push({
        code: r.code,
        detail: excerpt(text, kws[0]),
        confidence: Math.min(0.9, 0.55 + kws.length * 0.15),
        evidence: '批语关键词：' + kws.join('、')
      });
    }
  });

  // 4) 批语没给出线索时，退回得分特征
  if (!hits.length) {
    if (ratio !== null && ratio < 0.4) {
      hits.push({
        code: 'C1',
        detail: '失分超过六成，通常是概念或方法层面没抓住，建议先回到定义。',
        confidence: 0.4,
        evidence: '得分率偏低推测'
      });
    } else if (ratio !== null) {
      hits.push({
        code: 'C2',
        detail: '方向基本正确但过程有缺漏，重点检查是否漏掉了定义的某个必要条件。',
        confidence: 0.4,
        evidence: '得分特征推测'
      });
    }
  }

  // 去重 + 按置信度排序，最多 3 条
  const seen = {};
  const causes = hits
    .filter((h) => (seen[h.code] ? false : (seen[h.code] = 1)))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  return { causes, advice: adviceFor(causes, q.kp), source: 'rule' };
}

function commentPlainText(q) {
  if (!q) return '';
  if (q.comment) {
    if (typeof q.comment === 'string') return q.comment;
    if (q.comment.text) return String(q.comment.text);
    if (q.comment.nodes) {
      return q.comment.nodes.filter((n) => n.t === 't').map((n) => n.v).join(' ');
    }
  }
  return String(q.commentText || '');
}

function excerpt(text, kw) {
  const i = text.indexOf(kw);
  if (i < 0) return text.slice(0, 60);
  const s = Math.max(0, i - 24);
  return (s > 0 ? '…' : '') + text.slice(s, Math.min(text.length, i + 56)) + '…';
}

/** 根据错因 + 知识点生成补救建议 */
function adviceFor(causes, kpIds) {
  if (!causes || !causes.length) return '这道题没有明显的错因，保持即可。';
  const main = CAUSES[causes[0].code];
  const lines = [];
  lines.push('主要问题：' + (main ? main.name : causes[0].code));
  if (main) lines.push(main.remedy);
  const extra = causes.slice(1).map((c) => (CAUSES[c.code] ? CAUSES[c.code].name : c.code));
  if (extra.length) lines.push('同时注意：' + extra.join('、') + '。');
  const kpText = (kpIds || []).map((id) => kvName(id)).filter(Boolean);
  if (kpText.length) lines.push('相关知识点：' + kpText.join('、') + '。建议先在巩固训练里刷完这个点的题，再回来重做原题。');
  return lines.join('\n');
}

// 避免与 kp.js 循环依赖，这里做一次延迟加载
let _kp = null;
function kvName(id) {
  if (!_kp) {
    try { _kp = require('./kp.js'); } catch (e) { _kp = null; }
  }
  return _kp ? _kp.nameOf(id) : id;
}

/** 错因分布统计：入参为错因条目数组 */
function distribution(items) {
  const map = {};
  ALL_CODES.forEach((c) => { map[c] = 0; });
  (items || []).forEach((it) => {
    if (it && map[it.code] !== undefined) map[it.code] += 1;
  });
  return ALL_CODES
    .map((c) => ({ code: c, name: CAUSES[c].name, short: CAUSES[c].short, count: map[c] }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

module.exports = { CAUSES, ALL_CODES, RULES, analyze, adviceFor, distribution, commentPlainText };
