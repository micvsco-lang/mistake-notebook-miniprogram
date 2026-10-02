/**
 * recognizeWork — 拍照识别云函数
 *
 * 把一张【已批改作业】的照片转成结构化题目数组：
 *   题干、我的解答、教师批语、标准解答、得分、知识点
 *
 * ---------------------------------------------------------------------------
 * 为什么用视觉大模型，而不是「OCR + 关键词切分」
 * ---------------------------------------------------------------------------
 * 纯 OCR 只给一串纯文本，会丢掉**版面语义**：哪段是印刷的题干、哪段是学生
 * 手写的解答、哪段是老师红笔的批语。而这三段恰好是这个 App 的核心字段。
 * 视觉模型一次调用就能同时完成「认字 + 分栏 + 判色」，比 OCR 后再拿规则去猜
 * 可靠得多，也省掉一整套启发式代码。
 *
 * ---------------------------------------------------------------------------
 * 关键约束（改动时不要放开）
 * ---------------------------------------------------------------------------
 * 1. **kpNames 白名单硬过滤**：模型返回的知识点必须落在传入的清单里。
 *    理由与知识点树、错因表完全一致 —— 一旦允许自由命名，统计很快失效。
 * 2. **不允许模型解题**：只转录照片上有的东西。这条是产品边界，
 *    不能让「拍照录入」悄悄变成「拍题出答案」。
 * 3. 数值字段做范围校验，越界一律丢弃。
 *
 * ---------------------------------------------------------------------------
 * 部署
 * ---------------------------------------------------------------------------
 * 本函数**零依赖**（不用装 wx-server-sdk），右键「上传并部署：云端安装依赖」即可。
 *
 * ⚠️ 必须把云函数**超时时间调到 60 秒**。默认太短，视觉模型一次要几秒到十几秒，
 *    开了 thinking 之后可能二十几秒。这一步最容易漏，漏了就是在真机上转圈到超时。
 *
 * ---------------------------------------------------------------------------
 * 换模型：只改环境变量，不改一行代码
 * ---------------------------------------------------------------------------
 * 所有厂商都走 OpenAI 兼容协议，所以换模型 = 换三个环境变量。
 *
 *   VLM_PROVIDER  选一家预设，默认 zhipu：
 *
 *     zhipu    智谱 GLM      默认 glm-4.6v-flash（免费）  open.bigmodel.cn
 *     qwen     阿里通义千问   默认 qwen3-vl-plus            bailian.console.aliyun.com
 *     doubao   字节豆包       默认 doubao-seed-1-6-vision   console.volcengine.com/ark
 *     deepseek DeepSeek      默认 deepseek-v4-flash-vision-exp（实验版，单图上限 384 token）
 *     custom   任意 OpenAI 兼容（需自己填 ENDPOINT + MODEL）
 *
 *   VLM_API_KEY   必填。对应厂商控制台申请，别填错家的。
 *   VLM_ENDPOINT  选填。覆盖预设地址（custom 必填）
 *   VLM_MODEL     选填。覆盖预设模型名
 *
 * 没配 VLM_API_KEY 时会退回读 analyzeCause 用的 LLM_API_KEY ——
 * 但注意 DeepSeek 那类纯文本模型**没有视觉能力**，退过去也调不通，只适合临时应急。
 *
 * 微调项（一般不用动）：
 *   VLM_IMAGE_STYLE  dataurl（默认）| raw。个别厂商不认 data: 前缀时改 raw
 *   VLM_THINKING     1 = 开深度思考（目前只有智谱有）→ 更准，但更慢更贵
 *   VLM_JSON_MODE    1 = 加 response_format 强制 JSON → 更稳，个别模型不支持该参数
 *   VLM_MAX_TOKENS   默认 4000。一页作业题多时输出会长
 *   VLM_TIMEOUT_MS   默认 50000
 *   VLM_MAX_RETRY    默认 2。对 429 / 5xx / 网络错误做退避重试
 *
 * 完整选型理由与成本估算见 cloudfunctions/README.md。
 */
const https = require('https');
const { URL } = require('url');

/**
 * 厂商预设。加新厂商只需在这里加一项，不用碰下面的调用逻辑。
 * 三家都用 OpenAI 兼容协议（同样的 messages + image_url 结构），所以能共用一套代码。
 */
