/**
 * 手写数学符号对照库
 *
 * 为什么要有这个文件
 * ------------------
 * 老师用 AI 判卷，AI 经常把学生手写的符号认错 —— 最典型的：把 σ（sigma）
 * 认成 6，然后批「符号写错」。但**手写体的形状差异不是错误**：学生写作业时
 * 按自己的习惯写，认不出来是认的人的问题。
 *
 * 这个库就是小程序「记住」这些手写变体的地方，两个用途：
 * 1. 传给云函数做识别提示（PROMPT_NOTES）—— 让视觉模型转录时按上下文取
 *    标准符号，而不是照抄形状，避免重蹈老师 AI 的覆辙；
 * 2. 导入页的「手写符号对照」面板 —— 你看到识别结果里出现奇怪的字符时，
 *   查这张表就知道原稿写的可能是什么。
 *
 * 数据分两块：
 *   GROUPS       展示用的分组明细（sym 符号 / name 名称 / look 手写长什么样 /
 *                scene 什么时候出现）
 *   PROMPT_NOTES 由 GROUPS 生成的紧凑提示串（发给云函数用，控制 token 量）
 *
 * 维护约定：加符号只在 GROUPS 里加，PROMPT_NOTES 会跟着变；
 *          云函数里另有一份极简兜底文案（它部署后读不到本文件），两处大方向保持一致即可。
 */

const GROUPS = [
  {
    name: '希腊字母',
    items: [
      { sym: 'α', name: 'alpha 阿尔法', look: '像 a、2，带个小尾巴', scene: '角度、系数、数列通项' },
      { sym: 'β', name: 'beta 贝塔', look: '像 B、13', scene: '系数、角度' },
      { sym: 'γ', name: 'gamma 伽马', look: '像 y、r', scene: '密度函数、路径' },
      { sym: 'δ', name: 'delta 德尔塔', look: '像 ∂、6、小手写 d', scene: 'ε-δ 极限定义、增量' },
      { sym: 'ε', name: 'epsilon 艾普西隆', look: '像反写的 3、€、ϵ', scene: 'ε-N / ε-δ 定义的核心符号，几乎每道极限证明都有' },
      { sym: 'θ', name: 'theta 西塔', look: '像 0、8 中间带横', scene: '角度' },
      { sym: 'λ', name: 'lambda 拉姆达', look: '像 人、入、λ', scene: '特征值（Aξ=λξ）、实数参数' },
      { sym: 'μ', name: 'mu 缪', look: '像 u 加尾巴、µ', scene: '期望、测度' },
      { sym: 'ξ', name: 'xi 克西', look: '手写极乱，像一堆圈和钩', scene: '随机变量、中值定理里的中间点' },
      { sym: 'π', name: 'pi 派', look: '像 n 上加横、π', scene: '圆周率、乘积记号' },
      { sym: 'ρ', name: 'rho 柔', look: '像 p', scene: '密度、极坐标的极径' },
      { sym: 'σ', name: 'sigma 西格马', look: '**像 6、b、o**——本次实测最常见的误认', scene: '求和记号 ∑、标准差、置换' },
      { sym: 'τ', name: 'tau 套', look: '像 7 加横、τ', scene: '时间参数、曲线参数' },
      { sym: 'φ', name: 'phi 斐', look: '像 中、Φ、ø', scene: '角度、函数、空集符 ∅ 混淆' },
      { sym: 'ω', name: 'omega 欧米伽', look: '像 w', scene: '角频率、无穷小记号' }
    ]
  },
  {
    name: '逻辑与集合符号',
    items: [
      { sym: '∀', name: '任意（全称量词）', look: '倒写的 A', scene: '「对任意 M」—— 确界、极限定义全靠它' },
      { sym: '∃', name: '存在（存在量词）', look: '反写的 E', scene: '「存在 N」' },
      { sym: '∈', name: '属于', look: '**与希腊字母 ε 同形**，全靠上下文区分', scene: 'x∈A、n∈N₊' },
      { sym: '⊆', name: '子集', look: '像 C 加横线', scene: '集合包含' },
      { sym: '∪ / ∩', name: '并 / 交', look: '∪ 像 U，∩ 像 n', scene: '集合运算' },
      { sym: '∅', name: '空集', look: '像 Ø、斜线圆', scene: '空集 —— 别认成希腊字母 φ' },
      { sym: '⇒ / ⇔', name: '推出 / 等价', look: '= 加箭头，双线箭头', scene: '证明的推理链条' }
    ]
  },
  {
    name: '运算记号',
    items: [
      { sym: '∑', name: '求和', look: '像 E、M、W（上下限写法各异）', scene: '数列求和 —— 手写大 Σ 与 E 极难区分' },
      { sym: '∏', name: '求积', look: '像 Π、∏', scene: '连乘' },
      { sym: '∞', name: '无穷大', look: '像 8、横写的 oo', scene: 'lim(n→∞)' },
      { sym: '√', name: '根号', look: '像 r、勾', scene: '√2、根式' },
      { sym: '≤ / ≥', name: '小于等于 / 大于等于', look: '手写常带小勾，像 ≦ ≧', scene: '不等式' },
      { sym: 'lim', name: '极限', look: 'i 的点常丢失，像 1im', scene: 'lim(n→∞) —— 线代/数列通项' }
    ]
  }
];

/**
 * 生成给视觉模型的紧凑提示串。
 * 挑最容易误认的符号，一行一个，控制 token。
 */
function buildPromptNotes() {
  const pick = {};
  GROUPS.forEach((g) => {
    g.items.forEach((it) => {
      if (it.sym && it.look && it.sym.indexOf('略') < 0) pick[it.sym] = it.look;
    });
  });
  return [
    'σ 像 6/b（求和、标准差）',
    'ε 像 反3/€（极限定义）',
    'δ 像 ∂/6',
    'λ 像 人/入（特征值）',
    'θ 像 0',
    'ξ 手写极乱',
    '∀ 是倒 A（任意）',
    '∃ 是反 E（存在）',
    '∈ 与 ε 同形，靠上下文区分',
    '∑ 像 E/M（求和）',
    '∞ 像 8/oo',
    '∅ 像 Ø（空集，别认成 φ）'
  ].join('；');
}

const PROMPT_NOTES = buildPromptNotes();

module.exports = {
  GROUPS: GROUPS,
  PROMPT_NOTES: PROMPT_NOTES
};
