// ============================================================
// 姿态识别核心逻辑：关键点类型、动作库、规则法匹配打分
// MediaPipe Pose 33 关键点索引:
// 0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists,
// 23/24 hips, 25/26 knees, 27/28 ankles
// 所有动作均为原地可完成的安全动作（无跳跃失控、无翻转）
// ============================================================

export interface Landmark {
  x: number; // 0-1 normalized
  y: number;
  z: number;
  visibility?: number;
}

export type ActionId =
  | 'hands_up'
  | 'arm_swing'
  | 'jumping_jack'
  | 'squat'
  | 'march'
  | 'torso_twist'
  | 'chest_expand'
  | 'head_turn';

export interface ActionDef {
  id: ActionId;
  name: string;
  nameEn: string;
  hint: string;
  icon: string;
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'hands_up',
    name: '双手举高',
    nameEn: 'Hands Up High',
    hint: '把两只手腕都举到肩膀以上，举得越高分数越高',
    icon: '🙌',
  },
  {
    id: 'arm_swing',
    name: '左右摆臂',
    nameEn: 'Swing Arms Left & Right',
    hint: '双臂有节奏地左右摆动，保持稳定的摆动周期',
    icon: '💃',
  },
  {
    id: 'jumping_jack',
    name: '开合步',
    nameEn: 'Jumping Jacks',
    hint: '双腿反复张开并拢（可配合手臂），保持节奏',
    icon: '🤸',
  },
  {
    id: 'squat',
    name: '深蹲',
    nameEn: 'Squats',
    hint: '缓慢下蹲再站起，膝盖不超过脚尖，反复进行',
    icon: '🏋️',
  },
  {
    id: 'march',
    name: '原地踏步',
    nameEn: 'March in Place',
    hint: '原地交替抬腿踏步，膝盖尽量抬高，保持节奏',
    icon: '🚶',
  },
  {
    id: 'torso_twist',
    name: '左右扭腰',
    nameEn: 'Torso Twists',
    hint: '双脚不动，上半身有节奏地左右扭转',
    icon: '🌀',
  },
  {
    id: 'chest_expand',
    name: '扩胸运动',
    nameEn: 'Chest Expansions',
    hint: '双臂在胸前平举，反复向两侧打开再收回',
    icon: '🫁',
  },
  {
    id: 'head_turn',
    name: '头部左右转',
    nameEn: 'Head Turns Left & Right',
    hint: '身体不动，头部缓慢有节奏地左右转动',
    icon: '🙆',
  },
];

export function randomAction(exclude?: ActionId): ActionDef {
  const pool = exclude ? ACTIONS.filter((a) => a.id !== exclude) : ACTIONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- 工具函数 ----------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function vis(lm: Landmark | undefined): number {
  return lm?.visibility ?? 0;
}

function ok(lm: Landmark | undefined, min = 0.4): lm is Landmark {
  return !!lm && vis(lm) >= min;
}

// 骨架连线（用于 Canvas 绘制）
export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // arms
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [24, 26], [26, 28], // legs
  [0, 11], [0, 12], // head
];

// ---------- 摆动分析器（周期性动作共用） ----------
// 维护一个滑动窗口内的标量序列，检测周期性翻转
export class OscillationTracker {
  private buf: { t: number; v: number }[] = [];
  private windowMs: number;

  constructor(windowMs = 2000) {
    this.windowMs = windowMs;
  }

  reset() {
    this.buf = [];
  }

  push(v: number, t: number) {
    this.buf.push({ t, v });
    while (this.buf.length && t - this.buf[0].t > this.windowMs) this.buf.shift();
  }

  /** 返回 0-1：振幅得分 × 周期翻转得分 */
  score(minAmp: number, fullAmp: number): number {
    if (this.buf.length < 8) return 0;
    const vs = this.buf.map((b) => b.v);
    const max = Math.max(...vs);
    const min = Math.min(...vs);
    const amp = max - min;
    const ampScore = clamp01((amp - minAmp) / (fullAmp - minAmp));

    // 用"过中线次数"衡量周期翻转（滞回带防抖）
    const mid = (max + min) / 2;
    const band = amp * 0.15;
    let flips = 0;
    let state: 0 | 1 | -1 = 0;
    for (const v of vs) {
      if (state <= 0 && v > mid + band) {
        if (state === -1) flips++;
        state = 1;
      } else if (state >= 0 && v < mid - band) {
        if (state === 1) flips++;
        state = -1;
      }
    }
    const flipScore = clamp01(flips / 3); // 2 秒内翻转 3 次 = 满分
    return ampScore * 0.6 + ampScore * flipScore * 0.4;
  }
}

// ---------- 各动作的度量提取 ----------
// 返回 null 表示关键点不可见，本帧不参与打分

type MetricFn = (lms: Landmark[]) => number | null;

function torsoLen(lms: Landmark[]): number {
  const ls = lms[11], lh = lms[23];
  if (!ok(ls) || !ok(lh)) return 0.25;
  return Math.max(0.12, Math.hypot(ls.x - lh.x, ls.y - lh.y));
}

function shoulderWidth(lms: Landmark[]): number {
  const ls = lms[11], rs = lms[12];
  if (!ok(ls) || !ok(rs)) return 1e-6;
  return Math.abs(ls.x - rs.x) + 1e-6;
}

