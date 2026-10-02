/**
 * 知识点树
 *
 * 设计原则（重要）：知识点**只从这棵预置树里选**，不允许自动生成新节点。
 * 否则用不了多久，表里就会长出几十个同义不同名的节点，掌握度统计会直接失效。
 * 新增知识点要在这里手工加，并保持 id 稳定。
 *
 * ---------------------------------------------------------------------------
 * 覆盖范围（按工科数学分析教材章节编排）
 * ---------------------------------------------------------------------------
 * 一、极限与连续：实数与确界 / 函数与邻域 / 数列极限 / 函数极限 / 连续性
 * 二、微分学：导数与微分 / 微分中值定理与导数应用 / 多元函数微分学
 * 三、积分学：不定积分 / 定积分 / 定积分应用 / 反常积分 / 重积分 /
 *             曲线积分与曲面积分
 * 四、级数：数项级数 / 幂级数与函数项级数 / 傅里叶级数
 * 五、线性代数：矩阵与运算 / 行列式 / 向量组与线性相关性 / 线性方程组 /
 *               特征值与二次型 / 线性空间与线性变换
 *
 * 命名的两套前缀：数学分析用 `kb_`（knowledge），线性代数用 `la_`。
 * 章节用 `ch_`，课程用 `c_`。
 */

