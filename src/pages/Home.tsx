import { useCallback, useEffect, useRef, useState } from 'react';
import { usePoseCamera } from '@/hooks/usePoseCamera';
import {
  ActionScorer,
  randomAction,
  POSE_CONNECTIONS,
  ACTIONS,
  MATCH_THRESHOLD,
  MATCH_HOLD_MS,
  INTERRUPT_GRACE_MS,
  RESET_AFTER_MS,
  COUNTDOWN_SECONDS,
  type ActionDef,
  type ActionId,
  type Landmark,
} from '@/lib/pose';
import { AlarmSound, playSuccess, decodeAudioFile } from '@/lib/alarm';
import { saveRingtone, loadRingtone, clearRingtone } from '@/lib/ringtoneStore';
import { drawDemoFigure } from '@/lib/demoFigure';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

type Phase = 'idle' | 'ringing' | 'countdown' | 'done';

const PHASE_TEXT: Record<Phase, { zh: string; en: string }> = {
  idle: { zh: '待机中', en: 'Standby' },
  ringing: { zh: '闹钟响了！做出目标动作', en: 'ALARM! Match the target pose!' },
  countdown: { zh: '保持动作！', en: 'Keep dancing!' },
  done: { zh: '解锁成功，闹钟已停止 🎉', en: 'Unlocked! Alarm stopped.' },
};