const PROVIDERS = {
  zhipu: {
    label: '智谱 GLM',
    console: 'open.bigmodel.cn',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-5.3-flash',   // 默认用这个：始终思考型（代码里已按 low 档调），付费池不排队
    thinking: true            // 支持 thinking 开关（深度思考）
  },
  qwen: {
    label: '阿里通义千问',
    console: 'bailian.console.aliyun.com',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen3-vl-plus',
    thinking: false
  },
  doubao: {
    label: '字节豆包（火山方舟）',
    console: 'console.volcengine.com/ark',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-seed-1-6-vision-250815',
    thinking: false
  },
  deepseek: {
    label: 'DeepSeek V4 Flash Vision',
    console: 'platform.deepseek.com',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash-vision-exp',
    thinking: false,
    // 实验性模型；且**每张图最多 384 token**（图片会被压得比较狠），
    // 手写小字、数学符号这类细节可能不够看清 —— 建议先用 compare-vlm.js 实测再决定
    note: 'experimental，单图 token 上限 384'
  },
  kimi: {
    label: 'Kimi（月之暗面）',
    console: 'platform.moonshot.cn',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'kimi-k3',
    // K3 原生视觉（图/视频输入），且**永远开着推理**，没有 thinking 开关可关
    thinking: false,
    // 只支持 base64 传图（本项目默认正是 dataurl），不支持公网图片 URL；
    // 按量付费、无免费档 —— 2026-09-24 用旋转 90° 的手写证明页实测，转录质量良好
    note: '原生视觉，仅 base64 传图；按量付费无免费档'
  },
  custom: {
    label: '自定义 OpenAI 兼容',
    console: '',
    endpoint: '',
    model: '',
    thinking: false
  }
};

const PROVIDER_KEY = String(process.env.VLM_PROVIDER || 'zhipu').toLowerCase().trim();
const PRESET = PROVIDERS[PROVIDER_KEY] || PROVIDERS.zhipu;

const ENDPOINT = process.env.VLM_ENDPOINT || PRESET.endpoint
  || process.env.LLM_ENDPOINT || PROVIDERS.zhipu.endpoint;
const MODEL = process.env.VLM_MODEL || PRESET.model || 'glm-4.6v-flash';
const API_KEY = process.env.VLM_API_KEY || process.env.LLM_API_KEY || '';

const IMAGE_STYLE = String(process.env.VLM_IMAGE_STYLE || 'dataurl').toLowerCase();
const USE_THINKING = process.env.VLM_THINKING === '1' && PRESET.thinking;
/** 始终思考型模型的思考档位（low / high / max），默认 low */
const THINKING_LEVEL = process.env.VLM_THINKING_LEVEL || 'low';

/**
 * thinking 参数的写法随模型代次而变，发错直接 400。
 *
 *   GLM-4.6V 系：`{type:'disabled'|'enabled'}`  —— 可以关（转录任务不需要推理）
 *   GLM-5.3 系：`{type:'low'|'high'|'max'}`      —— **不能关**，报错原文：
 *                「该模型始终思考，不支持关闭思考；请使用 low、high 或 max」
 *
 * 2026-09-25 实测撞上：切到 glm-5.3-flash（用户资源包覆盖此模型）后，
 * 原先把 thinking 写成 disabled 的做法被直接拒绝。所以按模型名前缀分派。
 *
 * 转录用 low 档足够 —— 这活儿是照抄 + 分栏，不需要长链推理。
 */
function buildThinking(model) {
  const m = String(model || '');
  // GLM-5.x 系（始终思考）：档位参数是**顶层字段 reasoning_effort**，
  // 取值 low/high/max，**默认 max** —— 最深最贵的一档。
  // 2026-09-25 实测：max 档下一页作业思考 3618 token、耗时 30-180s 还可能超时；
  // 而  /  这种 thinking 写法它不认，
  // **静默落回 max**（官方文档明确警告：只有 low 和 high 被认作覆盖，其余一律按 max）。
  // 官方对「分类、路由、提取」类任务的推荐就是 low —— 转录正是这类。
  if (/^glm-5\./.test(m)) return { reasoning_effort: THINKING_LEVEL };
  // GLM-4.6V 系：可关。显式发 disabled（不发等于开着，实测慢 4 倍）。
  return { thinking: { type: USE_THINKING ? 'enabled' : 'disabled' } };
}
const JSON_MODE = process.env.VLM_JSON_MODE === '1';
/*
 * 输出上限。**必须给足** —— 因为有些模型（GLM-5.3 系）始终思考，
 * 思考 token 也算在 completion 里。实测一页作业：思考 3618 + 正文 334 ≈ 3952，
 * 原来的 4000 几乎顶满 —— 稍微多思考一点，正文就一个字都出不来，
 * 表现为「解析失败」但连原始内容都看不到（因为正文是空的）。
 * 2026-09-25 实测踩到。给到 12000 留足余量（这些模型最大输出有 32K~128K）。
 */
const MAX_TOKENS = Number(process.env.VLM_MAX_TOKENS) || 12000;
/**
 * 轻量档位：0=完整版（翻拍纸质）1=屏幕截图版 2=极简版
 * 用 `VLM_LITE=1` / `VLM_LITE=2` 指定；`VLM_LITE=1` 以外的值（如 `true`）按 1 处理。
 */
const LITE = (function () {
  const raw = String(process.env.VLM_LITE || '').trim();
  if (raw === '2') return 2;
  if (raw === '1' || raw.toLowerCase() === 'true') return 1;
  return 0;
})();
const TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS) || 50000;
const MAX_RETRY = Number(process.env.VLM_MAX_RETRY) || 2;

/** 图片地址的包装方式。多数厂商要 data URL，个别只认裸 base64 */
function imageUrl(b64) {
  return IMAGE_STYLE === 'raw' ? b64 : 'data:image/jpeg;base64,' + b64;
}

