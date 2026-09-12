# 13 · 音频实现方案评估（SE / 语音 / BGM：要建模什么、多难、要不要新库）

> 触发：2026-09 排查「被跳过的指令里哪些是音频」之后，评估把音频真正做出来需要多少东西。
> 引擎侧结论（设备/三模块/字段/opcode 全表）在 [`docs-new/03-engine/sound-system.md`](../../../docs-new/03-engine/sound-system.md)；
> 本文只谈**本工程要加什么、复杂度、技术选型**。数据全部为 2026-09 实测（探针 `.tmp/audioProbe.mts` / `.tmp/codecProbe.mts` / `.tmp/appendAudioProbe.mts`）。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 音频资源在哪 | **同一个统一文件 id 空间**（`install/SYS4INI.BIN` + `DATA*.ALF` / `APPEND0n.ALF`）——`FileSource.readById(id)` 已经能取字节（AGF 就是走它） |
| 是什么格式 | SE = **RIFF PCM16 WAV**；BGM / 大部分语音 = **Ogg Vorbis**；★**全库没有 AOGG/ADPCM** |
| 要引入新库吗 | **不需要**。Chromium（Electron 44）原生 `decodeAudioData` 就吃这两种格式，Web Audio 原生就有 15 通道所需的 gain/pan/loop |
| 真正的成本在哪 | **语义层**（15 条通道 + 音量/pan/循环/延迟/语音仲裁/ADV 寄存），不在解码；约 **4.5–7 人日**（见 §4） |
| 状态字段要不要建模 | 纯粹为「声音怎么响」服务：**没有任何 opcode 能把这些字段读回 VM**（见 §2.3）⇒ 不做声音就没有建模价值 |
| 现有方案够不够 | 够。零新增运行时依赖（现状仅 `pixi.js`）；唯一建议新增的是**自定义协议 + Range**（不是库，是 Electron 内置能力），用于 BGM 流式 |

> ## ✅ 落地状态（2026-09 已实现 S0–S3 的核心）
>
> | 层 | 文件 | 内容 |
> |---|---|---|
> | 音频引擎（宿主无关·可单测） | `src/audio/audioEngine.ts` | SE 10 通道 / 语音 3 通道 / BGM；音量×因子×主音量、pan、循环、延迟播、语音仲裁与队列、**ADV 位寄存与冲刷**、BGM 淡变与语音压低、按字节预算的 LRU 解码缓存 |
> | 意图词汇表 | `src/audio/audioEngine.ts` 的 `AudioIntent` | VM 与宿主之间唯一的音频接口（19 种意图 + `tick`） |
> | VM handler | `src/vm/handlers/audio.ts` | **22 条 opcode**：`0xB4/0xB5/0xB6/0xB7/0xB9/0xBA/0xBB/0xBC/0xBF/0xC2/0xC4/0xC6/0x1BD/0x2BF/0x2C0/0x2F4/0x2F5/0x2F6/0x2F7/0x2F8/0x2FF/0x302`（从 `ENGINE_INTERNAL_OPS`/`STUB_NATIVE_OPS` 移出，落在 `NATIVE_OPS`） |
> | 宿主 | `src/renderer/audio/webAudioHost.ts` | Web Audio：`decodeAudioData` 解码、`AudioBufferSourceNode`+`GainNode`+`StereoPannerNode` 播放；BGM 走 `amayui-audio://` `<audio>` 流式，**流式失败自动退化为解码** |
> | 主进程 | `electron/ipc/files.ts` + `electron/main.ts` | `audio` IPC（SE/语音字节）、`amayui-audio://` 协议 + **Range**（BGM 流式）、`autoplay-policy=no-user-gesture-required` |
> | 帧泵 | `src/renderer/app/session.ts` 的 `#present()` | 每帧发 `{kind:'tick', nowMs, advActive}`（对应引擎 raw 20645/20646 与 20146/24966） |
> | 守卫 | `test/audio-engine.test.ts`（25 条）、`test/audio-opcodes.test.ts`（7 条） | 通道/音量/pan/循环/延迟/寄存冲刷/缓存/流式分支；操作数顺序与 ADV 分叉 |
>
> **仍未做**（都不影响"有声"）：
> 1. 「**语音跟着文本走**」（S5）：文本项记录表（`Font+3364`，72B/条，`0x1D2` 仍 no-op）与 ADV 显示路径的入队（`sub_409E10`）；
>    `0x2F4` 目前只做"立即/寄存起播"，不登记记录表。
> 2. **设备丢失后的重建与 SE 通道重载**（引擎 `sub_4B5090`）：现在只在 `AudioContext` 创建时建一次。
> 3. **影片音轨**（MPG，`sound:Volume4`）：引擎走另一路播放器，本工程 `play-movie` 仍是日志桩。
> 4. 音量曲线未做 1:1 A/B 校准（当前线性增益；数学上与 DS 的 `20log10` 映射等价，见 §3.4）。


