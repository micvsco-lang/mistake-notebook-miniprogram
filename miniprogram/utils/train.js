/**
 * 出题与判分引擎
 *
 * 选题策略：知识点命中优先，错因命中次之。
 * 也就是「同一块知识 + 同一个毛病」的题先上，避免练了一堆不相干的。
 */

const { DRILLS } = require('../data/drills.js');
const format = require('./format.js');

/**
 * 为一道错题挑训练题
 * @param {object} mistake 错题条目
 * @param {number} n 需要几道
 */
function pick(mistake, n) {
  const kp = (mistake && mistake.kp) || [];
  const codes = [];
  const src = (mistake && mistake.analysis && mistake.analysis.causes && mistake.analysis.causes.length)
    ? mistake.analysis.causes
    : ((mistake && mistake.flaws) || []);
  src.forEach((c) => { if (c && c.code) codes.push(c.code); });

  const scored = [];
  DRILLS.forEach((d) => {
    let s = 0;
    (d.kp || []).forEach((k) => { if (kp.indexOf(k) >= 0) s += 10; });
    (d.cause || []).forEach((c) => { if (codes.indexOf(c) >= 0) s += 6; });
    if (s > 0) scored.push({ d: d, s: s });
  });

  scored.sort((a, b) => b.s - a.s);
  const out = scored.slice(0, n || 3).map((x) => x.d);

  // 题目不够时用同科目兜底，保证至少能练起来
  if (out.length < (n || 3)) {
    DRILLS.forEach((d) => {
      if (out.length >= (n || 3)) return;
      if (out.indexOf(d) < 0) out.push(d);
    });
  }
  return out;
}

/**
 * 生成一次训练会话
 * @param {Array} drills
 * @param {number} seed 用于排序题的稳定打乱
 */
function makeSession(drills, seed) {
  return (drills || []).map((d, i) => {
    const s = {
      id: d.id,
      kind: d.kind,
      q: d.q,
      explain: d.explain,
      options: d.options || null,
      answer: d.answer,
      accept: d.accept || null
    };
    if (d.kind === 'order') {
      const idx = d.steps.map((_, j) => j);
      const shuffled = format.shuffle(idx, (seed || 1) * 97 + i);
      s.tokens = shuffled.map((j) => ({ i: j, text: d.steps[j] }));
      s.answer = idx;                      // 正确顺序：原始索引 0,1,2,...
      s.userOrder = shuffled.slice();      // 当前排列（用户在此之上调整）
    }
    return s;
  });
}

/**
 * 判分
 * @param {object} session 单题会话
 * @param {*} ans 作答：judge→boolean，choice→索引，fill→字符串，order→索引数组
 */
function grade(session, ans) {
  let correct = false;
  let expectText = '';

  switch (session.kind) {
    case 'judge':
      correct = (ans === session.answer);
      expectText = session.answer ? '正确（√）' : '错误（×）';
      break;
    case 'choice':
      correct = (ans === session.answer);
      expectText = session.options ? session.options[session.answer] : '';
      break;
    case 'fill':
      correct = format.judgeFill(ans, session.accept);
      expectText = session.accept && session.accept.length ? session.accept[0] : '';
      break;
    case 'order':
      correct = format.sameArray(ans, session.answer);
      expectText = '按解析中的顺序排列';
      break;
    default:
      correct = false;
  }

  return {
    correct: correct,
    expectText: expectText,
    explain: session.explain || ''
  };
}

/** 根据会话答案给出提示（答错时用） */
function hintOf(session) {
  if (session.kind === 'fill') return '提示：对照上确界定义的第二步。';
  if (session.kind === 'order') return '提示：先证「是界」，再证「最小／最大性」，最后下结论。';
  return '';
}

module.exports = { pick, makeSession, grade, hintOf };