/** 题型白名单 —— 与小程序端 pages/import 的 typeOptions 保持一致 */
const TYPES = ['解答题', '证明题', '计算题', '选择题', '填空题', '判断题'];

const SYSTEM = `你是一位数学作业的转录助手。用户会给你一张【已被老师批改过的作业】的照片（可能是手机截图、翻拍，或手写稿）。

你的任务：把照片里的内容**如实转录并结构化**，拆成一道或多道题。

先处理照片的实际情况（这些在真实翻拍里都是常态，不是异常）：
- 照片可能旋转了 90° 或 180°（文字横躺或倒置）。先在心里把画面转正，再转录。
- 纸张背面透出的镜像淡字、格线、污渍一律忽略，它们不是内容。
- 涂改、划掉的片段忽略，只转录最终保留下来的版本。
- 学生常把题目**手抄**在解答页顶部：若解答上方有一段独立的问题陈述，无论印刷还是手写，都归入 stem。
- 手写数学符号的形状常与印刷体差别很大：σ 写得像 6 或 b，ε 像反写的 3，∀ 是倒 A，∑ 像 E。请按上下文取**标准符号**转录，不要照抄形状——手写体的形状差异不是错误，更不要在批语里重述「符号写错」这类判断。

必须严格区分四类内容，它们通常**笔迹、颜色或字体**都不同：
- stem  题干：**从这页印刷体题目开头，一直到「我的答案」「解答」「答」这类作答标题之前**。
  期间的所有宋体印刷字、以及 lim / 积分 / 根号 / 分数等公式，全部属于题干。
  **不含作答标题本身，更不含手写内容** —— 学生手写的解答（含他拍/贴上的手写照片）算 myAnswer。
  题目含图形时，用一两句简短文字描述图形。
- myAnswer  学生的解答：**从「我的答案」这类作答标题开始**，包含该标题与其下的所有手写内容
  （手写过程、贴着的手写照片都算）。
- comment  教师的批语：**「教师批语」标题连同它下方整段浅灰色小字一起**算批语。
  灰字通常是老师的补充说明或订正建议，不要漏掉，也不要把它算进题干。
- rightAnswer  标准解答：仅当照片上**明确存在**老师给出的标准解法/正确答案时才填，否则留空字符串。

铁律（违反任何一条都算失败）：
1. 只转录照片上**确实存在**的内容。认不出的字用「□」占位，绝对不要猜测、不要补全、不要润色。
2. 不要自己解题，不要生成照片上没有的解析或答案。
3. 数学符号尽量用 Unicode：∈ ∉ ∀ ∃ ≤ ≥ ≠ ∞ √ ² ³ ₀ ₁ ₙ ε δ λ α β ξ。极限写成 lim(n→∞)，分数写成 a/b。
4. 一张照片里有几道题就拆成几道，逐个返回；只有一题也返回长度为 1 的数组。
5. **每题满分就写在这一题的「题头」里**（题号旁边的括号或标题文字），这是唯一权威来源。
   典型写法：「证明题，16.6 分」「计算题，20 分」「（本题 10 分）」「3. (12分)」——
   那个数字就是**该题满分**，照抄进 fullScore。
   - 也可能写在题末或整页页脚，形如「6/20」「6/20分」「扣14分（满分20）」——
     「6/20」要拆成 score=6、fullScore=20。
   - score 是老师的**实得分**；题头只标了满分而没标得分时，score 填 null。
   - ⚠️ **一律以题头标注为准**：不要按题数去均分、也不要写死 20。
     每次作业的题量和分值都不一样，只有题头写着的才是真的。
   - 题头和整页都找不到任何分数时，才填 null。
6. gist 用不超过 14 个字概括这道题的考点。
7. type 只能取：解答题 / 证明题 / 计算题 / 选择题 / 填空题 / 判断题。
8. kpNames 只能从下面给出的【知识点清单】里挑，最多 3 个，选最贴切的。一个都匹配不上就返回空数组，**绝不允许自创**。
9. 只输出 JSON，不要任何解释文字，不要 \`\`\` 代码块标记。


**每一栏还要给出它在原图上的矩形区域**，坐标用归一化小数（0~1，相对图片宽和高，左上角为原点）：[左, 上, 右, 下]。图上没有那一栏就留空数组 []。宁可框松一点（把整栏框全），也不要切掉内容。
输出格式：
{"questions":[{"no":1,"type":"证明题","gist":"考点概括","stem":"题干原文","myAnswer":"学生解答","rightAnswer":"","comment":"教师批语","score":null,"fullScore":20,"kpNames":["知识点名"],"boxes":{"stem":[],"myAnswer":[],"comment":[],"rightAnswer":[]},"confidence":"high"}]}

confidence 取 high / medium / low，表示你对这道题转录准确度的自评。`;