## 1. 语料实测（决定技术选型的关键证据）

### 1.1 音频成员都在统一 id 空间里

`SYS4INI.BIN` 索引共 21109 条，其中音频 **13968 条 / 1541.5 MB**（占全部数据 6.7 GB 的 23%）：

| 类别 | 命名 | 数量 | 字节 | id 区间 | 容器/编解码（抽样实测） |
|---|---|---|---|---|---|
| BGM | `BGM###.OGG` | 43 | 123.4 MB | 1..43 | `OggS` Vorbis（stereo 44.1/48/96 kHz） |
| SE | `SE###.WAV` / `SEA###` / `SEM###` | 192 | 19.8 MB | 46..21078 | `RIFF` **PCM16**（mono/stereo 22050/44100） |
| 角色语音 | 角色缩写 + 序号（`FIA1155.OGG` / `KIS0001.OGG` / …） | 13700 | 1390.3 MB | 77..20845 | `OggS` Vorbis（多为 mono 44.1 kHz） |
| 语音（少量 WAV） | `C####.WAV` | 33 | 8.0 MB | 60..12691 | `RIFF` PCM16 |

- **id 就是索引下标**：`play-sound-effect 2e 1` → id 46 = `SE004.WAV` ✓；`play-bgm 12` → **曲号 18** = `BGM018.OGG`
  ✓（★BGM 用的是**曲号**，不是文件 id：引擎 `MusicBase` 有「曲号 → 文件 id」表，本作等价于 `BGM%03d.OGG`；
  见 `docs-new/03-engine/sound-system.md` §5。把曲号当 id 会静音错曲：曲号 31 曾是 id 31 = `BGM041.OGG`）；
  语音 id 来自脚本 global（`play-voice (global-int f8007)`），指向角色 `*.OGG`。
- 扩展包一样：`APPEND01` 385 个音频、`APPEND03` 1019 个、`APPEND05` 546 个……抽样全是 `OggS`/`RIFF`（统一 id 高字节 = 包号，`$3$ROS0832.OGG` 等）。
- ★**没有任何成员是 `AOGG`** —— 引擎里第三个解码器 `sub_48C870`（raw 138995-139003）在本作数据上**没有对应用例**（那是引擎家族其它作品的变体）。实现时可以只做 RIFF + OggS，并留一行注释/断言。
- 容器里的 PCM WAV 是**未压缩 PCM16**（`fmt` tag = 1），不是 IMA/MS-ADPCM ⇒ `decodeAudioData` 直接可解。

### 1.2 目前 emulator 实际会碰到的量

| 脚本（可达路径） | 音频指令 |
|---|---|
| `TITLE.txt` | `play-sound-effect`×7 + `i0b5`×10、`play-bgm`×1 |
| `CONFIG1.txt`（系统设定页） | `play-sound-effect`×12 + `i0b5`×12 + `i0ba`×5、`i0b7`×1、`i0c5/i0c6/i0c7`（音量读数/设置/开关）、`i2f5/i2f6/i2f8/i2ff`、`play-voice`×1 |
| `CONFIG2.txt`（角色设定页） | `i0b5`×11、`play-sound-effect`×6、`i2ff`×2、`i2f5/i2f6/i2f8`、`play-voice`×1 |
| `CONFIGCV.txt`（CV 页） | `i0b5`×6、`i302`×2、`i2f6`×3、`play-voice`×1 |
| `SAVE.txt` / `SELFONT.txt` / `MENU.txt` | `i0b5` ×24 / ×8 / ×2（UI 反馈音） |
| `SYSTEM4.txt` | `i2f6`×7、`i2f8`×3（含「三路语音 pan 归中」子程序 `:476-480`） |
| `CALLBACK_LOAD` / `GAMEOVER` | `i2f6`/`i2f8`/`i0ba`/`i0b7`/`i0c2`（淡变）/`i0b9` |
| 故事脚本（`SN0000`/`SC*`） | `i2f6`×86k 级、`play-voice`×14k、`i2f7`/`i2ff`/`i2f8` 各 1–3 万 |

