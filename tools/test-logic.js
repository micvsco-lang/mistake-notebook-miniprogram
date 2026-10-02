'use strict';
/**
 * test-logic.js — 逻辑层冒烟测试（Node 内运行，用内存 storage 模拟 wx）
 * 运行：node tools/test-logic.js
 */
const path = require('path');
const MP = path.join(__dirname, '..', 'miniprogram');

const store = require(path.join(MP, 'utils/store.js'));
const cause = require(path.join(MP, 'utils/cause.js'));
const train = require(path.join(MP, 'utils/train.js'));
const srs = require(path.join(MP, 'utils/srs.js'));
const kp = require(path.join(MP, 'utils/kp.js'));
const format = require(path.join(MP, 'utils/format.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------------- 1. 种子导入 ---------------- */
section('种子导入');
const init = store.ensureInit();
ok('ensureInit 返回总数', init.total === 4, init);
ok('首次导入 4 条（满分题不算错题）', init.imported === 4, init);

const all = store.all();
ok('all() 返回 4 条', all.length === 4, all.length);
ok('满分题 Q1 不在错题列表', all.every((m) => m.no !== 1), all.map((m) => m.no));
ok('所有条目初始状态为 new', all.every((m) => m.status === 'new'));
ok('所有条目初始未解锁解析', all.every((m) => m.unlocked === false));
ok('每题都有知识点', all.every((m) => m.kp.length > 0));

/* ---------------- 2. 数据完整性 ---------------- */
section('数据完整性');
const q3 = store.get('m_as_hw1_0921_q3');
ok('取到 Q3', !!q3);
ok('Q3 得分 6', q3 && q3.score === 6, q3 && q3.score);
ok('Q3 题干有节点', q3 && q3.stem.length > 0, q3 && q3.stem.length);
ok('Q3 题干引用了符号图', q3 && q3.stem.some((n) => n.t === 'i' && /^\/assets\/sym\//.test(n.s)));
ok('Q3 我的答案含手写照片', q3 && q3.myAnswer.photo === true);
ok('Q3 批语非空', q3 && q3.comment.text.length > 50, q3 && q3.comment.text.length);
ok('符号图文件存在', (function () {
  const fs = require('fs');
  return q3.stem.filter((n) => n.t === 'i').every((n) => fs.existsSync(path.join(MP, n.s)));
})());
ok('手写照片文件存在', (function () {
  const fs = require('fs');
  return q3.myAnswer.nodes.filter((n) => n.t === 'i').every((n) => fs.existsSync(path.join(MP, n.s)));
})());

/* ---------------- 3. 解析解锁闸门 ---------------- */
section('解析解锁闸门（核心产品逻辑）');
const bad = store.submitCorrection('m_as_hw1_0921_q3', { text: '   ', photos: [] });
ok('空订正被拒绝', bad.ok === false, bad);
ok('拒绝后仍未解锁', store.get('m_as_hw1_0921_q3').unlocked === false);

const good = store.submitCorrection('m_as_hw1_0921_q3', {
  text: '我错在没有分 M²<2 和 M²>2 两种情况讨论，只提了稠密性就下结论。正确做法是反设 M∈Q 是上确界，再分别构造更小的有理上界推出矛盾。',
  photos: []
});
ok('提交订正成功', good.ok === true, good.msg);
const after = store.get('m_as_hw1_0921_q3');
ok('提交后解锁解析', after.unlocked === true);
ok('状态推进到 analyzed', after.status === 'analyzed', after.status);
ok('订正内容已保存', after.correction && after.correction.text.length > 20);

/* ---------------- 4. 错因分析 ---------------- */
section('错因分析');
const an = after.analysis;
ok('生成了分析', !!(an && an.causes.length), an);
ok('Q3 命中 C3（逻辑不严谨）', an.causes.some((c) => c.code === 'C3'), an.causes.map((c) => c.code));
ok('Q3 命中 C4（漏分类讨论）', an.causes.some((c) => c.code === 'C4'), an.causes.map((c) => c.code));
ok('给出补救建议', !!(an.advice && an.advice.length > 20));
ok('来源标注为人工标注', an.source === 'annotation', an.source);

// 规则引擎路径（模拟一道没有 flaws 的新导入题）
section('规则引擎（无人工标注时的降级路径）');
const rule = cause.analyze({
  score: 12,
  fullScore: 20,
  comment: { text: '你的结论正确，但下确界的证明不完整，缺少对「任意小于 1 的数都不是下界」的验证，论证不够充分。' },
  flaws: [],
  kp: ['kb_inf']
});
ok('规则引擎命中 C2（结构不完整）', rule.causes.some((c) => c.code === 'C2'), rule.causes.map((c) => c.code));
ok('规则来源为 rule', rule.source === 'rule', rule.source);
ok('低分无批语线索 → C1', cause.analyze({ score: 2, fullScore: 20, comment: { text: '再看看' }, flaws: [], kp: [] }).causes[0].code === 'C1');
ok('满分题无错因', cause.analyze({ score: 20, fullScore: 20, comment: { text: '' }, flaws: [], kp: [] }).causes.length === 0);

/* ---------------- 5. 出题与判分 ---------------- */
section('出题与判分');
const picked = train.pick(after, 3);
ok('为 Q3 选出 3 道题', picked.length === 3, picked.map((d) => d.id));
ok('优先命中同一知识点/错因', picked.some((d) => d.kp.indexOf('kb_dense') >= 0), picked.map((d) => d.kp));

const ses = train.makeSession(picked, 7);
ok('会话生成', ses.length === 3);
const orderQ = ses.find((s) => s.kind === 'order') || train.makeSession([require(path.join(MP, 'data/drills.js')).byId('d_dense_03')], 3)[0];
ok('排序题已打乱', orderQ.tokens && orderQ.tokens.map((t) => t.i).join(',') !== orderQ.answer.join(','), orderQ.tokens && orderQ.tokens.map((t) => t.i));
ok('排序题判对', train.grade(orderQ, orderQ.answer).correct === true);
ok('排序题判错', train.grade(orderQ, orderQ.answer.slice().reverse()).correct === false);

const judgeQ = ses.find((s) => s.kind === 'judge');
if (judgeQ) {
  ok('判断题判对', train.grade(judgeQ, judgeQ.answer).correct === true);
  ok('判断题判错', train.grade(judgeQ, !judgeQ.answer).correct === false);
}
const choiceQ = ses.find((s) => s.kind === 'choice');
if (choiceQ) {
  ok('选择题判对', train.grade(choiceQ, choiceQ.answer).correct === true);
  ok('选择题判错', train.grade(choiceQ, (choiceQ.answer + 1) % choiceQ.options.length).correct === false);
}

// 填空题：验证等价写法
section('填空题等价写法');
const fillQ = {
  kind: 'fill',
  accept: ['x0>s-ε', 'x₀>s-ε'],
  explain: ''
};
ok('x₀ > s − ε 判对', train.grade(fillQ, 'x₀ > s − ε').correct === true);
ok('x0>s-e 判对（写法变体）', train.grade(fillQ, 'x0>s-e').correct === true, format.normalizeAnswer('x0>s-e'));
ok('错误答案判错', train.grade(fillQ, 'x0>s').correct === false);
ok('空答案判错', train.grade(fillQ, '   ').correct === false);

/* ---------------- 6. 状态机推进 ---------------- */
section('状态机与复习排程');
let cur = store.get('m_as_hw1_0921_q3');
cur = store.recordDrill(cur.id, true);
ok('第一次训练通过 → training', cur.status === 'training', cur.status);
ok('间隔为 1 天', cur.srs.intervalDays === 1, cur.srs.intervalDays);
cur = store.recordDrill(cur.id, true);
ok('连续两次通过 → mastered（已掌握）', cur.status === 'mastered', cur.status);
ok('间隔升到 3 天', cur.srs.intervalDays === 3, cur.srs.intervalDays);
ok('下次复习时间在未来', cur.srs.dueAt > Date.now());
cur = store.recordDrill(cur.id, false);
ok('答错 → 退回 training', cur.status === 'training', cur.status);
ok('答错后 lapse 计数', cur.srs.lapses === 1, cur.srs.lapses);
ok('答错后间隔归 1 天', cur.srs.intervalDays === 1);

/* ---------------- 7. 统计 ---------------- */
section('统计');
const st = store.stats();
ok('total = 4', st.total === 4, st.total);
ok('统计到待订正', st.byStatus.new === 3, st.byStatus);
ok('统计到巩固中', st.byStatus.training === 1, st.byStatus);
ok('有知识点统计', st.kpStats.length > 0, st.kpStats.length);
ok('知识点按丢分排序', st.kpStats[0].lost >= st.kpStats[st.kpStats.length - 1].lost);
ok('有错因分布', st.causes.length > 0, st.causes.map((c) => c.code + ':' + c.count));
console.log('  丢分合计 ' + st.totalLost + ' 分，平均得分率 ' + (st.avgRatio * 100).toFixed(0) + '%');
console.log('  错因分布：' + st.causes.map((c) => c.name + '×' + c.count).join('  '));

/* ---------------- 8. 知识点树 ---------------- */
section('知识点树');
ok('所有种子知识点都在树里', all.every((m) => m.kp.every((k) => !!kp.FLAT[k])), all.map((m) => m.kp));
ok('nameOf 可解析', kp.nameOf('kb_dense') === '有理数集内的确界与稠密性', kp.nameOf('kb_dense'));
ok('picker 选项含层级', kp.flatOptions().length > 8, kp.flatOptions().length);
ok('题库所有知识点都在树里', require(path.join(MP, 'data/drills.js')).DRILLS.every((d) => d.kp.every((k) => !!kp.FLAT[k])));

/* ---------------- 9. 导入 / 导出 ---------------- */
section('导入导出');
const exp = store.exportJson();
ok('导出非空', exp.length > 100, exp.length);
const imp = store.importFullJson(exp);
ok('回灌导入成功', imp.ok === true && imp.total === 4, imp);
ok('坏数据被拒绝', store.importFullJson('{"foo":1}').ok === false);
ok('非法 JSON 被拒绝', store.importFullJson('not json').ok === false);

const dup = store.importAssignment(require(path.join(MP, 'data/seed.js')).assignments[0]);
ok('重复导入被跳过（幂等）', dup.ok === true && dup.added === 0 && dup.skipped === 4, dup);

/* ---------------- 10. 拍照识别（纯逻辑，不碰 wx） ---------------- */
section('拍照识别 · 知识点映射');
const rec = require(path.join(MP, 'utils/recognize.js'));

ok('云开发默认未开启（走降级）', rec.isReady() === false);

const dict = rec.buildKpDict(kp.flatOptions());
ok('知识点字典只收叶子', !!dict[rec.normName('上确界')] && !dict[rec.normName('实数与确界')]);
ok('字典值是树里的 id', dict[rec.normName('上确界')] === 'kb_sup', dict[rec.normName('上确界')]);
ok('归一化吃掉空白与括号', rec.normName(' 无上界／无下界的符号化 ') === rec.normName('无上界／无下界的符号化'));

ok('映射命中', JSON.stringify(rec.mapKp(['上确界', '下确界'], dict)) === JSON.stringify(['kb_sup', 'kb_inf']));
ok('未知名被丢弃', rec.mapKp(['上确界', '模型自己编的知识点'], dict).length === 1);
ok('重复项去重', rec.mapKp(['上确界', '上确界'], dict).length === 1);
ok('非数组不炸', JSON.stringify(rec.mapKp(null, dict)) === '[]');

section('拍照识别 · 结果规范化');
const nq = rec.normalizeQuestion({ stem: ' 证明 A 无上确界 ', myAnswer: '略', score: 6, kpNames: ['上确界'] }, dict, 1);
ok('题干去空白', nq.stemText === '证明 A 无上确界', nq.stemText);
// 曾经这里兜底填 20，结果界面显示「null/20」—— 跟实际评分体系对不上
// （工科数学分析按 100 分制均分，6 题就是 16.6/题）。现在留 null，
// 交给核对页按「本份总分 ÷ 题数」推算，或用户手填。
ok('没给满分时留 null（不再硬编码 20）', nq.fullScore === null, nq.fullScore);
ok('知识点映射成 id', nq.kp[0] === 'kb_sup', nq.kp);
ok('空题被标记', nq.empty === false);

const nq2 = rec.normalizeQuestion({ stem: '', myAnswer: '', comment: '' }, dict, 2);
ok('三样全空判为空题', nq2.empty === true);

const nq3 = rec.normalizeQuestion({ stem: 'x', score: 30, fullScore: 20 }, dict, 3);
ok('得分超出满分时抬高满分而不是丢分', nq3.fullScore >= 30, nq3);

const nr = rec.normalizeResult({ questions: [{ stem: 'a' }, {}, { stem: '' }, { comment: 'b' }] }, dict);
ok('规范化时过滤空题', nr.length === 2, nr.length);
ok('缺 questions 字段返回空数组', rec.normalizeResult({}, dict).length === 0);

section('拍照识别 · 错误文案可行动');
ok('NO_KEY 指向具体变量名', rec.friendlyError({ code: 'NO_KEY' }).indexOf('VLM_API_KEY') >= 0);
ok('401 提示 Key 有问题', rec.friendlyError({ code: 'UPSTREAM_401' }).indexOf('Key') >= 0);
ok('429 提示额度', rec.friendlyError({ code: 'UPSTREAM_429' }).indexOf('额度') >= 0);
ok('未知码回落到 msg', rec.friendlyError({ code: 'XXX', msg: '原始信息' }) === '原始信息');
ok('TRUNCATED 给出可行动建议', rec.friendlyError({ code: 'TRUNCATED' }).indexOf('VLM_MAX_TOKENS') >= 0);

section('拍照识别 · 入库');
const before = store.all().length;

// ① 识别成功：题干是文字，原图另存
const r1 = store.addRecognized([{
  no: 3, type: '证明题', gist: '上确界',
  stemText: '证明 A={x∈Q | x²<2} 在有理数集内无上确界',
  myAnswerText: '设 M 为上界……', rightText: '', commentText: '构造量不严谨',
  score: 6, fullScore: 20, kp: ['kb_sup', 'kb_dense'],
  confidence: 'high', photo: '/tmp/scan.jpg'
}], { assignTitle: 'HW3 0926' });
ok('批量入库返回条数', r1.added === 1, r1.added);

const m1 = store.get(r1.items[0].id);
ok('识别模式：题干是文字节点', m1.stem.length === 1 && m1.stem[0].t === 't', m1.stem);
ok('识别模式：原图单独存着', m1.origin && m1.origin.photo === '/tmp/scan.jpg', m1.origin);
ok('识别模式：我的解答进了 myAnswer', m1.myAnswer.text.indexOf('设 M 为上界') >= 0, m1.myAnswer.text);
ok('识别模式：批语进了 comment', m1.comment.text === '构造量不严谨', m1.comment.text);
ok('知识点名可读', m1.kpNames.indexOf('上确界') >= 0, m1.kpNames);
ok('课程由知识点反查', m1.courseId === 'c_math', m1.courseId);
ok('作业名生效', m1.assignTitle === 'HW3 0926', m1.assignTitle);

// ② 没识别（降级）：题干就是那张照片
const r2 = store.addRecognized([{
  no: 1, type: '解答题', gist: '', stemText: '', myAnswerText: '', rightText: '', commentText: '',
  score: null, fullScore: 20, kp: ['kb_inf'], photo: '/tmp/raw.jpg'
}], {});
const m2 = store.get(r2.items[0].id);
// 行为已改（用户要求「图放原图栏、别占题目栏」）：
// 以前题干空着就把图塞进 stem，现在题干永远只是题干，没文字就留空。
ok('纯搬运：题干留空，图不占题目栏', m2.stem.length === 0, m2.stem);
ok('纯搬运：图进原图栏，路径正确', m2.origin && m2.origin.photo === '/tmp/raw.jpg', m2.origin);
ok('默认作业名', m2.assignTitle === '拍照录入', m2.assignTitle);

// ②b 截图直存：一图一题、没有知识点、没有识别文字
//     这是「手机上截图搬作业」的主路径 —— 学习通在手机上装不了脚本，
//     用户只能截图。整份作业丢进来时没人知道每道题属于哪个知识点，
//     所以 kp 必须允许为空，否则「一键入库」会被知识点校验卡死。
const r3 = store.addRecognized([{
  no: 1, type: '解答题', gist: '', stemText: '', myAnswerText: '', rightText: '', commentText: '',
  score: null, fullScore: 20, kp: [], photo: '/tmp/shot1.jpg'
}], { assignTitle: '截图搬运 0926' });
const m3 = store.get(r3.items[0].id);
ok('截图直存：kp 为空也能入库', r3.added === 1, r3.added);
ok('截图直存：kp 就是空数组', Array.isArray(m3.kp) && m3.kp.length === 0, m3.kp);
ok('截图直存：课程回落到默认', m3.courseId === 'c_math', m3.courseId);
// 行为已改：题干不再被截图顶替（用户要求「图放原图栏、别占题目栏」）
ok('截图直存：题干留空，截图不占题目栏', m3.stem.length === 0, m3.stem);
ok('截图直存：截图进原图栏', !!(m3.origin && m3.origin.photo), m3.origin);
ok('截图直存：作业名生效', m3.assignTitle === '截图搬运 0926', m3.assignTitle);
ok('截图直存：仍然锁着解析', m3.unlocked === false);

// ③ 闸门没有被绕过 —— 这是最关键的一条
ok('拍照录入的题仍是 new', m1.status === 'new' && m2.status === 'new' && m3.status === 'new');
ok('拍照录入的题解析依然锁着', m1.unlocked === false && m2.unlocked === false && m3.unlocked === false);
ok('拍照录入不带任何订正内容', m1.correction === null && m2.correction === null);
const gate = store.submitCorrection(m1.id, { text: '  ', photos: [] });
ok('空订正同样被拒（闸门对拍照录入一视同仁）', gate.ok === false, gate);
ok('被拒后仍然锁着', store.get(m1.id).unlocked === false);

ok('入库后总数增加', store.all().length === before + 3, store.all().length);
ok('空数组入库不报错', store.addRecognized([]).added === 0);
ok('含 null 项不炸', store.addRecognized([null]).added === 0);
ok('非叶子知识点反查课程回落', store.courseOfKp('不存在的id') === 'c_math');
ok('线代知识点反查课程', store.courseOfKp('la_eigen') === 'c_linalg', store.courseOfKp('la_eigen'));

/* ---------------- 拍照识别 · Kimi K3 实测管线 ----------------
 * 夹具是 Kimi K3 对真实作业照片的转录（tools/fixtures/）。
 * 完整走一遍：模型原文 → extractJson → 云端 normalizeQuestions → 客户端 normalizeResult，
 * 每一步都用生产代码（云函数与客户端的导出），不是复刻。
 */
section('拍照识别 · Kimi K3 实测管线');
const fs = require('fs');
const cf = require(path.join(__dirname, '..', 'cloudfunctions', 'recognizeWork', 'index.js'));
const fxDir = path.join(__dirname, 'fixtures');
const kpWhitelist = kp.flatOptions().filter((o) => o.isLeaf).map((o) => o.name);
const kpIdSet = {};
kp.flatOptions().forEach((o) => { kpIdSet[o.id] = true; });

function runPipeline(modelOutput) {
  // 模拟云函数 main() 里「抠 JSON → 规范化」这段（网络部分之外的全部）
  const data = typeof modelOutput === 'string' ? cf.extractJson(modelOutput) : modelOutput;
  if (!data) return { data: null, cloud: [], local: [] };
  const cloud = cf.normalizeQuestions(data, kpWhitelist);
  const local = rec.normalizeResult({ questions: cloud }, dict);
  return { data: data, cloud: cloud, local: local };
}

// —— 夹具 1：hw1-q3，旋转 90° 的纯手写证明页（无印刷题干）——
const fx1 = JSON.parse(fs.readFileSync(path.join(fxDir, 'kimi-hw1-q3.json'), 'utf8'));
const p1 = runPipeline(fx1.modelOutput);
ok('夹具1 云端拆出 1 道题', p1.cloud.length === 1, p1.cloud.length);
ok('夹具1 题干为空但不被误丢（有 myAnswer）', p1.cloud.length > 0 && p1.cloud[0].stem === '');
ok('夹具1 手写解答被转录且含 □ 占位', p1.cloud[0] && p1.cloud[0].myAnswer.indexOf('□') >= 0);
ok('夹具1 知识点全部命中白名单', p1.cloud[0] && p1.cloud[0].kpNames.length >= 2
  && p1.cloud[0].kpNames.every((n) => kpWhitelist.indexOf(n) >= 0), p1.cloud[0] && p1.cloud[0].kpNames);
ok('夹具1 客户端映射出合法知识点 id', p1.local.length === 1
  && p1.local[0].kp.length >= 2 && p1.local[0].kp.every((id) => kpIdSet[id]), p1.local[0] && p1.local[0].kp);
ok('夹具1 无分数时 score 为 null', p1.local[0] && p1.local[0].score === null);

// —— 夹具 2：work01-q4，学生手抄题目在解答页顶部 ——
const fx2 = JSON.parse(fs.readFileSync(path.join(fxDir, 'kimi-work01-q4.json'), 'utf8'));
const p2 = runPipeline(fx2.modelOutput);
ok('夹具2 手抄题干被保留进 stem', p2.cloud.length === 1 && p2.cloud[0].stem.indexOf('lim') >= 0, p2.cloud[0] && p2.cloud[0].stem);
ok('夹具2 题号识别为 4', p2.cloud[0] && p2.cloud[0].no === 4, p2.cloud[0] && p2.cloud[0].no);
ok('夹具2 知识点树无 ε-N 节点 → 空数组（不许自创）', p2.cloud[0] && p2.cloud[0].kpNames.length === 0, p2.cloud[0] && p2.cloud[0].kpNames);
ok('夹具2 空知识点仍能过客户端规范化', p2.local.length === 1 && p2.local[0].kp.length === 0);

// —— 夹具 3：对抗性输出（围栏 + 废话 + 近似知识点名 + "6/20" 分数）——
const fx3 = fs.readFileSync(path.join(fxDir, 'adversarial-output.txt'), 'utf8');
const p3 = runPipeline(fx3);
ok('extractJson 剥掉围栏与前后废话', p3.data !== null && Array.isArray(p3.data.questions), p3.data === null);
ok('对抗 拆出 1 道题', p3.cloud.length === 1, p3.cloud.length);
ok('对抗 白名单过滤：数列极限/裸「确界」被丢，两个正主留下',
  p3.cloud[0] && JSON.stringify(p3.cloud[0].kpNames) === JSON.stringify(['上确界', '有理数集内的确界与稠密性']),
  p3.cloud[0] && p3.cloud[0].kpNames);
ok('对抗 "6/20" 字符串分数被拆成 6 + 20', p3.cloud[0] && p3.cloud[0].score === 6
  && p3.cloud[0].fullScore === 20, p3.cloud[0] && { s: p3.cloud[0].score, f: p3.cloud[0].fullScore });

// —— parseScorePair 的边界 ——
ok('拆 「6/20」', cf.parseScorePair('6/20').score === 6 && cf.parseScorePair('6/20').full === 20);
ok('拆 「6／20分」（全角斜杠+分字）', cf.parseScorePair('6／20分').full === 20);
ok('拆 「 18.5 / 20 」（含空格小数）', cf.parseScorePair(' 18.5 / 20 ').score === 18.5);
ok('得分大于满分不拆', cf.parseScorePair('25/20') === null);
ok('非分数串不拆', cf.parseScorePair('6月20日') === null && cf.parseScorePair('abc') === null);
ok('非字符串不拆', cf.parseScorePair(6) === null && cf.parseScorePair(null) === null);
ok('满分超过 1000 不拆（防误伤）', cf.parseScorePair('6/20000') === null);

// —— Kimi 预设与提示词 ——
ok('PROVIDERS 含 kimi 且模型为 kimi-k3', cf.PROVIDERS.kimi && cf.PROVIDERS.kimi.model === 'kimi-k3');
ok('kimi 走 OpenAI 兼容端点', cf.PROVIDERS.kimi.endpoint.indexOf('api.moonshot.cn') >= 0);
ok('提示词覆盖旋转场景', cf.SYSTEM.indexOf('旋转') >= 0);
ok('提示词覆盖背面透字', cf.SYSTEM.indexOf('背面') >= 0);
ok('提示词覆盖手抄题干', cf.SYSTEM.indexOf('手抄') >= 0);
ok('提示词仍死守「不自创知识点」', cf.SYSTEM.indexOf('绝不允许自创') >= 0);
ok('提示词仍死守「不解题」', cf.SYSTEM.indexOf('不要自己解题') >= 0);

// —— extractJson 自身的边界 ——
ok('extractJson 接受裸 JSON', cf.extractJson('{"questions":[]}').questions.length === 0);
ok('extractJson 容忍数组顶层', JSON.stringify(cf.normalizeQuestions([{ stem: 'x' }], kpWhitelist).length) === '1');
ok('extractJson 对纯废话返回 null', cf.extractJson('对不起，我看不清这张照片') === null);
ok('extractJson 对空串返回 null', cf.extractJson('') === null);

/* ---------------- 手写符号库 ---------------- */
section('手写符号库（data/symbols.js）');
const symbols = require(path.join(MP, 'data', 'symbols.js'));
ok('分了 3 组且都非空', Array.isArray(symbols.GROUPS) && symbols.GROUPS.length === 3
  && symbols.GROUPS.every((g) => g.items.length > 0));
const allSyms = symbols.GROUPS.reduce((a, g) => a.concat(g.items.map((it) => it.sym)), []);
ok('符号无重复', allSyms.length === new Set(allSyms).size, allSyms);
ok('每项字段齐全（sym/name/look/scene）', symbols.GROUPS.every((g) => g.items.every((it) =>
  it.sym && it.name && it.look && it.scene)));
ok('σ 的 look 明确提到「像 6」', (function () {
  const s = symbols.GROUPS.reduce((a, g) => a.concat(g.items), []).find((it) => it.sym === 'σ');
  return s && s.look.indexOf('像 6') >= 0;
})());
ok('PROMPT_NOTES 含 σ/ε/∑ 关键词', symbols.PROMPT_NOTES.indexOf('σ') >= 0
  && symbols.PROMPT_NOTES.indexOf('ε') >= 0 && symbols.PROMPT_NOTES.indexOf('∑') >= 0);
ok('PROMPT_NOTES 不含 markdown 强调符（**）', symbols.PROMPT_NOTES.indexOf('**') < 0);
ok('小抄有长度上限意识（≤ 400 字）', symbols.PROMPT_NOTES.length <= 400, symbols.PROMPT_NOTES.length);
// 云函数侧：兜底提示与「形状差异不是错误」的立场
ok('云函数 SYSTEM 有手写符号兜底（σ 像 6）', cf.SYSTEM.indexOf('像 6') >= 0);
ok('云函数 SYSTEM 立场：形状差异不是错误', cf.SYSTEM.indexOf('形状差异不是错误') >= 0);
ok('云函数 SYSTEM 不许模型重述「符号写错」式判断', cf.SYSTEM.indexOf('不要照抄形状') >= 0);

/* ---------------- 疑惑点标注 ---------------- */
section('疑惑点标注（对 AI 批语的异议）');
const TAGS = store.DOUBT_TAGS;
ok('DOUBT_TAGS 白名单 4 类', TAGS && Object.keys(TAGS).length === 4
  && !!TAGS.ai_misjudge && !!TAGS.symbol && !!TAGS.unclear && !!TAGS.other);

// 用一道还没动过的题（Q4）测，避免和闸门测试互相干扰
const q4id = 'm_as_hw1_0921_q4';
const q4a = store.get(q4id);
ok('Q4 初始无疑惑', (q4a.doubts || []).length === 0);
ok('Q4 初始未解锁', q4a.unlocked === false);
ok('decorate 派生 doubtCount=0', q4a.doubtCount === 0);

// 添加
store.setDoubts(q4id, [{ tag: 'symbol', text: '批语说我符号写错，其实我写的是 σ（西格马），不是 6。' }]);
const q4b = store.get(q4id);
ok('写入一条疑惑', q4b.doubts.length === 1);
ok('自动生成 id 与 at', q4b.doubts[0].id && typeof q4b.doubts[0].at === 'number');
ok('doubtCount 同步为 1', q4b.doubtCount === 1, q4b.doubtCount);
// ★ 闸门安全：标疑惑绝不解锁订正
ok('标疑惑不解锁解析', q4b.unlocked === false, q4b.unlocked);
ok('标疑惑不改状态机', q4b.status === 'new', q4b.status);
ok('标疑惑后 correction 仍为 null', q4b.correction === null);

// 白名单硬过滤：非法 tag 降级 other
store.setDoubts(q4id, [{ tag: '随便写的tag', text: 'x' }]);
ok('非法 tag 降级为 other', store.get(q4id).doubts[0].tag === 'other');

// 整组替换语义：再写一次就覆盖，不会叠加
store.setDoubts(q4id, [
  { id: 'd1', tag: 'ai_misjudge', text: '批语判错，我的证明没问题。', at: 1000 },
  { id: 'd2', tag: 'unclear', text: '', at: 2000 }
]);
const q4c = store.get(q4id);
ok('整组替换（不是追加）', q4c.doubts.length === 2 && q4c.doubts[0].id === 'd1');
ok('给定 at 保留', q4c.doubts[0].at === 1000);
ok('text 会去空格、留空合法', q4c.doubts[1].text === '');
ok('doubtCount=2', q4c.doubtCount === 2);

// text 截断到 300
store.setDoubts(q4id, [{ tag: 'other', text: '长'.repeat(500) }]);
ok('text 截断到 300 字', store.get(q4id).doubts[0].text.length === 300);

// 清空
store.setDoubts(q4id, []);
const q4d = store.get(q4id);
ok('空数组清空疑惑', q4d.doubts.length === 0 && q4d.doubtCount === 0);
ok('清空后依然未解锁、状态不变', q4d.unlocked === false && q4d.status === 'new');

// 找不到题返回 null，不抛错
ok('setDoubts 找不到题返回 null', store.setDoubts('m_不存在', [{ tag: 'other' }]) === null);

// 疑惑点与订正互不干扰：先标疑惑再提交订正，都能正常走
store.setDoubts(q4id, [{ tag: 'symbol', text: 'σ 被认成 6 了。' }]);
store.submitCorrection(q4id, { text: '重新核对了一遍，σ 写法没问题。', photos: [] });
const q4e = store.get(q4id);
ok('标过疑惑的题照常提交订正并解锁', q4e.unlocked === true && q4e.status === 'analyzed');
ok('解锁后疑惑点还在', q4e.doubts.length === 1 && q4e.doubts[0].tag === 'symbol');

// 导出备份包含 doubts（换机不丢）
const backupQ4 = JSON.parse(JSON.stringify((function () {
  const data = JSON.parse(store.exportJson());
  return data.list.find((m) => m.id === q4id);
})()));
ok('exportJson 含 doubts 字段', Array.isArray(backupQ4.doubts) && backupQ4.doubts.length === 1);

/* ---------------------------------------------------------------------------
 * 极简提示词（VLM_LITE=2）· 靠代码兜底，不靠模型守规矩
 * ---------------------------------------------------------------------------
 * 背景：为了压长期使用的 token 成本，极简版把固定提示词从 1366 字砍到 430 字，
 * 代价是丢掉了「只能输出 JSON」「type 只能取 6 个值」「gist 不超过 14 字」
 * 这类格式约束。这个策略**只有在下游兜底真的兜得住时才成立**。
 *
 * 所以这一节专门验证：**故意喂格式不规范的输出，看会不会翻车。**
 * 如果哪天有人改了 normalizeQuestions 又把这些断言删了，这里就该红。
 * ------------------------------------------------------------------------- */
section('极简提示词 · 下游兜底不依赖模型守规矩');

// ① 提示词本体：三档字数必须是递降的，且极简版不能悄悄变胖
ok('三档提示词都存在', cf.SYSTEM.length > 0 && cf.SYSTEM_LITE.length > 0 && cf.SYSTEM_TINY.length > 0);
ok('极简版比完整版短一半以上', cf.SYSTEM_TINY.length < cf.SYSTEM.length * 0.5,
  cf.SYSTEM_TINY.length + ' vs ' + cf.SYSTEM.length);
ok('极简版保留了四栏定义（产品核心，不能省）',
  ['stem', 'myAnswer', 'comment', 'rightAnswer'].every((k) => cf.SYSTEM_TINY.indexOf(k) >= 0));
ok('极简版保留了「不许自己解题」', cf.SYSTEM_TINY.indexOf('解题') >= 0);
ok('极简版保留了「取标准符号不照抄形状」', cf.SYSTEM_TINY.indexOf('照抄形状') >= 0);

// ② 题型近义归并：极简版没列白名单，模型一定会自由发挥
ok('「证明」归并到证明题', cf.normalizeType('证明') === '证明题');
ok('「简答题」归并到解答题', cf.normalizeType('简答题') === '解答题');
ok('「计算」归并到计算题', cf.normalizeType('计算') === '计算题');
ok('「单选」归并到选择题', cf.normalizeType('单选') === '选择题');
ok('合法值原样返回（不被误改）', cf.normalizeType('填空题') === '填空题');
ok('完全认不出的回落解答题', cf.normalizeType('应用题呀') === '解答题');
ok('type 缺失也不炸', cf.normalizeType(undefined) === '解答题' && cf.normalizeType(null) === '解答题');

// ③ 整条管线喂「野输出」：全缺字段、类型全错、多余字段
// 注意每道题都要有 stem / myAnswer / comment 里至少一样，
// 否则会被「三样全空就丢」的护栏拦掉（那是防空壳污染的，见最后一组断言）。
const wild = {
  questions: [
    { stem: '求极限', type: '证明', kpNames: ['上确界', '不存在的知识点'] },
    { myAnswer: '我写的过程', gist: '只有解答没题干', type: '简答题', score: '6/20', confidence: '奇怪' },
    { stem: 'x', type: 123, no: '第二题' },
    { stem: '  有空白  ', extra: '多余字段应被忽略' }
  ]
};
const wildOut = cf.normalizeQuestions(wild, kpWhitelist);
ok('野输出全部被接住（4 道都没丢）', wildOut.length === 4, wildOut.length);
ok('缺字段填空串而不是 undefined', wildOut[1].stem === '' && wildOut[1].comment === '');
ok('题型近义被归并到白名单内',
  wildOut.every((q) => cf.TYPES.indexOf(q.type) >= 0), wildOut.map((q) => q.type).join(','));
ok('自创知识点被白名单滤掉，只留合法的',
  wildOut[0].kpNames.length === 1 && wildOut[0].kpNames[0] === '上确界', wildOut[0].kpNames);
ok('「6/20」拆成 score=6 / fullScore=20', wildOut[1].score === 6 && wildOut[1].fullScore === 20);
ok('非法 confidence 回落 medium', wildOut[1].confidence === 'medium');
ok('题干两端空白被清掉', wildOut[3].stem === '有空白');
ok('多余字段不会漏进结果', wildOut[3].extra === undefined);
ok('非数字 no 时按序号补', wildOut[2].no === 3, wildOut[2].no);

// ⑥ ★ 真实撞过的坑：模型把多行解答直接塞进 JSON 字符串（裸换行 → 非法 JSON）
//    2026-09-25 实测：同一张作业截图，模型有时转义成 \n（能解析）、
//    有时不转义（JSON.parse 抛错 → 用户看到「没有报告」）。最难查的那类 bug。
const dirtyJson = '```json\n{"questions":[{"no":3,"stem":"证明题",'
  + '"myAnswer":"1 情形二：取 n 充分大\n2 反设 M ∈ Q 是上确界\n3 三种情形都矛盾"}]}\n```';
ok('裸换行的 JSON：原样 parse 必然失败（先确认这是真问题）',
  (function () { try { JSON.parse(dirtyJson.replace(/```json|```/g, '').trim()); return false; } catch (e) { return true; } })());
const fixedDirty = cf.extractJson(dirtyJson);
ok('裸换行的 JSON：extractJson 能救回来', fixedDirty !== null && Array.isArray(fixedDirty.questions));
ok('救回来后多行内容完整保留（换行没丢）',
  fixedDirty && fixedDirty.questions[0].myAnswer.indexOf('\n') >= 0,
  fixedDirty && JSON.stringify(fixedDirty.questions[0].myAnswer));
ok('救回来的内容逐字正确',
  fixedDirty && fixedDirty.questions[0].myAnswer === '1 情形二：取 n 充分大\n2 反设 M ∈ Q 是上确界\n3 三种情形都矛盾');

// 合法 JSON 根本走不到修复器 —— extractJson 第一级就解析成功了。
// 所以真正要验的是「extractJson 对合法输入原样返回、一个字都不改」。
const normalJson = '{"a":"x\\ny","b":"带\\"引号\\"的值","c":1}';
ok('extractJson 对合法 JSON 原样返回、不做任何改动',
  JSON.stringify(cf.extractJson(normalJson)) === JSON.stringify(JSON.parse(normalJson)));

// 修复器自身有个**已知取舍**（已写在它的函数注释里）：字符串内的 \n 若后面跟字母，
// 会被判成 LaTeX 命令名。这是为「公式必现」付出的代价，有意为之 ——
// 固定成断言，免得以后有人当 bug 来「修」，反而把 LaTeX 场景弄坏。
ok('已知取舍（有意为之）：修复器把「反斜杠+n+字母」判为 LaTeX',
  cf.repairJsonCtl('{"a":"x\\ny"}') === '{"a":"x\\\\ny"}',
  cf.repairJsonCtl('{"a":"x\\ny"}'));
ok('repairJsonCtl 不误伤字符串外的换行',
  cf.repairJsonCtl('{\n  "a": 1\n}') === '{\n  "a": 1\n}');
ok('转义反斜杠状态正确（不会把 \\\\" 误判成字符串结束）',
  cf.repairJsonCtl('{"a":"尾反斜杠\\\\"}') === '{"a":"尾反斜杠\\\\"}');

// 制表符与 \r 同样要处理（手写解答里的缩进）
const tabJson = '{"questions":[{"stem":"a\tb\rc"}]}';
const fixedTab = cf.extractJson(tabJson);
ok('裸制表符/回车也能救回来',
  fixedTab !== null && fixedTab.questions[0].stem === 'a\tb\rc',
  fixedTab && JSON.stringify(fixedTab.questions[0].stem));

// ⑧ ★★ 用户真实作业撞上的坑：LaTeX 反斜杠在 JSON 里是非法转义
//    模型转录数学公式爱输出 LaTeX：$\lim_{n \to \infty} \frac{\sin 2n}{n}$
//    其中 \l \s \e \v 都不是合法 JSON 转义 → JSON.parse 直接炸。
//    \f \t 虽然合法，却会把 \frac 解析成「换页符+rac」——能过但内容被改坏，更阴。
const latexRaw = '{"questions":[{"no":1,"type":"证明题",'
  + '"stem":"用定义证明：$\\lim_{n \\to \\infty} \\frac{\\sin 2n}{n} = 0$",'
  + '"myAnswer":"对任意$\\varepsilon > 0$，取$\\theta$与$N = [\\frac{1}{\\varepsilon}] + 1$"}]}';
ok('LaTeX 的 JSON：原样 parse 必然失败（先确认问题真实存在）',
  (function () { try { JSON.parse(latexRaw); return false; } catch (e) { return true; } })());
const latexFixed = cf.extractJson(latexRaw);
ok('LaTeX 的 JSON：extractJson 能救回来', latexFixed !== null && Array.isArray(latexFixed.questions));
ok('LaTeX 命令的反斜杠被完整保留（\\lim 没丢）',
  latexFixed && latexFixed.questions[0].stem.indexOf('\\lim') >= 0,
  latexFixed && latexFixed.questions[0].stem);
ok('\\frac 没被解析成换页符（内容没被悄悄改坏）',
  latexFixed && latexFixed.questions[0].stem.indexOf('\\frac') >= 0
    && latexFixed.questions[0].stem.indexOf('\f') < 0,
  latexFixed && JSON.stringify(latexFixed.questions[0].stem));
ok('\\theta 没被解析成制表符',
  latexFixed && latexFixed.questions[0].myAnswer.indexOf('\\theta') >= 0
    && latexFixed.questions[0].myAnswer.indexOf('\t') < 0,
  latexFixed && JSON.stringify(latexFixed.questions[0].myAnswer));
ok('整句 LaTeX 逐字还原',
  latexFixed && latexFixed.questions[0].stem
    === '用定义证明：$\\lim_{n \\to \\infty} \\frac{\\sin 2n}{n} = 0$',
  latexFixed && latexFixed.questions[0].stem);

// 但真正的转义（不是 LaTeX）必须保持原义 —— 别把 \n 也当成命令
ok('真正的 \\n 换行不受影响（后不跟字母）',
  (function () {
    const r = cf.extractJson('{"questions":[{"myAnswer":"第一行\\n第二行"}]}');
    return r && r.questions[0].myAnswer === '第一行\n第二行';
  })(),
  (function () {
    const r = cf.extractJson('{"questions":[{"myAnswer":"第一行\\n第二行"}]}');
    return r && JSON.stringify(r.questions[0].myAnswer);
  })());

// ⑨ 最坏情况：模型完全跑偏，返回纯文字无 JSON
ok('模型返回纯文字 → extractJson 得到 null 而不是抛错', cf.extractJson('对不起，我看不清这张图。') === null);
const emptyOut = cf.normalizeQuestions({ questions: [{}, { stem: '   ' }, { gist: '只有概要' }] }, kpWhitelist);
ok('空壳题被整批丢弃（不产生假记录污染错题库）', emptyOut.length === 0, emptyOut.length);
ok('空壳判断看的是 stem/myAnswer/comment，不看 gist',
  cf.normalizeQuestions({ questions: [{ gist: '有概要', myAnswer: '有解答' }] }, kpWhitelist).length === 1);

/* ---------------------------------------------------------------------------
 * 知识点树与搜索
 * ---------------------------------------------------------------------------
 * 树是「统计的地基」：知识点一旦能自由生成，表里就会长出同义不同名的节点，
 * 掌握度统计直接失效。所以这里盯三件事：id 唯一、结构完整、搜索能用。
 * ------------------------------------------------------------------------- */
section('知识点树 · 结构与搜索');

const kpAll = kp.flatOptions();
const kpLeaves = kp.leaves();
ok('知识点数量够覆盖教材（>=100 个叶子）', kpLeaves.length >= 100, kpLeaves.length);
ok('id 全局唯一', new Set(kpAll.map((o) => o.id)).size === kpAll.length, kpAll.length);
ok('每个叶子都能在 FLAT 里查到', kpLeaves.every((o) => kp.FLAT[o.id]));
ok('每个叶子都有所属章节路径', kpLeaves.every((o) => kp.FLAT[o.id].path.length >= 3));

// 曾经缺这一章，导致用户的作业认不出知识点
ok('有「数列的极限」这一章', kpAll.some((o) => o.name === '数列的极限'));
ok('有 ε-N 定义这个知识点', kpLeaves.some((o) => o.name.indexOf('ε-N') >= 0));

ok('搜「极限」有结果', kp.search('极限', 10).length > 0);
ok('搜「确界」能命中上确界', kp.search('确界', 10).some((h) => h.name === '上确界'));
ok('搜「中值定理」能命中拉格朗日', kp.search('中值定理', 10).some((h) => h.name.indexOf('拉格朗日') >= 0));
ok('搜「特征值」有结果', kp.search('特征值', 10).length > 0);
ok('搜描述也能命中（不只搜名称）', kp.search('切线', 10).length > 0);
ok('名称命中排在路径命中前面',
  kp.search('上确界', 5)[0].name === '上确界', kp.search('上确界', 5).map((h) => h.name));
ok('空关键词返回空数组', kp.search('').length === 0 && kp.search('   ').length === 0);
ok('搜不到时返回空数组而不是抛错', kp.search('这个词绝对不存在zzz').length === 0);
ok('结果条数受 limit 限制', kp.search('的', 3).length <= 3);

/* ---------------- 汇总 ---------------- */
console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(46));
process.exitCode = fail ? 1 : 0;
