const store = require('../../utils/store.js');

const STATUS_META = [
  { key: 'new', label: '待订正' },
  { key: 'analyzed', label: '已分析' },
  { key: 'training', label: '巩固中' },
  { key: 'mastered', label: '已掌握' }
];

Page({
  data: {
    stats: null,
    statusBars: [],
    maxCause: 1,
    maxKpLost: 1,
    advice: '',
    hasData: false
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const st = store.stats();
    const total = st.total || 1;

    const statusBars = STATUS_META.map((m) => {
      const n = st.byStatus[m.key] || 0;
      return {
        key: m.key,
        label: m.label,
        n: n,
        pct: Math.round(n / total * 100)
      };
    });

    const maxCause = Math.max(1, st.causes.length ? Math.max.apply(null, st.causes.map((c) => c.count)) : 1);
    const maxKpLost = Math.max(1, st.kpStats.length ? Math.max.apply(null, st.kpStats.map((k) => k.lost)) : 1);

    // 只算到「掌握」的进度
    const masteredRate = Math.round((st.byStatus.mastered || 0) / total * 100);
    let advice = '';
    if (!st.total) {
      advice = '还没有错题。导入一份学习通作业，或手动录一道，就能开始。';
    } else if (masteredRate >= 80) {
      advice = '掌握率已经到 ' + masteredRate + '%，保持这个复习节奏就够了。';
    } else if (st.byStatus.new > 0) {
      advice = '还有 ' + st.byStatus.new + ' 道没订正。先把「我错在哪」写下来——写不出来的题，说明还没真的搞懂。';
    } else if (st.causes.length) {
      advice = '最集中的问题是「' + st.causes[0].name + '」（' + st.causes[0].count + ' 次）。训练时优先刷这一类。';
    } else {
      advice = '都订正完了，按训练页的排程继续练。';
    }

    this.setData({
      stats: st,
      statusBars: statusBars,
      maxCause: maxCause,
      maxKpLost: maxKpLost,
      advice: advice,
      hasData: st.total > 0
    });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },
  goTrain() {
    wx.switchTab({ url: '/pages/train/train' });
  },
  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  }
});
