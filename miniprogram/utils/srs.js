/**
 * 间隔复习排程（简化版 SM-2）
 *
 * 只保留真正影响个人复习节奏的几个量：连对次数、当前间隔、下次到期时间。
 * 通过 → 间隔按 1/3/7/14/30 天阶梯上升；答错 → 间隔归零，明天再来。
 */

const STEPS = [1, 3, 7, 14, 30];
const MASTER_STREAK = 2;   // 连续答对两次即视为掌握
const DAY = 86400000;

function fresh(now) {
  return {
    reps: 0,
    streak: 0,
    lapses: 0,
    intervalDays: 0,
    lastAt: 0,
    dueAt: now || Date.now()
  };
}

/**
 * 记录一次训练结果
 * @param {object} srs 当前 srs
 * @param {boolean} pass 是否通过
 * @param {number} now 时间戳
 */
function next(srs, pass, now) {
  const s = Object.assign(fresh(now), srs || {});
  const t = now || Date.now();
  s.reps += 1;
  s.lastAt = t;

  if (pass) {
    s.streak += 1;
    const idx = Math.min(s.streak, STEPS.length) - 1;
    s.intervalDays = STEPS[Math.max(0, idx)];
  } else {
    s.streak = 0;
    s.lapses += 1;
    s.intervalDays = 1;
  }
  s.dueAt = t + s.intervalDays * DAY;
  return s;
}

function isDue(srs, now) {
  if (!srs) return true;
  return (srs.dueAt || 0) <= (now || Date.now());
}

function isMastered(srs) {
  return !!srs && srs.streak >= MASTER_STREAK;
}

/** 人类可读的下次复习时间 */
function dueText(srs, now) {
  if (!srs || !srs.dueAt) return '随时可练';
  const t = now || Date.now();
  if (srs.dueAt <= t) return '今天该练';
  const days = Math.ceil((srs.dueAt - t) / DAY);
  if (days <= 1) return '明天';
  return days + ' 天后';
}

module.exports = { STEPS, MASTER_STREAK, DAY, fresh, next, isDue, isMastered, dueText };
