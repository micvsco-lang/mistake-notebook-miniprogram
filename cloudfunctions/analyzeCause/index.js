/**
 * analyzeCause — 可选的 AI 错因分析云函数
 *
 * 小程序里的规则引擎在批语写得清楚时已经够用。这个云函数是给「批语很含糊、
 * 或者干脆没有批语」的题目兜底：把题目、你的作答、教师批语一起发给大模型，
 * 让它从**预置的错因表**里挑，而不是自由发挥。
 *
 * 关键约束：模型只允许返回 CAUSES 里已有的 code。否则它会造出一堆同义不同名的
 * 错因标签，统计立刻失效——这和知识点树是同一个道理。
 *
 * 部署前需要在云函数环境变量里配置：
 *   LLM_API_KEY   必填，模型服务的 Key
 *   LLM_ENDPOINT  选填，默认 DeepSeek 的 OpenAI 兼容地址
 *   LLM_MODEL     选填，默认 deepseek-chat
 *
 * 注意：这个函数没有部署也能正常使用小程序，只是错因归类走规则引擎。
 */
const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ENDPOINT = process.env.LLM_ENDPOINT || 'https://api.deepseek.com/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'deepseek-chat';
const API_KEY = process.env.LLM_API_KEY || '';

const CAUSES = `C1 概念理解偏差：对定义、定理本身理解有误，用错对象或范围
C2 证明结构不完整：漏掉定义要求的某个必要条件，结论对但论证链断了
C3 逻辑推理不严谨：构造量或推导不成立，没推出矛盾或没构造出所需对象
C4 分类讨论遗漏：没覆盖全部情形，用一种情况代替了所有情况
C5 计算与符号错误：思路对但运算、代入出错
C6 表述与书写不规范：符号写错、笔误、表述不到位，影响论证清晰度
C7 审题偏差：答非所问，或误读了题目条件／要求`;

const SYSTEM = `你是一位严谨的数学助教，帮学生做错因归因。

错因只能从下面这 7 类里选，必须使用给定的代码，不得自创：

${CAUSES}

要求：
1. 只依据给定材料判断，不要脑补学生没写的内容。
2. 如果材料不足以判断错因，causes 返回空数组，并在 advice 里说明需要补充什么信息。
3. 每条错因的 detail 要指出「具体哪一步出了问题」，不要泛泛而谈。
4. advice 用第二人称，给可操作的一两步，不超过 3 句。
5. 只输出 JSON，不要任何解释文字或代码块标记。

输出格式：
{"causes":[{"code":"C2","detail":"具体问题"}],"advice":"补救建议"}`;

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
      timeout: timeoutMs || 20000
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

/** 从模型输出里抠出 JSON（它经常忍不住加 ``` 或前后缀） */
function extractJson(text) {
  if (!text) return null;
  const s = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(s); } catch (e) { /* 继续尝试 */ }
  const m = /\{[\s\S]*\}/.exec(s);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { return null; } }
  return null;
}

exports.main = async (event) => {
  if (!API_KEY) {
    return { ok: false, msg: '云函数未配置 LLM_API_KEY，请在小程序后台为该云函数添加环境变量。' };
  }

  const e = event || {};
  const material = [
    '【题目】' + (e.stem || '（无）'),
    '【学生的作答】' + (e.myAnswer || '（无）'),
    '【正确答案】' + (e.rightAnswer || '（无）'),
    '【教师批语】' + (e.comment || '（无）'),
    '【本题得分】' + (e.score != null ? e.score + ' / ' + (e.fullScore || 20) : '未知'),
    '【知识点】' + ((e.kp || []).join('、') || '未标注')
  ].join('\n');

  let resp;
  try {
    resp = await httpsPost(ENDPOINT, {
      Authorization: 'Bearer ' + API_KEY
    }, {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: material }
      ],
      temperature: 0.2,
      max_tokens: 800
    }, 20000);
  } catch (err) {
    return { ok: false, msg: '调用模型失败：' + err.message };
  }

  if (resp.status !== 200) {
    return { ok: false, msg: '模型返回 ' + resp.status + '：' + String(resp.body).slice(0, 200) };
  }

  let parsedOuter;
  try {
    parsedOuter = JSON.parse(resp.body);
  } catch (err) {
    return { ok: false, msg: '模型响应不是合法 JSON' };
  }

  const content = parsedOuter
    && parsedOuter.choices
    && parsedOuter.choices[0]
    && parsedOuter.choices[0].message
    && parsedOuter.choices[0].message.content;

  const data = extractJson(content);
  if (!data) return { ok: false, msg: '没能从模型输出里解析出结果', raw: String(content).slice(0, 300) };

  // 硬性过滤：只接受预置错因代码
  const VALID = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
  const causes = (Array.isArray(data.causes) ? data.causes : [])
    .filter((c) => c && VALID.indexOf(c.code) >= 0)
    .slice(0, 3)
    .map((c) => ({
      code: c.code,
      detail: String(c.detail || '').slice(0, 300),
      confidence: 0.85,
      evidence: 'AI 依据批语与作答推断'
    }));

  return {
    ok: true,
    causes: causes,
    advice: String(data.advice || '').slice(0, 500),
    model: MODEL
  };
};
