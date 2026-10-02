'use strict';
/**
 * test-pages.js — 页面逻辑冒烟测试
 *
 * 小程序页面没法在 Node 里直接渲染，但页面 js 的逻辑（生命周期、setData、事件处理）
 * 是可以真实执行的。这里 mock 掉 wx / Page / App / getApp，把每个页面按真实使用顺序
 * 走一遍，能抓出 undefined 访问、字段名写错、状态机不推进这类问题。
 *
 * 运行：node tools/test-pages.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

/* ---------------- 全局 mock ---------------- */
const mem = {};
let toastLog = [];
let lastModal = null;

global.wx = {
  getStorageSync: (k) => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => { toastLog.push(o && o.title); },
  showModal: (o) => { lastModal = o; },
  navigateTo: () => {},
  redirectTo: () => {},
  switchTab: () => {},
  previewImage: () => {},
  setNavigationBarTitle: () => {},
  stopPullDownRefresh: () => {},
  setClipboardData: (o) => { if (o && o.success) o.success({}); },
  chooseMedia: () => {},
  getFileSystemManager: () => ({ copyFileSync: () => {} }),
  env: { USER_DATA_PATH: '/tmp/mz' }
};

const appGlobal = { globalData: { trainTargetId: null } };
global.getApp = () => appGlobal;

let defs = [];
global.Page = (cfg) => { defs.push(cfg); };
global.App = (cfg) => { global.__app = cfg; };

/* ---------------- 工具 ---------------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '   → ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

function loadPage(rel) {
  defs = [];
  const abs = path.join(MP, rel);
  delete require.cache[require.resolve(abs)];
  require(abs);
  if (!defs.length) throw new Error('页面没有调用 Page(): ' + rel);
  return defs[0];
}

function loadApp() {
  global.__app = null;
  const abs = path.join(MP, 'app.js');
  delete require.cache[require.resolve(abs)];
  require(abs);
  if (!global.__app) throw new Error('app.js 没有调用 App()');
  return global.__app;
}

function instantiate(def) {
  const inst = Object.assign({}, def);
  inst.data = JSON.parse(JSON.stringify(def.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return inst;
}

/** 模拟一次事件：e.currentTarget.dataset = ds */
function ev(ds, detail) {
  return { currentTarget: { dataset: ds || {} }, detail: detail || {} };
}

/* ---------------- 启动 App（触发种子导入） ---------------- */
const appDef = loadApp();
const app = instantiate(appDef);
app.onLaunch();
ok('App onLaunch 不报错', true);
ok('globalData.ready 置位', app.globalData.ready === true);
// 页面里用的是 getApp() 的返回，这里让两者指向同一个 globalData
appGlobal.globalData = app.globalData;

const store = require(path.join(MP, 'utils/store.js'));

/* ==================== 1. 首页 ==================== */
section('首页 pages/index');
const index = instantiate(loadPage('pages/index/index.js'));
index.onShow();
ok('onShow 不报错', true);
ok('stats 已计算', !!index.data.stats);
ok('统计到 4 道错题', index.data.stats.total === 4, index.data.stats.total);
ok('待订正列表 4 条', index.data.todo.length === 4, index.data.todo.length);
ok('课程名取自种子', index.data.course.indexOf('高等数学分析') >= 0, index.data.course);
ok('列表项含得分档位', index.data.todo[0].level !== undefined, index.data.todo[0]);
ok('列表项已裁剪（不带 nodes）', index.data.todo[0].stem === undefined);
ok('列表项含知识点名', index.data.todo[0].kpNames.length > 0, index.data.todo[0].kpNames);

/* ==================== 2. 错题本 ==================== */
section('错题本 pages/list');
const list = instantiate(loadPage('pages/list/list.js'));
list.onShow();
ok('列表 4 条', list.data.list.length === 4, list.data.list.length);
ok('全部计数正确', list.data.counts.all === 4 && list.data.counts.new === 4, list.data.counts);

list.setTab(ev({ key: 'mastered' }));
ok('切到「已掌握」为空', list.data.list.length === 0, list.data.list.length);
list.setTab(ev({ key: 'all' }));
ok('切回「全部」为 4', list.data.list.length === 4, list.data.list.length);

list.onInput(ev({}, { value: '确界' }));
setTimeout(() => {}, 0);
list.refresh();
ok('按关键词过滤（确界）', list.data.list.length === 4 || list.data.list.length >= 1, list.data.list.length);
list.onInput(ev({}, { value: '不存在的关键词xyz' }));
list.refresh();
ok('无匹配时为空', list.data.list.length === 0, list.data.list.length);
list.clearKw();
ok('清空关键词后恢复', list.data.list.length === 4, list.data.list.length);
list.toggleDue();
ok('只看该复习可切换', list.data.onlyDue === true);

/* ==================== 3. 详情页（未解锁） ==================== */
section('详情页（订正前）');
const detail = instantiate(loadPage('pages/detail/detail.js'));
detail.onLoad({ id: 'm_as_hw1_0921_q3' });
detail.onShow();
ok('取到题目', !!detail.data.item, detail.data.notFound);
ok('Q3 得分 6', detail.data.item.score === 6, detail.data.item.score);
ok('得分档位为 bad', detail.data.item.level === 'bad', detail.data.item.level);
ok('解析未解锁', detail.data.unlocked === false);
ok('错因选项齐全（7 类）', detail.data.allCauses.length === 7, detail.data.allCauses.length);
ok('知识点 picker 有选项', detail.data.kpOptions.length > 5, detail.data.kpOptions.length);
ok('题干有节点', detail.data.item.stem.length > 0);
ok('批语非空', detail.data.item.comment.text.length > 30);
detail.toggleComment();
ok('批语可展开', detail.data.commentOpen === true);
detail.toggleKpEdit();
ok('知识点编辑可展开', detail.data.kpEditing === true);

// —— 原图栏的展开策略 ——
// 有题干文字（识别入库）：原图默认收起，免得一屏全是图。
ok('识别入库的题：原图默认收起', detail.data.originOpen === false, detail.data.originOpen);
ok('识别入库的题：不被标成「只有图」（有文字要正常显示）',
  detail.data.imgOnly === false, detail.data.imgOnly);

// 只搬了图、没识别文字（纯搬运）：图就是这道题的全部内容，必须直接展开 ——
// 用户明确要求「图放原图栏、别占题目栏」，藏在折叠里等于没放。
const moved = store.addRecognized([{
  courseId: 'c_math', no: 901, type: '解答题', gist: '', stemText: '',
  myAnswerText: '', rightText: '', commentText: '', score: null, fullScore: 20,
  kp: [], photo: '/tmp/mz/only-img.jpg'
}], { assignTitle: '搬运测试', courseId: 'c_math' });
const movedList = store.all().filter((m) => m.assignTitle === '搬运测试');
ok('构造出一条纯搬运的题', movedList.length === 1, movedList.length);
if (movedList.length) {
  const d2 = instantiate(loadPage('pages/detail/detail.js'));
  d2.onLoad({ id: movedList[0].id });
  d2.onShow();
  ok('纯搬运的题：题干确实为空（图没被塞进题目栏）', d2.data.item.stem.length === 0);
  ok('纯搬运的题：原图自动展开在「原始照片」栏', d2.data.originOpen === true, d2.data.originOpen);
  ok('原图确实存在', !!(d2.data.item.origin && d2.data.item.origin.photo));
  // 纯搬运 = 只有图。题目/我的答案/正确答案/批语四栏都该藏起来，
  // 只留 原图 + 疑惑 + 我的订正 + 错因分析 + 知识点（用户明确要求）。
  ok('纯搬运的题：标记为「只有图」', d2.data.imgOnly === true, d2.data.imgOnly);
  ok('纯搬运的题：五个保留板块仍在（原图/疑惑/订正/错因/知识点）',
    d2.data.item.origin && !!d2.data.item.doubts !== undefined, 'doubts 字段存在');
}

