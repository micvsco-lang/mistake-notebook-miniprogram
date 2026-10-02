/** 通用格式化与判分辅助 */

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/** 时间戳 → 2026-09-23 */
function date(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 时间戳 → 09-23 21:05 */
function dateTime(ts) {
  const d = new Date(ts || Date.now());
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 相对时间 */
function fromNow(ts, now) {
  if (!ts) return '';
  const t = now || Date.now();
  const diff = t - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' 天前';
  return date(ts);
}

/** 得分率 → 文本 */
function scoreText(score, full) {
  if (typeof score !== 'number') return '未批改';
  return score + ' / ' + (full || 20);
}

/** 得分率 → 色档 */
function scoreLevel(score, full) {
  if (typeof score !== 'number') return 'none';
  const r = score / (full || 20);
  if (r >= 1) return 'good';
  if (r >= 0.8) return 'mild';
  if (r >= 0.5) return 'mid';
  return 'bad';
}

/**
 * 数学符号归一化表
 *
 * 手机上打不出 ε、下标 ₀ 这类字符，用户只会输入 e、0。
 * 所以判分前把两边都归一：希腊字母转拉丁字母、上下标转数字、特殊符号转等价写法。
 * 这样「x₀ > s − ε」「x0>s-e」「x0 > s - e」都会被认成同一个答案。
 */
const MATH_MAP = {
  'ε': 'e', 'δ': 'd', 'η': 'n', 'θ': 't', 'λ': 'l', 'μ': 'u',
  'ξ': 'x', 'π': 'p', 'ρ': 'r', 'σ': 's', 'φ': 'f', 'ψ': 'y', 'ω': 'w',
  'α': 'a', 'β': 'b', 'γ': 'g', 'τ': 't', 'ν': 'v',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  'ℝ': 'r', 'ℚ': 'q', 'ℕ': 'n', 'ℤ': 'z',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '≡': '='
};

/** 归一化填空题答案：去空白、全角转半角、统一符号写法 */
function normalizeAnswer(s) {
  let v = String(s || '')
    .replace(/\s+/g, '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[−–—]/g, '-')
    .replace(/[，]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .toLowerCase();
  v = v.replace(/[^\x00-\x7f]/g, (c) => (MATH_MAP[c] !== undefined ? MATH_MAP[c] : c));
  return v;
}

/** 填空题判分：命中任一可接受写法即算对 */
function judgeFill(input, accept) {
  const v = normalizeAnswer(input);
  if (!v) return false;
  return (accept || []).some((a) => normalizeAnswer(a) === v);
}

/** 数组是否相等（用于排序题） */
function sameArray(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** 洗牌（固定种子可选，保证同一题每次顺序一致时传 seed） */
function shuffle(arr, seed) {
  const a = arr.slice();
  let rand = Math.random;
  if (seed !== undefined) {
    let s = seed;
    rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * 错题 → 列表项简版
 *
 * 列表页只要这几个字段。题干 nodes 可能很大（含批语公式图），
 * 直接塞进 setData 会明显拖慢渲染，所以列表一律走这个函数裁一刀。
 */
function toBrief(m) {
  const kp = m.kpNames || [];
  return {
    id: m.id,
    no: m.no,
    title: m.assignTitle || '',
    gist: m.gist || '',
    text: m.stemText || '',
    score: m.score,
    fullScore: m.fullScore,
    scoreText: scoreText(m.score, m.fullScore),
    level: scoreLevel(m.score, m.fullScore),
    statusText: m.statusText || '',
    statusCls: m.statusCls || '',
    kpNames: kp.slice(0, 2),
    kpMore: Math.max(0, kp.length - 2),
    dueText: m.dueText || '',
    isDue: !!m.isDue,
    unlocked: !!m.unlocked,
    verdict: m.verdict || ''
  };
}

module.exports = {
  pad2, date, dateTime, fromNow, scoreText, scoreLevel,
  normalizeAnswer, judgeFill, sameArray, shuffle, toBrief
};