⇒ **光做 UI（标题/设置/存档/字体选择）就已经需要：SE 装载+起播+停止（0xB4/0xB5/0xBA/0xB6）、BGM（0xBF/0xB7/0xB9）、音量（0xC6/0xC5/0xC7）、语音预览（0xC4 + 0x2F5/0x2F6/0x2F8/0x2FF/0x302）**；`i2bf`（延迟 SE）与 3 路语音仲裁主要服务 ADV/战斗。

## 2. 需要建模的内容

### 2.1 资源层：**零新增**（已有）

- `FileSource.readById(id)`（`src/arch/nodeFileSource.ts`）已按统一 id 取字节：先找松散文件、否则按索引从 ALF 切片。
- 扩展包 id（高字节 = 包号）已由 `resolveEntry` 处理，缺失时抛 `MissingAppendPackError`（引擎语义）。
- 唯一要加的是一条**取二进制**的通道（现在 IPC 只有 `image` 会返回二进制）：
  - 简单版：`ipcMain.handle('audio', async (_e, id) => Buffer)`（复用 `readById`）；
  - 推荐版：自定义协议 `amayui-audio://<id>` + **Range 支持**（见 §3.3），BGM 直接流式给 `<audio>`。

### 2.2 音频引擎对象层：**新写一个模块（唯一真正的新代码）**

```
AudioEngine（renderer）
├─ ctx: AudioContext + masterGain
├─ SE 通道 ×10（设备通道 0..9）   : { buffer?, src?, loop, pan, volumeFactor, state }
├─ Voice 通道 ×3（设备通道 12..14）: 同上 + { armed, delayMs, startedAt, pendingId, pendingLoop }
└─ BGM 播放器（单槽 + 模式）      : { el/MediaElementSource?, fadeTarget, fadeStep, current }
```

与引擎字段的对应（`docs-new/03-engine/sound-system.md` §2/§4）：

| 引擎 | 本工程 | 说明 |
|---|---|---|
| `设备[327+ch]` | `channel.volume` | 通道音量（0..10000 线性） |
| `设备[342]` | `masterGain.gain` | 主音量（`sound:Volume0`） |
| `设备[375+ch]` | `channel.pan` | **pan**（±10000 → `StereoPannerNode.pan`） |
| `设备[390+ch]` | `channel.volumeFactor` | 每通道音量因子（语音 = 角色语音音量，0..10000，-1 = 不缩放） |
| `设备[345+ch]` | （不需要） | 仅用于「临时跳过音量下发」的内部技巧 |
| SoundBuffer `+9296` | `source.loop` | 循环标志（0xB5=播一次 / 0xBA=循环） |
| SoundBuffer `+9292/+2331` | `source.start(when, offset)` | 定位（`sub_4B5A30` 毫秒→秒） |
| `Engine[5053+ch]` | `voice[i].pan` | 语音通道 pan（0x2F8 写） |
| `Engine[122501]` | （内部） | 「有语音在响」，无 opcode 可读（见 §2.3） |

- 延迟/排队：引擎是**每帧泵**（raw 20645 SE、20646 语音，用 `Engine+369332` 的时钟）⇒ 挂到渲染帧循环 `audio.tick(nowMs)`，**不要**用 `setTimeout`（暂停/跳帧语义会漂）。
- 淡入淡出：BGM 用 `linearRampToValueAtTime`（引擎是逐帧步进 `sub_489E50`，听感对齐即可）。

### 2.3 「状态字段」要不要建模？——**没有 VM 可见效果**

这一条是本评估最重要的结论，直接决定「只做状态不做声音」是伪需求：

- 音频写的字段（`设备[327/342/375/390+ch]`、`Engine[5053+ch]`、`Engine[122501]`、`[122505/122508+ch]`）**没有任何 opcode 能读回脚本**：
  - `0xC5`/`0xC7` 读的是**配置注册表**（`sound:Volume0..4` / `sound:Music|SE|Voice|Movie`），不是这些字段；
  - `Engine[122501]` 的读者是引擎内部的 ADV 显示例程（`sub_41EEF0`，raw 28560）与 `sub_4090F0`（raw 13708）—— 都是引擎自己的控制流，不经 VM。