/**
 * 轻量模式提示词：**屏幕截图**专用（`VLM_LITE=1` 开启）
 *
 * 为什么单独搞一份
 * ----------------
 * 完整版有一大段（约 300 字）在对付「翻拍纸质作业」的麻烦：旋转 90°、背面透字、
 * 格线污渍、涂改划掉。但用户实际传的大多是**学习通页面的屏幕截图** ——
 * 屏幕截图不会旋转、不会透字、没有污渍。这段提示词每次调用都要发一遍，
 * 白花 token（中文约 1 字 ≈ 1 token，一次就多 300 左右）。
 *
 * 砍掉之后保留的：四类内容区分、符号形状容错、铁律、输出格式 —— 这些才是
 * 决定「能不能正确分栏」的东西，一个字都不能省。
 *
 * 什么时候别用轻量模式：翻拍的纸质作业、拍照的手写稿。那些旋转和透字是真会遇到的。
 */
const SYSTEM_LITE = `你是一位数学作业的转录助手。用户会给你一张【已被老师批改过的作业】的屏幕截图。

你的任务：把截图里的内容**如实转录并结构化**，拆成一道或多道题。

手写数学符号的形状常与印刷体差别很大：σ 写得像 6 或 b，ε 像反写的 3，∀ 是倒 A，∑ 像 E。请按上下文取**标准符号**转录，不要照抄形状——手写体的形状差异不是错误，更不要在批语里重述「符号写错」这类判断。

必须严格区分四类内容，它们通常笔迹与颜色都不同：
- stem  题干：题目原文（印刷体，或学生手抄的题目）。题目含图形时，用一两句简短文字描述图形。
- myAnswer  学生的解答：学生自己手写的解答过程。
- comment  教师的批语：老师用红笔或其它颜色写下的批注、扣分说明、对错标记。
- rightAnswer  标准解答：仅当截图上**明确存在**老师给出的标准解法/正确答案时才填，否则留空字符串。

铁律（违反任何一条都算失败）：
1. 只转录截图上**确实存在**的内容。认不出的字用「□」占位，绝对不要猜测、不要补全、不要润色。
2. 不要自己解题，不要生成截图上没有的解析或答案。
3. 数学符号尽量用 Unicode：∈ ∉ ∀ ∃ ≤ ≥ ≠ ∞ √ ² ³ ₀ ₁ ₙ ε δ λ α β ξ。极限写成 lim(n→∞)，分数写成 a/b。
4. 一张截图里有几道题就拆成几道，逐个返回；只有一题也返回长度为 1 的数组。
5. **每题满分就写在这一题的「题头」里**（题号旁的括号或标题），这是唯一权威来源：
   「证明题，16.6 分」「计算题，20 分」「（本题 10 分）」—— 那个数字照抄进 fullScore。
   也可能写成「6/20」「扣14分（满分20）」（拆成 score / fullScore）。得分没标就填 null。
   ⚠️ **以题头标注为准**：不要按题数均分、不要写死 20 —— 每次作业题量和分值都不同。
6. gist 用不超过 14 个字概括这道题的考点。
7. type 只能取：解答题 / 证明题 / 计算题 / 选择题 / 填空题 / 判断题。
8. kpNames 只能从下面给出的【知识点清单】里挑，最多 3 个，选最贴切的。一个都匹配不上就返回空数组，**绝不允许自创**。
9. 只输出 JSON，不要任何解释文字，不要 \`\`\` 代码块标记。


**每一栏还要给出它在原图上的矩形区域**，坐标用归一化小数（0~1，相对图片宽和高，左上角为原点）：[左, 上, 右, 下]。图上没有那一栏就留空数组 []。宁可框松一点（把整栏框全），也不要切掉内容。
输出格式：
{"questions":[{"no":1,"type":"证明题","gist":"考点概括","stem":"题干原文","myAnswer":"学生解答","rightAnswer":"","comment":"教师批语","score":null,"fullScore":20,"kpNames":["知识点名"],"boxes":{"stem":[],"myAnswer":[],"comment":[],"rightAnswer":[]},"confidence":"high"}]}

confidence 取 high / medium / low，表示你对这道题转录准确度的自评。`;

/**
 * 极简模式提示词（`VLM_LITE=2`）—— 长期使用的主推档
 * ==================================================
 * 为什么还能再砍一半
 * ------------------
 * LITE 版（1158 字）里有一大半字在教模型做**它本来就会的事**：
 *   · 「只输出 JSON、不要 ``` 代码块」—— 现代多模态模型全部已内建
 *   · 「type 只能取 6 个值」—— 列出来占 40 字，不如让它自然填然后我们这边过滤
 *   · 「极限写成 lim(n→∞)、分数写成 a/b」—— 不写它也会这么干
 *   · 「gist 不超过 14 个字」—— 我们后端会截断，写在这里是双重保险
 * 这类「模型默认行为」不用花钱反复交代。
 *
 * 真正必须写、删了就会出错的，只有四条 —— 也就是这份的全部内容：
 *   ① **分四栏**（stem / myAnswer / comment / rightAnswer）：这是产品核心，
 *      模型自己绝无可能猜到你要把红笔批语单拎出来。
 *   ② **取标准符号而非照抄形状**：手写 σ 像 6、ε 像反 3，不交代必错。
 *   ③ **不许自己解题**：不交代它会热心地帮你把题做了。
 *   ④ **忠实转录**：认不出就占位，不许猜（否则错题记录就是假的）。
 *
 * 预期省下约 800 字 ≈ 800 token/次。识别一页 5–10 题时，
 * 这 800 字摊到每题只有 80–160 token —— 但它是**每次调用都发生**的固定开销，
 * 长期用累积下来就是这笔钱的大头。
 *
 * 风险与对策：砍提示词 = 输出格式可能不稳。所以 normalizeQuestion() 里
 * 对每个字段都做了兜底（缺字段→空串、score 非数→null、type 不在白名单→改默认），
 * 不依赖模型「守规矩」。**能用代码兜住的，就不要用提示词去求它。**
 */