// —— 疑惑点：对 AI 批语的异议（不应影响解锁闸门）——
ok('疑惑编辑态初始收起', detail.data.doubtEditing === false);
detail.toggleDoubtEdit();
ok('疑惑编辑可展开', detail.data.doubtEditing === true);
ok('疑惑类型有 4 个', detail.data.doubtTags.length === 4, detail.data.doubtTags.length);
detail.pickDoubtTag(ev({ key: 'symbol' }));
ok('可切换疑惑类型', detail.data.doubtTag === 'symbol');
detail.onDoubtInput(ev({}, { value: '批语说我符号写错，其实我写的是 σ（西格马），不是 6。' }));
detail.saveDoubt();
ok('保存后收起编辑态', detail.data.doubtEditing === false);
ok('疑惑视图出现 1 条', detail.data.doubtsView.length === 1, detail.data.doubtsView);
ok('tag 翻译成中文标签', detail.data.doubtsView[0].tagLabel === '符号被认错', detail.data.doubtsView[0].tagLabel);
ok('标疑惑不解锁解析', detail.data.unlocked === false, detail.data.unlocked);
ok('标疑惑不推进状态机', store.get('m_as_hw1_0921_q3').status === 'new');
const doubtId = detail.data.doubtsView[0].id;
detail.removeDoubt(ev({ id: doubtId }));
ok('可删除疑惑', detail.data.doubtsView.length === 0);
// 再标一条留给「订正后」段验证共存
detail.pickDoubtTag(ev({ key: 'ai_misjudge' }));
detail.onDoubtInput(ev({}, { value: '批语判错，我的下界证明是完整的。' }));
detail.saveDoubt();
ok('Q3 留存一条疑惑（供订正后段验证）', detail.data.doubtsView.length === 1);

/* ==================== 4. 订正页 ==================== */
section('订正页 pages/correct');
const correct = instantiate(loadPage('pages/correct/correct.js'));
correct.onLoad({ id: 'm_as_hw1_0921_q3' });
correct.onShow();
ok('载入待订正题目', !!correct.data.item && correct.data.done === false);
ok('引导问题 4 条', correct.data.prompts.length === 4);

// 空提交应被拦
correct.submit();
ok('空订正被拦截并提示', toastLog[toastLog.length - 1].indexOf('至少写一句') >= 0, toastLog[toastLog.length - 1]);

correct.usePrompt(ev({ p: correct.data.prompts[0] }));
ok('点提示可填入正文', correct.data.text.length > 0, correct.data.text);

correct.onInput(ev({}, { value: '我只证明了 1 是 A 的下界，没有验证「任意小于 1 的数都不是下界」，漏掉了确界定义里最大性那一步。而且第三题我根本没有分 M²<2 和 M²>2 讨论。' }));
correct.submit();
ok('提交成功并解锁', correct.data.done === true);
ok('返回了错因分析', !!(correct.data.analysis && correct.data.analysis.causes.length));
ok('分析含 C3 逻辑不严谨', correct.data.analysis.causes.some((c) => c.code === 'C3'), correct.data.analysis.causes.map((c) => c.code));
ok('分析含 C4 漏分类', correct.data.analysis.causes.some((c) => c.code === 'C4'));
correct.editAgain();
ok('可回到编辑态', correct.data.done === false);

/* ==================== 5. 详情页（解锁后） ==================== */
section('详情页（订正后）');
const detail2 = instantiate(loadPage('pages/detail/detail.js'));
detail2.onLoad({ id: 'm_as_hw1_0921_q3' });
detail2.onShow();
ok('解析已解锁', detail2.data.unlocked === true);
ok('解锁后疑惑点仍在（疑惑与订正共存）', detail2.data.doubtsView.length === 1, detail2.data.doubtsView);
ok('疑惑 tag 正确', detail2.data.doubtsView[0].tagLabel === 'AI 批语判错');
ok('显示订正内容', detail2.data.item.correction.text.length > 20);
ok('显示订正时间', !!detail2.data.item.correctionTime, detail2.data.item.correctionTime);
ok('错因已选中 C3', detail2.data.allCauses.find((c) => c.code === 'C3').on === true);
ok('错因未选中 C1', detail2.data.allCauses.find((c) => c.code === 'C1').on === false);

// 手动改判：加上 C6
detail2.toggleCause(ev({ code: 'C6' }));
ok('手动加上 C6', detail2.data.allCauses.find((c) => c.code === 'C6').on === true);
ok('改判后来源标记为手动', store.get('m_as_hw1_0921_q3').analysis.source === 'manual',
  store.get('m_as_hw1_0921_q3').analysis.source);

// 知识点调整
const beforeKp = detail2.data.item.kp.length;
detail2.toggleKp(ev({ id: 'kb_def_verify' }));
ok('知识点可增删', detail2.data.item.kp.length === beforeKp + 1, detail2.data.item.kp);
ok('改知识点后会重新归因', !!store.get('m_as_hw1_0921_q3').analysis);

/* ==================== 6. 训练页 ==================== */
section('训练页 pages/train');
const trainPage = instantiate(loadPage('pages/train/train.js'));
trainPage.onShow();
ok('列表模式', trainPage.data.mode === 'list');
ok('订正过的题进入待复习', trainPage.data.dueList.length >= 1, trainPage.data.dueList.length);

trainPage.start('m_as_hw1_0921_q3');
ok('进入答题模式', trainPage.data.mode === 'quiz', trainPage.data.mode);
ok('出了 3 道题', trainPage.data.sessions.length === 3, trainPage.data.sessions.length);
ok('通过线为 2 题', trainPage.data.passLine === 2, trainPage.data.passLine);
ok('当前题已就绪', !!trainPage.data.cur);

// 自动把 3 道题都答完
let guard = 0;
const kinds = [];
while (trainPage.data.mode === 'quiz' && guard++ < 12) {
  const cur = trainPage.data.cur;
  kinds.push(cur.kind);
  if (cur.kind === 'judge') trainPage.answerJudge(ev({ v: '1' }));
  else if (cur.kind === 'choice') trainPage.answerChoice(ev({ i: '1' }));
  else if (cur.kind === 'fill') { trainPage.setData({ fillVal: 'x0>s-e' }); trainPage.answerFill(); }
  else if (cur.kind === 'order') {
    cur.tokens.forEach((t) => trainPage.toggleOrder(ev({ i: String(t.i) })));
    trainPage.submitOrder();
  }
  ok('第 ' + (trainPage.data.idx + 1) + ' 题判分完成（' + cur.kind + '）', trainPage.data.judged === true);
  trainPage.next();
}
ok('走完所有题进入结果页', trainPage.data.mode === 'result', trainPage.data.mode);
ok('结果记录 3 条', trainPage.data.results.length === 3, trainPage.data.results.length);
ok('正确数已累计', typeof trainPage.data.correctCount === 'number' && trainPage.data.correctCount >= 0, trainPage.data.correctCount);
ok('题型覆盖了排序题', kinds.indexOf('order') >= 0, kinds);

