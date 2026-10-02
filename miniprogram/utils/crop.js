/**
 * 图片裁剪 · 按归一化坐标从原图切出一块
 *
 * ---------------------------------------------------------------------------
 * 干什么用的
 * ---------------------------------------------------------------------------
 * 模型识别时会给出「题干 / 我的解答 / 教师批语」各自在原图上的矩形区域
 * （归一化坐标 0~1）。这里按这些坐标把原图切开，一块贴到对应栏里 ——
 * 核对的时侯就不用整页图来回翻了，一眼能看到「这段字对应图上哪一块」。
 *
 * ---------------------------------------------------------------------------
 * 三个必须守住的点
 * ---------------------------------------------------------------------------
 * 1. **失败绝不抛异常**。裁剪只是锦上添花，任何一步失败都返回 null，
 *    界面回退到「显示整张原图」。让入库流程因为一张切图挂掉是不可接受的。
 * 2. **先夹紧坐标**。模型偶尔给出越界值或针尖大的框，夹进 [0,1] 并保证最小边长；
 *    框太小就直接放弃（多半是模型瞎给的，切出来是空白）。
 * 3. **缩放到合理尺寸**。原图可能是 1260×5430 的长截图，直接裁一块也很大；
 *    按宽度上限等比缩放，既省空间又够看清手写。
 *
 * 依赖 `wx.createOffscreenCanvas`（基础库 2.16.1+）。老基础库直接返回 null，
 * 走整图回退 —— 功能降级，但不会崩。
 */

/** 裁出图的宽度上限（够看清手写，又不至于太大） */
const MAX_W = 1000;
/** 最小边长（像素）。比这还小说明框有问题 */
const MIN_SIDE = 24;
/** JPEG 质量 */
const QUALITY = 0.88;

/** 把数字夹进 [0,1]，非法值当 0 */
function clamp01(n) {
  n = Number(n);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** 读原图宽高（拿不到就放弃） */
function imageSize(src) {
  return new Promise((resolve) => {
    if (!wx.getImageInfo) return resolve(null);
    wx.getImageInfo({
      src: src,
      success: (r) => resolve({ w: r.width, h: r.height }),
      fail: () => resolve(null)
    });
  });
}

/** 用离屏 canvas 裁一块，返回 dataURL */
function cropToDataUrl(src, sx, sy, sw, sh) {
  return new Promise((resolve) => {
    if (!wx.createOffscreenCanvas) return resolve(null);   // 老基础库 -> 回退
    const scale = Math.min(1, MAX_W / sw);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    let canvas;
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width: dw, height: dh });
    } catch (e) {
      return resolve(null);
    }
    const ctx = canvas.getContext('2d');
    const img = canvas.createImage();
    img.onload = () => {
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        const url = canvas.toDataURL('image/jpeg', QUALITY);
        resolve(url && url.indexOf(',') > 0 ? url : null);
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    try {
      img.src = src;
    } catch (e) {
      resolve(null);
    }
  });
}

/** 把 base64 dataURL 写成文件，返回路径 */
function saveDataUrl(dataUrl) {
  if (!dataUrl || dataUrl.indexOf(',') < 0) return null;
  try {
    const fs = wx.getFileSystemManager();
    const dir = (wx.env && wx.env.USER_DATA_PATH) || '';
    if (!dir) return null;
    const p = dir + '/crop_' + Date.now() + '_'
      + Math.floor(Math.random() * 10000) + '.jpg';
    fs.writeFileSync(p, dataUrl.split(',')[1], 'base64');
    return p;
  } catch (e) {
    return null;
  }
}

/**
 * 纯函数：归一化框 → 像素矩形。**不碰 wx，可同步单测**。
 *
 * 把「夹紧 + 最小边长」这两条判断都收在这里，cropByBox 只负责取尺寸和画布。
 *
 * @param {number} w 原图宽
 * @param {number} h 原图高
 * @param {number[]} box [左, 上, 右, 下]，归一化 0~1
 * @returns {{sx:number, sy:number, sw:number, sh:number}|null} 框不可信时返回 null
 */
function computeRect(w, h, box) {
  if (!w || !h || !Array.isArray(box) || box.length !== 4) return null;

  const l = clamp01(box[0]);
  const t = clamp01(box[1]);
  const r = clamp01(box[2]);
  const b = clamp01(box[3]);

  let sx = Math.round(l * w);
  let sy = Math.round(t * h);
  let sw = Math.round((r - l) * w);
  let sh = Math.round((b - t) * h);

  // 夹进图片实际范围，避免 drawImage 拿到越界参数（会静默出错图）
  sx = Math.max(0, Math.min(w - 1, sx));
  sy = Math.max(0, Math.min(h - 1, sy));
  sw = Math.max(1, Math.min(w - sx, sw));
  sh = Math.max(1, Math.min(h - sy, sh));

  // 框太小 -> 认为坐标不可信，别切出一块空白贴上去
  if (sw < MIN_SIDE || sh < MIN_SIDE) return null;

  return { sx: sx, sy: sy, sw: sw, sh: sh };
}

/**
 * 按归一化框从原图裁一块并落盘。
 * @param {string} src 原图路径
 * @param {number[]} box [左, 上, 右, 下]，归一化 0~1
 * @returns {Promise<string|null>} 新图路径；任何失败都返回 null
 */
function cropByBox(src, box) {
  if (!src || !Array.isArray(box) || box.length !== 4) return Promise.resolve(null);
  return imageSize(src).then((info) => {
    if (!info) return null;
    const rect = computeRect(info.w, info.h, box);
    if (!rect) return null;
    return cropToDataUrl(src, rect.sx, rect.sy, rect.sw, rect.sh).then(saveDataUrl);
  });
}

/**
 * 一次裁多栏。串行执行（小程序同时开多个 canvas 容易出问题）。
 * @param {string} src 原图路径
 * @param {object} boxes { stem: [...], myAnswer: [...], ... }
 * @returns {Promise<object>} { stem: path|null, myAnswer: path|null, ... }
 */
async function cropAll(src, boxes) {
  const out = {};
  if (!src || !boxes) return out;
  const keys = ['stem', 'myAnswer', 'comment', 'rightAnswer'];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!boxes[k]) { out[k] = null; continue; }
    /* eslint-disable no-await-in-loop */
    out[k] = await cropByBox(src, boxes[k]);
  }
  return out;
}

module.exports = { cropByBox, cropAll, computeRect, clamp01, MAX_W, MIN_SIDE };