const SYSTEM_TINY = `把这张已批改作业的截图如实转录成 JSON，拆成逐道题。只转录图上**确实有**的字，认不出用「□」，不许猜、不许润色、**不许自己解题**。

分清四栏（笔迹、颜色或字体通常不同）：
- stem=题干：从这页印刷体题目开头，到「我的答案／解答」这类作答标题**之前**为止；其中的宋体印刷字与 lim、积分、根号、分数等公式都算题干。**不含作答标题本身，更不含手写内容**。
- myAnswer=学生的解答：从「我的答案」这类作答标题开始，含该标题与其下所有手写内容（含手写照片）。
- comment=教师批语：「教师批语」标题连同它**下方整段浅灰色小字**一起，算批语；别漏灰字，也别把它算进题干。
- rightAnswer=老师给出的标准解答，图上没有就留空串。

满分/得分**以题头标注为准**（如「证明题，16.6 分」「计算题，20 分」），照抄进 fullScore；
题头没标就填 null —— 不要按题数均分、不要写死 20（每次作业题量和分值都不同）。

手写符号按上下文取**标准符号**，不要照抄形状（σ 常写得像 6，ε 像反 3，∀ 是倒 A，∑ 像 E）；学生字丑不是错误，也不要在批语里编「符号写错」这种话。公式写成 Unicode 或纯文本（lim(n→∞)、a/b、∑、√、ε），**不要用 LaTeX 的 $ 和反斜杠**。


**每一栏还要给出它在原图上的矩形区域**，坐标用归一化小数（0~1，相对图片宽和高，左上角为原点）：[左, 上, 右, 下]。图上没有那一栏就留空数组 []。宁可框松一点（把整栏框全），也不要切掉内容。
输出（不要任何多余文字）：
{"questions":[{"no":1,"type":"证明题","gist":"考点","stem":"","myAnswer":"","rightAnswer":"","comment":"","score":null,"fullScore":20,"kpNames":[],"boxes":{"stem":[],"myAnswer":[],"comment":[],"rightAnswer":[]},"confidence":"high"}]}`;

/** 实际使用的系统提示词（必须在各份定义之后，否则踩暂时性死区） */
const USE_SYSTEM = LITE >= 2 ? SYSTEM_TINY : (LITE === 1 ? SYSTEM_LITE : SYSTEM);

function httpsPost(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }, headers),
      timeout: timeoutMs || 45000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 该不该重试：限流和上游抖动值得等一等，其余 4xx 是配置问题，重试没意义 */
function shouldRetry(status) {
  if (!status) return true;                    // 网络层错误（含超时）
  if (status === 429) return true;             // 限流
  return status >= 500;                        // 上游抖动
}

/**
 * 带退避重试的调用。
 * 间隔 1s / 2s —— 个人自用撞不上高频限流，不需要更激进的策略。
 * 401/403 不重试：Key 错了等多久都还是错，让用户早点看到明确报错。
 */
async function postWithRetry(headers, body) {
  let last = null;
  for (let i = 0; i <= MAX_RETRY; i++) {
    /* eslint-disable no-await-in-loop */
    if (i > 0) await sleep(1000 * Math.pow(2, i - 1));
    try {
      const r = await httpsPost(ENDPOINT, headers, body, TIMEOUT_MS);
      if (r.status === 200) return r;
      last = r;
      if (!shouldRetry(r.status)) return r;
    } catch (err) {
      last = { status: 0, body: err.message };
      if (!shouldRetry(0)) return last;
    }
  }
  last = last || { status: 0, body: '未知错误' };
  last.retried = true;
  return last;
}