- 因此：**不建模 = 不会让任何脚本分支走错**（这也解释了为什么现在全程 no-op 也没出过逻辑 bug）；它们的唯一作用是「声音怎么响」。
- 反过来，要做声音时这些字段自然成为 AudioEngine 的内部状态；**唯一需要 VM 侧改动的**是 `0xC6`（设音量）：写配置（已实现）之外要 `audio.setVolume(category, value)` 让音量立刻生效。

### 2.4 指令 → API 映射（新增 VM handler 或让 bridge 真实现）

| opcode | 语义 | AudioEngine API |
|---|---|---|
| `0xB4` play-sound-effect | 装载 SE 到通道 | `se.load(id, ch)`（取字节 → decode → LRU 缓存） |
| `0xB5` / `0xBA` | 起播（播一次 / 循环） | `se.play(ch, { loop:false/true })` |
| `0xB6` | 停止/释放 | `se.stop(ch)` |
| `0x2BF` | 延迟播 SE（循环标志 + 毫秒） | `se.playDelayed(ch, loop, ms)`（帧泵） |
| `0x2F6` | 复位语音通道 | `voice.reset(ch)` |
| `0x2F7` / `0x2FF` / `0x302` | 语音通道状态位 / 音量因子 | `voice.setFlag(ch,…)` / `voice.setFactor(ch, v)` |
| `0x2F8` | **语音通道 pan** | `voice.setPan(ch, v)` |
| `0xC4` / `0x1BD` | 播语音（通道 0，循环位 0/1） | `voice.play(0, id, loop)`（ADV 激活位时先寄存） |
| `0x2C0` / `0x2F5` | 语音排队（带延迟、指定通道） | `voice.queue(id, ch, delayMs, …)` |
| `0x2F4` | 播语音 + 登记文本项记录 | `voice.play(ch,…)` + （可选）文本项记录表 |
| `0xBF` / `0xB7` / `0xB9` | 播 BGM / 当前槽播（循环/不循环） | `bgm.play(id, loop)` |
| `0xBB` / `0xBC` | SE / BGM 开关（模式） | `se.setEnabled(bool)` / `bgm.setMode(n)` |
| `0xC2` | BGM 淡变 | `bgm.fadeTo(v, step)` |
| `0xC6` | 设音量（0..4 类别） | `audio.setVolume(cat, v)`（+ 写配置） |
| `0xC5` / `0xC7` | 读音量 / 读开关 | **已实现**（`handlers/config-read.ts`） |

> 现在这些 opcode 在 `stubs.ts` 里全是 `op_engine_internal` 空操作（`0xB4/0xBF/0xC4` 走 `stubSubsystem` → `native.playSound/playBgm/playVoice`，而那三个方法目前只写日志）。

### 2.5 与 ADV / 帧循环的挂钩（最容易漏的部分）

1. **ADV 激活位**（`Engine[174801] & 0x8000000`）：位在时 `0xC4/0x1BD/0x2F4` 只寄存（`Engine[122505/122508+ch]`），位清除时冲刷（raw 20146-20159 / 24966-24979）。该位在 emulator 里**已建模**（第二层 `adv-flag-lifecycle`），挂钩点现成。
2. **文本项记录带语音**（`Font+3364`，72B/条，flags `0x40000000`，`+28` = pan）：ADV 显示路径据此起播或入队（raw 76888-76907），每帧泵排水（raw 19967-19999）。
   - emulator **尚未建模**该记录表（`0x1D2` 是 no-op）⇒ 想要「语音跟着文本走」要先建模它（约 +1–2 天）；只做 UI 场景可以先不做（`0xC4` 的立即播放路径够用）。
3. **3 路仲裁**（`sub_404CB0` 忙判定 + `v182[槽]` 计数 + 入队 `sub_409E10`）：只影响 ADV/战斗的语音重叠处理。

## 3. 技术方案评估

### 3.1 要不要引入新库？——不需要

| 需求 | 现成能力 | 结论 |
|---|---|---|
| 解 WAV(PCM16) | Chromium `decodeAudioData` / `<audio>` | 不需要库 |
| 解 Ogg Vorbis | 同上（Vorbis 是**开源**编解码，不受 Electron proprietary-codecs 影响） | 不需要库 |
| 15 通道混音 / 音量 / pan | Web Audio：`GainNode` / `StereoPannerNode` / `AudioBufferSourceNode(loop)` | 不需要库 |
| BGM 流式（2–6MB/曲） | `<audio>` + `MediaElementAudioSourceNode`，或 `AudioBufferSourceNode` 单曲 | 不需要库 |
| 帧同步/延迟播 | 复用现有渲染帧循环（`tick(nowMs)`） | 不需要库 |
| 解 AOGG / ADPCM | 本作数据里**没有** | 先不做，留注释 |
| headless 音频回归（Node 侧无 Web Audio） | 需要 ffmpeg/wasm 解码器 | **当前不是需求**（用假 sink 断言 opcode→意图即可） |

