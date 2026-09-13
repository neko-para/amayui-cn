# T-0006 · 变更记录（changes.md）

> **一句话**：把"音频帧泵"的所有权交给**帧驱动**，并给 headless 一个**不出声但全真**的宿主
> ⇒ 两条 chain 的链路报告里第一次能看到"什么时候响、响什么、时长多少"。

## 第 1 批（2026-09-14）—— D5 帧泵所有权 + headless 真 `AudioEngine`

### ① 帧泵归驱动（`src/frame/loop.ts`）

新增档位 `audio?: 'host' | 'never'`（默认 `'host'`），在**每完整帧**的帧末：
`host.audio?.({kind:'tick', nowMs, advActive: e.advActive})` → 再 `advanceModel` → 再 `present`。

- 次序照引擎：raw 20645-20646（`sub_4B5230` SE 通道老化 + `sub_4BBAB0` 语音队列）就在 present 段里；
  产品路径 `session.#present()`（texturesIdle → tick → present）也是这个次序。
- **撞脚本尾/退出/重置的那一帧不算完整帧** ⇒ 不发 tick（与 session 的 `break outer` 一致）。
- `report.ts` 显式 `audio: 'never'`：它是指令驱动的 tracer（C2 决策），不假装"每帧"。
- ★`session.#present()` 里那一处 tick **暂时保留**（它还没迁到驱动）⇒ **B4/T-0004 迁移时必须删掉**，
  否则每帧双 tick（BGM 淡变两倍速、延迟 SE 提前到期）。已在该处与 T-0004 票据里写明。

### ② headless 宿主实现 `audio`（`src/renderer/headlessScene.ts`）

- `HeadlessOptions.audioHost?: AudioHost` ⇒ 构造时建**真 `AudioEngine`**（与 Electron 同一个类）。
- ★**条件能力**：方法在构造器里按需赋值（原型上没有）⇒ 没给宿主时 `audio` 是 `undefined`，
  闸门 A 会把音频意图记成「意图被丢弃」；**不是静默空实现**（`tickets/T-0013` 的纪律）。
  这也保住了 G2：`report.ts` 不给宿主 ⇒ 输出逐字节不变（见 §⑤）。

### ③ `NodeAudioHost`（`src/audio/nodeAudioHost.ts`，新）

不出声，但**做决定的地方全真**：

| 关注点 | 做法 | 与 Electron 的差别 |
|---|---|---|
| 取字节 | `{id}` → `FileSource.readById`；`{name}` → `readByName`（曲号无扩展名时按 `BGM%03d.OGG` 补） | 无 |
| 时长 | **从容器头精确推**：OGG = 末页 granule ÷ 首页采样率；WAV = `data` 大小 ÷ `fmt` 的 byteRate | Electron 用 `decodeAudioData`；两者都只为"通道占线/释放"提供 `durationSec` |
| 起播 | 记账 + 回哑句柄（`stop/setGain/setPan/setLoop`） | 不接声音设备 |
| 流式 | `streamUrl()` 返回 `undefined` | Electron 有 `amayui-audio://`；这里强制走 load+decode+play（决定更好比） |

真实语料实测（`.tmp/probe-audio-dur.mts`，读 `install/` 的 ALF）：

| 资源 | 容器 | 字节数 | 推得的时长 |
|---|---|---|---|
| `id:46`（`SE004.WAV`） | RIFF | 63 210 | **0.358 s** |
| `id:50`（`SE002.WAV`） | RIFF | 349 446 | **1.980 s** |
| `id:20963`（`SE009.WAV`） | RIFF | 598 060 | **3.390 s** |
| `id:354`（`FIA3203.OGG`） | OggS | 57 733 | **3.307 s** |
| `BGM031.OGG`（标题曲） | OggS | 2 157 427 | **134.489 s**（2:14） |

⇒ 时长不是估的，是容器里写着的；语音占线判定与 Electron 同源。

### ④ ★顺带修掉一个"虚拟时钟从 0 起"才会暴露的哨兵 bug（`src/audio/audioEngine.ts`）

- **现象**：`0x2BF se-delay ch1 500ms` 在 headless 里**晚一帧**才响（500ms 的门槛到 600ms 才成立）。
- **根因**：延迟记录用 `armedAtMs: 0` 表示"还没起步"，tick 里判 `=== 0` 就锁存当前时刻。
  而 headless 的虚拟时钟**第一帧就是 0** ⇒ 锁存后仍是 0 ⇒ 第二帧又锁存一次（这回是 100）
  ⇒ 延迟从第二帧起算。Electron 是真实墙钟（几千 ms）⇒ 永远只锁存一次 ⇒ **看不出来**。
- **改法**：把"未起步"从数字 0 改成显式 `null`（`delay.armedAtMs` / `request.armedAtMs`）。
  与 `winPhase`/`meshWindowDone` 的 `animStart === 0` 是**同一类坑**（那两处已登记在 T-0002 的 notes）。
- **判据**：`test/audio-node-host.test.ts` 的延迟 SE 用例断言"6 帧 100ms 步进 ⇒ 第 6 帧（clock=500）恰好响一次"；
  修前实测是第 7 帧（600ms）。

### ⑤ before/after（同一次运行内的对照，`audio:false` = 修前状态）

`.tmp/ab-headless-audio.mts`：

| | `drops` 里的音频项 | `audioEvents` |
|---|---|---|
| `gameStartChain` before（宿主没有 `audio`） | **`audio×37`** | **0 条** |
| `gameStartChain` after | 无 | **14 条**（`bgm#31 起播 134.5s`、`SE ch2 起播 id=14755`、`SE ch1 起播 id=50 1.98s`…） |
| `config1Chain` before | **`audio×14`** | **0 条** |
| `config1Chain` after | 无 | **6 条** |

两条 chain 的结果新增 `audioEvents: string[]`（`[audio] …` 行）= "headless 与 Electron 音频表现"的可比对象
（G3 回放比对的输入之一）；另加 `audio?: boolean` 开关只为复现 before 侧。

### ⑥ 判据

- `npm test` **454/454**（新增 `test/audio-node-host.test.ts` 10 条 + `test/frame-loop.test.ts` 3 条帧泵用例）。
- **G2 零 diff**：`report` 输出 sha256 = `FBC05509…`（与 B1/B2 记录的基准逐字节相同）。
- **E4 冒烟**（`--gamestart --name postT6`）：`[audio]` 24 行、`[present]` 66、`gate 0x400 cleared` 11、
  `[reveal]` 321 行 —— 与上一轮同量级 ⇒ 产品路径（session 自己那一处 tick）行为未变。