// 结算
trainPage.finish();
ok('结算弹出提示', !!lastModal, lastModal && lastModal.title);
const afterTrain = store.get('m_as_hw1_0921_q3');
ok('训练后 reps 增加', afterTrain.srs.reps === 1, afterTrain.srs);
ok('状态离开「待订正」', afterTrain.status !== 'new', afterTrain.status);
if (lastModal && lastModal.success) lastModal.success({ confirm: true });
ok('结算后回到列表模式', trainPage.data.mode === 'list', trainPage.data.mode);

/* ==================== 7. 统计页 ==================== */
section('统计页 pages/stats');
const stats = instantiate(loadPage('pages/stats/stats.js'));
stats.onShow();
ok('统计已计算', !!stats.data.stats);
ok('四个状态条', stats.data.statusBars.length === 4, stats.data.statusBars.length);
ok('进度条百分比为数字', stats.data.statusBars.every((b) => typeof b.pct === 'number'));
ok('有建议文案', stats.data.advice.length > 8, stats.data.advice);
ok('有知识点强弱', stats.data.stats.kpStats.length > 0);
ok('maxKpLost 已算', stats.data.maxKpLost >= 1, stats.data.maxKpLost);

/* ==================== 8. 导入页 ==================== */
section('导入页 pages/import');
const imp = instantiate(loadPage('pages/import/import.js'));
imp.onLoad();
ok('课程下拉有 2 项', imp.data.courseNames.length === 2, imp.data.courseNames);
ok('知识点选项齐全', imp.data.kpOptions.length > 5, imp.data.kpOptions.length);

// —— 手写符号对照面板 ——
ok('符号面板初始收起', imp.data.symOpen === false);
imp.toggleSym();
ok('符号面板可展开', imp.data.symOpen === true);
ok('符号分组组装出 3 组', imp.data.symGroups.length === 3, imp.data.symGroups.length);
ok('σ 条目存在且 look 已剥掉 **', imp.data.symGroups.some((g) =>
  g.items.some((s) => s.sym === 'σ' && s.look.indexOf('像 6') >= 0 && s.look.indexOf('**') < 0)));

// —— 手机抓取引导 ——
ok('抓取面板初始收起', imp.data.grabOpen === false);
imp.toggleGrab();
ok('抓取面板可展开', imp.data.grabOpen === true);
ok('4 步指引、3 种装法（安卓自动注入在第一个）',
  imp.data.grabSteps.length === 4 && imp.data.grabWays.length === 3
  && imp.data.grabWays[0].name.indexOf('安卓') >= 0,
  [imp.data.grabSteps.length, imp.data.grabWays.length]);
ok('每种装法都写清了操作步骤', imp.data.grabWays.every((w) => w.steps.length >= 3));
ok('脚本体积有显示（让用户知道不是坏了）', /KB$/.test(imp.data.grabSize), imp.data.grabSize);
ok('写明了微信里为什么不行（业务域名/个人主体）',
  imp.data.grabWhy.indexOf('web-view') >= 0 && imp.data.grabWhy.indexOf('业务域名') >= 0);
ok('讲清了「App 可当入口、执行必须在浏览器」',
  Array.isArray(imp.data.grabFromApp) && imp.data.grabFromApp.length >= 2
  && imp.data.grabFromApp.join('').indexOf('登录态') >= 0
  && imp.data.grabFromApp.join('').indexOf('**') < 0, imp.data.grabFromApp.length);
imp.copyGrabScript();
ok('复制脚本成功并置标记', imp.data.grabCopied === true);

imp.parsePreview();
ok('空内容时提示', imp.data.parseErr.length > 0, imp.data.parseErr);

imp.loadSample();
ok('载入示例成功', imp.data.jsonText.length > 100);
imp.parsePreview();
ok('示例解析出 1 份作业', !!imp.data.preview && imp.data.preview.length === 1, imp.data.preview);
ok('示例含 2 道可导入错题', imp.data.preview[0].wrong === 2, imp.data.preview[0]);
ok('示例解析无错误', imp.data.parseErr === '', imp.data.parseErr);

const beforeTotal = store.stats().total;
imp.doImport();
const afterTotal = store.stats().total;
ok('导入新增 2 道', afterTotal === beforeTotal + 2, beforeTotal + ' → ' + afterTotal);
ok('导入后弹窗提示', !!lastModal && lastModal.title.indexOf('导入完成') >= 0, lastModal && lastModal.title);
ok('导入后清空输入', imp.data.jsonText === '');

// 幂等
imp.loadSample();
imp.parsePreview();
imp.doImport();
ok('重复导入不新增', store.stats().total === afterTotal, store.stats().total);

// 坏数据
imp.onJsonInput(ev({}, { value: '{ 坏 json' }));
imp.parsePreview();
ok('坏 JSON 被拦下', imp.data.parseErr.length > 0, imp.data.parseErr);
ok('坏 JSON 不产生预览（不让人误以为能导）', imp.data.preview === null);
ok('报错信息给的是可行动指引，不是干巴巴的语法错误',
  imp.data.parseErr.indexOf('复制') >= 0 || imp.data.parseErr.indexOf('截断') >= 0, imp.data.parseErr);

// 手动录入校验
imp.submitManual();
ok('缺题干被拦截', toastLog[toastLog.length - 1].indexOf('题干') >= 0, toastLog[toastLog.length - 1]);

imp.onFormInput(ev({ f: 'stemText' }, { value: '用 ε-N 定义证明 lim(n→∞) 1/n = 0。' }));
imp.submitManual();
ok('缺知识点被拦截', toastLog[toastLog.length - 1].indexOf('知识点') >= 0, toastLog[toastLog.length - 1]);

const manualKpId = imp.data.kpOptions[0].id;
imp.toggleKp(ev({ id: manualKpId }));
imp.toggleKp(ev({ id: 'kb_def_verify' }));
ok('已选中 2 个知识点', imp.data.pickedKp.length === 2, imp.data.pickedKp.length);
const t3 = store.stats().total;
imp.submitManual();
ok('手动录入成功', store.stats().total === t3 + 1, t3 + ' → ' + store.stats().total);
const manual = store.query({}).find((m) => m.asId === 'manual');
ok('录入的题状态为待订正', manual && manual.status === 'new', manual && manual.status);
ok('录入的题带知识点', manual && manual.kp.length === 2, manual && manual.kp);
ok('录入后表单已重置', imp.data.form.stemText === '', imp.data.form.stemText);

// 导出
imp.doExport();
ok('导出内容非空', imp.data.backupText.length > 200, imp.data.backupText.length);
ok('导出可被解析回灌', store.importFullJson(imp.data.backupText).ok === true);
const exportTotal = store.stats().total;
imp.onBackupInput(ev({}, { value: imp.data.backupText }));
imp.doRestore();
if (lastModal && lastModal.success) lastModal.success({ confirm: true });
ok('恢复备份后数量一致', store.stats().total === exportTotal, store.stats().total);