const TREE = [
  {
    id: 'c_math',
    name: '高等数学分析（工科数学分析）',
    children: [
      {
        id: 'ch_real',
        name: '实数与确界',
        children: [
          { id: 'kb_def', name: '集合的界与无界性', desc: '有界、无界的定义表述' },
          { id: 'kb_unbounded', name: '无上界／无下界的符号化', desc: '量词顺序：∀M ∃x，而不是 ∃M ∀x' },
          { id: 'kb_sup', name: '上确界', desc: '最小上界 = 是上界 + 最小性' },
          { id: 'kb_inf', name: '下确界', desc: '最大下界 = 是下界 + 最大性' },
          { id: 'kb_def_verify', name: '确界定义的两步验证', desc: '「是界」与「最小／最大性」缺一不可' },
          { id: 'kb_dense', name: '有理数集内的确界与稠密性', desc: '在 Q 内确界可能不存在' },
          { id: 'kb_supinf_rel', name: '确界与最值的关系', desc: 'sup 属于集合时才等于 max' },
          { id: 'kb_real_complete', name: '实数系的完备性', desc: '确界原理、单调有界原理的等价性' }
        ]
      },
      {
        id: 'ch_func',
        name: '函数与邻域',
        children: [
          { id: 'kb_local_bound', name: '去心邻域内的无界性', desc: '对任意 M 都能找到邻域内的点超过它' },
          { id: 'kb_neighborhood', name: '去心邻域的表示与点列构造', desc: 'U°(x₀,δ)、构造合适的点列' },
          { id: 'kb_func_elem', name: '函数的基本性质', desc: '单调、奇偶、周期、有界' },
          { id: 'kb_composite_inv', name: '复合函数与反函数', desc: '定义域、值域的对应' }
        ]
      },
      {
        id: 'ch_seq',
        name: '数列的极限',
        children: [
          { id: 'kb_seq_def', name: '数列极限的定义（ε-N）', desc: '对任意 ε 存在 N，n>N 时成立' },
          { id: 'kb_seq_prop', name: '收敛数列的性质', desc: '唯一性、有界性、保号性' },
          { id: 'kb_seq_op', name: '数列极限的四则运算', desc: '加减乘除的极限法则' },
          { id: 'kb_seq_squeeze', name: '夹逼定理', desc: '两边夹、放缩取极限' },
          { id: 'kb_seq_mono', name: '单调有界原理', desc: '单调有界数列必收敛' },
          { id: 'kb_seq_cauchy', name: '柯西收敛准则', desc: '对任意 ε 存在 N，m,n>N 时距离小于 ε' },
          { id: 'kb_seq_sub', name: '子列与收敛性', desc: '收敛数列的子列都收敛于同一极限' },
          { id: 'kb_seq_stolz', name: 'Stolz 定理', desc: '数列形式的洛必达法则' },
          { id: 'kb_seq_limit_e', name: '重要极限 (1+1/n)ⁿ → e', desc: '自然常数 e 的定义' }
        ]
      },
      {
        id: 'ch_lim',
        name: '函数的极限',
        children: [
          { id: 'kb_lim_def', name: '函数极限的定义（ε-δ）', desc: 'x→x₀ 时的极限表述' },
          { id: 'kb_lim_inf', name: 'x→∞ 时的函数极限（ε-X）', desc: '自变量趋于无穷的表述' },
          { id: 'kb_lim_oneside', name: '左右极限', desc: '左右极限存在且相等才是极限存在' },
          { id: 'kb_inf_small', name: '无穷小与无穷大', desc: '定义与相互关系' },
          { id: 'kb_inf_compare', name: '无穷小的比较', desc: '高阶、同阶、等价无穷小' },
          { id: 'kb_lim_op', name: '极限的运算法则', desc: '四则运算与复合' },
          { id: 'kb_lim_two', name: '两个重要极限', desc: 'sinx/x → 1、(1+1/x)ˣ → e' },
          { id: 'kb_lim_heine', name: '海涅定理', desc: '函数极限与数列极限的转化' },
          { id: 'kb_lim_left_right', name: '极限存在的准则', desc: '夹逼、单调有界' }
        ]
      },
      {
        id: 'ch_cont',
        name: '函数的连续性',
        children: [
          { id: 'kb_cont_def', name: '连续的定义', desc: '极限值等于函数值' },
          { id: 'kb_cont_discont', name: '间断点及其分类', desc: '第一类（可去、跳跃）、第二类' },
          { id: 'kb_cont_closed', name: '闭区间上连续函数的性质', desc: '最值定理、介值定理、零点定理' },
          { id: 'kb_cont_uniform', name: '一致连续', desc: 'δ 只依赖 ε，不依赖点' },
          { id: 'kb_cont_elem', name: '初等函数的连续性', desc: '连续性与极限交换' }
        ]
      },
      {
        id: 'ch_deriv',
        name: '导数与微分',
        children: [
          { id: 'kb_deriv_def', name: '导数的定义', desc: '差商的极限' },
          { id: 'kb_deriv_geo', name: '导数的几何意义', desc: '切线斜率' },
          { id: 'kb_deriv_rules', name: '求导法则', desc: '四则、复合、反函数求导' },
          { id: 'kb_deriv_high', name: '高阶导数', desc: 'f″、f⁽ⁿ⁾' },
          { id: 'kb_deriv_implicit', name: '隐函数求导', desc: 'F(x,y)=0 两边求导' },
          { id: 'kb_deriv_param', name: '参数方程求导', desc: 'dy/dx = (dy/dt)/(dx/dt)' },
          { id: 'kb_diff_def', name: '微分与可微性', desc: '可导 ⟺ 可微' },
          { id: 'kb_diff_approx', name: '微分的近似计算', desc: 'Δy ≈ dy' }
        ]
      },
      {
        id: 'ch_mvt',
        name: '微分中值定理与导数应用',
        children: [
          { id: 'kb_mvt_fermat', name: '费马引理', desc: '极值点处导数为零' },
          { id: 'kb_mvt_rolle', name: '罗尔定理', desc: '端点相等则中间有一点导数为零' },
          { id: 'kb_mvt_lagrange', name: '拉格朗日中值定理', desc: 'f(b)-f(a) = f′(ξ)(b-a)' },
          { id: 'kb_mvt_cauchy', name: '柯西中值定理', desc: '两个函数之比的增量形式' },
          { id: 'kb_mvt_taylor', name: '泰勒公式与泰勒展开', desc: '带皮亚诺/拉格朗日余项' },
          { id: 'kb_mvt_lhopital', name: '洛必达法则', desc: '0/0 与 ∞/∞ 型不定式' },
          { id: 'kb_app_mono', name: '单调性与极值判别', desc: '一阶导数的符号' },
          { id: 'kb_app_concave', name: '凹凸性与拐点', desc: '二阶导数的符号' },
          { id: 'kb_app_asymptote', name: '渐近线', desc: '水平、垂直、斜渐近线' },
          { id: 'kb_app_curvature', name: '曲率与曲率半径', desc: 'K = |y″|/(1+y′²)^(3/2)' },
          { id: 'kb_ineq_proof', name: '用导数证明不等式', desc: '构造辅助函数、单调性' }
        ]
      },
      {
        id: 'ch_indef',
        name: '不定积分',
        children: [
          { id: 'kb_anti_def', name: '原函数与不定积分', desc: '原函数族相差常数' },
          { id: 'kb_anti_table', name: '基本积分表', desc: '常用积分公式' },
          { id: 'kb_anti_sub', name: '换元积分法', desc: '第一类与第二类换元' },
          { id: 'kb_anti_parts', name: '分部积分法', desc: '∫udv = uv - ∫vdu' },
          { id: 'kb_anti_rational', name: '有理函数的积分', desc: '部分分式分解' },
          { id: 'kb_anti_trig', name: '三角有理式的积分', desc: '万能代换 t=tan(x/2)' },
          { id: 'kb_anti_radical', name: '简单无理函数的积分', desc: '根式代换' }
        ]
      },
      {
        id: 'ch_defint',
        name: '定积分',
        children: [
          { id: 'kb_di_def', name: '定积分的定义（黎曼和）', desc: '分割、近似、求和、取极限' },
          { id: 'kb_di_prop', name: '定积分的性质', desc: '线性、区间可加、保号性' },
          { id: 'kb_di_nl', name: '牛顿-莱布尼茨公式', desc: '∫ₐᵇf = F(b)-F(a)' },
          { id: 'kb_di_var', name: '变限积分与求导', desc: 'Φ(x)=∫ₐˣf(t)dt 的导数' },
          { id: 'kb_di_mean', name: '积分中值定理', desc: '存在 ξ 使积分等于 f(ξ)(b-a)' },
          { id: 'kb_di_ineq', name: '积分不等式', desc: '估值、柯西-施瓦茨' }
        ]
      },
      {
        id: 'ch_intapp',
        name: '定积分的应用',
        children: [
          { id: 'kb_ia_area', name: '平面图形的面积', desc: '直角坐标与极坐标' },
          { id: 'kb_ia_volume', name: '旋转体的体积', desc: '圆盘法、柱壳法' },
          { id: 'kb_ia_arc', name: '弧长', desc: '直角坐标、参数、极坐标' },
          { id: 'kb_ia_surface', name: '旋转曲面的面积', desc: '侧面积公式' },
          { id: 'kb_ia_phys', name: '物理应用', desc: '变力做功、水压力、质心' }
        ]
      },
      {
        id: 'ch_improper',
        name: '反常积分',
        children: [
          { id: 'kb_imp_inf', name: '无穷限反常积分', desc: '∫ₐ^∞ f(x)dx 的收敛性' },
          { id: 'kb_imp_discont', name: '无界函数的反常积分', desc: '瑕积分' },
          { id: 'kb_imp_test', name: '反常积分的敛散判别', desc: '比较判别法' },
          { id: 'kb_imp_gamma', name: 'Γ 函数与 B 函数', desc: '含参量积分的初步' }
        ]
      },
      {
        id: 'ch_series',
        name: '数项级数',
        children: [
          { id: 'kb_se_def', name: '级数收敛的定义（部分和）', desc: '部分和数列有极限' },
          { id: 'kb_se_prop', name: '收敛级数的性质', desc: '必要条件、线性运算' },
          { id: 'kb_se_positive', name: '正项级数', desc: '部分和有界则收敛' },
          { id: 'kb_se_compare', name: '比较判别法', desc: '与已知级数比较' },
          { id: 'kb_se_ratio', name: '比值判别法（达朗贝尔）', desc: 'lim aₙ₊₁/aₙ' },
          { id: 'kb_se_root', name: '根值判别法（柯西）', desc: 'lim ⁿ√aₙ' },
          { id: 'kb_se_integral', name: '积分判别法', desc: '与反常积分同敛散' },
          { id: 'kb_se_alternating', name: '交错级数与莱布尼茨判别法', desc: '单调递减趋于零' },
          { id: 'kb_se_abs', name: '绝对收敛与条件收敛', desc: '绝对收敛必收敛' }
        ]
      },
      {
        id: 'ch_power',
        name: '幂级数与函数项级数',
        children: [
          { id: 'kb_pw_uniform', name: '函数项级数的一致收敛', desc: 'Weierstrass 判别法' },
          { id: 'kb_pw_radius', name: '幂级数的收敛半径与收敛域', desc: '比值法求 R' },
          { id: 'kb_pw_prop', name: '幂级数的性质', desc: '逐项求导、逐项积分' },
          { id: 'kb_pw_expand', name: '函数展开成幂级数', desc: '直接法与间接法' },
          { id: 'kb_pw_taylor', name: '泰勒级数与麦克劳林级数', desc: 'eˣ、sinx、ln(1+x) 等展开式' }
        ]
      },
      {
        id: 'ch_fourier',
        name: '傅里叶级数',
        children: [
          { id: 'kb_ft_def', name: '傅里叶级数与傅里叶系数', desc: '三角级数展开' },
          { id: 'kb_ft_dirichlet', name: '狄利克雷收敛定理', desc: '收敛条件与和函数' },
          { id: 'kb_ft_parity', name: '奇偶延拓与正弦余弦级数', desc: '按奇偶性简化' }
        ]
      },
      {
        id: 'ch_multivar',
        name: '多元函数微分学',
        children: [
          { id: 'kb_mv_limit', name: '多元函数的极限与连续', desc: '路径无关性' },
          { id: 'kb_mv_partial', name: '偏导数', desc: '对单个变量求导' },
          { id: 'kb_mv_total', name: '全微分', desc: '可微的充分条件' },
          { id: 'kb_mv_chain', name: '多元复合函数求导', desc: '链式法则' },
          { id: 'kb_mv_implicit', name: '隐函数定理', desc: 'F(x,y,z)=0 求偏导' },
          { id: 'kb_mv_directional', name: '方向导数与梯度', desc: 'grad f、最速上升方向' },
          { id: 'kb_mv_extremum', name: '多元函数的极值', desc: '驻点 + 二阶判别' },
          { id: 'kb_mv_conditional', name: '条件极值与拉格朗日乘数法', desc: '约束下的极值' }
        ]
      },
      {
        id: 'ch_multi_int',
        name: '重积分',
        children: [
          { id: 'kb_mi_double', name: '二重积分', desc: '直角坐标下的累次积分' },
          { id: 'kb_mi_polar', name: '极坐标下的二重积分', desc: '换元与 Jacobi 行列式' },
          { id: 'kb_mi_triple', name: '三重积分', desc: '直角、柱面、球面坐标' },
          { id: 'kb_mi_change', name: '重积分的换元法', desc: '一般变量替换' },
          { id: 'kb_mi_app', name: '重积分的应用', desc: '体积、曲面面积、质心' }
        ]
      },
      {
        id: 'ch_line_surf',
        name: '曲线积分与曲面积分',
        children: [
          { id: 'kb_ls_line1', name: '第一类曲线积分（弧长）', desc: '对弧长的曲线积分' },
          { id: 'kb_ls_line2', name: '第二类曲线积分（坐标）', desc: '对坐标的曲线积分' },
          { id: 'kb_ls_green', name: '格林公式', desc: '曲线积分与二重积分的桥梁' },
          { id: 'kb_ls_path', name: '曲线积分与路径无关的条件', desc: '势函数、保守场' },
          { id: 'kb_ls_surf1', name: '第一类曲面积分（面积）', desc: '对面积的曲面积分' },
          { id: 'kb_ls_surf2', name: '第二类曲面积分（坐标）', desc: '对坐标的曲面积分' },
          { id: 'kb_ls_gauss', name: '高斯公式', desc: '曲面积分与三重积分' },
          { id: 'kb_ls_stokes', name: '斯托克斯公式', desc: '空间曲线积分与曲面积分' }
        ]
      }
    ]
  },
  {
    id: 'c_linalg',
    name: '线性代数',
    children: [
      {
        id: 'ch_mat',
        name: '矩阵与运算',
        children: [
          { id: 'la_op', name: '矩阵加减与乘法', desc: '不满足交换律' },
          { id: 'la_pow', name: '矩阵的幂与多项式', desc: 'A²、A³、f(A)' },
          { id: 'la_transpose', name: '转置与对称矩阵', desc: 'Aᵀ、对称与反对称' },
          { id: 'la_inverse', name: '逆矩阵', desc: '可逆条件、求逆方法' },
          { id: 'la_block', name: '分块矩阵', desc: '分块运算与分块求逆' },
          { id: 'la_elem', name: '初等变换与初等矩阵', desc: '行变换、等价标准形' },
          { id: 'la_commute', name: '可交换矩阵的结构', desc: 'AB = BA 的推论' },
          { id: 'la_outer', name: '外积与秩一矩阵', desc: 'αβ 型矩阵的幂' }
        ]
      },
      {
        id: 'ch_det',
        name: '行列式',
        children: [
          { id: 'la_det_def', name: '行列式的定义与性质', desc: '排列、符号、性质化简' },
          { id: 'la_det_expand', name: '行列式按行（列）展开', desc: '代数余子式' },
          { id: 'la_det_cramer', name: '克拉默法则', desc: '解线性方程组' },
          { id: 'la_det_vander', name: '范德蒙德行列式', desc: '特殊行列式的值' },
          { id: 'la_det_block', name: '分块行列式', desc: '分块三角的化简' }
        ]
      },
      {
        id: 'ch_vec',
        name: '向量组与线性相关性',
        children: [
          { id: 'la_comb', name: '线性组合与线性表示', desc: 'β 可由向量组线性表示' },
          { id: 'la_depend', name: '线性相关与线性无关', desc: '存在非零系数使组合为零' },
          { id: 'la_rank', name: '向量组的秩', desc: '极大无关组所含向量个数' },
          { id: 'la_basis', name: '极大无关组与基', desc: '唯一表示' },
          { id: 'la_space', name: '向量空间与维数', desc: '基、坐标、过渡矩阵' },
          { id: 'la_orth', name: '内积与正交化', desc: '施密特正交化' }
        ]
      },
      {
        id: 'ch_eqn',
        name: '线性方程组',
        children: [
          { id: 'la_eq_homog', name: '齐次线性方程组', desc: '基础解系与解空间维数' },
          { id: 'la_eq_nonhomog', name: '非齐次线性方程组', desc: '有解条件、通解结构' },
          { id: 'la_eq_struct', name: '解的结构', desc: '特解 + 齐次通解' },
          { id: 'la_rank_eq', name: '秩与解的关系', desc: 'r(A) 与 n 的比较' }
        ]
      },
      {
        id: 'ch_eigen',
        name: '特征值与二次型',
        children: [
          { id: 'la_eigen', name: '特征值与特征向量', desc: 'Aξ = λξ' },
          { id: 'la_similar', name: '矩阵相似与对角化', desc: '可对角化的条件' },
          { id: 'la_eigen_prop', name: '特征值的性质', desc: '迹、行列式与特征值的关系' },
          { id: 'la_quadratic', name: '二次型与标准形', desc: '配方法、正交变换法' },
          { id: 'la_positive_def', name: '正定性判别', desc: '顺序主子式全正' }
        ]
      },
      {
        id: 'ch_linmap',
        name: '线性空间与线性变换',
        children: [
          { id: 'la_map_def', name: '线性变换的定义', desc: '保持加法与数乘' },
          { id: 'la_map_matrix', name: '线性变换的矩阵表示', desc: '在给定基下的矩阵' },
          { id: 'la_map_eigen', name: '特征子空间', desc: '不变子空间' },
          { id: 'la_jordan', name: '约当标准形', desc: '不可对角化时的标准形' }
        ]
      }
    ]
  }
];

