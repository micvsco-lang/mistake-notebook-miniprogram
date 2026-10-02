/**
 * 模拟器端到端验证脚本
 * ---------------------------------------------------------------
 * 用官方 miniprogram-automator 驱动微信开发者工具，在真实的小程序
 * 模拟器里把 7 个页面真跑一遍，逐页截图 + 收集报错。
 *
 * 前提（缺一不可）：
 *   1. 微信开发者工具已安装，路径见下面 CLI 常量
 *   2. 工具的「设置 → 安全设置 → 服务端口」已开启   ← 关键
 *      （判定：握手目录下 .ide-status = "On" 且 .ide 里的端口在监听）
 *   3. project.config.json 里的 appid 已改成你的真实 AppID
 *
 * ⚠️ 为什么不直接用 automator.launch()
 * ---------------------------------------------------------------
 * miniprogram-automator@0.12.1 内部是 `spawn(cliPath, args, {stdio:'ignore'})`，
 * **没有 shell:true**。而 Node ≥ 18.20.2 / 20.12.2 / 21.7.3 为修 CVE-2024-27980
 * 加了硬限制：spawn 直接执行 .bat/.cmd 一律抛 `Error: spawn EINVAL`。
 * 于是 launch() 必然失败，报错还是一句误导人的
 * 「Failed to launch wechat web devTools, please make sure cliPath is correctly specified」
 * —— 跟服务端口一点关系都没有。
 *
 * 本脚本的做法（不改 node_modules）：
 *   ① 自己用 shell:true 跑 `cli.bat auto --project <项目> --auto-port 9420`
 *   ② 轮询等 9420 起来
 *   ③ 用官方公开 API `automator.connect({ wsEndpoint })` 接进去
 * 效果与 launch() 完全等价，且不依赖第三方包被修好。
 *
 * 运行（需先装 miniprogram-automator，或用 NODE_PATH 指向已装的目录）：
 *   NODE_PATH="<装有 miniprogram-automator 的 node_modules>" node tools/e2e-simulator.js
 *
 * 环境变量：
 *   WECHAT_DEVTOOLS_DIR   开发者工具安装目录（默认猜常见位置）
 *   WECHAT_USER_DATA_DIR  开发者工具的 Default userData 目录（默认自动探测）
 *
 * 产出：
 *   tools/e2e-shots/*.png   每页截图，直接肉眼看渲染对不对
 *   控制台汇总表
 * ---------------------------------------------------------------
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

/**
 * 微信开发者工具的 cli.bat 路径。
 * 优先读环境变量 WECHAT_DEVTOOLS_DIR（指向开发者工具安装目录），
 * 否则按常见安装位置猜。装到非默认位置的请自行设置该环境变量。
 */
const DEVTOOLS_DIR = process.env.WECHAT_DEVTOOLS_DIR || 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具';
const CLI = path.join(DEVTOOLS_DIR, 'cli.bat');
const PROJECT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'e2e-shots');
const AUTO_PORT = 9420;          // 自动化端口（automation websocket）

/** 开发者工具的 userData 目录：扫描 User Data 下带 WeappLocalData 的那份。
 *  hash 由安装路径算出，没法复刻 → 只能探测（见项目文档）。 */
function findUserDataDir() {
  if (process.env.WECHAT_USER_DATA_DIR) return process.env.WECHAT_USER_DATA_DIR;
  const base = path.join(process.env.LOCALAPPDATA || '', '微信开发者工具', 'User Data');
  try {
    for (const name of fs.readdirSync(base)) {
      const cand = path.join(base, name, 'Default');
      if (fs.existsSync(path.join(cand, 'WeappLocalData'))) return cand;
    }
  } catch (e) { /* 目录不存在等情况，交给调用处报错 */ }
  return '';
}

const HAND_SHAKE = findUserDataDir();

// ---------------------------------------------------------------- 启动器