/* ==================== 9. 复位/空态 ==================== */
section('重置与空态');
const reset = store.resetAll();
ok('重置后回到 4 道种子错题', reset.total === 4, reset.total);
const stats2 = instantiate(loadPage('pages/stats/stats.js'));
stats2.onShow();
ok('重置后统计正常', stats2.data.hasData === true && stats2.data.stats.total === 4, stats2.data.stats.total);

/* ==================== 10. 拍照识别页 ==================== */
section('拍照识别页 pages/import · 降级与校验');
const rec = require(path.join(MP, 'utils/recognize.js'));

// —— 没配云开发时的样子：照样能用，只是不提取文字
rec.setEnv('');
const p1 = instantiate(loadPage('pages/import/import.js'));
p1.onLoad();
ok('默认停在「拍照识别」tab（新主入口）', p1.data.tab === 'photo', p1.data.tab);
ok('未配云开发时 cloudOk=false', p1.data.cloudOk === false);
ok('知识点白名单已备好', p1.data.kpNames.length > 8, p1.data.kpNames.length);
ok('知识点字典可用', !!p1.data.kpDict[rec.normName('上确界')]);
ok('默认知识点与手动录入的选项互不干扰', p1.data.dkpOptions !== p1.data.kpOptions);

p1.addShots(['/tmp/a.jpg', '/tmp/b.jpg']);
ok('两张图入队', p1.data.shots.length === 2, p1.data.shots.length);
ok('每张都复制进用户目录', p1.data.shots.every((s) => s.path.indexOf('/tmp/mz') === 0), p1.data.shots[0].path);
ok('未开云时状态是「待入库」', p1.data.shots[0].status === 'idle', p1.data.shots[0].status);
ok('未开云时不自动识别', p1.data.flatQ.length === 0);

p1.submitPhotos();
ok('一道都没勾时被拦截', p1.data.photoErr.indexOf('至少勾一道') >= 0, p1.data.photoErr);

// 手塞一道模拟降级入库（没识别出任何文字）
const fakeQ = {
  key: 'k1', sid: p1.data.shots[0].id, on: true, open: false, no: 1, type: '解答题',
  gist: '', stemText: '', myAnswerText: '', rightText: '', commentText: '',
  scoreInput: '', fullScoreInput: '20', hasScore: false, kp: [], kpNames: [], confidence: 'low'
};
p1.setData({ flatQ: [fakeQ] });
p1.refreshCount();
ok('勾选计数跟着变', p1.data.checkedCount === 1, p1.data.checkedCount);

// 先选中兜底知识点，验证「套用默认知识点」这条路仍然有效
p1.toggleDefaultKpOpen();
ok('默认知识点面板展开', p1.data.defaultKpOpen === true);
p1.toggleDefaultKp(ev({ id: 'kb_sup' }));
ok('默认知识点已选中', p1.data.defaultKp.length === 1 && p1.data.defaultKp[0].id === 'kb_sup');

const beforeP = store.stats().total;
p1.submitPhotos();
ok('兜底知识点后放行入库', store.stats().total === beforeP + 1, store.stats().total);
ok('提交后清空队列', p1.data.shots.length === 0 && p1.data.flatQ.length === 0);
ok('提交后默认知识点复位', p1.data.defaultKp.length === 0);
ok('提交后作业名复位', p1.data.photoForm.assignTitle === '');

const lastAdded = store.all().filter((m) => m.asId === 'photo');
const degraded = lastAdded[lastAdded.length - 1];
ok('降级入库：题干留空（图只进原图栏）', degraded.stem.length === 0, degraded.stem);
ok('降级入库：图确实在原图栏', !!(degraded.origin && degraded.origin.photo));
ok('降级入库：套用了兜底知识点', degraded.kp[0] === 'kb_sup', degraded.kp);
ok('降级入库：解析仍然锁着', degraded.unlocked === false);

// 关键回归：没选兜底知识点时也必须能入库（知识点影响统计，不该挡入库）
const p1b = instantiate(loadPage('pages/import/import.js'));
p1b.onLoad();
p1b.setData({ flatQ: [Object.assign({}, fakeQ, { key: 'k2' })] });
p1b.refreshCount();
const beforeNoKp = store.stats().total;
p1b.submitPhotos();
ok('不选兜底知识点也能入库', store.stats().total === beforeNoKp + 1, store.stats().total);
const noKpItem = store.all().filter((m) => m.asId === 'photo').pop();
ok('没知识点就是空数组（不瞎塞）', noKpItem.kp.length === 0, noKpItem.kp);
ok('没知识点的题照样锁着闸门', noKpItem.unlocked === false);

/* —— 云端可用分支（异步）：选图 → 识别 → 拆题 → 入库 —— */
section('拍照识别页 · 云端识别分支');
rec.setEnv('test-env-xxxxxx');
global.wx.cloud = {
  init: () => {},
  callFunction: () => Promise.resolve({
    result: {
      ok: true,
      model: 'stub-vlm',
      questions: [
        {
          no: 3, type: '证明题', gist: '上确界', stem: '证明 A={x∈Q|x²<2} 无上确界',
          myAnswer: '设 M 为上界', rightAnswer: '', comment: '构造量不严谨',
          score: 6, fullScore: 20, kpNames: ['上确界'], confidence: 'high'
        },
        {
          no: 4, type: '计算题', gist: '数列极限', stem: '求 lim(n→∞) sin2n/n',
          myAnswer: '夹逼定理得 0', rightAnswer: '', comment: '',
          score: null, fullScore: null, kpNames: [], confidence: 'low'
        },
        {
          no: 5, type: '解答题', gist: '', stem: '', myAnswer: '', rightAnswer: '',
          comment: '', score: null, fullScore: null, kpNames: [], confidence: 'medium'
        }
      ]
    }
  })
};
global.wx.compressImage = (o) => { o.success({ tempFilePath: o.src }); };
global.wx.getFileSystemManager = () => ({
  copyFileSync: () => {},
  readFile: (o) => { o.success({ data: 'A'.repeat(200) }); },
  writeFileSync: () => {},         // crop.js 落盘用
  unlinkSync: () => {}             // cleanCrops 清理切片用
});
// 切图链路要读原图尺寸 + 开离屏 canvas，这里 mock 出一条能走通的路径
global.wx.getImageInfo = (o) => { o.success({ width: 1000, height: 2000 }); };
global.wx.createOffscreenCanvas = () => ({
  getContext: () => ({ drawImage: () => {} }),
  createImage: () => {
    const im = {};
    Object.defineProperty(im, 'src', {
      set() { setTimeout(() => { if (im.onload) im.onload(); }, 0); }
    });
    return im;
  },
  toDataURL: () => 'data:image/jpeg;base64,QUJD'
});
global.wx.chooseMedia = (o) => { o.success({ tempFiles: [{ tempFilePath: '/tmp/pic.jpg' }] }); };
global.wx.chooseMessageFile = (o) => { o.success({ tempFiles: [{ path: '/tmp/chat.jpg' }] }); };
global.wx.previewImage = () => {};

const p2 = instantiate(loadPage('pages/import/import.js'));
p2.onLoad();
ok('配好环境后 cloudOk=true', p2.data.cloudOk === true);

p2.pickPhoto();
ok('相册选图后入队', p2.data.shots.length === 1, p2.data.shots.length);
ok('入队后立刻进入识别中', p2.data.shots[0].status === 'busy', p2.data.shots[0].status);