/** 从模型输出里抠 JSON（它经常忍不住加 ``` 或前后废话） */
/**
 * 修复「模型吐出的、不是合法 JSON 的文本」——两类真实故障，都修过：
 *
 * ① 裸控制字符（多行解答直接塞进字符串）
 * -------------------------------------------------------------------
 *     "myAnswer": "1 情形二 M² > 2：取 n 充分大…
 *     2 反设 M ∈ Q 是 A 在 Q 内的上确界"      ← 这里是裸换行
 * JSON 不允许字符串内有裸换行（必须是 `\n`），于是 parse 抛错。
 *
 * ② ★ LaTeX 的反斜杠（2026-09-25 用户真实作业撞上，比 ① 更隐蔽）
 * -------------------------------------------------------------------
 * 模型转录数学公式时会输出 LaTeX：
 *     "stem": "… $\lim_{n \to \infty} \frac{\sin 2n}{n} = 0;$"
 * 字符串里的 `\l` `\s` `\e` `\v` … **都不是合法 JSON 转义序列**，
 * JSON.parse 直接报错。而 `\f` `\t` `\n` `\r` 虽然合法，却会把
 * `\frac` 解析成「换页符 + rac」——**能解析但内容被悄悄改坏**，更阴。
 *
 * 手写数学作业必然出现公式，所以这个坑会反复撞，**必须在解析层兜住。**
 *
 * 做法：单次扫描，维护「是否在字符串内」与「上一个字符是不是反斜杠」两个状态：
 *   · 字符串外部：原样保留（那里的换行本来合法）
 *   · 字符串内部：
 *       - 裸控制字符 → 转义成 \n \r \t，其余控制字符丢弃
 *       - 合法转义（\" \\ \/ \uXXXX）→ 原样保留
 *       - b/f/n/r/t 后面**紧跟字母** → 判为 LaTeX 命令名（\frac \theta \times \neq
 *         \nabla …），补回字面反斜杠；不跟字母才当作真转义
 *       - 其余非法转义（\l \s \e …）→ 补回字面反斜杠
 *
 * ⚠️ 已知取舍：真换行若恰好写成 `\n` 且后一个字符是字母，会被误判成 LaTeX。
 * 在中文数学作业里这种情况少见，而「解析彻底失败」的代价大得多，所以取此舍。
 */
function repairJsonCtl(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (esc) {
      esc = false;
      // ① 标准转义：原样保留
      if (c === '"' || c === '\\' || c === '/') { out += '\\' + c; continue; }
      // ② \uXXXX
      if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(s.substr(i + 1, 4))) { out += '\\u'; continue; }
      // ③ b/f/n/r/t 且后面不跟字母 → 真转义；跟字母 → LaTeX 命令名
      if ('bfnrt'.indexOf(c) >= 0 && !/[a-zA-Z]/.test(s.charAt(i + 1) || '')) {
        out += '\\' + c; continue;
      }
      // ④ 其余（\l \s \e \v … 以及上面判定为 LaTeX 的情形）→ 还原成字面反斜杠
      out += '\\\\' + c;
      continue;
    }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      if (c < ' ') continue;              // 其它控制字符直接丢掉
    }
    out += c;
  }
  if (esc) out += '\\\\';                 // 文本以孤立反斜杠结尾
  return out;
}

function extractJson(text) {
  if (!text) return null;
  const s = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  // ① 原样试（模型老实转义了就能过）
  try { return JSON.parse(s); } catch (e) { /* 继续尝试 */ }
  // ② 抠出最外层的 {...} 再试（对付前后寒暄）
  const m = /\{[\s\S]*\}/.exec(s);
  const body = m ? m[0] : s;
  if (m) { try { return JSON.parse(body); } catch (e) { /* 继续尝试 */ } }
  // ③ 兜底：修掉字符串里的裸换行/制表符再解析
  try { return JSON.parse(repairJsonCtl(body)); } catch (e) { return null; }
}

/**
 * 归一化坐标框校验：必须是 4 个 0~1 的数，且左<右、上<下。
 * 模型给错的直接判 null（宁可回退整图，也不要按错坐标切出一块空白）。
 */
function normBox(v) {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map(Number);
  if (n.some((x) => !isFinite(x) || x < 0 || x > 1)) return null;
  if (n[0] >= n[2] || n[1] >= n[3]) return null;
  return n;
}

/**
 * 四栏坐标一起规范化。**全空就返回 null** —— 前端据此回退到「显示整张原图」，
 * 所以没坐标不是错误，只是少了个增强。
 */
function normBoxes(raw) {
  raw = raw || {};
  const out = {};
  let any = false;
  ['stem', 'myAnswer', 'comment', 'rightAnswer'].forEach((k) => {
    const b = normBox(raw[k]);
    if (b) { out[k] = b; any = true; } else { out[k] = null; }
  });
  return any ? out : null;
}

/** 数值字段校验：只接受合理范围内的数字，其余返回 null */
function num(v, max) {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v;
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return null;
  if (n > (max || 1000)) return null;
  return n;
}

/**
 * 文本字段清洗：**去掉首尾空白**后截断。
 *
 * ⚠️ 曾经只 replace(/\s+$/) 去尾部 —— 结果模型吐 "  求极限" 时
 * 开头会挂一坨空格进题干，列表页排版就歪了。首尾都要去。
 * （内部换行保留：题干里的多行结构是有意义的。）
 */
const str = (v, cap) => String(v == null ? '' : v).replace(/^\s+|\s+$/g, '').slice(0, cap || 4000);

/** 知识点白名单过滤 —— 归一化后求交集，命中的一律丢弃 */
function filterKp(raw, whitelist) {
  const norm = (s) => String(s || '').replace(/[\s　·・\-—_（）()【】\[\]]/g, '').toLowerCase();
  const table = {};
  whitelist.forEach((name) => { table[norm(name)] = name; });
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((n) => {
    const hit = table[norm(n)];
    if (hit && out.indexOf(hit) < 0) out.push(hit);
  });
  return out.slice(0, 3);
}

