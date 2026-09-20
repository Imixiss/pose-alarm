// ============================================================
// 动作示范动画：为每个动作绘制循环播放的火柴人动画
// 与判定规则使用同一套"度量直觉"，用户照着做即可达标
// ============================================================

import type { ActionId } from './pose';

interface Joints {
  head: [number, number];
  neck: [number, number];
  hip: [number, number];
  handL: [number, number];
  handR: [number, number];
  footL: [number, number];
  footR: [number, number];
  elbowL: [number, number];
  elbowR: [number, number];
  kneeL: [number, number];
  kneeR: [number, number];
  scaleX: number; // 模拟扭转时的水平压缩
}

// 每个动作的周期（毫秒）
const PERIODS: Record<ActionId, number> = {
  hands_up: 1600,
  arm_swing: 1200,
  jumping_jack: 1000,
  squat: 2000,
  march: 1000,
  torso_twist: 1400,
  chest_expand: 1400,
  head_turn: 1600,
};

function jointsFor(action: ActionId, phase: number): Joints {
  // phase ∈ [-1, 1]
  const p = phase;
  const q = (p + 1) / 2; // ∈ [0, 1]

  // 基础骨架（单位空间：x∈[-1,1]，y 向下，头顶≈-1.05，脚≈1.0）
  const j: Joints = {
    head: [0, -0.82],
    neck: [0, -0.62],
    hip: [0, 0.05],
    handL: [-0.42, -0.15],
    handR: [0.42, -0.15],
    footL: [-0.22, 1.0],
    footR: [0.22, 1.0],
    elbowL: [-0.3, -0.38],
    elbowR: [0.3, -0.38],
    kneeL: [-0.22, 0.52],
    kneeR: [0.22, 0.52],
    scaleX: 1,
  };

  switch (action) {
    case 'hands_up': {
      // 双手举过头顶，轻微上下
      const lift = 0.92 + 0.06 * p;
      j.handL = [-0.3, -lift];
      j.handR = [0.3, -lift];
      j.elbowL = [-0.26, -0.72];
      j.elbowR = [0.26, -0.72];
      break;
    }
    case 'arm_swing': {
      // 双臂一起左右摆
      const sx = 0.55 * p;
      j.handL = [-0.1 + sx, -0.25];
      j.handR = [0.1 + sx, -0.25];
      j.elbowL = [-0.12 + sx * 0.6, -0.42];
      j.elbowR = [0.12 + sx * 0.6, -0.42];
      break;
    }
    case 'jumping_jack': {
      // 腿开合 + 手上下
      const spread = 0.16 + 0.3 * q;
      j.footL = [-spread, 1.0];
      j.footR = [spread, 1.0];
      j.kneeL = [-spread, 0.52];
      j.kneeR = [spread, 0.52];
      const armY = -0.1 - 0.75 * q;
      const armX = 0.35 + 0.1 * q;
      j.handL = [-armX, armY];
      j.handR = [armX, armY];
      j.elbowL = [-armX * 0.75, (armY - 0.6) / 2 + 0.05];
      j.elbowR = [armX * 0.75, (armY - 0.6) / 2 + 0.05];
      break;
    }
    case 'squat': {
      // 整体下蹲：髋部下移、膝盖前移
      const drop = 0.32 * q;
      j.hip = [0, 0.05 + drop];
      j.head = [0, -0.82 + drop * 0.7];
      j.neck = [0, -0.62 + drop * 0.75];
      j.kneeL = [-0.3, 0.52 + drop * 0.3];
      j.kneeR = [0.3, 0.52 + drop * 0.3];
      j.handL = [-0.15, -0.35 + drop * 0.4]; // 手前平举保持平衡
      j.handR = [0.15, -0.35 + drop * 0.4];
      j.elbowL = [-0.2, -0.45 + drop * 0.5];
      j.elbowR = [0.2, -0.45 + drop * 0.5];
      break;
    }
    case 'march': {
      // 交替抬腿
      const liftL = Math.max(0, p) * 0.4;
      const liftR = Math.max(0, -p) * 0.4;
      j.footL = [-0.22, 1.0 - liftL];
      j.footR = [0.22, 1.0 - liftR];
      j.kneeL = [-0.24, 0.52 - liftL * 0.9];
      j.kneeR = [0.24, 0.52 - liftR * 0.9];
      // 手臂配合摆动
      j.handL = [-0.35, -0.15 - liftR * 0.6];
      j.handR = [0.35, -0.15 - liftL * 0.6];
      break;
    }
    case 'torso_twist': {
      // 水平压缩模拟扭转
      j.scaleX = 0.35 + 0.65 * Math.abs(p);
      const sway = 0.1 * p;
      j.head = [sway, -0.82];
      j.neck = [sway * 0.7, -0.62];
      j.handL = [-0.42, -0.2 + 0.08 * p];
      j.handR = [0.42, -0.2 - 0.08 * p];
      break;
    }
    case 'chest_expand': {
      // 双臂平举，打开-收回
      const spread = 0.25 + 0.4 * q;
      j.handL = [-spread, -0.5];
      j.handR = [spread, -0.5];
      j.elbowL = [-spread * 0.6, -0.55];
      j.elbowR = [spread * 0.6, -0.55];
      break;
    }
    case 'head_turn': {
      // 只有头动
      j.head = [0.16 * p, -0.82];
      break;
    }
  }
  return j;
}

export function drawDemoFigure(
  ctx: CanvasRenderingContext2D,
  action: ActionId,
  timeMs: number,
  w: number,
  h: number,
) {
  ctx.clearRect(0, 0, w, h);
  const period = PERIODS[action];
  const phase = Math.sin((timeMs / period) * Math.PI * 2);
  const j = jointsFor(action, phase);

  const scale = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h * 0.52;

  const map = (pt: [number, number]): [number, number] => [
    cx + pt[0] * j.scaleX * scale,
    cy + pt[1] * scale,
  ];

  ctx.lineWidth = Math.max(2, scale * 0.055);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#34d399'; // emerald-400
  ctx.fillStyle = '#34d399';

  const line = (a: [number, number], b: [number, number]) => {
    const [ax, ay] = map(a);
    const [bx, by] = map(b);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };

  // 躯干
  line(j.neck, j.hip);
  // 手臂（肩→肘→腕）
  line(j.neck, j.elbowL);
  line(j.elbowL, j.handL);
  line(j.neck, j.elbowR);
  line(j.elbowR, j.handR);
  // 腿（髋→膝→踝）
  line(j.hip, j.kneeL);
  line(j.kneeL, j.footL);
  line(j.hip, j.kneeR);
  line(j.kneeR, j.footR);
  // 头
  const [hx, hy] = map(j.head);
  ctx.beginPath();
  ctx.arc(hx, hy, scale * 0.16, 0, Math.PI * 2);
  ctx.stroke();

  // 地面参考线
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  const [, gy] = map([0, 1.02]);
  ctx.beginPath();
  ctx.moveTo(w * 0.12, gy);
  ctx.lineTo(w * 0.88, gy);
  ctx.stroke();
}