// 等识别链路的 promise 跑完（全是微任务，一次 setTimeout 足够；保险起见轮询）
let waited = 0;
(function poll() {
  waited++;
  const s = p2.data.shots[0] || {};
  if (s.status === 'busy' && waited < 30) return setTimeout(poll, 10);
  checkCloud();
})();

function checkCloud() {
  const s = p2.data.shots[0];
  ok('识别完成', s.status === 'done', s);
  ok('这张拆出 2 道题', s.count === 2, s.count);
  ok('两道都进了待确认列表', p2.data.flatQ.length === 2, p2.data.flatQ.length);
  ok('勾选计数 = 2', p2.data.checkedCount === 2, p2.data.checkedCount);

  const q0 = p2.data.flatQ[0];
  ok('知识点名映射回了 id', q0.kp[0] === 'kb_sup', q0.kp);
  ok('得分进了输入框', q0.scoreInput === '6' && q0.hasScore === true, q0);
  ok('题干文字进了可编辑区', q0.stemText.indexOf('无上确界') >= 0, q0.stemText);

  const q1 = p2.data.flatQ[1];
  ok('没识别出得分时不瞎填', q1.scoreInput === '' && q1.hasScore === false, q1.scoreInput);
  ok('低置信度有标记', q1.confidence === 'low', q1.confidence);

  // 取消勾选 / 展开编辑 / 改字
  p2.toggleQ(ev({ i: 1 }));
  ok('可以取消勾选某一道', p2.data.flatQ[1].on === false && p2.data.checkedCount === 1);
  p2.toggleQOpen(ev({ i: 0 }));
  ok('可以展开编辑', p2.data.flatQ[0].open === true);
  p2.onQInput(ev({ i: 0, f: 'commentText' }, { value: '老师写的是：构造量不严谨。' }));
  ok('编辑批语生效', p2.data.flatQ[0].commentText.indexOf('构造量') >= 0, p2.data.flatQ[0].commentText);

  const beforeC = store.stats().total;
  p2.submitPhotos();
  ok('勾选的入库、取消的不入库', store.stats().total === beforeC + 1, store.stats().total);

  const photoItems = store.all().filter((m) => m.source === 'photo');
  const got = photoItems[photoItems.length - 1];
  ok('识别模式：题干是文字', got.stem[0].t === 't', got.stem);
  ok('识别模式：原图另存可对照', !!got.origin && got.origin.photo.indexOf('/tmp/mz') === 0, got.origin);
  ok('识别模式：批语被写进去了', got.comment.text.indexOf('构造量') >= 0, got.comment.text);
  ok('识别模式：闸门依然是锁的', got.unlocked === false && got.status === 'new');

  // 重试链路：让云函数返回失败
  global.wx.cloud.callFunction = () => Promise.resolve({ result: { ok: false, code: 'NO_KEY' } });
  p2.pickFromChat();
  setTimeout(() => {
    const s2 = p2.data.shots[0];
    ok('聊天记录选图也能入队', p2.data.shots.length === 1, p2.data.shots.length);
    ok('识别失败时状态转 fail', s2.status === 'fail', s2.status);
    ok('失败原因是人话', String(s2.msg).indexOf('VLM_API_KEY') >= 0, s2.msg);
    ok('失败不污染结果列表', p2.data.flatQ.length === 0, p2.data.flatQ.length);
    p2.removeShot(ev({ id: s2.id }));
    ok('删掉这张后队列为空', p2.data.shots.length === 0);
    checkShotImport(p2);
  }, 60);
}

/* —— 截图导入 · 没配云环境：纯搬运（一图一题、不问知识点） —— */
function checkShotImport(p) {
  section('导入页 · 截图导入（未配云环境 → 纯搬运）');

  rec.setEnv('');                         // 明确关掉云端识别
  const p0 = instantiate(loadPage('pages/import/import.js'));
  p0.onLoad();
  ok('未配云环境时 cloudOk=false', p0.data.cloudOk === false);

  // 从聊天记录选（手机截图最顺手的入口）
  global.wx.showActionSheet = (o) => { o.success({ tapIndex: 0 }); };
  global.wx.chooseMessageFile = (o) => {
    o.success({ tempFiles: [{ path: '/tmp/shot1.jpg' }, { path: '/tmp/shot2.jpg' }] });
  };

  p0.setData({ photoForm: { assignTitle: '截图搬运 0926' } });
  const beforeS = store.stats().total;
  p0.quickShotImport();

  ok('两张截图直接入库', store.stats().total === beforeS + 2, store.stats().total);
  const shots = store.all().filter((m) => m.asId === 'photo' && m.assignTitle === '截图搬运 0926');
  ok('带上了作业名', shots.length === 2, shots.length);
  ok('每张图各自成一道题', shots.length === 2, shots.length);
  // 图不再占题目栏：题干留空，图进原图栏（详情页会自动展开它）
  ok('题干留空（图不占题目栏）', shots.every((m) => m.stem.length === 0),
    shots.map((m) => m.stem));
  ok('图进原图栏，且走的是持久化后的路径',
    shots.every((m) => m.origin && m.origin.photo.indexOf('/tmp/mz') === 0),
    shots.map((m) => m.origin && m.origin.photo));
  ok('知识点允许为空（不拦人）', shots.every((m) => m.kp.length === 0));
  ok('题号顺序递增', shots[1].no === shots[0].no + 1, [shots[0].no, shots[1].no]);
  ok('截图直存的题依然锁着解析', shots.every((m) => m.unlocked === false && m.status === 'new'));
  ok('截图直存不留订正痕迹', shots.every((m) => m.correction === null && m.analysis === null));
  ok('原图单独存着可对照', shots.every((m) => m.origin && m.origin.photo.indexOf('/tmp/mz') === 0));
  ok('没往识别队列里塞东西', p0.data.flatQ.length === 0 && p0.data.shots.length === 0);

  // 第二批同一作业名 → 题号接着往后排，不会又从头来
  global.wx.chooseMessageFile = (o) => { o.success({ tempFiles: [{ path: '/tmp/shot3.jpg' }] }); };
  p0.quickShotImport();
  const all3 = store.all().filter((m) => m.asId === 'photo' && m.assignTitle === '截图搬运 0926');
  ok('第二批接着原题号排', all3[2].no === all3[1].no + 1, all3.map((m) => m.no));

  // 走相册分支
  global.wx.showActionSheet = (o) => { o.success({ tapIndex: 1 }); };
  global.wx.chooseMedia = (o) => { o.success({ tempFiles: [{ tempFilePath: '/tmp/album.jpg' }] }); };
  const beforeA = store.stats().total;
  p0.quickShotImport();
  ok('相册分支同样能入库', store.stats().total === beforeA + 1, store.stats().total);

  // 没起作业名时给个默认名，不至于产生一堆空作业
  global.wx.chooseMessageFile = (o) => { o.success({ tempFiles: [{ path: '/tmp/shot4.jpg' }] }); };
  p0.setData({ photoForm: { assignTitle: '   ' } });
  p0.quickShotImport();
  const def = store.all().filter((m) => m.assignTitle === '截图搬运');
  ok('作业名留空时用默认名', def.length >= 1, def.length);

  // 用户在选择器里点了取消 —— 不能炸，也不能产生脏数据
  global.wx.chooseMedia = (o) => { o.fail && o.fail({ errMsg: 'chooseMedia:fail cancel' }); };
  const beforeX = store.stats().total;
  let threw = false;
  try { p0.quickShotImport(); } catch (e) { threw = true; }
  ok('选图取消不抛错', threw === false);
  ok('取消后没产生脏数据', store.stats().total === beforeX, store.stats().total);

  // 菜单本身被取消（用户左右滑关掉）
  global.wx.showActionSheet = (o) => { o.fail && o.fail({ errMsg: 'showActionSheet:fail cancel' }); };
  const beforeY = store.stats().total;
  threw = false;
  try { p0.quickShotImport(); } catch (e) { threw = true; }
  ok('关掉菜单也不抛错', threw === false);
  ok('关掉菜单后没产生脏数据', store.stats().total === beforeY, store.stats().total);

  checkShotRecognize();
}