function portOpen(port, timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { try { s.destroy(); } catch (e) {} resolve(v); };
    s.setTimeout(timeout);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

async function waitPort(port, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** 跑一次 cli.bat。必须 shell:true，否则 Node 22 抛 EINVAL（见文件头）。 */
function runCli(args) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try {
      p = spawn(CLI, args, { shell: true, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: 'spawn 失败: ' + e.message });
    }
    const grab = (d) => { out += d.toString('utf8'); };
    if (p.stdout) p.stdout.on('data', grab);
    if (p.stderr) p.stderr.on('data', grab);
    p.on('error', (e) => resolve({ code: -1, out: out + '\n' + e.message }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

/** 读握手文件，确认服务端口真的开着（比「看有没有报错」可靠）。 */
function servicePortState() {
  try {
    const ide = fs.readFileSync(path.join(HAND_SHAKE, '.ide'), 'utf8').trim();
    const st = fs.readFileSync(path.join(HAND_SHAKE, '.ide-status'), 'utf8').trim();
    return { port: ide, status: st, ok: st === 'On' && /^\d+$/.test(ide) };
  } catch (e) {
    return { ok: false, reason: e.code || e.message };
  }
}

/** 等价于 automator.launch()，但绕开 Node 的 .bat 限制。 */
async function launchMini(automator) {
  // 先看服务端口开没开 —— 没开的话后面必然连不上，直接给准确原因
  const sp = servicePortState();
  log('  服务端口握手：' + (sp.ok ? `.ide=${sp.port}  .ide-status=${sp.status}` : '未就绪（'
    + (sp.reason || `.ide-status=${sp.status}`) + '）'));

  if (await portOpen(AUTO_PORT)) {
    log(`  自动化端口 ${AUTO_PORT} 已在监听，直接连接`);
  } else {
    log(`  拉起自动化模式：cli auto --project <项目> --auto-port ${AUTO_PORT}`);
    const r = await runCli(['auto', '--project', `"${PROJECT}"`, '--auto-port', String(AUTO_PORT)]);
    const tail = r.out.trim().split('\n').slice(0, 12).map((l) => '      ' + l).join('\n');
    if (tail) log(tail);
    if (!await waitPort(AUTO_PORT, 90000)) {
      throw new Error(`等 90 秒，自动化端口 ${AUTO_PORT} 仍未监听`);
    }
  }
  return automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` });
}

// 需要走一遍的页面。 [路径, 中文名, 是否需要 id 参数]
const PAGES = [
  ['/pages/index/index', '今日', false],
  ['/pages/list/list', '错题本', false],
  ['/pages/detail/detail', '错题详情', true],
  ['/pages/correct/correct', '订正', true],
  ['/pages/train/train', '巩固训练', false],
  ['/pages/import/import', '导入与备份', false],
  ['/pages/stats/stats', '统计', false],
];

const results = [];
const consoleErrors = [];
const exceptions = [];

function log(s) {
  console.log(s);
}

function ok(name, pass, detail) {
  results.push({ name, pass, detail: detail || '' });
}

async function main() {
  let automator;
  try {
    automator = require('miniprogram-automator');
  } catch (e) {
    log('\n[×] 找不到 miniprogram-automator。');
    log('    请确认运行时带了 NODE_PATH（见本文件顶部注释）。');
    process.exitCode = 1;
    return;
  }

  // 检查工具是否装了
  if (!fs.existsSync(CLI)) {
    log(`\n[×] 找不到开发者工具 CLI：${CLI}`);
    log('    如果工具装在别处，请改本文件顶部的 CLI 常量。');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true });

  log('\n启动模拟器（需要工具的服务端口已开启）…');
  let miniProgram;
  try {
    miniProgram = await launchMini(automator);
  } catch (e) {
    log('\n[×] 启动失败：' + (e && e.message ? e.message : e));
    log('');
    log('  排查顺序：');
    log('   1) 服务端口是否开：工具 → 设置 → 安全设置 → 服务端口');
    log('      或跑 python tools/devtools-start.py --check（看 .ide / .ide-status）');
    log('   2) 项目是否已在工具里打开，且没有卡在某个弹窗上');
    log('   3) 若报 spawn EINVAL → 见本文件头「为什么不直接用 automator.launch()」');
    process.exitCode = 1;
    return;
  }

  log('[√] 模拟器已连接\n');

  // 挂上日志监听，抓页面报错
  try {
    miniProgram.on('console', (msg) => {
      const t = (msg && msg.type) || '';
      const a = (msg && msg.args) ? msg.args.join(' ') : '';
      if (t === 'error') consoleErrors.push(a);
    });
    miniProgram.on('exception', (err) => {
      exceptions.push(err && err.message ? err.message : String(err));
    });
  } catch (e) {
    /* 部分版本不支持监听，忽略 */
  }

  // ---- 第一步：首页，顺便取一个真实错题 id ----
  let sampleId = '';
  try {
    const page = await miniProgram.reLaunch('/pages/index/index');
    await page.waitFor(1200);
    const data = await page.data();

    ok('首页 · 页面加载', !!data, '');
    ok('首页 · 数据已初始化', data.ready === true, `ready=${data.ready}`);
    ok('首页 · 有错题数据', Array.isArray(data.todo), `todo 长度=${(data.todo || []).length}`);

    const todo = data.todo || [];
    if (todo.length) sampleId = todo[0].id || '';
    ok('首页 · 取到样例错题 id', !!sampleId, sampleId ? `id=${sampleId}` : '没取到');

    if (data.stats) {
      log(`    概览：${data.stats.total || 0} 道错题，待订正 ${data.stats.newCount || '?'}`);
    }

    await miniProgram.screenshot({ path: path.join(SHOT_DIR, '01-今日.png') });
    ok('首页 · 截图', true, '01-今日.png');
  } catch (e) {
    ok('首页 · 页面加载', false, e.message);
  }

  // ---- 其余页面逐个走 ----
  for (let i = 1; i < PAGES.length; i++) {
    const [url, name, needId] = PAGES[i];
    const full = needId && sampleId ? `${url}?id=${sampleId}` : url;
    const fileNo = String(i + 1).padStart(2, '0');
    try {
      const page = await miniProgram.reLaunch(full);
      await page.waitFor(900);
      const data = await page.data().catch(() => ({}));
      const keys = data ? Object.keys(data).length : 0;
      ok(`${name} · 页面加载`, true, `data 字段 ${keys} 个`);

      // 顺手验证：详情页的「解析闸门」初始必须是锁住的
      if (name === '错题详情') {
        const locked = data.unlocked === false || data.unlocked === undefined;
        ok('错题详情 · 解析默认锁住', locked, `unlocked=${data.unlocked}`);
      }

      await miniProgram.screenshot({ path: path.join(SHOT_DIR, `${fileNo}-${name}.png`) });
      ok(`${name} · 截图`, true, `${fileNo}-${name}.png`);
    } catch (e) {
      ok(`${name} · 页面加载`, false, e.message);
    }
  }

  // ---- 汇总 ----
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;

  log('\n==============================================');
  log('模拟器端到端验证');
  log('==============================================');
  for (const r of results) {
    log(`${r.pass ? '  √' : '  ×'} ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
  }
  log('');
  log(`通过 ${pass} 项，失败 ${fail} 项`);
  if (consoleErrors.length) {
    log(`\n页面 console.error ${consoleErrors.length} 条：`);
    consoleErrors.slice(0, 10).forEach((c) => log('  ! ' + c));
  } else {
    log('页面 console.error：0 条');
  }
  if (exceptions.length) {
    log(`\n页面异常 ${exceptions.length} 条：`);
    exceptions.slice(0, 10).forEach((c) => log('  ! ' + c));
  } else {
    log('页面异常：0 条');
  }
  log(`\n截图目录：${SHOT_DIR}`);
  log('==============================================');

  // 必须断开 websocket，否则事件循环被挂住、进程不退出
  try {
    if (typeof miniProgram.disconnect === 'function') await miniProgram.disconnect();
  } catch (e) { /* 忽略 */ }

  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error('\n[×] 未预期的错误：', e);
  process.exitCode = 1;
});