⇒ 保持「**零新增运行时依赖**」（现在只有 `pixi.js`）。

### 3.2 内存/性能（必须按需解码）

- 音频总量 **1.54 GB**（角色语音 1.39 GB）⇒ **绝不能预解码**。
- 单条：SE ≤ 350KB、语音均 ~90KB；解码成 PCM 后约 0.3–1MB/条 ⇒ 用**字节预算 LRU**（建议 64–128MB）。
- BGM 2–6MB/曲，解成 PCM 约 30–50MB/曲 ⇒ 推荐 `<audio>` 流式（零解码缓存），或单曲解码 + 切曲时释放。
- 取字节开销：`readById` 每次 open/seek/read/close（ALF 切片）；BGM 建议走协议流式，避免 6MB 经 IPC 复制。

### 3.3 推荐：自定义协议 + Range（Electron 内置能力，不是库）

```ts
// app ready 之前
protocol.registerSchemesAsPrivileged([
  { scheme: 'amayui-audio', privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
]);
// app ready 之后
protocol.handle('amayui-audio', async (req) => {
  const id = Number(new URL(req.url).hostname);        // amayui-audio://<id>
  const range = req.headers.get('range');              // <audio> 会发 Range
  const { entry, archives } = await fileSource.resolveEntry(id);
  const { start, end } = parseRange(range, entry.length);
  return new Response(fs.createReadStream(alfPath, { start: entry.offset + start, end: entry.offset + end }), {
    status: range ? 206 : 200,
    headers: { 'content-type': mimeOf(entry.name), 'accept-ranges': 'bytes', 'content-length': String(end - start + 1) },
  });
});
```
- 好处：`<audio src="amayui-audio://1">` 即可播 BGM，支持 seek/loop，渲染进程内存零占用；SE/语音仍可走 `fetch` + `decodeAudioData`（同协议也能 `fetch`）。
- 成本：约 60–80 行（含 Range 解析/Content-Type/206 语义）。
- ★**CSP 必须显式放行该 scheme**：`src/renderer/index.html` 的 `Content-Security-Policy` 要有
  `media-src 'self' amayui-audio:` 与 `connect-src 'self' amayui-audio:`。
  只靠 `registerSchemesAsPrivileged({bypassCSP:true})` **不够** —— 2026-09 实测：漏掉 `media-src` 时
  `<audio>` 立刻报 `no supported source was found`，请求**根本到不了主进程**（日志里没有 `[main] audio-stream`），
  而 `decodeAudioData` 的回退路径照常出声 ⇒ 表现是"有 BGM、但每次都多一条流式失败日志 + 白解 6MB PCM"。
- ★**id 放在路径段**（`amayui-audio://audio/31`），不要放主机名：WHATWG URL 会把纯数字主机名当 **IPv4**
  解析（`amayui-audio://31` → `hostname = 0.0.0.31`）⇒ 主进程用 hostname 取 id 会拿到 `NaN`（实测返回 400）。
- ★**CORS**：页面是 `file://` 起源，对自定义 scheme 的请求按跨源处理 ⇒ 响应要带 `access-control-allow-origin`。
- ★★**BGM 流式不要经 `createMediaElementSource`**（2026-09 实测）：`file://` 页面 + `amayui-audio://` 是**跨源**，
  Chromium 会把该 `<audio>` 判为 **tainted**，接进 Web Audio 图后**输出恒为静音** ——
  症状极具迷惑性：日志里"流式起播确认（readyState=4、时长正确）"、`[main] audio-stream` 也 200/206 正常，
  但**一点声音都没有**（而 SE/语音走 `decodeAudioData` + `AudioBufferSourceNode` 不受影响 ⇒ "音效还在、BGM 没了"）。
  修法：BGM 用**元素自身的 `el.volume`** 当增益（BGM 只需标量增益、不需要 pan），完全不进 Web Audio 图；
  淡变/压低就是每帧改 `el.volume`（引擎的 `sub_489D50` 步进语义照旧）。
