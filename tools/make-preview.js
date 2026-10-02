'use strict';
/**
 * make-preview.js — 用真实的种子数据生成一份可在浏览器打开的界面预览
 *
 * 目的：不装微信开发者工具也能看到成品长什么样。用的是 seed.js 里的真实题目、
 * 真实公式图和真实手写照片，不是占位图。
 *
 * 运行：node tools/make-preview.js
 * 产出：界面预览.html（项目根目录）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const seed = require(path.join(ROOT, 'miniprogram', 'data', 'seed.js'));
const drillsMod = require(path.join(ROOT, 'miniprogram', 'data', 'drills.js'));

const assign = seed.assignments[0];
const q3 = assign.questions.find((q) => q.no === 3);
const q2 = assign.questions.find((q) => q.no === 2);
const q5 = assign.questions.find((q) => q.no === 5);
const q4 = assign.questions.find((q) => q.no === 4);

/* rpx → px：预览按 375px 宽的机身布局，1rpx = 0.5px */
const R = (rpx) => (rpx * 0.5).toFixed(1) + 'px';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** nodes → HTML，与小程序里的 richNodes 模板等价 */
function nodes(ns, small) {
  if (!ns || !ns.length) return '<span class="dim">（无内容）</span>';
  return ns.map((n) => {
    if (n.t === 't') return '<span>' + esc(n.v) + '</span>';
    if (n.t === 'br') return '<br>';
    const src = 'miniprogram' + n.s;
    if (n.p === 1) return '<img class="photo" src="' + src + '" alt="手写作答">';
    return '<img class="fx" src="' + src + '" alt="" style="width:' + R(n.w) + ';height:' + R(n.h) + '">';
  }).join('');
}

const scoreCls = (s, f) => {
  const r = s / f;
  return r >= 1 ? 'sc-good' : r >= 0.8 ? 'sc-mild' : r >= 0.5 ? 'sc-mid' : 'sc-bad';
};

/** 一片待订正列表项 */
function item(q, verdict) {
  return `
    <div class="item">
      <div class="item-top">
        <span class="qno">Q${q.no}</span>
        <span class="badge ${scoreCls(q.score, q.fullScore)}">${q.score}<i>/${q.fullScore}</i></span>
        <span class="tag tag-${verdict === 'wrong' ? 'bad' : 'warn'}">${verdict === 'wrong' ? '失分最多' : '部分失分'}</span>
        <span class="item-assign">${esc(assign.title)}</span>
      </div>
      <div class="item-text">${esc(q.stemText || q.gist)}</div>
      <div class="item-foot">
        <span class="tag tag-brand">${esc(q.kp.map((k) => KP[k] || k).slice(0, 2).join('</span><span class="tag tag-brand">'))}</span>
        <span class="btn-sm">写下错在哪</span>
      </div>
    </div>`;
}

const KP = {
  kb_def: '集合的界与无界性',
  kb_unbounded: '无上界／无下界的符号化',
  kb_sup: '上确界',
  kb_inf: '下确界',
  kb_def_verify: '确界定义的两步验证',
  kb_dense: '有理数集内的确界与稠密性',
  kb_supinf_rel: '确界与最值的关系',
  kb_local_bound: '去心邻域内的无界性',
  kb_neighborhood: '去心邻域的表示与点列构造'
};

const CAUSE_NAME = {
  C1: '概念理解偏差', C2: '证明结构不完整', C3: '逻辑推理不严谨', C4: '分类讨论遗漏',
  C5: '计算与符号错误', C6: '表述与书写不规范', C7: '审题偏差'
};
const CAUSE_REMEDY = {
  C1: '回到定义原文，逐字抄写一遍，再自己举一个正例和一个反例。',
  C2: '把定义拆成编号的检查项，每写一步就打一个勾，缺一项就补。',
  C3: '先写出结论的否定命题，再逼出矛盾；构造量必须验证它真的落在范围内。',
  C4: '动笔前先问：参数可能落在哪几个区间？逐个列出再分别处理。',
  C5: '把关键式子单独抄一行再代入，回代验算一次。',
  C6: '写完后逐行读一遍，专门检查符号与量词，再补上交待清楚的过渡句。',
  C7: '读题时把「证明/计算」「是否存在」等动词圈出来，先复述一遍题目要求。'
};

/* 排序题挑一道做演示（d_dense_03 证明 Q 内无上确界） */
const orderDrill = drillsMod.byId('d_dense_03');
const shuffled = [2, 0, 4, 1, 3];   // 固定一个"乱序"用于展示

