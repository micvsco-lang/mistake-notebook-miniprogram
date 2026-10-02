const store = require('../../utils/store.js');
const train = require('../../utils/train.js');
const fmt = require('../../utils/format.js');

const OPT_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

Page({
  data: {
    mode: 'list',        // list | quiz | result
    dueList: [],
    target: null,
    sessions: [],
    idx: 0,
    cur: null,
    judged: false,
    judgeResult: null,
    fillVal: '',
    orderSel: [],
    orderNo: {},
    results: [],
    correctCount: 0,
    optKeys: OPT_KEYS,
    passLine: 0
  },

  onShow() {
    const g = getApp().globalData;
    if (g.trainTargetId) {
      const id = g.trainTargetId;
      g.trainTargetId = null;
      this.start(id);
      return;
    }
    if (this.data.mode === 'quiz') return;   // 保留进行中的训练
    this.loadDue();
  },

  onPullDownRefresh() {
    if (this.data.mode === 'list') this.loadDue();
    wx.stopPullDownRefresh();
  },

  /* ---------------- 列表模式 ---------------- */
  loadDue() {
    const all = store.query({});
    const due = all.filter((m) => m.status !== 'new' && m.isDue);
    this.setData({
      mode: 'list',
      dueList: due.map(fmt.toBrief)
    });
  },

  startFromList(e) {
    this.start(e.currentTarget.dataset.id);
  },

  /* ---------------- 开始训练 ---------------- */
  start(id) {
    const m = store.get(id);
    if (!m) {
      wx.showToast({ title: '题目不存在', icon: 'none' });
      this.loadDue();
      return;
    }
    if (!m.unlocked) {
      wx.showModal({
        title: '还没订正',
        content: '先写下这道题错在哪，再来训练巩固——顺序对了效果才好。',
        confirmText: '去订正',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: '/pages/correct/correct?id=' + id });
          else this.loadDue();
        }
      });
      return;
    }

    const drills = train.pick(m, 3);
    if (!drills.length) {
      wx.showToast({ title: '这个知识点还没有训练题', icon: 'none' });
      this.loadDue();
      return;
    }

    const sessions = train.makeSession(drills, Date.now() % 1000);
    this.setData({
      mode: 'quiz',
      target: { id: m.id, no: m.no, gist: m.gist, kpNames: m.kpNames },
      sessions: sessions,
      idx: 0,
      cur: sessions[0],
      judged: false,
      judgeResult: null,
      fillVal: '',
      orderSel: [],
      orderNo: {},
      results: [],
      correctCount: 0,
      passLine: Math.ceil(sessions.length * 0.6)
    });
    wx.setNavigationBarTitle({ title: '巩固训练 · Q' + m.no });
  },

  /* ---------------- 作答 ---------------- */
  answerJudge(e) {
    if (this.data.judged) return;
    this.judge(e.currentTarget.dataset.v === '1');
  },

  answerChoice(e) {
    if (this.data.judged) return;
    this.judge(Number(e.currentTarget.dataset.i));
  },

  onFillInput(e) {
    this.setData({ fillVal: e.detail.value });
  },

  answerFill() {
    if (this.data.judged) return;
    const v = (this.data.fillVal || '').trim();
    if (!v) {
      wx.showToast({ title: '先写下答案', icon: 'none' });
      return;
    }
    this.judge(v);
  },

  /** 排序题：点击步骤按顺序编号 */
  toggleOrder(e) {
    if (this.data.judged) return;
    const i = Number(e.currentTarget.dataset.i);
    let sel = this.data.orderSel.slice();
    const at = sel.indexOf(i);
    if (at >= 0) sel.splice(at, 1);
    else sel.push(i);

    const no = {};
    sel.forEach((v, k) => { no[v] = k + 1; });
    this.setData({ orderSel: sel, orderNo: no });
  },

  submitOrder() {
    if (this.data.judged) return;
    const total = this.data.cur.tokens.length;
    if (this.data.orderSel.length !== total) {
      wx.showToast({ title: '还有步骤没排', icon: 'none' });
      return;
    }
    this.judge(this.data.orderSel.slice());
  },

  /** 统一判分 */
  judge(ans) {
    const r = train.grade(this.data.cur, ans);
    const results = this.data.results.concat([{
      id: this.data.cur.id,
      no: this.data.idx + 1,
      correct: r.correct,
      kind: this.data.cur.kind,
      q: this.data.cur.q
    }]);
    this.setData({
      judged: true,
      judgeResult: r,
      results: results,
      correctCount: this.data.correctCount + (r.correct ? 1 : 0)
    });
  },

  next() {
    const nextIdx = this.data.idx + 1;
    if (nextIdx >= this.data.sessions.length) {
      this.setData({ mode: 'result' });
      wx.setNavigationBarTitle({ title: '训练结果' });
      return;
    }
    const cur = this.data.sessions[nextIdx];
    this.setData({
      idx: nextIdx,
      cur: cur,
      judged: false,
      judgeResult: null,
      fillVal: '',
      orderSel: [],
      orderNo: {}
    });
  },

  /* ---------------- 收尾 ---------------- */
  finish() {
    const pass = this.data.correctCount >= this.data.passLine;
    const updated = store.recordDrill(this.data.target.id, pass);
    wx.showModal({
      title: pass ? '本次通过' : '再来一次',
      content: pass
        ? '连对 ' + updated.srs.streak + ' 次。下次复习：' + updated.dueText + '。' + (updated.status === 'mastered' ? '这道题已经标记为「已掌握」。' : '')
        : '正确率不到 ' + Math.round(this.data.passLine / this.data.sessions.length * 100) + '%，明天会再排进来。',
      showCancel: false,
      confirmText: '继续练',
      success: () => this.loadDue()
    });
  },

  quit() {
    wx.showModal({
      title: '退出训练',
      content: '本次答题记录不会保存，确定退出吗？',
      success: (r) => { if (r.confirm) this.loadDue(); }
    });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },

  goCorrect() {
    wx.navigateTo({ url: '/pages/correct/correct?id=' + this.data.target.id });
  }
});
