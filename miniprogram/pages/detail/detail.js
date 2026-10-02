const store = require('../../utils/store.js');
const cause = require('../../utils/cause.js');
const kp = require('../../utils/kp.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    id: '',
    item: null,
    notFound: false,
    unlocked: false,
    commentOpen: false,
    causes: [],
    advice: '',
    analysisSource: '',
    allCauses: [],
    kpOptions: [],
    kpEditing: false,
    originOpen: false,
    /* 疑惑点（对 AI 批语的异议，与订正/解锁无关） */
    doubtsView: [],
    doubtTags: [],
    doubtEditing: false,
    doubtTag: 'ai_misjudge',
    doubtText: ''
  },

  onLoad(q) {
    this.setData({ id: (q && q.id) || '' });
  },

  onShow() {
    this.load();
  },

  load() {
    const m = store.get(this.data.id);
    if (!m) {
      this.setData({ notFound: true });
      return;
    }
    const analysis = m.analysis || {};
    const picked = (analysis.causes || []).map((c) => c.code);

    m.level = fmt.scoreLevel(m.score, m.fullScore);
    m.correctionTime = m.correction ? fmt.dateTime(m.correction.submittedAt) : '';

    // 疑惑点视图：tag 翻译成人话、时间格式化
    const doubtsView = (m.doubts || []).map((d) => ({
      id: d.id,
      tag: d.tag,
      tagLabel: (store.DOUBT_TAGS[d.tag] || store.DOUBT_TAGS.other).label,
      text: d.text,
      timeText: fmt.dateTime(d.at)
    }));

    // 题干是空的（纯搬运入库：只搬了图、没识别文字）-> 原图就是这道题的全部内容，
    // 直接展开给用户看，别让他再点一下「展开」才见到题。
    // 有题干文字的（识别模式）仍默认收起，免得一屏全是图。
    const hasStem = !!(m.stem && m.stem.length);
    const hasOrigin = !!(m.origin && m.origin.photo);
    const hasAnswer = !!(m.myAnswer && m.myAnswer.nodes && m.myAnswer.nodes.length);
    const hasComment = !!(m.comment && m.comment.text);

    // 「只有图」的题（纯搬运入库：没识别出任何文字）——
    // 详情页只保留真正有意义的板块：原图 / 疑惑 / 我的订正 / 错因分析 / 知识点。
    // 题目、我的答案、正确答案、教师批语这几栏在这类题上都是空的，
    // 硬显示出来只会满屏「没有作答记录」这种废话（用户明确要求藏掉）。
    const imgOnly = !hasStem && hasOrigin && !hasAnswer && !hasComment;

    this.setData({
      item: m,
      notFound: false,
      imgOnly: imgOnly,
      originOpen: !hasStem && hasOrigin,
      unlocked: m.unlocked,
      doubtsView: doubtsView,
      doubtTags: this.data.doubtTags.length ? this.data.doubtTags
        : Object.keys(store.DOUBT_TAGS).map((k) => ({ key: k, label: store.DOUBT_TAGS[k].label })),
      causes: analysis.causes || [],
      advice: analysis.advice || '',
      analysisSource: analysis.source || '',
      allCauses: cause.ALL_CODES.map((code) => ({
        code: code,
        name: cause.CAUSES[code].name,
        short: cause.CAUSES[code].short,
        remedy: cause.CAUSES[code].remedy,
        on: picked.indexOf(code) >= 0
      })),
      kpOptions: kp.flatOptions()
        .filter((o) => o.isLeaf)
        .map((o) => Object.assign({}, o, { on: m.kp.indexOf(o.id) >= 0 }))
    });
  },

  /* ---------- 图片预览 ---------- */
  onTapFx(e) { wx.previewImage({ urls: [e.currentTarget.dataset.src] }); },
  onTapPhoto(e) { wx.previewImage({ urls: [e.currentTarget.dataset.src] }); },
  previewMy(e) {
    const urls = (this.data.item.myAnswer.nodes || []).filter((n) => n.p === 1).map((n) => n.s);
    if (urls.length) wx.previewImage({ urls: urls });
  },
  previewCorrection(e) {
    const c = this.data.item.correction;
    if (c && c.photos && c.photos.length) wx.previewImage({ urls: c.photos, current: e.currentTarget.dataset.src });
  },

  /* ---------- 原始照片（拍照录入才有） ---------- */
  toggleOrigin() { this.setData({ originOpen: !this.data.originOpen }); },
  previewOrigin() {
    const o = this.data.item.origin;
    if (o && o.photo) wx.previewImage({ urls: [o.photo] });
  },

  /* ---------- 批语折叠 ---------- */
  toggleComment() { this.setData({ commentOpen: !this.data.commentOpen }); },

  /* ---------- 疑惑点：对 AI 批语的异议 ----------
   * 只走 store.setDoubts，不碰 correction —— 标疑惑不等于完成订正，
   * 不会解锁错因分析（解锁闸门在 submitCorrection，见 store.js）。 */
  toggleDoubtEdit() {
    this.setData({ doubtEditing: !this.data.doubtEditing });
  },

  pickDoubtTag(e) {
    this.setData({ doubtTag: e.currentTarget.dataset.key });
  },

  onDoubtInput(e) {
    this.setData({ doubtText: e.detail.value });
  },

  saveDoubt() {
    const tag = this.data.doubtTag || 'ai_misjudge';
    const text = (this.data.doubtText || '').trim();
    if (tag === 'other' && !text) {
      wx.showToast({ title: '选「其他」就写两句说明', icon: 'none' });
      return;
    }
    const list = (this.data.item.doubts || []).slice();
    list.push({ id: 'd' + Date.now(), tag: tag, text: text, at: Date.now() });
    store.setDoubts(this.data.id, list);
    this.setData({ doubtEditing: false, doubtText: '' });
    this.load();
    wx.showToast({ title: '已记下这条疑惑', icon: 'none' });
  },

  removeDoubt(e) {
    const did = e.currentTarget.dataset.id;
    const list = (this.data.item.doubts || []).filter((d) => d.id !== did);
    store.setDoubts(this.data.id, list);
    this.load();
  },

  /* ---------- 错因改判 ---------- */
  toggleCause(e) {
    const code = e.currentTarget.dataset.code;
    const all = this.data.allCauses.map((c) =>
      c.code === code ? Object.assign({}, c, { on: !c.on }) : c);
    const on = all.filter((c) => c.on);
    const causes = on.map((c) => {
      const old = (this.data.causes || []).find((x) => x.code === c.code);
      return {
        code: c.code,
        detail: old ? old.detail : '由你手动标注：' + c.name + '。' + c.remedy,
        confidence: 1,
        evidence: '手动标注'
      };
    });
    store.setCauses(this.data.id, causes);
    this.load();
    wx.showToast({ title: '已更新错因', icon: 'none' });
  },

  /* ---------- 知识点调整 ---------- */
  toggleKpEdit() { this.setData({ kpEditing: !this.data.kpEditing }); },

  toggleKp(e) {
    const id = e.currentTarget.dataset.id;
    const cur = this.data.item.kp.slice();
    const i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1); else cur.push(id);
    store.setKp(this.data.id, cur);
    this.load();
  },

  /* ---------- 跳转 ---------- */
  goCorrect() {
    wx.navigateTo({ url: '/pages/correct/correct?id=' + this.data.id });
  },
  goTrain() {
    getApp().globalData.trainTargetId = this.data.id;
    wx.switchTab({ url: '/pages/train/train' });
  },
  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },

  /* ---------- 重做订正 ---------- */
  redoCorrection() {
    wx.showModal({
      title: '重写订正',
      content: '会覆盖你已提交的订正内容，错因分析保留。确定吗？',
      success: (r) => {
        if (!r.confirm) return;
        store.update(this.data.id, { correction: null });
        this.goCorrect();
      }
    });
  }
});