/** id → 知识点（含所属路径） */
const FLAT = {};
(function walk(nodes, path) {
  nodes.forEach((n) => {
    const p = path.concat(n.name);
    FLAT[n.id] = { id: n.id, name: n.name, desc: n.desc || '', path: p, pathText: p.join(' / ') };
    if (n.children) walk(n.children, p);
  });
})(TREE, []);

function nameOf(id) {
  return (FLAT[id] && FLAT[id].name) || id;
}

function courseOf(kpId) {
  const one = FLAT[kpId];
  if (!one) return '';
  return one.path[0];
}

/** 树形展开，给 picker 用：返回 [{id,name,depth,isLeaf}] */
function flatOptions() {
  const out = [];
  (function walk(nodes, depth) {
    nodes.forEach((n) => {
      out.push({ id: n.id, name: n.name, depth, isLeaf: !n.children || !n.children.length });
      if (n.children) walk(n.children, depth + 1);
    });
  })(TREE, 0);
  return out;
}

/** 只要叶子（真正可选的知识点） */
function leaves() {
  return flatOptions().filter((o) => o.isLeaf);
}

/**
 * 按关键词搜知识点 —— 给核对页的「搜索打标签」用。
 *
 * 匹配范围：名称、描述、所属章节路径。三者任一命中即算。
 * 排序：名称命中的排前面（更相关），然后按名称长度（短的更可能是精确想找的）。
 *
 * 为什么要有这个：树里有一百多个知识点，靠 picker 一层层点是折磨。
 * 直接搜「极限」就能把相关章节的叶子全列出来。
 */
function search(kw, limit) {
  const q = String(kw || '').trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  leaves().forEach((o) => {
    const one = FLAT[o.id];
    const inName = one.name.toLowerCase().indexOf(q) >= 0;
    const inDesc = (one.desc || '').toLowerCase().indexOf(q) >= 0;
    const inPath = one.pathText.toLowerCase().indexOf(q) >= 0;
    if (!inName && !inDesc && !inPath) return;
    hits.push({
      id: one.id,
      name: one.name,
      desc: one.desc,
      pathText: one.pathText,
      // 名称命中 > 描述命中 > 仅路径命中
      rank: inName ? 0 : (inDesc ? 1 : 2)
    });
  });
  hits.sort((a, b) => (a.rank - b.rank) || (a.name.length - b.name.length));
  return hits.slice(0, limit || 30);
}

module.exports = { TREE, FLAT, nameOf, courseOf, flatOptions, leaves, search };
