const store = require('../../utils/store.js');
const kp = require('../../utils/kp.js');
const recognize = require('../../utils/recognize.js');
const crop = require('../../utils/crop.js');
const symbols = require('../../data/symbols.js');
const grab = require('../../data/grab-script.js');
const seedData = require('../../data/seed.js');
const SAMPLE = require('../../data/sample-import.js');

const EMPTY_FORM = {
  courseId: 'c_math',
  assignTitle: '手动录入',
  gist: '',
  type: '解答题',
  score: '',
  fullScore: '20',
  stemText: '',
  rightText: '',
  commentText: ''
};

Page({
  data: {
    tab: 'photo',
    courseNames: [],
    courses: [],

    /* 拍照识别 */
    cloudOk: false,
    shots: [],            // [{id, path, status, stateText, count, msg}]
    flatQ: [],            // 识别出来的题（唯一真源，视图直接从它渲染）
    totalScore: 100,      // 本份作业总分（没识别出每题满分的题，按它均分推算）
    perScoreText: '',     // 「÷ N 题 ≈ 每题 X 分」的展示文案（WXML 里算不了小数取整）
    checkedCount: 0,
    photoErr: '',
    photoForm: { assignTitle: '' },
    photoCourseIndex: 0,
    dkpOptions: [],       // 默认知识点专用，与手动录入的 kpOptions 分开，避免 on 标记互相污染
    defaultKp: [],
    defaultKpOpen: false,
    kpDict: {},           // 归一化知识点名 → id
    kpNames: [],          // 发给云函数的白名单

    /* 手写符号对照 */
    symGroups: [],        // 展示用分组（look 里的 ** 强调标记已剥掉，wxml 不认 markdown）
    symOpen: false,

    /* 粘贴导入 */
    jsonText: '',
    preview: null,
    parsed: null,
    parseErr: '',

    /* 手机抓取（免电脑、零费用） */
    grabSteps: [],
    grabWays: [],
    grabNotes: [],
    grabBrowsers: '',
    grabWhy: '',
    grabFromApp: [],      // 按行渲染（原文里的 ** 强调标记要剥掉，wxml 不认 markdown）
    grabOpen: false,
    grabCopied: false,
    grabSize: '',

    /* 手动录入 */
    form: Object.assign({}, EMPTY_FORM),
    typeOptions: ['解答题', '证明题', '计算题', '选择题', '填空题', '判断题'],
    typeIndex: 0,
    courseIndex: 0,
    kpOptions: [],
    pickedKp: [],
    kpOpen: false,
    myArt: [],

    /* 备份 */
    backupText: ''
  },

  onLoad() {
    const leaf = kp.flatOptions().filter((o) => o.isLeaf);
    this.setData({
      courses: seedData.courses,
      courseNames: seedData.courses.map((c) => c.name),
      kpOptions: leaf.map((o) => Object.assign({}, o, { on: false })),
      dkpOptions: leaf.map((o) => Object.assign({}, o, { on: false })),
      kpDict: recognize.buildKpDict(kp.flatOptions()),
      kpNames: leaf.map((o) => o.name),
      cloudOk: recognize.isReady(),
      grabSteps: grab.STEPS,
      grabWays: grab.WAYS,
      grabNotes: grab.NOTES,
      grabBrowsers: grab.BROWSERS,
      grabWhy: grab.WHY_NOT_WECHAT,
      grabFromApp: grab.FROM_APP.replace(/\*\*/g, '').split('\n'),
      // 脚本很长，给用户一个心理预期：粘进书签时它不是坏了
      grabSize: (grab.BOOKMARKLET.length / 1024).toFixed(0) + ' KB',
      symGroups: symbols.GROUPS.map((g) => ({
        name: g.name,
        items: g.items.map((it) => ({
          sym: it.sym,
          name: it.name,
          look: String(it.look || '').replace(/\*\*/g, ''),
          scene: it.scene
        }))
      }))
    });
  },

  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.t });
  },

  /* ==================== 拍照识别 ==================== */

  /** 拍照 / 相册选图（可多选） */
  pickPhoto() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        this.addShots((res.tempFiles || []).map((f) => f.tempFilePath));
      }
    });
  },

  /** 从聊天记录选截图 —— 手机截图最顺手的入口 */
  pickFromChat() {
    if (!wx.chooseMessageFile) {
      wx.showToast({ title: '当前微信版本不支持，先用相册', icon: 'none' });
      return;
    }
    wx.chooseMessageFile({
      count: 9,
      type: 'image',
      success: (res) => {
        this.addShots((res.tempFiles || []).map((f) => f.path));
      }
    });
  },

  /**
   * 选截图导入 —— 一条入口，两种处理
   *
   * 手机上的主路径：学习通 App 里装不了脚本（系统不允许往别人的 App 注入代码），
   * 所以手机上唯一「不涉及电脑」的搬运方式就是截图。
   *
   * 选了图之后走哪条，**由云环境配没配决定**，用户不用自己选：
   *   - 配了（`cloudOk`）→ 自动识别：读出题干/我的解答/教师批语/得分/知识点，
   *     一张图有几道题就拆几道，进「识别结果」让用户核对修改，再入库。
   *     这就是「分门别类放进对应栏」的效果。
   *   - 没配 → 纯搬运：一张图一道题，原图直接当题干，不识别不问知识点。
   * 所以同一个按钮，在两种环境下都能用，只是产出精细度不同。
   */
  quickShotImport() {
    if (!wx.chooseMessageFile && !wx.chooseMedia) {
      wx.showToast({ title: '当前微信版本不支持选图', icon: 'none' });
      return;
    }
    const go = (paths) => {
      if (!paths || !paths.length) return;
      const pick = this.persistAll(paths);
      if (!pick.length) return;
      if (this.data.cloudOk) {
        // 识别路：入队 → 自动逐张识别 → 进 flatQ 待核对
        this.jobTitle = (this.data.photoForm.assignTitle || '').trim() || '拍照录入';
        this.addShots(pick, true);
      } else {
        // 搬运路：直接入库，一图一题
        this.commitShots(pick);
      }
    };
    const fromChat = () => {
      wx.chooseMessageFile({
        count: 9,
        type: 'image',
        success: (res) => go((res.tempFiles || []).map((f) => f.path)),
        fail: () => {
          // 用户取消了就不弹相册，否则一顿连点会连开三个选择器
        }
      });
    };
    wx.showActionSheet({
      itemList: ['从微信聊天里选（截图发给文件传输助手最快）', '从相册 / 直接拍'],
      success: (r) => {
        if (r.tapIndex === 0) fromChat();
        else {
          wx.chooseMedia({
            count: 9,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            sizeType: ['compressed'],
            success: (res) => go((res.tempFiles || []).map((f) => f.tempFilePath))
          });
        }
      }
    });
  },

  /** 批量落盘（逐张调 persist，失败会退回临时路径，不阻塞） */
  persistAll(paths) {
    const out = [];
    paths.forEach((p) => {
      const saved = this.persist(p);
      if (saved) out.push(saved);
    });
    return out;
  },

  /** 当前批次的作业名：优先用输入框，空了退回默认名 */
  currentTitle(fallback) {
    return (this.data.photoForm.assignTitle || '').trim() || fallback;
  },

  /**
   * 一批截图直接作为题目入库（纯搬运路，不识别）
   * 顺序号按当前作业里已有多少条往后排，避免每张都叫 Q1。
   */
  commitShots(paths) {
    const course = this.data.courses[this.data.photoCourseIndex] || this.data.courses[0] || {};
    const title = this.currentTitle('截图搬运');
    const exist = store.all().filter((m) => m.asId === 'photo' && m.assignTitle === title).length;

    const items = paths.map((p, i) => ({
      courseId: course.id || 'c_math',
      no: exist + i + 1,
      type: '解答题',
      gist: '',
      stemText: '',
      myAnswerText: '',
      rightText: '',
      commentText: '',
      score: null,
      fullScore: 20,
      kp: [],              // 故意留空：截图时没人知道每题的知识点
      photo: p
    }));

    const r = store.addRecognized(items, { assignTitle: title, courseId: course.id });

    wx.showModal({
      title: '已加入错题本',
      content: '搬进 ' + r.added + ' 道（一图一题）。知识点和题干之后在详情页里对着原图补 —— ' +
        '写错在哪就能解锁错因分析。',
      showCancel: false,
      confirmText: '去错题本',
      success: (res) => { if (res.confirm) this.goList(); }
    });
  },

  /**
   * 把图存进用户目录并排队
   * @param {string[]} paths
   * @param {boolean} [alreadySaved] 传 true 表示路径已经落盘过（persistAll 的产物），
   *        不要再复制一次 —— 否则每张图会被复制两遍，白占用户目录空间。
   */
  addShots(paths, alreadySaved) {
    if (!paths || !paths.length) return;
    const shots = this.data.shots.slice();
    const added = [];
    paths.forEach((p) => {
      const s = {
        id: 's' + Date.now() + '_' + (shots.length + added.length),
        path: alreadySaved ? p : this.persist(p),
        status: 'idle',
        stateText: this.data.cloudOk ? '等待识别' : '待入库',
        count: 0,
        msg: ''
      };
      shots.push(s);
      added.push(s);
    });
    this.setData({ shots: shots, photoErr: '' });
    // 云开发可用就立刻挨张识别，省得用户再点一遍
    if (this.data.cloudOk) added.forEach((s) => this.recognizeShot(s.id));
  },

  /** 识别一张照片 */
  recognizeShot(sid) {
    const shots = this.data.shots.slice();
    const i = shots.findIndex((s) => s.id === sid);
    if (i < 0) return;
    shots[i] = Object.assign({}, shots[i], { status: 'busy', stateText: '识别中…', msg: '' });
    this.setData({ shots: shots });

    recognize.recognize(shots[i].path, {
      kpNames: this.data.kpNames,
      courseHint: this.data.courseNames[this.data.photoCourseIndex] || '',
      dict: this.data.kpDict,
      // 手写符号小抄：让模型按上下文取标准符号（σ 像 6 就认成 σ），别照抄形状
      symbolNotes: symbols.PROMPT_NOTES
    }).then((r) => {
      // 识别期间这张可能已被删掉
      const after = this.data.shots.slice();
      const j = after.findIndex((s) => s.id === sid);
      if (j < 0) return;

      if (r.ok) {
        after[j] = Object.assign({}, after[j], {
          status: 'done', stateText: '识别完成', count: r.questions.length, msg: ''
        });
        const qs = r.questions.map((q, k) => this.toQuestion(q, sid, k, after[j].path));
        /*
         * 先清掉这张图**上一次**拆出的题，再放新的。
         *
         * 不清的后果（真实踩过）：重试识别一次，同一张图就出现两份题 ——
         * 其中一份是模型刚给的（带着自动分配的知识点），另一份是你已经核对、
         * 改过标签的。看着就像「自动的又回来把手工的顶掉了」。
         * 重试的语义本来就是「这张图重新来一遍」，所以旧的该丢。
         */
        const kept = this.data.flatQ.filter((q) => q.sid !== sid);
        this.setData({ shots: after, flatQ: kept.concat(qs) });
        this.fillFullScores(qs);      // 只给这批新题兜底，不动之前核对好的
        this.fillCrops(qs, after[j].path);
      } else {
        after[j] = Object.assign({}, after[j], {
          status: 'fail', stateText: '没识别出来', count: 0,
          msg: r.msg || '识别失败，可以重试，或者直接入库后手动补。'
        });
        this.setData({ shots: after });
      }
      this.refreshCount();
    });
  },

  /**
   * 没识别出满分的题，按「本份总分 ÷ 本轮题数」推算。
   *
   * 为什么要这样：工科数学分析的作业常按 100 分制、每题均分（6 题 → 16.6 分/题），
   * 但页面上往往只在页眉写个「总分 100」，每题并不单独标满分。
   * 模型识别不到就留空，程序再按题数把它均出来 —— 比硬编码 20 准确得多。
   *
   * 只填**空着的**，识别到真实满分的题不动。
   */
  fillFullScores(onlyThese) {
    const all = this.data.flatQ;
    if (!all.length) return;
    const total = Number(this.data.totalScore) || 100;
    const per = Math.round((total / all.length) * 10) / 10;
    this.setData({
      perScoreText: '分 ÷ ' + all.length + ' 题 ≈ 每题 ' + per + ' 分'
    });

    // 传了 onlyThese（识别新图时）→ 只碰这批，不惊动已经核对过的老题。
    // 不传（用户点「重新均分」）→ 全部推算值重算。
    const scope = onlyThese || null;
    const q = all.slice();
    let changed = false;
    for (let i = 0; i < q.length; i++) {
      if (scope && scope.indexOf(q[i]) < 0) continue;
      const empty = !String(q[i].fullScoreInput || '').trim();
      const guessed = !scope && q[i].fullScoreReal === false;
      if ((empty || guessed) && q[i].fullScoreInput !== String(per)) {
        q[i] = Object.assign({}, q[i], { fullScoreInput: String(per), fullScoreReal: false });
        changed = true;
      }
    }
    if (changed) this.setData({ flatQ: q });
  },

  /**
   * 改本份总分：**只记值，不自动重算**。
   *
   * 曾经这里会自动把所有推算值刷一遍 —— 用户不想要这种"自己动"的行为：
   * 第一次填好就固定在那儿，要调自己点「重新均分」，不然改个数字就把
   * 已经核对过的一堆题全冲掉了。
   */
  onTotalScore(e) {
    this.setData({ totalScore: e.detail.value });
  },

  /** 用户主动点「按总分重新均分」才重算（只影响推算值，题头读到的真实值不动） */
  regradeAll() {
    this.fillFullScores();
    wx.showToast({ title: '已按总分重算「推算」的值', icon: 'none' });
  },

  /**
   * 按模型给的坐标把原图切成几块，贴到对应栏（题干/解答/批语/标准解答）。
   *
   * 为什么异步补齐、而不是等切完再显示：切一块要读图尺寸 + 开离屏 canvas，
   * 一页可能十几块，全等完用户会干瞪眼。先出文字、图随后补上，体感好得多。
   *
   * 失败一行都不抛：某栏切不出来就那栏不显示切片，文字照常能核对 ——
   * 甚至整个 fillCrops 挂了也不影响入库（外面还有 catch）。
   */
  async fillCrops(qs, src) {
    const list = (qs || []).filter((q) => q.boxes);
    if (!list.length || !src) return;
    try {
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        /* eslint-disable no-await-in-loop */
        const m = await crop.cropAll(src, q.boxes);
        if (m.stem) q.stemPhoto = m.stem;
        if (m.myAnswer) q.answerPhoto = m.myAnswer;
        if (m.comment) q.commentPhoto = m.comment;
        if (m.rightAnswer) q.rightPhoto = m.rightAnswer;
      }
      // 对象是原地改的，得换一次数组引用才会重渲染
      this.setData({ flatQ: this.data.flatQ.slice() });
    } catch (e) {
      // 切图失败只是少了增强，不影响识别结果与入库。
      // 但要留个线索 —— 整批都切不出来时，多半是 canvas 不可用（老基础库），
      // 排查时没日志就只能干猜。
      console.warn('切片失败：' + (e && e.message ? e.message : e));
    }
  },

  /**
   * 删掉核对用过的切片临时文件。
   *
   * 切片只是「核对时能对着原图看」的临时产物 —— 文字已经进各栏、整图也留着了。
   * **必须删**：它们写在本地文件系统里，一页作业可能切十几块，久了会把空间堆满
   * （微信对小程序的本地文件总量有上限）。清理失败不影响入库，静默跳过即可。
   */
  cleanCrops(list) {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    if (!fs || !fs.unlinkSync) return;
    const FIELDS = ['stemPhoto', 'answerPhoto', 'commentPhoto', 'rightPhoto'];
    (list || []).forEach((q) => {
      FIELDS.forEach((f) => {
        if (q && q[f]) {
          try { fs.unlinkSync(q[f]); } catch (e) { /* 文件不在了就算了 */ }
        }
      });
    });
  },

  /** 规范化的识别结果 → 页面里的一条可编辑题 */
  toQuestion(q, sid, k, photo) {
    // 数一数模型用「□」占位了多少个字 —— 那是它没认出来的。
    // 入库前不提醒的话，这些 □ 会跟着进错题本，日后背书时看到的是残句。
    const badChars = [q.stemText, q.myAnswerText, q.rightText, q.commentText]
      .reduce((n, s) => n + (String(s || '').split('□').length - 1), 0);
    return {
      key: sid + '_' + k + '_' + Date.now(),
      sid: sid,
      // 这张题是从哪张截图拆出来的 —— 核对时把原图摆在眼前对照，
      // 否则要滚回上面的「这一批」里找，补 □ 时尤其别扭。
      photo: photo || '',
      on: true,
      open: false,
      no: q.no,
      type: q.type,
      gist: q.gist,
      stemText: q.stemText,
      myAnswerText: q.myAnswerText,
      rightText: q.rightText,
      commentText: q.commentText,
      scoreInput: q.score === null || q.score === undefined ? '' : String(q.score),
      // 模型没给出满分就留空 —— 交给 fillFullScores 均分兜底（别硬编码 20）
      fullScoreInput: q.fullScore ? String(q.fullScore) : '',
      // 满分的来源：true = 题头读到的真实值；false = 兜底推算的（界面要标出来）
      fullScoreReal: !!q.fullScore,
      hasScore: q.score !== null && q.score !== undefined,
      kp: q.kp || [],
      kpNames: q.kpNames || [],
      kpKw: '',            // 知识点搜索框里的词
      kpHits: [],          // 搜索结果
      // 各栏在原图上的坐标 —— fillCrops 靠它切图，缺了就整图对照（不影响入库）
      boxes: q.boxes || null,
      confidence: q.confidence || 'medium',
      badChars: badChars
    };
  },

  retryShot(e) {
    this.recognizeShot(e.currentTarget.dataset.id);
  },

  removeShot(e) {
    const sid = e.currentTarget.dataset.id;
    this.cleanCrops(this.data.flatQ.filter((q) => q.sid === sid));   // 连带清掉它的切片
    this.setData({
      shots: this.data.shots.filter((s) => s.id !== sid),
      flatQ: this.data.flatQ.filter((q) => q.sid !== sid)
    });
    this.refreshCount();
  },

  clearShots() {
    wx.showModal({
      title: '清掉这一批',
      content: '照片和已识别出的题目都会清掉，没入库的不会保留。',
      confirmText: '清掉',
      success: (r) => {
        if (!r.confirm) return;
        this.cleanCrops(this.data.flatQ);                              // 整批的切片一起清
        this.setData({ shots: [], flatQ: [], checkedCount: 0, photoErr: '' });
      }
    });
  },

  previewShot(e) {
    const urls = this.data.shots.map((s) => s.path);
    wx.previewImage({ urls: urls, current: e.currentTarget.dataset.src });
  },

  /** 核对卡片里点「图片」放大 —— 补 □、核分数时对着原图看 */
  previewQ(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;
    // 把本批所有原图串成一组，放大后能左右滑动切换
    const urls = this.data.flatQ.map((q) => q.photo).filter(Boolean);
    wx.previewImage({ urls: urls.length ? urls : [src], current: src });
  },

  toggleQ(e) {
    const i = e.currentTarget.dataset.i;
    const q = this.data.flatQ.slice();
    q[i] = Object.assign({}, q[i], { on: !q[i].on });
    this.setData({ flatQ: q });
    this.refreshCount();
  },

  toggleQOpen(e) {
    const i = e.currentTarget.dataset.i;
    const q = this.data.flatQ.slice();
    q[i] = Object.assign({}, q[i], { open: !q[i].open });
    this.setData({ flatQ: q });
  },

  onQInput(e) {
    const i = e.currentTarget.dataset.i;
    const f = e.currentTarget.dataset.f;
    const q = this.data.flatQ.slice();
    const one = Object.assign({}, q[i]);
    one[f] = e.detail.value;
    q[i] = one;
    this.setData({ flatQ: q });
  },

  onQNum(e) {
    const i = e.currentTarget.dataset.i;
    const f = e.currentTarget.dataset.f;
    const q = this.data.flatQ.slice();
    const one = Object.assign({}, q[i]);
    one[f] = e.detail.value;
    one.hasScore = String(one.scoreInput || '').trim() !== '';
    // 用户亲手改过满分 -> 视为已确认，去掉「推算」标记
    if (f === 'fullScoreInput') one.fullScoreReal = true;
    q[i] = one;
    this.setData({ flatQ: q });
  },

  /**
   * 知识点搜索：边打边搜。
   *
   * 为什么不做成 picker 选择：树里有一百多个知识点，一层层展开点太折磨。
   * 直接敲「极限」「中值定理」，相关章节的叶子就都列出来了。
   */
  onKpSearch(e) {
    const i = e.currentTarget.dataset.i;
    const kw = e.detail.value;
    const q = this.data.flatQ.slice();
    const one = Object.assign({}, q[i]);
    one.kpKw = kw;
    one.kpHits = kw.trim() ? kp.search(kw, 8) : [];
    q[i] = one;
    this.setData({ flatQ: q });
  },

  /** 点搜索结果 → 给这道题打上这个标签 */
  pickKp(e) {
    const i = e.currentTarget.dataset.i;
    const id = e.currentTarget.dataset.id;
    const q = this.data.flatQ.slice();
    const one = Object.assign({}, q[i]);
    const ids = (one.kp || []).slice();
    const names = (one.kpNames || []).slice();
    if (ids.indexOf(id) < 0) {
      ids.push(id);
      names.push(kp.nameOf(id));
    }
    one.kp = ids;
    one.kpNames = names;
    one.kpKw = '';
    one.kpHits = [];
    q[i] = one;
    this.setData({ flatQ: q });
  },

  /** 删掉一道题（识别错了 / 重复了 / 不想要了）—— 还没入库，不影响错题本 */
  removeQ(e) {
    const i = Number(e.currentTarget.dataset.i);
    const q = this.data.flatQ[i];
    if (!q) return;
    wx.showModal({
      title: '删掉这道题',
      content: 'Q' + q.no + ' 会从这个待核对列表里去掉。还没入库，错题本不受影响。',
      confirmText: '删掉',
      success: (r) => {
        if (!r.confirm) return;
        this.cleanCrops([q]);                 // 连带清掉它的切片，别占着空间
        const list = this.data.flatQ.slice();
        list.splice(i, 1);
        this.setData({ flatQ: list });
        this.refreshCount();
      }
    });
  },

  /** 批量删掉所有**没勾选**的题（勾选 = 要入库的） */
  removeUnchecked() {
    const drop = this.data.flatQ.filter((q) => !q.on);
    if (!drop.length) {
      wx.showToast({ title: '没有未勾选的题', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删掉未勾选的 ' + drop.length + ' 道',
      content: '这些题不会入库，现在从待核对列表里清掉。',
      confirmText: '删掉',
      success: (r) => {
        if (!r.confirm) return;
        this.cleanCrops(drop);
        this.setData({ flatQ: this.data.flatQ.filter((q) => q.on) });
        this.refreshCount();
      }
    });
  },

  /** 点标签上的 × → 删掉这个标签 */
  removeKp(e) {
    const i = e.currentTarget.dataset.i;
    const ki = Number(e.currentTarget.dataset.ki);
    const q = this.data.flatQ.slice();
    const one = Object.assign({}, q[i]);
    const ids = (one.kp || []).slice();
    const names = (one.kpNames || []).slice();
    if (ki >= 0 && ki < ids.length) {
      ids.splice(ki, 1);
      names.splice(ki, 1);
    }
    one.kp = ids;
    one.kpNames = names;
    q[i] = one;
    this.setData({ flatQ: q });
  },

  refreshCount() {
    this.setData({ checkedCount: this.data.flatQ.filter((q) => q.on).length });
  },

  pickPhotoCourse(e) {
    this.setData({ photoCourseIndex: Number(e.detail.value) });
  },

  onPhotoFormInput(e) {
    const f = e.currentTarget.dataset.f;
    const form = Object.assign({}, this.data.photoForm);
    form[f] = e.detail.value;
    this.setData({ photoForm: form });
  },

  toggleDefaultKpOpen() {
    this.setData({ defaultKpOpen: !this.data.defaultKpOpen });
  },

  /* 手写符号对照面板 */
  toggleSym() {
    this.setData({ symOpen: !this.data.symOpen });
  },

  /* ---------- 手机抓取脚本 ---------- */
  toggleGrab() {
    this.setData({ grabOpen: !this.data.grabOpen });
  },

  /** 复制脚本到剪贴板：粘进书签或快捷指令都能用 */
  copyGrabScript() {
    wx.setClipboardData({
      data: grab.BOOKMARKLET,
      success: () => {
        this.setData({ grabCopied: true });
        wx.showToast({ title: '脚本已复制', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      }
    });
  },

  toggleDefaultKp(e) {
    const id = e.currentTarget.dataset.id;
    const opts = this.data.dkpOptions.map((o) => (o.id === id ? Object.assign({}, o, { on: !o.on }) : o));
    this.setData({ dkpOptions: opts, defaultKp: opts.filter((o) => o.on) });
  },

  submitPhotos() {
    const picked = this.data.flatQ.filter((q) => q.on);
    if (!picked.length) {
      this.setData({ photoErr: '至少勾一道题再入库。' });
      return;
    }
    const dkp = this.data.defaultKp.map((o) => o.id);

    // 没认出知识点的题：**只提示，不拦**。
    //
    // 这里原本是硬校验（没有知识点就不让入库）。放开的原因：
    //   ① 识图是主路径，模型认不出知识点很常见（题目照片模糊、题型不典型）；
    //   ② 整份作业搬进来的场景，用户本来就不该被逼着逐题选知识点；
    //   ③ 知识点影响的是「掌握度统计」，是**锦上添花**；搬不进来是**功能没了**。
    //      两害相权，宁可先入库、之后在详情页补（详情页能单题改知识点）。
    const noKp = picked.filter((q) => !q.kp.length).length;

    const course = this.data.courses[this.data.photoCourseIndex] || this.data.courses[0] || {};
    const shotPath = {};
    this.data.shots.forEach((s) => { shotPath[s.id] = s.path; });

    const items = picked.map((q) => ({
      courseId: course.id || 'c_math',
      no: q.no,
      type: q.type,
      gist: q.gist,
      stemText: q.stemText,
      myAnswerText: q.myAnswerText,
      rightText: q.rightText,
      commentText: q.commentText,
      score: String(q.scoreInput || '').trim() === '' ? null : Number(q.scoreInput),
      fullScore: Number(q.fullScoreInput) || 20,
      kp: q.kp.length ? q.kp : dkp,
      confidence: q.confidence,
      photo: shotPath[q.sid] || ''
    }));

    const r = store.addRecognized(items, {
      assignTitle: this.currentTitle('拍照录入'),
      courseId: course.id
    });

    // 文字已进各栏、整图也留了，切片只是核对时的临时产物 —— 清掉省空间
    this.cleanCrops(picked);

    this.setData({
      shots: [],
      flatQ: [],
      checkedCount: 0,
      photoErr: '',
      photoForm: { assignTitle: '' },
      dkpOptions: this.data.dkpOptions.map((o) => Object.assign({}, o, { on: false })),
      defaultKp: [],
      defaultKpOpen: false
    });

    wx.showModal({
      title: '已加入错题本',
      content: '新增 ' + r.added + ' 道。' +
        (noKp ? '其中 ' + noKp + ' 道没认出知识点，去详情页补一下就行（不影响订正）。' : '') +
        '打开任意一道，写下错在哪，就能解锁错因分析。',
      showCancel: false,
      confirmText: '去错题本',
      success: (res) => { if (res.confirm) this.goList(); }
    });
  },

  /* ==================== 粘贴导入 ==================== */
  /**
   * 清洗用户粘进来的文本，尽量把它变成一个能 JSON.parse 的串。
   *
   * 为什么需要这一步（真实场景，不是假想）
   * --------------------------------------
   * 走「手机 App 识图 → 复制 → 粘贴进来」这条路时，大模型几乎总会
   * 把 JSON 包在 ```json 围栏里，前面还爱写一句「好的，我来帮你转录」。
   * 用户复制的时候多半会连围栏一起复制 —— 然后收到一句
   * 「JSON 解析失败」，而他根本不知道哪里错了。
   *
   * 这属于**我们能兜住的麻烦**，不该丢给用户去学 JSON 语法。
   * 清洗规则很保守：只做四件事，任何一步没命中都不影响后续。
   *   ① 去围栏 ```json / ```
   *   ② 砍掉第一个 { 之前的所有废话
   *   ③ 砍掉最后一个 } 之后的收尾话
   *   ④ 全角引号「“”」转半角 —— 手机输入法有时会把模型输出的引号转成全角
   * 注意：**不**尝试修复语法错误。真错了还是要报错，否则等于掩盖问题。
   */
  cleanJsonText(raw) {
    let t = String(raw || '').trim();
    if (!t) return t;
    t = t.replace(/```json/gi, '').replace(/```/g, '').trim();
    const a = t.indexOf('{');
    const z = t.lastIndexOf('}');
    if (a >= 0 && z > a) t = t.slice(a, z + 1);
    // 全角引号 → 半角（只处理成对出现在 JSON 结构位置的那种）
    t = t.replace(/[“”]/g, '"');
    return t.trim();
  },

  onJsonInput(e) {
    this.setData({ jsonText: e.detail.value, parseErr: '', preview: null });
  },

  loadSample() {
    this.setData({
      jsonText: JSON.stringify(SAMPLE, null, 2),
      parseErr: '',
      preview: null
    });
    wx.showToast({ title: '已填入示例，点「解析」', icon: 'none' });
  },

  /**
   * 从一道题里读出「得分 / 满分」，容忍模型和大模型 App 的各种写法。
   *
   * 为什么不能直接 `typeof q.score === 'number'`
   * -------------------------------------------
   * 云函数规范化过的输出里 score 一定是数字。但「粘贴导入」这条路上，
   * 用户粘进来的可能是**大模型 App 的原始输出**，那里分数常写成
   * `"6/20"`（作业本上本来就是这么写的，模型忠实照抄）。
   * 只认 number 的写法会让这类题被判成「不是错题」而漏掉 ——
   * 用户看到预览里少了几道，还以为是自己复制漏了。
   *
   * 所以这里做两件事：① 拆 `"6/20"`；② 数字型字符串也认。
   */
  readScore(q) {
    q = q || {};
    const toNum = (v) => {
      if (typeof v === 'number' && isFinite(v)) return v;
      if (typeof v === 'string') {
        const m = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
        if (m) return Number(m[1]);
      }
      return null;
    };
    // 「6/20」连写形式：得分与满分写在同一个字段里
    if (typeof q.score === 'string') {
      const m = /^\s*(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)\s*(?:分)?\s*$/.exec(q.score);
      if (m) return { score: Number(m[1]), full: Number(m[2]) };
    }
    return { score: toNum(q.score), full: toNum(q.fullScore) };
  },

  parsePreview() {
    const t = this.cleanJsonText(this.data.jsonText);
    if (!t) {
      this.setData({ parseErr: '先粘贴作业 JSON，或点「载入示例」试试。' });
      return;
    }
    let data;
    try {
      data = JSON.parse(t);
    } catch (e) {
      this.setData({
        parseErr: '读取失败：' + e.message
          + '。多半是复制时被截断了 —— 确认从第一个 { 复制到最后一个 }，中间的换行别丢。',
        preview: null
      });
      return;
    }

    let list = [];
    if (Array.isArray(data.assignments)) list = data.assignments;
    else if (data.questions) list = [data];
    else if (Array.isArray(data)) list = data;

    if (!list.length) {
      this.setData({ parseErr: '没找到作业数据。需要包含 questions 字段（单份作业）或 assignments 数组（多份）。' });
      return;
    }

    const preview = list.map((a) => {
      const qs = a.questions || [];
      // importAll 的包（手机抓取的「原样搬运」产物）会把整份作业都算进来，
      // 这时「可导入」就是题目总数，不能只数错题 —— 否则预览显示 0，
      // 用户以为抓失败了，其实 20 道题都好好在包里。
      const all = !!a.importAll;
      let wrong = 0;
      qs.forEach((q) => {
        if (q.verdict === 'partial' || q.verdict === 'wrong') { wrong += 1; return; }
        const s = this.readScore(q);
        if (s.score !== null && s.full !== null && s.score < s.full) wrong += 1;
      });
      return {
        title: a.title || a.workTitle || '(未命名作业)',
        count: qs.length,
        wrong: wrong,
        plain: all && !wrong,          // 全都没批改：提示改成「无批语也照收」的说法
        all: all
      };
    });

    const totalImportable = preview.reduce((s, p) => s + (p.all ? p.count : p.wrong), 0);
    this.setData({
      parseErr: totalImportable ? '' : '解析成功，但没有可导入的错题（可能这份作业还没批改）。',
      preview: preview,
      parsed: list
    });
  },

  doImport() {
    const list = this.data.parsed;
    if (!list || !list.length) {
      wx.showToast({ title: '先点「解析」看看', icon: 'none' });
      return;
    }
    let added = 0, skipped = 0;
    list.forEach((a) => {
      const r = store.importAssignment(a);
      if (r.ok) { added += r.added; skipped += r.skipped; }
    });
    this.setData({ jsonText: '', preview: null, parsed: null, parseErr: '' });
    wx.showModal({
      title: '导入完成',
      content: '新增 ' + added + ' 道错题，跳过 ' + skipped + ' 道（已存在）。',
      showCancel: false,
      confirmText: '好'
    });
  },

  /* ==================== 手动录入 ==================== */
  onFormInput(e) {
    const f = e.currentTarget.dataset.f;
    const form = Object.assign({}, this.data.form);
    form[f] = e.detail.value;
    this.setData({ form: form });
  },

  pickCourse(e) {
    const i = Number(e.detail.value);
    const form = Object.assign({}, this.data.form);
    form.courseId = this.data.courses[i].id;
    this.setData({ form: form, courseIndex: i });
  },

  pickType(e) {
    const i = Number(e.detail.value);
    const form = Object.assign({}, this.data.form);
    form.type = this.data.typeOptions[i];
    this.setData({ form: form, typeIndex: i });
  },

  toggleKpOpen() {
    this.setData({ kpOpen: !this.data.kpOpen });
  },

  toggleKp(e) {
    const id = e.currentTarget.dataset.id;
    const opts = this.data.kpOptions.map((o) => (o.id === id ? Object.assign({}, o, { on: !o.on }) : o));
    this.setData({ kpOptions: opts, pickedKp: opts.filter((o) => o.on) });
  },

  addPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const tmp = res.tempFiles[0].tempFilePath;
        const saved = this.persist(tmp);
        this.setData({ myArt: this.data.myArt.concat([saved]) });
      }
    });
  },

  /** 把临时图片复制到小程序用户目录，避免重启后路径失效 */
  persist(tempPath) {
    try {
      const fs = wx.getFileSystemManager();
      const m = /\.(\w+)$/.exec(tempPath);
      const dst = wx.env.USER_DATA_PATH + '/mz_' + Date.now() + (m ? '.' + m[1] : '.jpg');
      fs.copyFileSync(tempPath, dst);
      return dst;
    } catch (e) {
      return tempPath;   // 复制失败就先用临时路径，本次会话内可正常显示
    }
  },

  delPhoto(e) {
    const i = e.currentTarget.dataset.i;
    const arr = this.data.myArt.slice();
    arr.splice(i, 1);
    this.setData({ myArt: arr });
  },

  previewArt(e) {
    wx.previewImage({ urls: this.data.myArt, current: e.currentTarget.dataset.src });
  },

  submitManual() {
    const f = this.data.form;
    const stemText = (f.stemText || '').trim();
    if (!stemText) {
      wx.showToast({ title: '至少写下题干', icon: 'none' });
      return;
    }
    if (!this.data.pickedKp.length) {
      wx.showToast({ title: '选一个知识点', icon: 'none' });
      return;
    }
    const scoreNum = f.score === '' ? null : Number(f.score);
    store.addManual({
      courseId: f.courseId,
      assignTitle: f.assignTitle || '手动录入',
      gist: f.gist || '',
      type: f.type,
      score: Number.isFinite(scoreNum) ? scoreNum : null,
      fullScore: Number(f.fullScore) || 20,
      stem: [{ t: 't', v: stemText }],
      stemText: stemText,
      rightText: (f.rightText || '').trim(),
      commentText: (f.commentText || '').trim(),
      kp: this.data.pickedKp.map((o) => o.id),
      myArt: this.data.myArt
    });
    this.setData({
      form: Object.assign({}, EMPTY_FORM),
      typeIndex: 0,
      kpOptions: this.data.kpOptions.map((o) => Object.assign({}, o, { on: false })),
      pickedKp: [],
      myArt: [],
      kpOpen: false
    });
    wx.showModal({
      title: '已加入错题本',
      content: '去「错题本」里打开它，写下错在哪，就能解锁错因分析。',
      showCancel: false,
      confirmText: '好'
    });
  },

  /* ==================== 备份 ==================== */
  doExport() {
    const json = store.exportJson();
    this.setData({ backupText: json });
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
  },

  onBackupInput(e) {
    this.setData({ backupText: e.detail.value });
  },

  doRestore() {
    const t = (this.data.backupText || '').trim();
    if (!t) {
      wx.showToast({ title: '先粘贴备份内容', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '恢复备份',
      content: '会覆盖当前所有错题与进度，确定吗？',
      success: (r) => {
        if (!r.confirm) return;
        const res = store.importFullJson(t);
        wx.showModal({
          title: res.ok ? '恢复完成' : '恢复失败',
          content: res.ok ? '已载入 ' + res.total + ' 道错题。' : res.msg,
          showCancel: false
        });
        if (res.ok) this.setData({ backupText: '' });
      }
    });
  },

  doReset() {
    wx.showModal({
      title: '清空并重置',
      content: '所有错题、订正记录和复习进度都会被清除，只保留内置的示例数据。此操作不可撤销。',
      confirmText: '确定清空',
      confirmColor: '#dc2626',
      success: (r) => {
        if (!r.confirm) return;
        const res = store.resetAll();
        wx.showToast({ title: '已重置（' + res.total + ' 道）', icon: 'none' });
      }
    });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  }
});