const chairOrder = shuffled.map((i, idx) =>
  `<div class="order-item ${idx < 2 ? 'on' : ''}"><span class="order-no">${idx < 2 ? idx + 1 : ''}</span><span>${esc(orderDrill.steps[i])}</span></div>`
).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>错题订正 · 界面预览</title>
<style>
  :root{
    --brand:#2b6cff; --brand-soft:#eaf1ff; --bg:#f4f6fa; --card:#fff;
    --t1:#16181d; --t2:#5b6270; --t3:#9aa1ad; --line:#e8ebf0;
    --ok:#16a34a; --ok-soft:#e8f7ee; --warn:#f59e0b; --warn-soft:#fef4e2;
    --bad:#dc2626; --bad-soft:#fdecec; --purple:#7c3aed; --purple-soft:#f2ecfe;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#eef1f6;color:var(--t1);font:400 14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:28px 20px 60px}
  .head{max-width:1500px;margin:0 auto 26px}
  .head h1{font-size:20px;font-weight:500;margin-bottom:8px}
  .head p{font-size:13px;color:var(--t2);line-height:1.7}
  .notice{display:inline-block;margin-top:12px;padding:8px 14px;border-radius:8px;background:var(--warn-soft);color:#92400e;font-size:13px}
  .screens{display:flex;flex-wrap:wrap;gap:26px;max-width:1500px;margin:0 auto;align-items:flex-start}
  .screen{width:375px;background:var(--bg);border-radius:26px;overflow:hidden;box-shadow:0 8px 28px rgba(22,24,29,.10);border:1px solid #e2e6ee;flex-shrink:0}
  .navbar{height:46px;display:flex;align-items:center;justify-content:center;background:#fff;font-size:15px;font-weight:500;border-bottom:1px solid var(--line)}
  .navbar .back{position:absolute;margin-left:-320px;color:var(--t2);font-size:15px}
  .navwrap{position:relative}
  .body{padding:14px 14px 26px}
  .caption{text-align:center;font-size:12px;color:var(--t3);margin-top:12px}

  .hero{background:#2b6cff;border-radius:14px;padding:16px 18px 14px;color:#fff;margin-bottom:12px}
  .hero-course{font-size:12px;opacity:.88;margin-bottom:10px}
  .hero-row{display:flex;justify-content:space-between;align-items:flex-end}
  .hero-num{font-size:38px;font-weight:500;line-height:1;letter-spacing:-1px}
  .hero-unit{font-size:13px;margin-left:6px;opacity:.92}
  .hero-side{display:flex;gap:20px}
  .hero-side div{display:flex;flex-direction:column;align-items:flex-end}
  .hero-side b{font-size:17px;font-weight:500}
  .hero-side span{font-size:11px;opacity:.82;margin-top:2px}
  .hero-bar{height:5px;background:rgba(255,255,255,.3);border-radius:3px;margin-top:13px;overflow:hidden}
  .hero-bar i{display:block;height:100%;width:70%;background:#fff;border-radius:3px}
  .hero-foot{display:flex;justify-content:space-between;font-size:11px;opacity:.9;margin-top:8px}

  .sec{font-size:13px;color:var(--t3);font-weight:500;margin:18px 4px 10px}
  .card{background:var(--card);border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 6px rgba(22,24,29,.04)}
  .item-top{display:flex;align-items:center;gap:7px}
  .qno{font-size:12px;font-weight:500;color:var(--brand);background:var(--brand-soft);border-radius:4px;padding:1px 6px}
  .badge{font-size:13px;font-weight:500;border-radius:6px;padding:2px 7px}
  .badge i{font-style:normal;font-size:11px;opacity:.8}
  .sc-good{background:var(--ok-soft);color:var(--ok)}
  .sc-mild{background:#eef7e2;color:#4d7c0f}
  .sc-mid{background:var(--warn-soft);color:#b45309}
  .sc-bad{background:var(--bad-soft);color:var(--bad)}
  .item-assign{margin-left:auto;font-size:11px;color:var(--t3);white-space:nowrap}
  .item-text{font-size:14px;margin-top:8px;line-height:1.55;color:var(--t1)}
  .item-foot{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
  .tag{display:inline-block;font-size:11px;border-radius:5px;padding:2px 7px;background:#f2f4f8;color:var(--t2);margin-right:5px}
  .tag-brand{background:var(--brand-soft);color:var(--brand)}
  .tag-bad{background:var(--bad-soft);color:var(--bad)}
  .tag-warn{background:var(--warn-soft);color:#b45309}
  .tag-purple{background:var(--purple-soft);color:var(--purple)}
  .tag-ok{background:var(--ok-soft);color:var(--ok)}
  .btn-sm{font-size:12px;font-weight:500;background:var(--brand);color:#fff;border-radius:6px;padding:5px 12px}
  .btn{display:block;text-align:center;height:44px;line-height:44px;border-radius:8px;background:var(--brand);color:#fff;font-size:15px;font-weight:500;margin-top:12px}
  .btn-line{background:#fff;color:var(--t2);border:1px solid var(--line)}

  .blk{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px;box-shadow:0 1px 6px rgba(22,24,29,.04)}
  .blk-head{display:flex;align-items:center;margin-bottom:11px}
  .blk-bar{width:3px;height:15px;border-radius:2px;background:var(--brand);margin-right:7px}
  .bar-mine{background:#f59e0b}.bar-right{background:#16a34a}.bar-teacher{background:#7c3aed}
  .blk-title{font-size:14px;font-weight:500}
  .blk-right{margin-left:auto;font-size:12px;color:var(--t3)}
  .rn{font-size:15px;line-height:1.9;word-break:break-word}
  .rn .fx{display:inline-block;vertical-align:middle;margin:0 2px}
  .rn .photo{display:block;width:100%;border-radius:6px;border:1px solid var(--line);margin:8px 0;background:#fafbfd}
  .dim{color:var(--t3);font-size:13px}

  .prompt{font-size:12.5px;color:var(--brand);background:var(--brand-soft);border-radius:6px;padding:7px 10px;margin-bottom:6px;line-height:1.5}
  .ta{background:#f7f9fc;border-radius:7px;padding:11px 12px;font-size:14px;line-height:1.7;color:var(--t1);min-height:104px}
  .note{background:var(--brand-soft);color:#1f52cc;border-radius:7px;padding:9px 11px;font-size:12px;line-height:1.6;margin-top:10px}

  .cause{display:flex;gap:7px;padding:10px 11px;border-radius:7px;border:1px solid var(--line);margin-bottom:7px;background:#fcfdfe}
  .cause.on{border-color:var(--brand);background:var(--brand-soft)}
  .cause-dot{width:6px;height:6px;border-radius:3px;background:#d6dbe5;margin-top:7px;flex-shrink:0}
  .cause.on .cause-dot{background:var(--brand)}
  .cause-name{font-size:14px;font-weight:500}
  .cause.on .cause-name{color:#1f52cc}
  .cause-rem{font-size:11.5px;color:var(--t3);line-height:1.5;margin-top:3px}
  .cause-ck{margin-left:auto;color:var(--brand);font-weight:500}
  .ev{padding:10px 0;border-bottom:1px dashed var(--line)}
  .ev:last-child{border-bottom:none}
  .ev-code{font-size:11.5px;color:var(--brand);font-weight:500;margin-bottom:3px}
  .ev-text{font-size:13px;line-height:1.7}
  .ev-src{font-size:11px;color:var(--t3);margin-top:4px}
  .advice{background:#f7f9fc;border-radius:7px;padding:11px 12px;font-size:13.5px;line-height:1.8;white-space:pre-wrap}

  .order-item{display:flex;gap:8px;background:#fff;border:1px solid transparent;border-radius:8px;padding:11px 12px;margin-bottom:7px;box-shadow:0 1px 6px rgba(22,24,29,.04);font-size:13.5px;line-height:1.6}
  .order-item.on{border-color:var(--brand);background:var(--brand-soft)}
  .order-no{width:20px;height:20px;border-radius:10px;border:1px solid #d6dbe5;color:var(--t3);font-size:11px;text-align:center;line-height:19px;flex-shrink:0;margin-top:1px}
  .order-item.on .order-no{background:var(--brand);border-color:var(--brand);color:#fff;font-weight:500}
  .qkind{display:inline-block;font-size:11px;color:var(--brand);background:var(--brand-soft);border-radius:4px;padding:2px 7px;margin-bottom:9px}
  .qtext{font-size:15px;line-height:1.85;white-space:pre-wrap}
  .res-ok{border-left:3px solid var(--ok);background:#f6fdf8}
  .res-title{font-size:15px;font-weight:500;color:var(--ok);margin-bottom:6px}
  .res-exp{font-size:13.5px;line-height:1.8;color:var(--t2)}

  .tabbar{display:flex;background:#fff;border-top:1px solid var(--line);padding:8px 0 10px}
  .tabbar div{flex:1;text-align:center;font-size:11px;color:var(--t3)}
  .tabbar div.on{color:var(--brand);font-weight:500}
</style>
</head>
<body>

<div class="head">
  <h1>错题订正 · 知识强化 —— 界面预览</h1>
  <p>下面四屏用的是<b>真实数据</b>：学习通《高等数学分析（工科数学分析）（2026秋）》HW1 09-21 的第 3 题，得分 6/20，
     题干公式、你的手写作答照片、教师批语都是抓下来的原件。</p>
  <p style="margin-top:6px">这是用同一份数据渲染的静态预览，方便你不装工具就能看到效果；<b>真正的小程序在 <code>miniprogram/</code> 目录</b>，用微信开发者工具导入即可运行。</p>
  <div class="notice">预览是只读的，点不动。要真的答题、订正、训练，请用微信开发者工具打开项目。</div>
</div>

<div class="screens">

  <!-- ============ 1. 今日 ============ -->
  <div>
    <div class="screen">
      <div class="navwrap"><div class="navbar">错题订正</div></div>
      <div class="body">
        <div class="hero">
          <div class="hero-course">${esc(seed.courses[0].name)}</div>
          <div class="hero-row">
            <div><span class="hero-num">4</span><span class="hero-unit">道待订正</span></div>
            <div class="hero-side">
              <div><b>24</b><span>丢分</span></div>
              <div><b>0</b><span>已掌握</span></div>
            </div>
          </div>
          <div class="hero-bar"><i></i></div>
          <div class="hero-foot"><span>平均得分率 70%</span><span>看统计 ›</span></div>
        </div>

        <div class="sec">先订正 · 这些题你还没写下「错在哪」</div>
        ${item(q3, 'wrong')}
        ${item(q2, 'partial')}
        ${item(q4, 'partial')}
        ${item(q5, 'partial')}
        <div style="text-align:center;font-size:13px;color:var(--brand);padding:4px 0">还有 0 道待订正 ›</div>
      </div>
      <div class="tabbar">
        <div class="on">今日</div><div>错题本</div><div>训练</div><div>统计</div>
      </div>
    </div>
    <div class="caption">① 今日 —— 失分多的排前面</div>
  </div>

  <!-- ============ 2. 订正 ============ -->
  <div>
    <div class="screen">
      <div class="navwrap"><div class="navbar"><span class="back">‹</span>订正</div></div>
      <div class="body">
        <div class="blk">
          <div class="blk-head">
            <i class="blk-bar"></i><span class="blk-title">Q3 · 题干</span>
            <span class="blk-right">得分 6/20</span>
          </div>
          <div class="rn">${nodes(q3.stem)}</div>
        </div>

        <div class="blk">
          <div class="blk-head">
            <i class="blk-bar bar-mine"></i><span class="blk-title">我当时写的</span>
            <span class="blk-right">点图放大</span>
          </div>
          <div class="rn">${nodes(q3.myAnswer.nodes)}</div>
        </div>

        <div class="blk">
          <div class="blk-head"><i class="blk-bar"></i><span class="blk-title">先自己写：我错在哪</span></div>
          <div style="font-size:12px;color:var(--t3);line-height:1.6;margin-bottom:8px">照着这几问写，比随便写两句有用得多。点一下就能填进去。</div>
          <div class="prompt">我当时是怎么想的？把原思路写下来。</div>
          <div class="prompt">卡在哪一步、哪一步其实站不住？</div>
          <div class="prompt">正确的路径应该怎么走？</div>
          <div class="prompt">同类题下次要注意什么？</div>
          <div class="ta" style="margin-top:8px">我只证明了 A 有上界，就直接说「由稠密性可知无上确界」——没有分 M²&lt;2 和 M²&gt;2 讨论，也没有真的构造出比 M 更小的有理上界。构造的那个 ε=[M−√2]+1 也说不清它要干什么。</div>
        </div>

        <div class="note">提交后会解锁这道题的错因分析和针对性训练。先写完再看，效果最好。</div>
        <div class="btn">提交订正，解锁分析</div>
      </div>
    </div>
    <div class="caption">② 订正 —— 闸门在这一步</div>
  </div>

  <!-- ============ 3. 错因分析 ============ -->
  <div>
    <div class="screen">
      <div class="navwrap"><div class="navbar"><span class="back">‹</span>错题详情</div></div>
      <div class="body">
        <div class="blk">
          <div class="item-top">
            <span class="qno" style="font-size:15px">Q3</span>
            <span class="badge sc-bad" style="font-size:14px">6<i>/20</i></span>
            <span class="tag tag-purple">巩固中</span>
            <span class="item-assign">${esc(assign.title)}</span>
          </div>
          <div style="font-size:12px;color:var(--t3);margin-top:9px">${esc(assign.title)} · ${esc(q3.type)}</div>
          <div style="font-size:13px;color:var(--t2);margin-top:3px">${esc(q3.gist)}</div>
        </div>

        <div class="blk">
          <div class="blk-head"><i class="blk-bar"></i><span class="blk-title">错因分析</span><span class="blk-right">批语归因 · 可点选修改</span></div>
          <div class="cause on"><i class="cause-dot"></i><div style="flex:1"><div class="cause-name">逻辑推理不严谨</div><div class="cause-rem">${esc(CAUSE_REMEDY.C3)}</div></div><span class="cause-ck">✓</span></div>
          <div class="cause on"><i class="cause-dot"></i><div style="flex:1"><div class="cause-name">分类讨论遗漏</div><div class="cause-rem">${esc(CAUSE_REMEDY.C4)}</div></div><span class="cause-ck">✓</span></div>
          <div class="cause"><i class="cause-dot"></i><div style="flex:1"><div class="cause-name">证明结构不完整</div><div class="cause-rem">${esc(CAUSE_REMEDY.C2)}</div></div><span class="cause-ck"></span></div>
          <div class="cause"><i class="cause-dot"></i><div style="flex:1"><div class="cause-name">表述与书写不规范</div><div class="cause-rem">${esc(CAUSE_REMEDY.C6)}</div></div><span class="cause-ck"></span></div>
        </div>

        <div class="blk">
          <div class="blk-head"><i class="blk-bar"></i><span class="blk-title">具体依据</span></div>
          ${q3.flaws.map((f) => `<div class="ev"><div class="ev-code">${f.code} · 确定</div><div class="ev-text">${esc(f.detail)}</div><div class="ev-src">来源：教师批语</div></div>`).join('')}
        </div>

        <div class="blk">
          <div class="blk-head"><i class="blk-bar"></i><span class="blk-title">怎么补</span></div>
          <div class="advice">主要问题：逻辑推理不严谨
先写出结论的否定命题，再逼出矛盾；构造量必须验证它真的落在范围内。
同时注意：分类讨论遗漏。
相关知识点：上确界、有理数集内的确界与稠密性。建议先在巩固训练里刷完这个点的题，再回来重做原题。</div>
          <div class="btn">去做针对性训练</div>
        </div>

        <div class="blk">
          <div class="blk-head"><i class="blk-bar bar-teacher"></i><span class="blk-title">教师批语</span><span class="blk-right">展开 ⌄</span></div>
          <div class="rn" style="font-size:13.5px;line-height:1.75">${nodes(q3.comment.nodes)}</div>
        </div>
      </div>
    </div>
    <div class="caption">③ 详情 —— 订正后才解锁</div>
  </div>

  <!-- ============ 4. 训练 ============ -->
  <div>
    <div class="screen">
      <div class="navwrap"><div class="navbar"><span class="back">‹</span>巩固训练 · Q3</div></div>
      <div class="body">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:7px">
          <span>Q3 · 第 1 / 3 题</span><span style="color:var(--t3)">退出</span>
        </div>
        <div style="height:5px;background:#eef1f6;border-radius:3px;overflow:hidden;margin-bottom:14px">
          <i style="display:block;height:100%;width:33%;background:var(--brand)"></i>
        </div>

        <div class="blk">
          <span class="qkind">排序题</span>
          <div class="qtext">${esc(orderDrill.q)}</div>
        </div>

        <div style="font-size:12px;color:var(--t3);margin:0 4px 9px">按正确顺序依次点击下面的步骤（再点一次可取消）</div>
        ${chairOrder}
        <div class="btn">提交顺序</div>

        <div class="blk res-ok" style="margin-top:14px">
          <div class="res-title">✓ 答对了</div>
          <div class="res-exp">${esc(orderDrill.explain)}</div>
          <div class="btn" style="margin-top:10px">下一题</div>
        </div>
      </div>
      <div class="tabbar">
        <div>今日</div><div>错题本</div><div class="on">训练</div><div>统计</div>
      </div>
    </div>
    <div class="caption">④ 训练 —— 客观题可自动判分</div>
  </div>

</div>

</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, '界面预览.html'), html, 'utf8');
console.log('已生成：界面预览.html  (' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB)');
console.log('用了真实数据：' + assign.title + ' Q3（' + q3.score + '/' + q3.fullScore + '）');
console.log('公式图 ' + (nodes(q3.stem).match(/class="fx"/g) || []).length + ' 张，手写照片见「我当时写的」');