// ---------- 动作示范动画组件 ----------
function ActionDemo({ action, size = 96 }: { action: ActionId; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const ctx = ref.current?.getContext('2d');
      if (ctx) drawDemoFigure(ctx, action, t, size, size);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [action, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<ActionDef | null>(null);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const [paused, setPaused] = useState(false);
  const [bossMode, setBossMode] = useState(false);
  const [bossSwitched, setBossSwitched] = useState(false);
  const [notice, setNotice] = useState('');

  // 闹钟设置
  const [alarmMode, setAlarmMode] = useState<'time' | 'countdown'>('time');
  const [timeValue, setTimeValue] = useState('07:30');
  const [minutesValue, setMinutesValue] = useState(1);
  const [ringAt, setRingAt] = useState<number | null>(null); // epoch ms
  const [nowTick, setNowTick] = useState(Date.now());

  // 铃声
  const [ringtoneName, setRingtoneName] = useState<string>('');
  const [previewing, setPreviewing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const targetRef = useRef<ActionDef | null>(null);
  const landmarksRef = useRef<Landmark[] | null>(null);
  const scoreRef = useRef(0);
  const scorerRef = useRef(new ActionScorer());
  const alarmRef = useRef(new AlarmSound());
  const matchedSinceRef = useRef<number | null>(null);
  const interruptSinceRef = useRef<number | null>(null);
  const resumeHoldRef = useRef<number | null>(null);
  const remainingMsRef = useRef(COUNTDOWN_SECONDS * 1000);
  const lastTickRef = useRef(0);
  const pausedRef = useRef(false);
  const bossSwitchAtRef = useRef<number | null>(null);
  const bossSwitchedRef = useRef(false);
  const hiddenRef = useRef(false);
  const bossModeRef = useRef(bossMode);
  bossModeRef.current = bossMode;

  // 页面切后台：视为动作中断（防作弊）
  useEffect(() => {
    const onVis = () => {
      hiddenRef.current = document.hidden;
      if (document.hidden && phaseRef.current === 'countdown') {
        setNotice('检测到页面切后台，计时已暂停');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 恢复上次保存的自定义铃声
  useEffect(() => {
    (async () => {
      const saved = await loadRingtone();
      if (saved) {
        try {
          const buf = await decodeAudioFile(saved.blob);
          alarmRef.current.setCustomBuffer(buf);
          setRingtoneName(saved.name);
        } catch {
          /* 解码失败则忽略 */
        }
      }
    })();
  }, []);

  const onFrame = useCallback((frame: { landmarks: Landmark[] | null }) => {
    landmarksRef.current = frame.landmarks;
  }, []);

  const { videoRef, status, error, start } = usePoseCamera(onFrame);

  const startAlarm = useCallback(async () => {
    await start(); // 用户手势内启动摄像头 + 解锁音频
    alarmRef.current.warmup();
    const action = randomAction();
    targetRef.current = action;
    setTarget(action);
    scorerRef.current.reset();
    matchedSinceRef.current = null;
    interruptSinceRef.current = null;
    resumeHoldRef.current = null;
    remainingMsRef.current = COUNTDOWN_SECONDS * 1000;
    setRemaining(COUNTDOWN_SECONDS);
    bossSwitchAtRef.current = null;
    bossSwitchedRef.current = false;
    setBossSwitched(false);
    setNotice('');
    setPaused(false);
    pausedRef.current = false;
    setRingAt(null);
    phaseRef.current = 'ringing';
    setPhase('ringing');
    alarmRef.current.start();
    lastTickRef.current = performance.now();
  }, [start]);

  const startAlarmRef = useRef(startAlarm);
  startAlarmRef.current = startAlarm;

  // 设定闹钟 / 倒计时
  const armAlarm = useCallback(() => {
    alarmRef.current.warmup(); // 借设定时的点击手势解锁音频
    void start(); // 提前打开摄像头，响铃时无需等待
    let at: number;
    if (alarmMode === 'time') {
      const [hh, mm] = timeValue.split(':').map(Number);
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // 已过点 → 明天
      at = d.getTime();
    } else {
      at = Date.now() + Math.max(1, minutesValue) * 60 * 1000;
    }
    setRingAt(at);
  }, [alarmMode, timeValue, minutesValue, start]);

  // 每秒检查是否到点
  useEffect(() => {
    const t = window.setInterval(() => {
      setNowTick(Date.now());
      if (ringAt !== null && Date.now() >= ringAt && phaseRef.current === 'idle') {
        void startAlarmRef.current();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [ringAt]);

  const unlock = useCallback(() => {
    alarmRef.current.stop();
    phaseRef.current = 'done';
    setPhase('done');
    playSuccess();
  }, []);

  const resetAll = useCallback(() => {
    alarmRef.current.stop();
    phaseRef.current = 'idle';
    setPhase('idle');
    setTarget(null);
    targetRef.current = null;
    setScore(0);
    scoreRef.current = 0;
    setRemaining(COUNTDOWN_SECONDS);
    setNotice('');
    setPaused(false);
    pausedRef.current = false;
  }, []);

  // ---------- 铃声管理 ----------
  const onPickRingtone = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await decodeAudioFile(file);
      alarmRef.current.setCustomBuffer(buf);
      await saveRingtone(file.name, file.type, file);
      setRingtoneName(file.name);
    } catch {
      alert('无法解码该音频文件，请换 mp3 / m4a / wav 格式试试');
    }
    e.target.value = '';
  }, []);

  const togglePreview = useCallback(() => {
    if (previewing) {
      alarmRef.current.stop();
      setPreviewing(false);
    } else {
      alarmRef.current.warmup();
      alarmRef.current.start();
      setPreviewing(true);
    }
  }, [previewing]);

  const resetRingtone = useCallback(async () => {
    alarmRef.current.setCustomBuffer(null);
    await clearRingtone();
    setRingtoneName('');
  }, []);

  // ---------- 游戏主循环 ----------
  useEffect(() => {
    let raf = 0;
    let lastUiScore = -1;
    let lastUiRemaining = -1;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const lms = landmarksRef.current;
      const phase = phaseRef.current;

      drawSkeleton(canvasRef.current, lms, scoreRef.current);

      let s = 0;
      if ((phase === 'ringing' || phase === 'countdown') && lms && targetRef.current && !hiddenRef.current) {
        s = scorerRef.current.score(targetRef.current.id, lms, now);
      }
      scoreRef.current = s;
      const uiScore = Math.round(s * 100);
      if (uiScore !== lastUiScore) {
        lastUiScore = uiScore;
        setScore(uiScore);
      }

      if (phase === 'ringing') {
        if (s >= MATCH_THRESHOLD) {
          if (matchedSinceRef.current === null) matchedSinceRef.current = now;
          if (now - matchedSinceRef.current >= MATCH_HOLD_MS) {
            phaseRef.current = 'countdown';
            setPhase('countdown');
            lastTickRef.current = now;
            if (bossSwitchAtRef.current === null && bossModeRef.current) {
              bossSwitchAtRef.current = 5 + Math.random() * 5;
            }
            setNotice('');
          }
        } else {
          matchedSinceRef.current = null;
        }
      } else if (phase === 'countdown') {
        const dt = now - lastTickRef.current;
        lastTickRef.current = now;
        const interrupted = s < MATCH_THRESHOLD;

        if (interrupted) {
          resumeHoldRef.current = null;
          if (interruptSinceRef.current === null) interruptSinceRef.current = now;
          const interruptDur = now - interruptSinceRef.current;
          if (interruptDur >= INTERRUPT_GRACE_MS && !pausedRef.current) {
            pausedRef.current = true;
            setPaused(true);
            setNotice('动作中断，计时暂停 — The timer pauses when the pose breaks');
          }
          if (interruptDur >= RESET_AFTER_MS) {
            remainingMsRef.current = COUNTDOWN_SECONDS * 1000;
            bossSwitchedRef.current = false;
            setBossSwitched(false);
            if (bossModeRef.current) bossSwitchAtRef.current = 5 + Math.random() * 5;
            setNotice('中断过久，倒计时重置！— The timer resets when the pose is lost for 3 seconds');
          }
        } else {
          if (pausedRef.current) {
            if (resumeHoldRef.current === null) resumeHoldRef.current = now;
            if (now - resumeHoldRef.current >= 300) {
              pausedRef.current = false;
              interruptSinceRef.current = null;
              setPaused(false);
              setNotice('');
            }
          } else {
            interruptSinceRef.current = null;
          }
        }

        if (!pausedRef.current) {
          remainingMsRef.current -= dt;
          if (
            bossSwitchAtRef.current !== null &&
            !bossSwitchedRef.current &&
            remainingMsRef.current / 1000 <= bossSwitchAtRef.current
          ) {
            bossSwitchedRef.current = true;
            setBossSwitched(true);
            const next = randomAction(targetRef.current?.id);
            targetRef.current = next;
            setTarget(next);
            scorerRef.current.reset();
            pausedRef.current = true;
            setPaused(true);
            interruptSinceRef.current = now;
            resumeHoldRef.current = null;
            setNotice(`⚡ Boss 模式：动作切换为「${next.name}」！— Boss switch!`);
          }
          if (remainingMsRef.current <= 0) {
            remainingMsRef.current = 0;
            unlock();
          }
        }

        const uiRem = Math.ceil(remainingMsRef.current / 100) / 10;
        if (Math.abs(uiRem - lastUiRemaining) > 0.001) {
          lastUiRemaining = uiRem;
          setRemaining(Math.max(0, uiRem));
        }
      } else {
        lastTickRef.current = now;
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlock]);

  const matched = score >= MATCH_THRESHOLD * 100;
  const progress = (remaining / COUNTDOWN_SECONDS) * 100;
  const armed = ringAt !== null && phase === 'idle';
  const armedRemainMs = armed ? Math.max(0, ringAt - nowTick) : 0;
  const fmtRemain = (ms: number) => {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4 py-6 font-sans">
      <header className="text-center mb-4">
        <p className="text-xs tracking-widest text-emerald-400 mb-1">WEEK 02 项目活动 · AI MOMENT</p>
        <h1 className="text-3xl font-bold">不跳舞就关不掉：姿态识别闹钟</h1>
        <p className="text-zinc-400 text-sm mt-1">
          The alarm stops only when you complete the full 15-second dance.
        </p>
      </header>

      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* 摄像头区域 */}
        <div className="flex flex-col gap-4">
          <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 aspect-[4/3]">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover -scale-x-100"
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-cover -scale-x-100"
            />
            {phase === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/70 gap-3">
                <p className="text-zinc-300 text-sm">
                  {status === 'loading' && '⏳ 姿态模型加载中…（The model tracks 33 body landmarks in real time）'}
                  {status === 'ready' && '✅ 模型就绪，设定闹钟或点击立即演示'}
                  {status === 'running' && (armed ? `✅ 摄像头待命，${fmtRemain(armedRemainMs)} 后响铃` : '✅ 摄像头运行中')}
                  {status === 'error' && `❌ ${error}`}
                </p>
              </div>
            )}
            {phase === 'ringing' && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 animate-pulse">
                <Badge className="bg-red-600 text-white text-base px-4 py-1">⏰ 闹钟响铃中！</Badge>
              </div>
            )}
            {phase !== 'idle' && phase !== 'done' && (
              <div className="absolute bottom-3 left-3 right-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className={matched ? 'text-emerald-400' : 'text-zinc-300'}>
                    匹配分数 Match Score: {score}
                  </span>
                  <span className="text-zinc-500">达标线 {MATCH_THRESHOLD * 100}</span>
                </div>
                <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${matched ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 动作库展示 */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <p className="text-xs text-zinc-500 mb-3">动作库（响铃时随机抽取，全部为安全原地动作）</p>
            <div className="grid grid-cols-4 gap-2">
              {ACTIONS.map((a) => (
                <div
                  key={a.id}
                  className={`flex flex-col items-center rounded-xl p-2 border transition-colors ${
                    target?.id === a.id && phase !== 'idle'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-zinc-800 bg-zinc-950/50'
                  }`}
                  title={a.hint}
                >
                  <ActionDemo action={a.id} size={72} />
                  <p className="text-xs mt-1">{a.icon} {a.name}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 控制面板 */}
        <div className="flex flex-col gap-4">
          {/* 状态 */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <p className="text-xs text-zinc-500 mb-1">当前状态</p>
            <p className="text-lg font-semibold">{PHASE_TEXT[phase].zh}</p>
            <p className="text-sm text-zinc-400">{PHASE_TEXT[phase].en}</p>
          </div>

          {/* 目标动作 */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <p className="text-xs text-zinc-500 mb-2">随机目标动作 Target Pose</p>
            {target ? (
              <div className="flex items-center gap-3">
                <ActionDemo action={target.id} size={96} />
                <div>
                  <p className="text-xl font-bold">
                    {target.icon} {target.name}
                  </p>
                  <p className="text-sm text-emerald-400">{target.nameEn}</p>
                  <p className="text-xs text-zinc-400 mt-1">{target.hint}</p>
                  {bossSwitched && <Badge className="mt-2 bg-purple-600">Boss 已切换</Badge>}
                </div>
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">响铃后从下方动作库随机抽取一个目标动作</p>
            )}
          </div>

          {/* 倒计时血条 */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
            <div className="flex justify-between items-baseline mb-2">
              <p className="text-xs text-zinc-500">Boss 血条 · 倒计时</p>
              <p className={`text-3xl font-mono font-bold ${paused ? 'text-amber-400' : 'text-red-400'}`}>
                {remaining.toFixed(1)}s
                {paused && phase === 'countdown' && <span className="text-xs ml-1">⏸ 暂停</span>}
              </p>
            </div>
            <div className="h-5 rounded-full bg-zinc-800 overflow-hidden border border-zinc-700">
              <div
                className={`h-full transition-all duration-100 ${
                  paused ? 'bg-amber-500' : 'bg-gradient-to-r from-red-600 to-red-400'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {notice && <p className="text-xs text-amber-400 mt-2">{notice}</p>}
          </div>

          {/* 闹钟设置 */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
            <p className="text-xs text-zinc-500">闹钟设置</p>
            {armed ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-emerald-400">
                    ⏰ {new Date(ringAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 响铃
                  </p>
                  <p className="text-xs text-zinc-400">还有 {fmtRemain(armedRemainMs)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRingAt(null)}>
                  取消
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 text-sm">
                  <button
                    className={`flex-1 rounded-lg py-1.5 border ${alarmMode === 'time' ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-700'}`}
                    onClick={() => setAlarmMode('time')}
                  >
                    🕐 定时
                  </button>
                  <button
                    className={`flex-1 rounded-lg py-1.5 border ${alarmMode === 'countdown' ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-700'}`}
                    onClick={() => setAlarmMode('countdown')}
                  >
                    ⏳ 倒计时
                  </button>
                </div>
                {alarmMode === 'time' ? (
                  <input
                    type="time"
                    value={timeValue}
                    onChange={(e) => setTimeValue(e.target.value)}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-lg font-mono"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={minutesValue}
                      onChange={(e) => setMinutesValue(Number(e.target.value))}
                      className="w-24 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-lg font-mono"
                    />
                    <span className="text-sm text-zinc-400">分钟后响铃</span>
                  </div>
                )}
                <Button
                  className="bg-emerald-600 hover:bg-emerald-500"
                  onClick={armAlarm}
                  disabled={phase !== 'idle' && phase !== 'done'}
                >
                  ✅ 设定闹钟
                </Button>
              </>
            )}
            <Button
              size="lg"
              variant={phase === 'idle' || phase === 'done' ? 'default' : 'destructive'}
              className={phase === 'idle' || phase === 'done' ? 'bg-zinc-700 hover:bg-zinc-600 font-bold' : 'font-bold'}
              onClick={phase === 'idle' || phase === 'done' ? startAlarm : resetAll}
              disabled={status === 'loading' || status === 'error'}
            >
              {phase === 'idle' || phase === 'done'
                ? phase === 'done'
                  ? '🔁 再来一次（立即演示）'
                  : '⚡ 立即响铃（课堂演示）'
                : '⏹ 放弃并重置（闹钟照响）'}
            </Button>
            <label className="flex items-center justify-between text-sm">
              <span>👹 Boss 模式（中途随机切换一次动作）</span>
              <Switch checked={bossMode} onCheckedChange={setBossMode} disabled={phase === 'countdown'} />
            </label>
          </div>

          {/* 铃声设置 */}
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-2">
            <p className="text-xs text-zinc-500">铃声设置（音量会渐强）</p>
            <p className="text-sm">
              当前铃声：<span className="text-emerald-400">{ringtoneName || '默认合成铃声 🔊'}</span>
            </p>
            <div className="flex gap-2">
              <label className="flex-1">
                <input type="file" accept="audio/*" className="hidden" onChange={onPickRingtone} />
                <span className="block text-center text-sm rounded-lg border border-zinc-700 py-1.5 cursor-pointer hover:bg-zinc-800">
                  🎵 选择本地音乐
                </span>
              </label>
              <Button variant="outline" size="sm" onClick={togglePreview}>
                {previewing ? '⏹ 停止' : '▶ 试听'}
              </Button>
              {ringtoneName && (
                <Button variant="outline" size="sm" onClick={resetRingtone}>
                  恢复默认
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-6xl mt-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 p-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-zinc-400">
        <p>🇬🇧 The alarm stops only when the 15-second pose challenge is completed.</p>
        <p>🇬🇧 The model tracks 33 body landmarks and computes a live match score.</p>
        <p>🇬🇧 The timer resets when the pose is lost for 3 seconds.</p>
      </footer>
    </div>
  );
}

// ---------- 骨架绘制 ----------
function drawSkeleton(
  canvas: HTMLCanvasElement | null,
  lms: Landmark[] | null,
  score: number,
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lms) return;

  const hue = Math.round(score * 120);
  const color = `hsl(${hue}, 90%, 55%)`;

  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = lms[a];
    const lb = lms[b];
    if (!la || !lb || (la.visibility ?? 0) < 0.3 || (lb.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(la.x * canvas.width, la.y * canvas.height);
    ctx.lineTo(lb.x * canvas.width, lb.y * canvas.height);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  for (const lm of lms) {
    if ((lm.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
