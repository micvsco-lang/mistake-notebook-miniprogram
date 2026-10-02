const store = require('./utils/store.js');

App({
  globalData: {
    ready: false,
    lastResult: null      // 训练结束后回传的结果，供页面间传递
  },

  onLaunch() {
    // 首次启动把学习通抓到的作业导入本地库
    const r = store.ensureInit();
    this.globalData.ready = true;
    console.log('[错题订正] 本地数据就绪：共 ' + r.total + ' 道错题，本次新增 ' + r.imported + ' 道');
  }
});
