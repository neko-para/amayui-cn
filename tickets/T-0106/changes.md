# T-0106 · 过程文档（changes.md）

## 2026-09-21

## 2026-09-21

## 第 1 次变更：静音开关落地（选项 + 命令行覆盖 + 宿主门 + 测试默认静音）

### 1. 选项（`src/emulatorOptions.ts`）

- 新增 `audio.enabled`（默认 `true` = 真游戏行为）；解析走既有的"未知键/类型错都报 problem"口径。
- 新增环境变量 **`AMAYUI_AUDIO_ENABLED`**（`AUDIO_ENABLED_ENV`）与三个纯函数：
  - `parseBoolish`（`1/true/on/yes` / `0/false/off/no`；**认不出返回 undefined**，不猜）；
  - `applyEnvOverrides(options, env)`（Node 侧：文件之后套用，返回生效说明行）；
  - `envOverridesOf(env)`（Electron 主 → 渲染的**结构化**传递；不改文件文本，免得抹掉 `$comment`）；
  - `mergeEmulatorOptions(file, overrides)`（渲染侧合并，覆盖优先）。
- `applyEmulatorOptions` 的参数放宽为 `EmulatorOptionsInput` 并在内部 normalize —— 历史调用点会手写半份字面量
  （`{ boot: { showLogo: false } }`），不收宽松输入就会在 `options.audio` 上炸。

### 2. 宿主门（`src/renderer/audio/webAudioHost.ts`）

- `WebAudioHostOptions.silent` + `setSilent(on)`（幂等、**只支持开**；已建过 `AudioContext` 就 `dispose` 关掉）。
- 静音时的行为：`#ensureCtx()` **永不建**（被误调直接抛，提示调用点应先查 `#silent`）、`resume()` 不碰 context、
  `play()` 回 `SilentPlayback`（按墙钟推进 `positionSec`，`setGain/Pan/Loop/Paused/stop` 全是可调的空操作）、
  `streamUrl()` 返回 `undefined`（⇒ 引擎退回 `load+decode+play`，引擎侧同一结局）、`playStream()` 防御性兜底。
  `info().contextState` 在静音时是 `'silent'`。
- `decode()` 在静音时改走 **`audioDurationSec`**（从 `NodeAudioHost` 导入的**同一个**函数：WAV 用 `data/byteRate`、
  OGG 用 granule/采样率）⇒ **时长与真宿主同量级**，`AudioEngine` 判"语音占线/SE 何时释放"的依据不变。

### 3. 接线

| 位置 | 改动 |
|---|---|
| `src/renderer/pixiBackend.ts` | 新增 `setAudioSilent(on)` / `audioSilent()`（转发宿主） |
| `src/renderer/app/boot.ts` | 选项装载后按 `audio.enabled` 运行期切静音（后端建在选项之前，且音频是惰性的、选项在**脚本装载之前** ⇒ 不存在"先响一声"） |
| `src/renderer/app/configBoot.ts` | `loadEmulatorOptionsFile` 改为**返回**生效选项；合并主进程传来的 `envOverrides` 并打生效行 |
| `src/renderer/ipcProtocol.ts` + `electron/ipc/files.ts` | `read-emulator-options` 的载荷加 `envOverrides`（主进程用 `envOverridesOf(process.env)` 解析，并打一行 `[main] … env override`） |
| `src/emulatorOptionsFile.ts` | `loadEmulatorOptions` 套用环境变量覆盖，返回 `envApplied` 并进 `describeEmulatorOptions` |
| `test/options.test.env` | **`AMAYUI_AUDIO_ENABLED=0`** ⇒ 所有测试默认静音（由 `node --env-file=…` 引入，= 用户要的"命令行引入"） |
| `docs-new/04-app/emulator.md` §8 / `emulator.config.example.json` / `emulatorOptions.ts` 文件头 | 选项表 + 专项说明（关掉的是宿主输出、"两个来源是刻意的"、headless 不受影响） |

### 4. 守卫 `test/audio-silent-option.test.ts`（7 条）

① 解析（显式 false 生效；未知键 `audio.enable` / 类型错 `"no"` 都报 problem）；
② 宽松输入 + `mergeEmulatorOptions` 覆盖优先（且默认必须是"出声"）；
③ 命令行口径（`0/off/1/Yes` 与 `maybe → undefined`）+ 覆盖生效行 / 认不出留 problem；
④ `loadEmulatorOptions` 真的套上（临时配置文件 + **显式 env 对象**，不依赖本机环境）；
⑤ 静音宿主：`createContext` 工厂**一次都没被调用**（resume/decode/play 三处都不建）、`decode` 给得出 0.5s、
   句柄可 `setGain/Pan/Loop/Paused/stop` 且 `positionSec()` 有值、`streamUrl` 为 `undefined`、有"静音模式"日志；
⑤反面 非静音宿主**会**建 context（证明门是真的）+ `setSilent(true)` 会 `close` 既有 context；
⑥ 棘轮：`test/options.test.env` 必须含 `AMAYUI_AUDIO_ENABLED=0`，且 `package.json` 的 `test` 脚本必须用 `--env-file` 引入。

### 5. 判据对照

全部达成：`npm run verify` 全绿（typecheck ×3 + 全量测试 + 死写闸门）；四份台账 `--validate` 绿。
★注意 `applyEmulatorOptions` 的宽松化让既有的 `test/emulator-options.test.ts`（手写半份字面量）继续通过。