const METRICS: Record<Exclude<ActionId, 'hands_up'>, { metric: MetricFn; minAmp: number; fullAmp: number }> = {
  // 左右摆臂：双腕中心相对双肩中心的水平偏移
  arm_swing: {
    minAmp: 0.25,
    fullAmp: 0.9,
    metric: (lms) => {
      const ls = lms[11], rs = lms[12], lw = lms[15], rw = lms[16];
      if (!ok(ls) || !ok(rs) || !ok(lw) || !ok(rw)) return null;
      return ((lw.x + rw.x) / 2 - (ls.x + rs.x) / 2) / shoulderWidth(lms);
    },
  },
  // 开合步：脚踝间距 / 肩宽
  jumping_jack: {
    minAmp: 0.5,
    fullAmp: 1.3,
    metric: (lms) => {
      const la = lms[27], ra = lms[28];
      if (!ok(lms[11]) || !ok(lms[12])) return null;
      if (!ok(la, 0.3) || !ok(ra, 0.3)) return null;
      return Math.hypot(la.x - ra.x, la.y - ra.y) / shoulderWidth(lms);
    },
  },
  // 深蹲：髋部在 肩-踝 之间的相对高度（下蹲时变大）
  squat: {
    minAmp: 0.08,
    fullAmp: 0.22,
    metric: (lms) => {
      const ls = lms[11], rs = lms[12], lh = lms[23], rh = lms[24];
      const la = lms[27], ra = lms[28];
      if (!ok(ls) || !ok(rs) || !ok(lh) || !ok(rh)) return null;
      if (!ok(la, 0.3) || !ok(ra, 0.3)) return null;
      const shoulderY = (ls.y + rs.y) / 2;
      const hipY = (lh.y + rh.y) / 2;
      const ankleY = (la.y + ra.y) / 2;
      const span = ankleY - shoulderY;
      if (span < 0.15) return null; // 全身未入镜
      return (hipY - shoulderY) / span;
    },
  },
  // 原地踏步：左右脚踝高度差（交替抬腿）
  march: {
    minAmp: 0.06,
    fullAmp: 0.2,
    metric: (lms) => {
      const la = lms[27], ra = lms[28];
      if (!ok(la, 0.3) || !ok(ra, 0.3)) return null;
      return (la.y - ra.y) / torsoLen(lms);
    },
  },
  // 左右扭腰：双肩深度差（z 轴），扭转时一前一后
  torso_twist: {
    minAmp: 0.12,
    fullAmp: 0.45,
    metric: (lms) => {
      const ls = lms[11], rs = lms[12];
      if (!ok(ls) || !ok(rs)) return null;
      return ls.z - rs.z;
    },
  },
  // 扩胸运动：双腕间距 / 肩宽（手腕需在髋部以上）
  chest_expand: {
    minAmp: 0.4,
    fullAmp: 1.3,
    metric: (lms) => {
      const lw = lms[15], rw = lms[16], lh = lms[23], rh = lms[24];
      if (!ok(lms[11]) || !ok(lms[12]) || !ok(lw) || !ok(rw)) return null;
      if (ok(lh) && ok(rh)) {
        const hipY = (lh.y + rh.y) / 2;
        if (lw.y > hipY || rw.y > hipY) return null; // 手太低不算
      }
      return Math.abs(lw.x - rw.x) / shoulderWidth(lms);
    },
  },
  // 头部左右转：鼻子相对双肩中心的水平偏移
  head_turn: {
    minAmp: 0.12,
    fullAmp: 0.45,
    metric: (lms) => {
      const nose = lms[0], ls = lms[11], rs = lms[12];
      if (!ok(nose) || !ok(ls) || !ok(rs)) return null;
      return (nose.x - (ls.x + rs.x) / 2) / shoulderWidth(lms);
    },
  },
};

// ---------- 双手举高打分（纯函数） ----------
export function scoreHandsUpPure(lms: Landmark[]): number {
  const ls = lms[11], rs = lms[12], lw = lms[15], rw = lms[16];
  if (!ok(ls) || !ok(rs) || !ok(lw) || !ok(rw)) return 0;
  const torso = torsoLen(lms);
  // y 轴向下：手腕在肩膀上方 => shoulder.y - wrist.y > 0
  const hL = (ls.y - lw.y) / torso;
  const hR = (rs.y - rw.y) / torso;
  const sL = clamp01((hL - 0.05) / 0.9);
  const sR = clamp01((hR - 0.05) / 0.9);
  return (sL + sR) / 2;
}

// ---------- 统一入口 ----------
export class ActionScorer {
  private trackers = new Map<ActionId, OscillationTracker>();

  private tracker(id: ActionId): OscillationTracker {
    let t = this.trackers.get(id);
    if (!t) {
      t = new OscillationTracker(2000);
      this.trackers.set(id, t);
    }
    return t;
  }

  reset() {
    this.trackers.forEach((t) => t.reset());
  }

  score(action: ActionId, lms: Landmark[], t: number): number {
    if (action === 'hands_up') return scoreHandsUpPure(lms);
    const def = METRICS[action];
    const v = def.metric(lms);
    if (v === null) return 0;
    const tracker = this.tracker(action);
    tracker.push(v, t);
    return tracker.score(def.minAmp, def.fullAmp);
  }
}

export const MATCH_THRESHOLD = 0.6;
export const MATCH_HOLD_MS = 500; // 达标需保持 0.5s 才开始计时
export const INTERRUPT_GRACE_MS = 1200; // 低于阈值 1.2s 判定为中断
export const RESET_AFTER_MS = 3000; // 中断持续 3s → 倒计时重置
export const COUNTDOWN_SECONDS = 15;