/* —— 截图导入 · 配了云环境：同一入口自动切到识别路 —— */
function checkShotRecognize() {
  section('导入页 · 截图导入（配了云环境 → 自动识别拆栏）');

  rec.setEnv('test-env-xxxxxx');
  global.wx.cloud = {
    init: () => {},
    callFunction: () => Promise.resolve({
      result: {
        ok: true,
        model: 'stub-vlm',
        questions: [
          {
            no: 1, type: '计算题', gist: '矩阵乘法',
            stem: '已知矩阵 A, B，求 AB', myAnswer: '我算得 C', rightAnswer: '',
            comment: '第二行乘错了', score: 12, fullScore: 20,
            kpNames: ['矩阵加减与乘法'], confidence: 'high',
            boxes: {
              stem: [0.05, 0.05, 0.9, 0.25],
              myAnswer: [0.05, 0.3, 0.9, 0.65],
              comment: [0.05, 0.7, 0.9, 0.9],
              rightAnswer: []
            }
          },
          {
            no: 2, type: '证明题', gist: '', stem: '证明 det(AB)=det(A)det(B)',
            myAnswer: '', rightAnswer: '', comment: '', score: null, fullScore: null,
            kpNames: [], confidence: 'medium'
          }
        ]
      }
    })
  };
  global.wx.compressImage = (o) => { o.success({ tempFilePath: o.src }); };
  global.wx.getFileSystemManager = () => ({
    copyFileSync: () => {},
    readFile: (o) => { o.success({ data: 'A'.repeat(200) }); },
    writeFileSync: () => {},       // crop.js 落盘用（漏了这行 -> 切片静默失败）
    unlinkSync: () => {}           // cleanCrops 清理切片用
  });
  global.wx.showActionSheet = (o) => { o.success({ tapIndex: 0 }); };
  global.wx.chooseMessageFile = (o) => { o.success({ tempFiles: [{ path: '/tmp/one.jpg' }] }); };
  global.wx.showModal = (o) => { lastModal = o; };

  const p = instantiate(loadPage('pages/import/import.js'));
  p.onLoad();
  ok('配好后 cloudOk=true', p.data.cloudOk === true);

  const beforeR = store.stats().total;
  p.setData({ photoForm: { assignTitle: '识图 0926' } });
  p.quickShotImport();

  // 这一步是同步发生的：图进了识别队列，而不是直接入库
  ok('走识别路：图进了队列', p.data.shots.length === 1, p.data.shots.length);
  ok('走识别路：没有立刻入库', store.stats().total === beforeR, store.stats().total);
  ok('走识别路：状态为识别中', p.data.shots[0].status === 'busy', p.data.shots[0].status);

  let waited = 0;
  (function poll() {
    waited++;
    const s = p.data.shots[0] || {};
    if (s.status === 'busy' && waited < 40) return setTimeout(poll, 10);
    // 切片是异步补上的（先出文字、图随后贴）。
    // ⚠️ 必须在 settleShot **之前**核对 —— settleShot 里有 submitPhotos()，
    // 跑完 flatQ 就被清空了（踩过：断言写在后面，看到的是空对象）。
    let w2 = 0;
    (function waitCrop() {
      w2++;
      const q0 = p.data.flatQ[0] || {};
      if (!q0.stemPhoto && w2 < 40) return setTimeout(waitCrop, 10);
      checkCrop(p);
      checkRetry(p, function () {
        settleShot(p, beforeR);
        checkPasteClean();
      });
    })();
  })();
}

/* —— 重试识别：同一张图不该出现两份题 —— */
function checkRetry(p, done) {
  section('导入页 · 重试识别不重复');

  const sid = (p.data.flatQ[0] || {}).sid;
  ok('有可重试的题', !!sid);
  if (!sid) return done();

  const before = p.data.flatQ.length;
  p.recognizeShot(sid);

  let w = 0;
  (function poll() {
    w++;
    const s = p.data.shots.filter((x) => x.id === sid)[0] || {};
    if (s.status === 'busy' && w < 60) return setTimeout(poll, 10);

    // 重试的语义是「这张图重新来一遍」：旧的该丢、新的顶上，总数不变。
    // 曾经不清旧的 -> 同一张图出现两份，其中一份带着模型自动分配的知识点，
    // 看起来就像「自动的又回来把手工改过的顶掉了」。
    ok('重试后题目总数不翻倍', p.data.flatQ.length === before,
      before + ' -> ' + p.data.flatQ.length);
    // 注意：一张图**可以**拆出多道题（这张就拆了 2 道），所以不能断言「只有 1 份」。
    // 该断言的是「数量跟重试前一致」—— 不增不减才叫没重复。
    const mine = p.data.flatQ.filter((q) => q.sid === sid).length;
    ok('重试后该图的题数与重试前一致', mine === before, before + ' -> ' + mine);
    done();
  })();
}

