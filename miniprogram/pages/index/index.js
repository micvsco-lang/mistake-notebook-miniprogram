const store = require('../../utils/store.js');
const fmt = require('../../utils/format.js');
const seedData = require('../../data/seed.js');

Page({
  data: {
    ready: false,
    course: '',
    stats: null,
    todo: [],
    todoMore: 0,
    review: [],
    hasData: false,
    today: ''
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const stats = store.stats();
    const all = store.query({});

    // 待订正：还没提交过订正的错题，低分优先
    const todoAll = all.filter((m) => m.status === 'new');
    // 该复习的：到了排程时间且尚未掌握
    const reviewAll = all.filter((m) => m.isDue && m.status !== 'mastered' && m.status !== 'new');

    this.setData({
      ready: true,
      course: (seedData.courses[0] && seedData.courses[0].name) || '',
      stats: stats,
      todo: todoAll.slice(0, 4).map(fmt.toBrief),
      todoMore: Math.max(0, todoAll.length - 4),
      review: reviewAll.slice(0, 3).map(fmt.toBrief),
      hasData: all.length > 0,
      today: fmt.date(Date.now())
    });
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
    const id = e.currentTarget.dataset.id;
    // 训练页是 tabBar 页，用全局变量把目标传过去
    getApp().globalData.trainTargetId = id;
    wx.switchTab({ url: '/pages/train/train' });
  },
  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },
  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' });
  }
});
