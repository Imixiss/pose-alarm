import { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '@/lib/pose';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export type PoseStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error';

interface PoseFrame {
  landmarks: Landmark[] | null;
  timestamp: number;
}

// EMA 平滑器：对 33 个关键点做指数滑动平均防抖
class LandmarkSmoother {
  private prev: Landmark[] | null = null;
  private alpha = 0.4; // 越小越平滑

  smooth(lms: Landmark[]): Landmark[] {
    if (!this.prev || this.prev.length !== lms.length) {
      this.prev = lms.map((l) => ({ ...l }));
      return this.prev;
    }
    const out = lms.map((l, i) => {
      const p = this.prev![i];
      return {
        x: p.x + this.alpha * (l.x - p.x),
        y: p.y + this.alpha * (l.y - p.y),
        z: p.z + this.alpha * (l.z - p.z),
        visibility: l.visibility,
      };
    });
    this.prev = out;
    return out;
  }

  reset() {
    this.prev = null;
  }
}

export function usePoseCamera(onFrame: (frame: PoseFrame) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<PoseStatus>('idle');
  const [error, setError] = useState<string>('');
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(false);
  const smootherRef = useRef(new LandmarkSmoother());
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // 预加载模型（组件挂载即开始，减少响铃时等待）
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError('姿态模型加载失败，请检查网络后刷新（模型文件来自 Google CDN）');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      setStatus('running');

      const loop = () => {
        if (!runningRef.current) return;
        const lm = landmarkerRef.current;
        const v = videoRef.current;
        if (lm && v && v.readyState >= 2) {
          const now = performance.now();
          const res = lm.detectForVideo(v, now);
          const raw = (res.landmarks?.[0] as Landmark[] | undefined) ?? null;
          const smoothed = raw ? smootherRef.current.smooth(raw) : null;
          if (!raw) smootherRef.current.reset();
          onFrameRef.current({ landmarks: smoothed, timestamp: now });
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      setStatus('error');
      setError('无法访问摄像头：请授权摄像头权限，并通过 localhost 或 HTTPS 打开页面');
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus((s) => (s === 'running' ? 'ready' : s));
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  return { videoRef, status, error, start, stop };
}