- ★**自检**：`WebAudioHost` 构造时用 `fetch(base+'id/0', {Range:'bytes=0-1'})` 探一次可达性并写日志
  （`流式协议探测：status=…`），探测失败就永久退回解码 —— 否则这类问题只会以"`<audio>` 静默失败"的形式出现。

### 3.4 已知的「不完全一致」（可接受，需在验收时说明）

| 项 | 引擎 | 本工程 | 处理 |
|---|---|---|---|
| 音量曲线 | 0..10000 线性值经 `log` 映射成 DirectSound 的**百分之一 dB**（静音下限 -10000 = -100 dB，该常量已在 unpacked exe 验到 @0x126720） | `GainNode.gain = v/10000`（线性振幅） | 数学上等价（DS 衰减 dB=20log10(amp) ⇒ amp = v/10000）；M 阶段用真机 A/B 听感校准一次 |
| pan | `SetPan(-10000..+10000)` | `StereoPannerNode.pan = v/10000` | 直接映射 |
| 循环 | 解码器复位重播（缓冲边界） | `source.loop = true` | 更精确（采样级） |
| BGM 淡变 | 逐帧步进（`sub_489E50`） | `linearRampToValueAtTime` | 听感对齐即可 |
| 96 kHz BGM | DirectSound 重采样 | Web Audio 自动重采样 | 无需处理 |
| 同时通道数 | 15（0..9 SE / 12..14 语音） | 同 | 设备 10/11 未分配，本作不用 |

## 4. 分期与工作量（人日）

| 阶段 | 内容 | 估计 |
|---|---|---|
| **S0 管道** | 自定义协议（或 IPC）+ `AudioEngine` 骨架 + `AudioContext`（Electron 需 `--autoplay-policy=no-user-gesture-required`）+ 主/SE/语音/BGM 音量 + `0xC6` 联动 + 控制面板音频日志 | 0.5–1 |
| **S1 SE** | `0xB4/0xB5/0xBA/0xB6` + 延迟 `0x2BF` + 10 通道 + LRU + 帧泵 | 1–2 |
| **S2 语音** | `0x2F6/0x2F7/0x2F8/0x2FF/0x302/0xC4/0x1BD/0x2C0/0x2F4/0x2F5` + 3 通道仲裁 + ADV 位寄存/冲刷 | 1–2 |
| **S3 BGM** | `0xBF/0xB7/0xB9/0xBB/0xBC/0xC2` + 流式 + 淡变 + 语音时 ducking（`set:KeepMusicVoice`/`sound:MusicFadeOnVoicePlaying`） | 1 |
| **S4 验证** | 假 AudioContext 的 E2 单测（断言通道/音量/pan/循环/寄存）+ E3 真脚本跑 CONFIG1 音量页 + E4 手动听 | 1 |
| **S5（可选）** | 文本项记录表（`Font+3364` 72B/条）+ 显示驱动起播/入队 → 「语音跟着文本走」 | +1–2 |

合计 **≈4.5–7 人日**（含可选 S5 则 6–9）。若只求「标题/设置页有反馈音与 BGM」的 S0+S1+S2 最小集，**3–4 人日**。

## 5. 风险与前置

- `0x2CB`（`_this[5037] = op1`，即 `设备[371]`）语义未定 —— 唯一未解的音频邻接指令（**全库 0 处使用**），实施前顺手读掉即可。
- 文本项记录表未建模（`0x1D2` no-op）是 S5 的前置；不影响 S0–S4。
- Electron 自动播放策略：必须在 `app.commandLine` 里关掉手势要求，否则 `AudioContext` 永远 suspended（自动化截图/无输入场景会静音）。
- 音量/开关的**配置读写已实现**（`config-read.ts` 的 `0xC5/0xC7` + 设置页保存），所以设置页的滑块与开关**已经能持久化**；缺的只是「让它们真的影响声音」。

## 6. 与数据层的对应

- 第二层能力（缺口判定）：`audio-module-topology-and-volume-routing`、`voice-request-deferral-and-adv-gate`、`frame-pump-sound-channels`（每帧 SE 延迟播 + 3 路语音泵）、`frame-pump-music-fade`、`audio-device-init`。
- 第一层函数：`analysis/functions.json` 的音频族（含 `0x4B70B0`=SetVolume / `0x4B7110`=SetPan / `0x4B6940`=pan setter 等 60+ 条）。
- 第三层脚本：`SYSTEM4`（三路语音 pan 归中子程序）、`SELFONT`/`CONFIG2`（UI 反馈音）、`SP2563`（音效/语音惯用法）。
