# 不跳舞就关不掉：姿态识别闹钟 | Pose-Alarm

> 闹钟响起后，按照屏幕指定的动作连续跳舞 15 秒才能关闭它——身体是关机密码，AI 是裁判。
> When the alarm rings, you must perform the randomly assigned pose for 15 consecutive seconds to stop it — your body is the off-switch, and AI is the referee.

🔗 **在线体验 / Live Demo**: https://poserecognitionmarg-finsix.netlify.app/

## 功能 | Features

- ⏰ **真闹钟系统 / Real alarm clock**：定时响铃（如 07:30）+ 倒计时响铃（如 10 分钟后）+ 课堂演示用「立即响铃」/ Scheduled alarms, countdown alarms, and an instant-demo mode
- 🎲 **随机目标动作 / Random target pose**：响铃时从 8 个安全原地动作中随机抽取，每个动作配循环火柴人示范动画 / A random pick from 8 safe in-place exercises, each with a looping stick-figure demo
- 🦴 **实时姿态识别 / Real-time pose tracking**：MediaPipe Pose 追踪 33 个人体关键点，彩色骨架叠加 + 0–100 实时匹配分数 / 33 body landmarks with a live skeleton overlay and a 0–100 match score
- ❤️ **Boss 血条倒计时 / Boss health-bar countdown**：15 秒挑战；动作中断 1.2 秒暂停、3 秒重置 / 15s challenge — lose the pose for 1.2s to pause, 3s to reset
- 👹 **Boss 模式 / Boss mode**：倒计时中途随机切换一次目标动作 / The target pose switches once mid-challenge
- 🎵 **自定义铃声 / Custom ringtone**：支持本地音乐（mp3/m4a/wav），IndexedDB 持久保存，音量渐强 / Pick a local music file as your ringtone, persisted via IndexedDB, with volume crescendo
- 🇬🇧 **中英双语界面 / Bilingual UI**（课堂演示友好 / classroom-demo friendly）

## 技术栈 | Tech Stack

| 层 | 技术 |
|---|---|
| 姿态识别 Pose | MediaPipe Pose Landmarker（lite, float16）· 浏览器端 GPU 推理 / in-browser GPU inference |
| 动作判定 Scoring | 规则法：关键点归一化 + 关节几何 + 摆动周期检测 / rule-based: normalized landmarks + joint geometry + oscillation detection |
| 前端 Frontend | React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| 音频 Audio | Web Audio API（合成闹铃 + 自定义铃声 + 胜利音效 / synthesized alarm + custom ringtone + success jingle） |
| 部署 Deploy | Netlify（静态托管 / static hosting） |

> 模型只做关键点定位，不做动作分类——动作判定为手写规则，零训练成本、完全可解释。
> The model only localizes landmarks; action recognition is hand-written rule-based scoring — zero training cost, fully interpretable.

## 本地运行 | Run Locally

```bash
npm install
npm run dev        # http://localhost:3000
```

> ⚠️ 摄像头需要 localhost 或 HTTPS 环境；首次加载姿态模型（约 5 MB）需联网。
> Camera requires localhost or HTTPS; the pose model (~5 MB) downloads from Google CDN on first load.

## 构建部署 | Build & Deploy

```bash
npm run build      # 输出 dist/ → outputs dist/
```

把 `dist/` 拖到 [Netlify Drop](https://app.netlify.com/drop) 即可上线。
Drag `dist/` onto Netlify Drop to deploy.

## 项目结构 | Structure

```
src/
├── pages/Home.tsx        # 主界面 + 游戏状态机 / main UI + game state machine
├── lib/pose.ts           # 8 动作规则判定 / rule-based scoring for 8 actions
├── lib/demoFigure.ts     # 火柴人示范动画 / stick-figure demo animations
├── lib/alarm.ts          # 闹铃音频（合成/自定义/渐强）/ alarm audio (synth/custom/crescendo)
├── lib/ringtoneStore.ts  # 铃声 IndexedDB 持久化 / ringtone persistence
└── hooks/usePoseCamera.ts # 摄像头 + MediaPipe 检测循环 / camera + detection loop
```

## License

[MIT](LICENSE)