/**
 * 「6/20」形式的分数：模型常把得分和满分写在同一个字段里（照片上也确实是这么写的）。
 * 命中时返回 {score, full}，否则返回 null 走常规解析。
 */
function parseScorePair(v) {
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)\s*(?:分)?\s*$/.exec(v);
  if (!m) return null;
  const score = Number(m[1]);
  const full = Number(m[2]);
  if (!isFinite(score) || !isFinite(full) || full <= 0 || score < 0 || score > full) return null;
  if (full > 1000) return null;
  return { score: score, full: full };
}

/**
 * 题型宽松映射。
 *
 * 完整版提示词里把 6 个合法值全列了出来；极简版没列（省 token），
 * 于是模型会自由发挥成「简答题」「计算」「证明」这类近义词。
 * 静默改成「解答题」不算错，但白丢信息 —— 这里做一次近义归并，
 * 让「不列白名单」这个省钱决定不以损失字段为代价。
 */
const TYPE_ALIAS = {
  证明: '证明题', 证明题: '证明题', 论证题: '证明题',
  计算: '计算题', 计算题: '计算题', 求解题: '计算题',
  解答: '解答题', 解答题: '解答题', 简答题: '解答题', 应用题: '解答题',
  选择: '选择题', 选择题: '选择题', 单选: '选择题', 多选: '选择题',
  填空: '填空题', 填空题: '填空题',
  判断: '判断题', 判断题: '判断题', 是非题: '判断题'
};

/** 把模型给的题型归并到 6 个白名单值；认不出的回落到「解答题」 */
function normalizeType(v) {
  const s = String(v == null ? '' : v).replace(/[\s　题]/g, '');
  if (TYPES.indexOf(v) >= 0) return v;
  return TYPE_ALIAS[s] || '解答题';
}

/**
 * 模型输出 → 规范化题目数组（纯函数，不碰网络）。
 * 抽出来单独导出，是为了 tools 里能用同一份逻辑做离线测试 ——
 * 不然「云端怎么清洗模型输出」只有真调 API 才能验证。
 */
function normalizeQuestions(data, whitelist) {
  const rawList = Array.isArray(data && data.questions) ? data.questions
    : (Array.isArray(data) ? data : []);

  return rawList.slice(0, 20).map((q, i) => {
    q = q || {};
    // 优先拆「6/20」连写形式，其次才按独立字段读
    const pair = parseScorePair(q.score);
    let full = pair ? pair.full : num(q.fullScore, 200);
    let score = pair ? pair.score : num(q.score, 200);
    if (score !== null && full !== null && score > full) score = null;   // 明显不合理就丢
    const type = normalizeType(q.type);
    return {
      no: num(q.no, 999) || (i + 1),
      type: type,
      gist: str(q.gist, 60),
      stem: str(q.stem, 4000),
      myAnswer: str(q.myAnswer, 4000),
      rightAnswer: str(q.rightAnswer, 4000),
      comment: str(q.comment, 2000),
      score: score,
      fullScore: full,
      kpNames: filterKp(q.kpNames, whitelist),
      boxes: normBoxes(q.boxes),
      confidence: ['high', 'medium', 'low'].indexOf(q.confidence) >= 0 ? q.confidence : 'medium'
    };
  }).filter((q) => q.stem || q.myAnswer || q.comment);   // 三样全空的丢掉
}

