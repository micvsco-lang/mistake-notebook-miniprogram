const store = require('../../utils/store.js');
const fmt = require('../../utils/format.js');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '待订正' },
  { key: 'analyzed', label: '已分析' },
  { key: 'training', label: '巩固中' },
  { key: 'mastered', label: '已掌握' }
];

Page({
  data: {
    statusTabs: TABS,
    active: 'all',
    keyword: '',
    list: [],
    counts: { all: 0 },
    onlyDue: false,
    empty: false
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const all = store.query({});
    const counts = { all: all.length, new: 0, analyzed: 0, training: 0, mastered: 0 };
    all.forEach((m) => { counts[m.status] = (counts[m.status] || 0) + 1; });

    const list = store.query({
      status: this.data.active === 'all' ? '' : this.data.active,
      keyword: this.data.keyword,
      onlyDue: this.data.onlyDue
    });

    this.setData({
      counts: counts,
      list: list.map(fmt.toBrief),
      empty: list.length === 0
    });
  },

  setTab(e) {
    this.setData({ active: e.currentTarget.dataset.key }, () => this.refresh());
  },

  toggleDue() {
    this.setData({ onlyDue: !this.data.onlyDue }, () => this.refresh());
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
    clearTimeout(this._t);
    this._t = setTimeout(() => this.refresh(), 220);
  },

  clearKw() {
    this.setData({ keyword: '' }, () => this.refresh());
  },

  onTapFx(e) {
    wx.previewImage({ urls: [e.currentTarget.dataset.src] });
  },
  onTapPhoto(e) {
    wx.previewImage({ urls: [e.currentTarget.dataset.src] });
  },

  openItem(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  startCorrect(e) {
    wx.navigateTo({ url: '/pages/correct/correct?id=' + e.currentTarget.dataset.id });
  },

  startTrain(e) {
    getApp().globalData.trainTargetId = e.currentTarget.dataset.id;
    wx.switchTab({ url: '/pages/train/train' });
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  }
});