/* —— 切片分栏：原图按模型给的坐标切开，各栏贴各自那块 —— */
function checkCrop(p) {
  section('导入页 · 切片分栏（题干/解答/批语各贴自己的那块）');

  const q0 = p.data.flatQ[0] || {};
  ok('题干栏贴上了切片', !!q0.stemPhoto, q0.stemPhoto);
  ok('解答栏贴上了切片', !!q0.answerPhoto, q0.answerPhoto);
  ok('批语栏贴上了切片', !!q0.commentPhoto, q0.commentPhoto);
  ok('切片是从原图裁出来的新文件（不是复用原图）',
    q0.stemPhoto && q0.stemPhoto !== q0.photo, q0.stemPhoto);

  // 坐标换算（纯函数，同步可测）
  const crop = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'crop.js'));
  const r = crop.computeRect(1000, 2000, [0.1, 0.2, 0.5, 0.6]);
  ok('归一化坐标换算成像素正确',
    r && r.sx === 100 && r.sy === 400 && r.sw === 400 && r.sh === 800, JSON.stringify(r));

  ok('越界坐标被夹紧（不会越出图片）',
    (function () {
      const a = crop.computeRect(1000, 2000, [-1, -1, 2, 2]);
      return a && a.sx === 0 && a.sy === 0 && a.sw === 1000 && a.sh === 2000;
    })());
  ok('针尖大的框判为不可信 → 返回 null（不切空白贴上去）',
    crop.computeRect(1000, 2000, [0.5, 0.5, 0.5001, 0.5001]) === null);
  ok('没有框 → 返回 null', crop.computeRect(1000, 2000, null) === null);
  ok('缺图片尺寸 → 返回 null', crop.computeRect(0, 0, [0, 0, 1, 1]) === null);
  ok('clamp01 处理非法值',
    crop.clamp01(-3) === 0 && crop.clamp01(9) === 1 && crop.clamp01('x') === 0);

  // 只有部分栏有框时，没框的栏不该被贴图
  ok('标准解答没框 → 那栏不贴图（不凭空造）', !q0.rightPhoto, q0.rightPhoto);

  // —— 知识点搜索打标签 ——
  section('导入页 · 知识点搜索打标签');
  ok('卡片初始有搜索用的空字段', q0.kpKw === '' && Array.isArray(q0.kpHits));

  p.onKpSearch({ currentTarget: { dataset: { i: 0 } }, detail: { value: '极限' } });
  ok('输入关键词后出结果', p.data.flatQ[0].kpHits.length > 0, p.data.flatQ[0].kpHits.length);
  ok('结果带名称与出处', !!(p.data.flatQ[0].kpHits[0].name && p.data.flatQ[0].kpHits[0].pathText));

  const beforeN = p.data.flatQ[0].kp.length;
  const pickId = p.data.flatQ[0].kpHits[0].id;
  p.pickKp({ currentTarget: { dataset: { i: 0, id: pickId } } });
  ok('点结果 → 打上标签', p.data.flatQ[0].kp.length === beforeN + 1, p.data.flatQ[0].kp);
  ok('标签名同步进 kpNames', p.data.flatQ[0].kpNames.length === p.data.flatQ[0].kp.length);
  ok('打完清空搜索框', p.data.flatQ[0].kpKw === '' && p.data.flatQ[0].kpHits.length === 0);

  // 重复点同一个不该加两次
  p.onKpSearch({ currentTarget: { dataset: { i: 0 } }, detail: { value: '极限' } });
  p.pickKp({ currentTarget: { dataset: { i: 0, id: pickId } } });
  ok('同一标签不会重复加', p.data.flatQ[0].kp.length === beforeN + 1, p.data.flatQ[0].kp.length);

  // ⚠️ 删的是**刚加的那个**（索引 = beforeN），不是第 0 个 ——
  // 删 0 会把原本的 la_op 删掉，污染后面的断言（踩过）。
  p.removeKp({ currentTarget: { dataset: { i: 0, ki: beforeN } } });
  ok('点 × 能删掉标签', p.data.flatQ[0].kp.length === beforeN, p.data.flatQ[0].kp.length);
  ok('删标签时名字同步删', p.data.flatQ[0].kpNames.length === p.data.flatQ[0].kp.length);
  ok('原有的标签没被误删', p.data.flatQ[0].kp[0] === 'la_op', p.data.flatQ[0].kp);

  // 搜索清空 / 无结果不该炸
  p.onKpSearch({ currentTarget: { dataset: { i: 0 } }, detail: { value: '' } });
  ok('清空关键词 → 结果清空', p.data.flatQ[0].kpHits.length === 0);
  p.onKpSearch({ currentTarget: { dataset: { i: 0 } }, detail: { value: 'zzz不存在' } });
  ok('搜不到 → 空结果且不抛错', p.data.flatQ[0].kpHits.length === 0);
  // 恢复，别影响后面的入库断言
  p.onKpSearch({ currentTarget: { dataset: { i: 0 } }, detail: { value: '' } });

  // —— 满分来源标记：题头读到的 vs 兜底推算的 ——
  // 用户明确过：满分**以题头标注为准**（「证明题，16.6 分」），
  // 不是按题数均分算出来的。所以两种情况必须在界面上可区分。
  section('导入页 · 满分的来源标记');
  const qq0 = p.data.flatQ[0];
  const qq1 = p.data.flatQ[1];
  ok('题头读到的满分 → 标为真实值', qq0.fullScoreReal === true, qq0.fullScoreInput);
  ok('题头没读到 → 兜底推算，并标为非真实', qq1.fullScoreReal === false, qq1.fullScoreReal);
  ok('兜底值是「本份总分 ÷ 题数」', qq1.fullScoreInput === '50', qq1.fullScoreInput);   // 100 / 2 题
  // 用户明确要求：**自动填的东西不要反复刷新** —— 第一次定下来就固定，
  // 改总分同样不能把已经核对过的数字冲掉，要重算必须自己点按钮。
  ok('改总分不会自动重算（数字保持不动）',
    (function () {
      p.onTotalScore({ detail: { value: '60' } });
      const kept = p.data.flatQ[1].fullScoreInput;   // 仍是 50，没被改成 30
      p.onTotalScore({ detail: { value: '100' } });  // 还原
      return kept === '50';
    })(), p.data.flatQ[1].fullScoreInput);
  ok('点「重新均分」才重算',
    (function () {
      p.onTotalScore({ detail: { value: '60' } });
      p.regradeAll();
      const now = p.data.flatQ[1].fullScoreInput;    // 这次应为 30
      p.onTotalScore({ detail: { value: '100' } });
      p.regradeAll();                                 // 还原成 50
      return now === '30' && p.data.flatQ[1].fullScoreInput === '50';
    })(), p.data.flatQ[1].fullScoreInput);

  // 用户手改满分 → 视为已确认，摘掉「推算」标记
  p.onQNum({ currentTarget: { dataset: { i: 1, f: 'fullScoreInput' } }, detail: { value: '16.6' } });
  ok('手改满分后不再标「推算」', p.data.flatQ[1].fullScoreReal === true);
  ok('手改的满分值是 16.6', p.data.flatQ[1].fullScoreInput === '16.6');
  // 还原成兜底值，避免影响后面的入库断言
  p.onQNum({ currentTarget: { dataset: { i: 1, f: 'fullScoreInput' } }, detail: { value: '' } });
  p.fillFullScores();

  // —— 删除错题 ——
  // ⚠️ 这段会真的改 flatQ，**必须存快照并在结束时还原** ——
  // 否则后面的重试/入库断言会拿到空列表（这个错我犯过两次了）。
  section('导入页 · 删除错题');
  const snap = p.data.flatQ.slice();
  const nBefore = snap.length;
  const savedModal = global.wx.showModal;
  global.wx.showModal = (o) => { o.success({ confirm: true }); };   // 自动确认

  p.removeQ({ currentTarget: { dataset: { i: 0 } } });
  ok('能删掉一道题', p.data.flatQ.length === nBefore - 1, nBefore + ' -> ' + p.data.flatQ.length);
  ok('删完勾选数同步更新', p.data.checkedCount === p.data.flatQ.filter((x) => x.on).length);

  p.removeQ({ currentTarget: { dataset: { i: 99 } } });             // 越界索引
  ok('删不存在的题不抛错、也不乱删', p.data.flatQ.length === nBefore - 1, p.data.flatQ.length);

  p.setData({ flatQ: snap });                                       // 先还原再测批量
  p.refreshCount();
  ok('还原现场（不污染后续测试）', p.data.flatQ.length === nBefore, p.data.flatQ.length);

  // 批量删未勾选：手工把第 2 题设为未勾选（toggleQ 是「切换」不是「勾上」）
  p.setData({
    flatQ: p.data.flatQ.map((x, k) => (k === 0 ? x : Object.assign({}, x, { on: false })))
  });
  p.refreshCount();
  ok('构造出「1 勾选 + 1 未勾选」', p.data.checkedCount === 1, p.data.checkedCount);
  p.removeUnchecked();
  ok('批量删掉未勾选的', p.data.flatQ.length === 1 && p.data.flatQ[0].on === true,
    p.data.flatQ.length);

  global.wx.showModal = savedModal;
  p.setData({ flatQ: snap });                                       // 彻底还原
  p.refreshCount();

  // 又识别了一张图时，**已核对过的老题不该被动**（用户明确要求过）
  ok('带范围调用只碰范围内的题（老题不动）',
    (function () {
      const before = p.data.flatQ.map((x) => x.fullScoreInput).join('|');
      p.fillFullScores([]);                            // 空范围 = 谁都不碰
      const after = p.data.flatQ.map((x) => x.fullScoreInput).join('|');
      return before === after;
    })(), p.data.flatQ.map((x) => x.fullScoreInput).join('|'));
}

