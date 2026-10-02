const store = require('../../utils/store.js');

const PROMPTS = [
  '我当时是怎么想的？把原思路写下来。',
  '卡在哪一步、哪一步其实站不住？',
  '正确的路径应该怎么走？',
  '同类题下次要注意什么？'
];

Page({
  data: {
    id: '',
    item: null,
    notFound: false,
    text: '',
    photos: [],
    prompts: PROMPTS,
    done: false,
    analysis: null,
    submitting: false
  },

  onLoad(q) {
    this.setData({ id: (q && q.id) || '' });
  },

  onShow() {
    if (this.data.done) return;
    const m = store.get(this.data.id);
    if (!m) {
      this.setData({ notFound: true });
      return;
    }
    // 已经订正过：直接带着内容进来，由用户决定改写还是看结果
    if (m.correction) {
      this.setData({
        item: m,
        text: m.correction.text || '',
        photos: m.correction.photos || [],
        done: true,
        analysis: m.analysis
      });
      return;
    }
    this.setData({ item: m });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  usePrompt(e) {
    const p = e.currentTarget.dataset.p;
    const cur = this.data.text;
    const next = cur ? cur + '\n' + p : p;
    this.setData({ text: next });
  },

  addPhoto() {
    const left = 3 - this.data.photos.length;
    if (left <= 0) {
      wx.showToast({ title: '最多 3 张', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const add = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ photos: this.data.photos.concat(add) });
      }
    });
  },

  delPhoto(e) {
    const i = e.currentTarget.dataset.i;
    const arr = this.data.photos.slice();
    arr.splice(i, 1);
    this.setData({ photos: arr });
  },

  previewPhoto(e) {
    wx.previewImage({ urls: this.data.photos, current: e.currentTarget.dataset.src });
  },

  onTapFx(e) { wx.previewImage({ urls: [e.currentTarget.dataset.src] }); },
  onTapPhoto(e) { wx.previewImage({ urls: [e.currentTarget.dataset.src] }); },

  submit() {
    if (this.data.submitting) return;
    const text = (this.data.text || '').trim();
    if (!text && !this.data.photos.length) {
      wx.showToast({ title: '至少写一句，或拍一张订正稿', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });

    const r = store.submitCorrection(this.data.id, { text: text, photos: this.data.photos });
    this.setData({ submitting: false });

    if (!r.ok) {
      wx.showToast({ title: r.msg, icon: 'none' });
      return;
    }
    this.setData({ done: true, analysis: r.analysis, item: r.item });
    wx.showToast({ title: '已解锁错因分析', icon: 'success' });
  },

  editAgain() {
    this.setData({ done: false });
  },

  goTrain() {
    getApp().globalData.trainTargetId = this.data.id;
    wx.switchTab({ url: '/pages/train/train' });
  },

  goDetail() {
    wx.redirectTo({ url: '/pages/detail/detail?id=' + this.data.id });
  }
});