exports.main = async (event) => {
  if (!API_KEY) {
    return {
      ok: false,
      code: 'NO_KEY',
      msg: '云函数未配置 VLM_API_KEY。请到云开发控制台 → 云函数 → recognizeWork → 配置 → 环境变量里添加。'
    };
  }

  const e = event || {};
  // 接受裸 base64 或 data URL 两种写法
  let b64 = String(e.image || '').trim();
  if (!b64) return { ok: false, code: 'NO_IMAGE', msg: '没有收到图片数据。' };
  const dm = /^data:image\/\w+;base64,/.exec(b64);
  if (dm) b64 = b64.slice(dm[0].length);
  if (b64.length > 4 * 1024 * 1024) {
    return { ok: false, code: 'TOO_LARGE', msg: '图片数据过大（超过 4MB），请先在手机上压缩。' };
  }

  const whitelist = (Array.isArray(e.kpNames) ? e.kpNames : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean)
    .slice(0, 120);

  const kpBlock = whitelist.length
    ? whitelist.map((n) => '- ' + n).join('\n')
    : '（本次没有提供知识点清单，kpNames 一律返回空数组）';

  const hint = e.hint ? '\n\n【用户补充说明】' + String(e.hint).slice(0, 300) : '';
  const courseHint = e.courseHint ? '\n\n【所属课程】' + String(e.courseHint).slice(0, 100) : '';
  // 手写符号对照：客户端从 miniprogram/data/symbols.js 的 PROMPT_NOTES 传来。
  // 没传也不影响 —— SYSTEM 里已有一句兜底，这里只是更详细的版本。
  const symbolNotes = e.symbolNotes
    ? '\n\n【手写符号对照】下面这些符号的手写形状常与印刷体差很远，请按上下文取标准符号转录，不要照抄形状：\n'
      + String(e.symbolNotes).slice(0, 600)
    : '';

  const userContent = [
    { type: 'image_url', image_url: { url: imageUrl(b64) } },
    {
      type: 'text',
      text: '【知识点清单】\n' + kpBlock + courseHint + hint + symbolNotes
        + '\n\n请转录这张已批改作业的照片，按要求输出 JSON。'
    }
  ];

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: USE_SYSTEM },
      { role: 'user', content: userContent }
    ],
    temperature: 0.1,
    max_tokens: MAX_TOKENS
  };
  /*
   * 深度思考开关。
   *
   * ⚠️ 必须**显式发 disabled**，不能靠"不发这个字段"来省事。
   * 因为 GLM-4.6V 系**默认就是开着 thinking 的** —— 不发等于开着。
   * 2026-09-25 用真实作业截图实测同一张图：
   *     不关：43.0 秒，completion 2416 token（其中 reasoning 1770）
   *     关掉：10.7 秒，completion  420 token（reasoning 0）
   * 快 4 倍、输出省 83%。而转录任务只是"照抄 + 分栏"，不需要深度推理。
   * 真需要它推理时再设 VLM_THINKING=1。
   *
   * 只对声明支持 thinking 的厂商发这个字段 —— 别家不认，发了可能直接报错。
   */
  if (PRESET.thinking) Object.assign(body, buildThinking(MODEL));
  // 强制 JSON 输出：稳定性更好，但个别模型不认这个参数，所以默认关
  if (JSON_MODE) body.response_format = { type: 'json_object' };

  const resp = await postWithRetry({ Authorization: 'Bearer ' + API_KEY }, body);

  if (!resp || resp.status !== 200) {
    const st = (resp && resp.status) || 0;
    const tail = resp && resp.body ? String(resp.body).slice(0, 300) : '无响应内容';
    return {
      ok: false,
      code: st ? 'UPSTREAM_' + st : 'NETWORK',
      msg: (st ? '模型返回 ' + st + '：' : '调用视觉模型失败：') + tail
        + (resp && resp.retried ? '（已自动重试仍失败）' : '')
        + ' [provider=' + PROVIDER_KEY + ' model=' + MODEL + ']'
    };
  }

  let outer;
  try {
    outer = JSON.parse(resp.body);
  } catch (err) {
    return { ok: false, code: 'BAD_RESPONSE', msg: '模型响应不是合法 JSON' };
  }

  const choice = outer && outer.choices && outer.choices[0];
  const content = choice && choice.message && choice.message.content;
  const finishReason = choice && choice.finish_reason;
  const data = extractJson(content);
  if (!data) {
    // finish_reason=length 说明输出被 max_tokens 截断 —— 这是配置问题，
    // 跟「模型说胡话」是两回事，给的指引也完全不同
    if (finishReason === 'length') {
      return {
        ok: false,
        code: 'TRUNCATED',
        msg: '模型输出被长度上限截断了。把云函数环境变量 VLM_MAX_TOKENS 调大（当前 '
          + MAX_TOKENS + '），或者一次少拍几道题。'
      };
    }
    return {
      ok: false,
      code: 'UNPARSABLE',
      msg: '没能从模型输出里解析出结果',
      raw: String(content || '').slice(0, 400)
    };
  }

  const questions = normalizeQuestions(data, whitelist);

  return {
    ok: true,
    questions: questions,
    provider: PROVIDER_KEY,
    providerLabel: PRESET.label,
    model: MODEL,
    usage: (outer && outer.usage) || null
  };
};

/* ---------------------------------------------------------------------------
 * 导出给本地工具用（不影响云函数运行）
 * tools/compare-vlm.js 直接 require 这里，复用同一份提示词与过滤规则 ——
 * 避免「线上认一套、对比脚本认另一套」的漂移。
 * --------------------------------------------------------------------------- */
exports.SYSTEM = SYSTEM;
exports.SYSTEM_LITE = SYSTEM_LITE;
exports.SYSTEM_TINY = SYSTEM_TINY;
exports.USE_SYSTEM = USE_SYSTEM;
exports.TYPES = TYPES;
exports.PROVIDERS = PROVIDERS;
exports.filterKp = filterKp;
exports.extractJson = extractJson;
exports.repairJsonCtl = repairJsonCtl;
exports.buildThinking = buildThinking;
exports.imageUrl = imageUrl;
exports.normalizeQuestions = normalizeQuestions;
exports.normalizeType = normalizeType;
exports.normBoxes = normBoxes;
exports.normBox = normBox;
exports.TYPE_ALIAS = TYPE_ALIAS;
exports.parseScorePair = parseScorePair;
exports.currentConfig = () => ({
  provider: PROVIDER_KEY,
  label: PRESET.label,
  endpoint: ENDPOINT,
  model: MODEL,
  imageStyle: IMAGE_STYLE,
  thinking: USE_THINKING,
  jsonMode: JSON_MODE,
  lite: LITE,
  maxTokens: MAX_TOKENS,
  timeoutMs: TIMEOUT_MS,
  maxRetry: MAX_RETRY
});