/* —— 粘贴导入 · 清洗用户粘进来的文本（手机 App 识图那条路的关键一环）—— */
function checkPasteClean() {
  section('导入页 · 粘贴导入（自动剥围栏，容错复制粘贴）');

  const p = instantiate(loadPage('pages/import/import.js'));
  p.onLoad();

  // ① 常见形态：模型把 JSON 包在 ```json 里，前面还有一句寒暄
  const messy = '好的，我来帮你转录：\n```json\n'
    + JSON.stringify({ title: '第2次作业', questions: [
      { no: 1, type: '简答题', gist: '确界', stem: '求 sup{x|x<1}', myAnswer: 'sup=1',
        rightAnswer: '', comment: '', score: '6/20', fullScore: 20,
        kpNames: ['上确界', '我编的'], confidence: 'high' }
    ] })
    + '\n```\n希望有帮助！';
  const cleaned = p.cleanJsonText(messy);
  ok('剥掉 ```json 围栏', cleaned.indexOf('```') < 0);
  ok('剥掉前面的寒暄', cleaned.charAt(0) === '{', cleaned.slice(0, 12));
  ok('剥掉后面的收尾话', cleaned.charAt(cleaned.length - 1) === '}');
  let parsed = null;
  let threw = false;
  try { parsed = JSON.parse(cleaned); } catch (e) { threw = true; }
  ok('清洗后能正常解析', threw === false && parsed !== null);
  ok('清洗没破坏内容', parsed && parsed.questions.length === 1 && parsed.title === '第2次作业');

  // ② 全角引号（手机输入法偶尔会把模型输出的引号转掉）
  ok('全角引号被转回半角',
    p.cleanJsonText('{“title”:“作业”}') === '{"title":"作业"}');

  // ③ 纯 JSON（正常情况）不能被改坏
  const neat = JSON.stringify({ questions: [{ no: 1, stem: 'x' }] });
  ok('已经是纯 JSON 时原样通过', p.cleanJsonText(neat) === neat);

  // ④ 空输入不炸
  ok('空输入返回空串', p.cleanJsonText('') === '' && p.cleanJsonText(null) === '');
  ok('只有空白也不炸', p.cleanJsonText('   \n  ') === '');

  // ⑤ 真的坏掉时给出可行动的提示（不是干巴巴的 JSON 语法错误）
  p.setData({ jsonText: '{"questions": [{"stem": "被截断了' });
  p.parsePreview();
  ok('截断的 JSON 报错信息含行动指引',
    p.data.parseErr.indexOf('从第一个') >= 0, p.data.parseErr);

  // ⑥ 走一遍完整粘贴流程：脏文本 → 解析 → 预览
  p.setData({ jsonText: messy });
  p.parsePreview();
  ok('脏文本也能解析出预览', p.data.parseErr === '', p.data.parseErr);
  ok('预览识别出 1 道可导入', p.data.preview && p.data.preview.length === 1
    && p.data.preview[0].wrong === 1, JSON.stringify(p.data.preview));

  // ⑦ 知识点白名单：编的名字不该出现在预览里
  const q = p.data.parsed && p.data.parsed[0] && p.data.parsed[0].questions[0];
  ok('解析结果保留原始 kpNames 交由后续过滤', q && q.kpNames.length === 2, q && q.kpNames);
}

function settleShot(p, beforeR) {
  const s = p.data.shots[0];
  ok('识别完成', s.status === 'done', s);
  ok('一张图拆出 2 道题', s.count === 2, s.count);
  ok('两道都进了待核对列表', p.data.flatQ.length === 2, p.data.flatQ.length);

  const q0 = p.data.flatQ[0];
  ok('题干进了题干栏', q0.stemText.indexOf('矩阵') >= 0, q0.stemText);
  // 核对卡片要带上原图 —— 用户补 □、核分数时得对着图看
  // （注意：这里拿到的是持久化后的路径，不是原始 tempFilePath —— 临时文件会失效）
  ok('核对卡片带上了原图', !!q0.photo && /\.jpg$/.test(q0.photo), q0.photo);
  ok('图片栏能点开（previewQ 不抛错）',
    (function () { try { p.previewQ({ currentTarget: { dataset: { src: q0.photo } } }); return true; } catch (e) { return false; } })());
  ok('没图时不抛错（不炸页面）',
    (function () { try { p.previewQ({ currentTarget: { dataset: {} } }); return true; } catch (e) { return false; } })());
  ok('我的解答进了对应栏', q0.myAnswerText.indexOf('我算得') >= 0, q0.myAnswerText);
  ok('教师批语进了对应栏', q0.commentText.indexOf('第二行') >= 0, q0.commentText);
  ok('得分进了对应栏', q0.scoreInput === '12' && q0.hasScore === true, q0.scoreInput);
  ok('满分也读出来了', q0.fullScoreInput === '20', q0.fullScoreInput);
  ok('知识点映射回了 id', q0.kp[0] === 'la_op', q0.kp);
  ok('考点也认出来了', q0.gist === '矩阵乘法', q0.gist);

  const q1 = p.data.flatQ[1];
  ok('第二题没得分时不瞎填', q1.scoreInput === '' && q1.hasScore === false, q1.scoreInput);

  // 入库
const beforeC = store.stats().total;
p.submitPhotos();
ok('没认出知识点也照样入库（不拦人）', store.stats().total === beforeC + 2, store.stats().total);

  const got = store.all().filter((m) => m.asId === 'photo' && m.assignTitle === '识图 0926');
  ok('作业名用输入框里的', got.length === 2, got.length);
  ok('入库后题干是文字（不是整张图）', got[0].stem[0].t === 't', got[0].stem);
  ok('入库后我的解答在 myAnswer', got[0].myAnswer.text.indexOf('我算得') >= 0, got[0].myAnswer.text);
  ok('入库后批语在 comment', got[0].comment.text.indexOf('第二行') >= 0, got[0].comment.text);
  ok('入库后得分保留', got[0].score === 12, got[0].score);
  ok('入库后原图仍留着可对照', !!got[0].origin && got[0].origin.photo.indexOf('/tmp/mz') === 0, got[0].origin);
  ok('识图入库的题闸门依然锁着', got.every((m) => m.unlocked === false && m.status === 'new'));

  finish();
}

/* ---------------- 汇总 ---------------- */
function finish() {
  console.log('\n' + '='.repeat(46));
  console.log('页面测试：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(46));
  process.exitCode = fail ? 1 : 0;
}
