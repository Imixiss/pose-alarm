// 闹铃音频：支持默认合成铃声 + 用户本地音乐，带音量渐强
export class AlarmSound {
  private ctx: AudioContext | null = null;
  private timer: number | null = null;
  private gain: GainNode | null = null;
  private customBuffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private crescendoTimer: number | null = null;
  playing = false;

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.12;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 在用户手势中提前创建/恢复 AudioContext，保证定时响铃时能出声 */
  warmup() {
    this.ensureCtx();
  }

  /** 设置用户自定义铃声（null 恢复默认合成铃声） */
  setCustomBuffer(buf: AudioBuffer | null) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.customBuffer = buf;
    if (wasPlaying) this.start();
  }

  hasCustom() {
    return this.customBuffer !== null;
  }

  private beep(freq: number, start: number, dur: number) {
    if (!this.ctx || !this.gain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(this.gain);
    osc.start(start);
    osc.stop(start + dur);
  }

  private schedulePattern() {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    this.beep(880, t0, 0.15);
    this.beep(660, t0 + 0.2, 0.15);
    this.beep(880, t0 + 0.4, 0.15);
    this.beep(660, t0 + 0.6, 0.15);
  }

  // 音量渐强：从 0.12 开始，每秒约 +8%，上限 0.6
  private startCrescendo() {
    this.startedAt = Date.now();
    this.crescendoTimer = window.setInterval(() => {
      if (!this.gain) return;
      const elapsed = (Date.now() - this.startedAt) / 1000;
      this.gain.gain.value = Math.min(0.12 * Math.pow(1.08, elapsed), 0.6);
    }, 1000);
  }

  start() {
    if (this.playing) return;
    this.ensureCtx();
    this.playing = true;
    if (this.gain) this.gain.gain.value = 0.12;

    if (this.customBuffer && this.ctx && this.gain) {
      // 循环播放用户音乐
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.customBuffer;
      this.source.loop = true;
      this.source.connect(this.gain);
      this.source.start();
    } else {
      this.schedulePattern();
      this.timer = window.setInterval(() => this.schedulePattern(), 1200);
    }
    this.startCrescendo();
  }

  stop() {
    this.playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.crescendoTimer !== null) {
      clearInterval(this.crescendoTimer);
      this.crescendoTimer = null;
    }
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}

// 解码本地音频文件
export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  const arr = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  void ctx.close();
  return buf;
}

// 成功解锁音效
export function playSuccess() {
  const ctx = new AudioContext();
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.12;
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(g).connect(ctx.destination);
    const t = ctx.currentTime + i * 0.12;
    osc.start(t);
    osc.stop(t + 0.25);
  });
}
