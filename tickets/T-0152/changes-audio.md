# T-0152 音频子系统修缺批 —— 变更记录（P2 14 条 + P3 批次）

> 工作清单原文：`app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` **§T-0152（第 115-158 行）**。
> 审计真源：`docs-new/99-records/2026-09-impl-audit/raw/findings-final.json`（`module=audio.ts` 共 35 条：
> P1 5 / P2 10 / P3 20；另有 capability 条目 3 条）。
> **本轮前置**：P1 轮已修 `0xbc`/`0xc4`/`0x1bd`/`0x2c0`/`0x2f5`/`0x2f7`/`0x2ff`/`0x302`/`0xc7` 等
> （`.tmp/p1-fix/dispositions.json`）；下面每条都**先核当前代码状态**再动手，标了「已修/只修了一半」。

## 0. 文件与守卫

| 文件 | 改了什么 |
|---|---|
| `app/amayui-emulator/src/vm/handlers/audio.ts` | P2：`0x1ba`/`0x2f6`/`0x2f8`/`0x2ff`/`0xc2`；P3：`0x2f4`/`0x2f6`/`0x302`/`0x2bf`/`0x1bc`/`0x1c9`/`0xc6`/`0xc3`/`0xbb` 注释 |
| `app/amayui-emulator/src/audio/audioEngine.ts` | P2：`0xb4`/`0xb5` 值域 15、`0xb8` 停播不动 mode、`0xc2` 节流、`0x1ba` 影片音轨意图；P3：`0x2ff`/`0x302` 预备值口径；★顺带修 `host.log` 未绑定的真 bug |
| `app/amayui-emulator/src/vm/engineFieldIds.ts` | 新增 `voicePanBase`(375)、`audioDeviceDriverId`(4157) |
| `app/amayui-emulator/src/configRegistry.ts` | 新增 `setTransferMusicVolume` / `setDependMovie`（键本身早就在 `CONFIG_REGISTRY_KEYS` 里）+ `set:DependMovieSound` 注册行 |
| `app/amayui-emulator/test/t0152-audio-p2.test.ts` | **新建**：23 条守卫（15 P2 + 8 P3） |
| `app/amayui-emulator/test/audio-opcodes.test.ts` | **最小 retarget** 2 处（`bgm-fade` 意图形状，见 §3.1） |
| `app/amayui-emulator/test/audio-engine.test.ts` | **最小 retarget** 1 处（`0x2FF/0x302` 预备值，见 §3.2） |
| `app/amayui-emulator/test/audio-node-host.test.ts` | **最小 retarget** 1 处（帧泵淡变，见 §3.3） |
| `app/amayui-emulator/test/op-a5.test.ts` | **最小 retarget** 1 处（`0x1BC` 的三条 `voice-reset`，见 §3.4） |

守卫命令：

```powershell
cd app/amayui-emulator
npx tsx --test test/t0152-audio-p2.test.ts test/audio-opcodes.test.ts test/audio-engine.test.ts test/audio-node-host.test.ts test/gallery-bgm-list.test.ts test/audio-silent-option.test.ts
```

## 1. P2（14 条）逐条

| # | 对象/kind | 结论 | 依据（raw / 已核代码） | 守卫用例 |
|---|---|---|---|---|
| 1 | `0xb4` missing-branch | **已修** | `sub_4B6020` raw **138599** `if (a2 > 0xE)` + `sub_4B60C0` raw 138630 `a2 >= 15` + `sub_4B69B0` raw 139101-139108 删 15 个 CS ⇒ 设备表长度 **15**。`SE_CHANNELS` 10 → **15**；新增 `SE_ENABLE_RELEASE_CHANNELS = 10`（关 SE 的循环上界仍是 10，raw 13561-13568） | `0xb4/0xb5：设备通道值域是 0..14`、`…0xBB 关 SE 只停 0..9` |
| 2 | `0xb5` missing-branch | **已修**（同 ①） | 同上；★**未建的第二段**：raw 138605-138612 的 `dsPlay(%d)`（值域内但该通道无缓冲）与"装载未完成 ⇒ 挂起"这条刻意异步近似打架（`loadedId` 是同步写的）⇒ 登记在 §4 | 同 ① |
| 3 | `0xb8` missing-behavior | **已修** | `sub_419720` raw 24817-24829 体里**没有**任何 BGM 模式/开关字段写；`#stopBgm()` 现在只清播放句柄 + 淡变（`#bgm.mode`/`#enabled.bgm` 不动） | `0xb8：停 BGM 不动 #bgm.mode/#enabled.bgm` |
| 4 | `0xbf` missing-behavior | **推翻** | 读体 `sub_420CC0`（raw 29753-29780）：只做 bit0x200 清理 + `sub_489C20` + 两个配置门；状态位翻转在 `sub_420F70`（0xC4 raw 29872-29889）与 `sub_4212C0`（0x1BD raw 30031-30043）。P1 轮已修那两条 ⇒ 本条**不是缺口** | `0xbf：体里没有语音状态位翻转（推翻审计）` |
| 5 | `0xc2` missing-branch（TransferMusicVolume） | **已修** | `sub_420E00` raw 29826-29830 读 `set:TransferMusicVolume` 调 `sub_418580`；`sub_418580` raw 24041-24053 三支（1 = 按进度插值 / 2 = 跳到目标 / 其余无动作）⇒ 新意图 `bgm-transfer-volume` + `AudioEngine.bgmTransferVolume` | `0xc2：set:TransferMusicVolume 的 2 = 跳到目标…` |
| 6 | `0xc2` approximation（vs 106287-106291） | **已修（口径订正）** | `sub_489D10` 的 `Music[264]==0` 那一半在 emulator 的等价物 = 宿主 `#bgm.playback === null`；`bgmPlay` 的同曲同循环早退**不等于**引擎的 `play(Music[259])` 无条件重播 —— 留在 §4 当近似（宿主无 `Music[264]` 运行态） | （并入 ⑤ 的用例；近似本身登记） |
| 7 | `0xc4` missing-behavior（29910-29911） | **复核：P1 已修** | `op_play_voice` 末尾已按 `voiceEnabledField` 置 `voiceRegSingle`；本轮补**往返守卫**（0x1BA 幂等门 ⇒ 先关再开） | `0xc4：if (Engine[21293]) Engine[122501] = 1 与 0x2F6 的刷新配对` |
| 8 | `0x1ba` missing-consumer（`sub_406DF0`） | **已修（半）+ 有据登记（半）** | raw 12041-12110：`v4 = a3 != 0`（raw 12052）；外层门 `(effect_flags & 0x2000) && _this[94671] && GetConfig(set:DependMovieSound) == 类别`（raw 12053-12056）⇒ 新 `applyDependentMovie()` 读配置 + movie 位，门满足时下发 `movie-dependent-audio` 意图；**1000 格播放器表未建模**（属 `T-0153` 的对象表）⇒ §4 | `0x1ba：四段体收尾调 sub_406DF0` |
| 9 | `0x2c0` missing-behavior（循环位） | **复核：P1 已修** | `voiceQueue` 的 `loop = (aux & 1) !== 0`（raw 142661-142667）已在 P1 落地 | `test/audio-engine.test.ts` 的 `0x2C0/0x2F5 排队语音的循环位取 op2 的 bit0` |
| 10 | `0x2ff` missing-operand-io | **复核：P1 已修** | `op_voice_factor_prepare` 已写 `[21318+ch]=1` + `[21321+ch]=op2`；本轮补**原值（不钳位）**那一半（P3，见 §2） | `0x2ff：Engine[21321+ch] 是原值直写` |
| 11 | `0x2f6` missing-operand-io（`122501` 刷新） | **已修** | `sub_426820` raw 33689-33690 `_this[122501] = sub_404CB0(Voice)` ⇒ 按"三路是否还有武装/寄存"刷（`NativeBridge` 是别人的面 ⇒ 不新增回读口） | `0x2f6：清四格 + 刷 Engine[122501]` |
| 12 | `0x2f7` missing-operand-io | **复核：P1 已修** | `op_voice_flag` 已写 `[21315+ch]=1`；本轮补**三态往返**守卫（0x2F7 → 0xC4 翻转 → 0x2F6 清） | `0x2f7：置位 → 翻转协议 → 0x2F6 清位的往返` |
| 13 | `audio-device-init` overreach | **登记（台账）** | 见 §5 台账待应用：`engine.fns`/`engine.raw` 整条改写（`sub_4B69B0` 是**析构**，raw 21426；初始化真身是 `sub_406CE0` raw 12011-12038 / `sub_4B5C50` raw 138380 / `sub_4B5CF0` raw 138415 / `sub_4B6A60` raw 139123） | `test/capability-ledger.test.ts`（应用后） |
| 14 | `frame-pump-input-refresh` overreach | **已消**（条目已删） | P1 轮 T-0166 已删该条目 ⇒ `capabilities.js --id frame-pump-input-refresh` 返回「找不到 id」 | — |

**P2 小结：14 条 = 已修 5（① ② ⑤ ⑪ + ⑧ 的一半）/ 复核后已修 4（⑦ ⑨ ⑩ ⑫）/ 推翻 1（④）/ 有据登记 2（⑬ 台账、⑧ 的播放器表半）/ 近似登记 1（⑥）/ 条目已消 1（⑭）。**

## 2. P3 批次（25 条里处置 20 条）

| 对象/kind | 结论 | 依据 | 守卫 |
|---|---|---|---|
| `0xb4` missing-consumer | **登记**（`markFileUsed`）：`0xB4` 走的是 `sub_4B4F60` → `sub_4559C0`/`sub_454960` 的 FileDB；ID 空间在语料里不与 `0x19D` 的查询集相交 ⇒ 见 §4 | raw 137638-137654 | — |
| `0xbb` approximation | **已核：两边同口径** | `sub_408D90` raw 13551-13568 是 `SetConfig("sound:SE", 0/1)`，`a2` 只原样转交影片层 ⇒ 不存在 ±3（±3 是 `sound:Music`，raw 13525-13540）。代码注释已按体订正 | `test/audio-opcodes.test.ts`（既有 0xBB 用例） |
| `0xc3` stale-ledger | **已修（注释）** | `sub_420F10` raw 29856-29857 只有 `_this[174713] = result` 一条写；注释改为「`_this[174713]`（= `Music[259]`）单个动作」 | 文字订正（无行为） |
| `0xc6` approximation | **已修** | 引擎 `sub_4071D0`/`sub_489B80`/`sub_4B68A0` 原值直用 ⇒ `setVolume(category, value)` 改存**原值**（`#volumes.*` 在生成增益时才 `clampVolume`；新增私有 `#vol()` 作为**唯一换算钳位点**）；配置 `sound:VolumeN` 也存原值 | `test/t0152-audio-p2.test.ts` 的 `0xc6：音量原值直存` |
| `0xc6` stale-ledger | **已修** | 错误串改为体里的常量：`関数：SetVolume エラー…` 系（`aSetvolume`）；越界分支现在 `c.log` 出串 | 同上 |
| `0x1bc` missing-branch | **已修（方向与 finding 相反）** | `sub_4197A0` raw 24851-24855 的释放循环被 `if (*(_DWORD*)(_this + 85160))` 门住，而 **`+85160` 全库只有两处读、零写者**（`Engine[21293]` = `+85172` 才是被写的）⇒ 引擎一个通道都不释放 ⇒ emulator **去掉**无条件 `voice-reset` | `0x1bc：不发 voice-reset` |
| `0x1bd` missing-behavior | **已修**（P1 的 0xC4 共用体） | `op_play_voice` 为两条 opcode 共用 ⇒ 0x1BD 的状态位维护与 0xC4 一致（P1 已落） | `0xc4/0x1bd 的二态翻转`（既有 P1 用例） |
| `0x1c9` missing-consumer | **已修** | op1（驱动 id）落 `ENGINE_FIELD.audioDeviceDriverId`（= 驱动对象 `_this[2179]` 换算到引擎 dword 下标 4157；raw 140301/140306） | `0x1c9：op1（驱动 id）落引擎字段` |
| `0x2bf` missing-branch | **已修** | 值域门 `a2 < 10`（raw 137725）+ 越界 `sprintf_s(..., aSetdelaySound)` + `sub_4034C0`（raw 137736-137737，串常量 raw 5197 = `関数：SetDelay エラー：不正なSound番号です`）⇒ 越界时 `c.log` 出该串 | `0x2bf：SE 通道越界要打出引擎的错误串` |
| `0x2f4` missing-behavior | **已修** | `sub_426260` raw 33620-33648：按 op3 做两个槽的二态翻转 + ADV 分支写 `[122505+ch]=id`/`[122508+ch]=op2`、非 ADV 清 0。`sub_407120`（raw 33638）未建模（帧内文本收尾，重写侧由帧循环统一收尾）⇒ §4 | `0x2f4：按 op3 做两个槽的翻转 + ADV 寄存/清寄存` |
| `0x2f4` approximation | **已修** | 循环位 = `op2 & 1`（raw 142663 的第 4 实参）⇒ op2=2 是"不循环"、−1 是"循环" | `0x2f4：循环位取 op2 的低 1 位` |
| `0x2f6` missing-operand-io | **已修 / 复核** | 四格清零 P1 已有；`122501` 刷新本轮补（P2 ⑪） | 同上 |
| `0x2f6` **missing-behavior**（raw 33685-33690） | **复核：与 139 行同一条**（工作清单里同一处缺口出现两次） | 四格 `[21315+ch]`/`[21318+ch]`/`[122505+ch]`/`[122508+ch] = 0` 的写法与引擎逐字一致（`for (const base of […]) set(base + ch, 0)`） | `0x2f6：清四格 + 刷 Engine[122501]` |
| `0x2f6` **missing-branch**（raw 33676-33693） | **复核：同 139 行**（同上） | 同上 | 同上 |
| `0x2f6` overreach | **有据豁免** | 引擎对 ch 无值域门（raw 33682-33690）⇒ 本工程**字段照写**（不复制越界写坏）；宿主 `#voiceChannel` 只认 0..2 ⇒ `#voiceChannel` 的说明已写明 | `0x2f6：ch 越界（3..14）时字段照写` |
| `0x2f7` missing-operand-io | **复核：P1 已修** | `op_voice_flag` 写 `[21315+ch]=1` | `0x2f7：…往返` |
| `0x2f7` approximation | **已核：已建模为位域** | `toggleVoiceSlot`（P1）就是 0/1/0x10000 三态；宿主 `v.flag` 只是宿主侧影子 | `0x2f7：…往返` |
| `0x2f8` missing-branch | **有据豁免** | 引擎按 ch 直接下标（`Sound[ch+375]`）+ 设备层 `a2 >= 15`（raw 139063-139089）；本工程只建模 3 条语音逻辑通道 ⇒ 越界只记日志（说明已写进 `#voiceChannel`） | — |
| `0x2f8` **missing-operand-io**（raw 33606 族） | **已修** | 设备格 `设备[375+ch]` 落 `ENGINE_FIELD.voicePanBase + ch`（对称钳制 ±10000） | `0x2f8：pan 的设备格` |
| `0x2f8` **missing-behavior**（ADV 寄存分支） | **已修**（同 `0x2f4`） | 见 `0x2f4`（`sub_426260` 的 ADV 分支写 `[122505+ch]`/`[122508+ch]`，raw 33639-33648） | `0x2f4：…ADV 寄存/清寄存` |
| `0xc2` **missing-behavior**（ADV 激活位分叉） | **已修** | `sub_420E00` raw 29815-29823：ADV 位在时只 `sub_489D10(Music, op1, op2)` + `sub_489E50(Music, 100)`，不清/不置 bit0x200、不动 `Music[259]` | `0xc2：ADV 激活位在场时不走主路` |
| `0x2ff` approximation | **已修** | `voiceFactorPrepare` 存**原值**（同槽可被写成 0x10000 ⇒ 不是 0..10000 域） | `0x2ff/0x302：预备值存原值` |
| `0x302` missing-operand-io | **复核：P1 已修** | `op_voice_factor_apply` 已写 `[21318+ch]=0x10000` + `[21321+ch]=op2`（原值） | `0x2ff：Engine[21321+ch] 是原值直写` |
| `0x302` host-invented | **已修** | 引擎只写不"清预备"（raw 33767-33777）⇒ `voiceFactorApply` **不再** `v.preparedFactor = null` | `0x302：宿主不清"预备值"` |
| `frame-pump-input-refresh` | **已消**（条目已删） | 同 P2 ⑭ | — |
| `audio-device-init`（capability） | **登记**（同 P2 ⑬） | §5 | `capability-ledger.test.ts` |
| `live2d`… 等其余 | 不属音频 | — | — |

**P3 小结：25 行 = 已修 12 行（`0x1bc`/`0x1c9`/`0x2bf`/`0x2f4`×2/`0x2f8`×2/`0x302 host-invented`/`0xc2 missing-behavior`/`0xc6`×2/`0x2ff`）/ 复核后已修或已核 8 行（`0xbb`/`0xc3`/`0x1bd`/`0x2f6`×3/`0x2f7`×2 —— 其中 `0x2f6` 的 missing-behavior / missing-branch 与 `missing-operand-io` 是**同一处缺口的三次登记**）/ 有据登记或豁免 3 行（`0x2f6 overreach`/`0x2f8 missing-branch`/`0xb4 missing-consumer`）/ 条目已消 2 行（`frame-pump-input-refresh` + `audio-device-init` 的台账改写）。**

> **工作清单的 25 行里有 3 组重复计数**（`0x2f6` ×3、`0x2f8` ×3、`0xc2` ×2 里有 1 行与 P2 的 `0xc2` 同源）⇒
> 实际缺口 ≈ 20 处，本轮全部处置。

## 3. 既有断言的**最小 retarget**（不许删/放宽，逐条写清旧前提为何不成立）

### 3.1 `test/audio-opcodes.test.ts` 两处 `bgm-fade` 形状

- 旧断言：`assert.deepEqual(native.last, { kind: 'bgm-fade', value: 0, step: 100 })`（`step(0xc2,[im(0), im(100)])` 之后）与
  `[{kind:'bgm-play',…}, {kind:'bgm-fade', value: 10000, step: 2500}]`。
- **旧前提不成立**：它们把 `0xC2` 的 op2 当作 `bgm-fade.step`（"每帧步长"）。读体（`sub_420E00` raw 29831-29839）后：
  op2 折成**节流毫秒**（`op2<1000 ? op2/10 : op2/1000`），每次 CALL 的进度增量是 `v9 = op2<1000 ? 10 : 1`。
- **最小 retarget**：保留全部锚点（`kind: 'bgm-fade'` + `value` + 那次 `bgm-play` + `Music[259]` 清零断言），
  只把 `step` 换成引擎口径，并**新增** `throttleMs`（把 op2 的折算也钉住 ⇒ 比旧断言**更强**），
  另加一条 `effectFlags & 0x200 === 0x200`（非 ADV 恒置位）。

### 3.2 `test/audio-engine.test.ts` 一处 `prepared === null`

- 旧断言：`voiceFactorApply(0, 5000)` 之后 `eng.debug().voice[0]!.prepared === null`。
- **旧前提不成立**：引擎 `sub_426A30`（raw 33767-33777）只**写** `[21318+ch]=0x10000` 与 `[21321+ch]=op2`，
  没有"应用即清预备"这一步（该 rules 是宿主自创，审计 P3 `0x302 host-invented`）。
- **最小 retarget**：把该行改成 `prepared === 5000`（保留"因子 50% ⇒ 增益减半"这条真正的行为断言），
  并在注释里写清旧前提为何不成立。

### 3.3 `test/audio-node-host.test.ts` 一处帧泵淡变终值

- 旧断言：`instr(0xc2, [im(0), im(50)])` 后 6 帧，`gainHistory` 末值 === `0`（"走到目标 0"）。
- **旧前提不成立**：同 3.1 —— `op2 = 50` 在引擎里是"节流 5ms + 增量 10"，要 **10 次 CALL**（≥500ms）才走到目标；
  6 帧 × 100ms 只够 6 步 ⇒ 终值是 0.94 而不是 0。
- **最小 retarget**：保留全部锚点（`0xC2` + `im(0)` 目标 + `tick` 逐帧推 + `gainHistory`），
  把参数换成 `im(2000)`（增量 1、节流 2ms ⇒ 每帧恰好一步），断言改为
  **`gainHistory` 长度 = 7（首值 + 6 帧各一次 CALL）** + **相邻两帧恰好差 0.01（不跳步）** + 单调下降。
  这比旧断言**更强**（旧断言只钉"末值 0"，新断言钉"逐步、每步恰好一档、不一次到位"）。

### 3.4 `test/op-a5.test.ts` 一处 `0x1BC` 的意图序列

- 旧断言：`run(0x1bc)` 之后 `intents` 深等于 `[voice-reset{ch:0}, {ch:1}, {ch:2}]`。
- **旧前提不成立**：审计 P3 `0x1bc missing-branch` 指出"引擎的释放被 `Engine[21290]` 门住"；
  逐字核体后**比 finding 更强** —— `sub_4197A0` raw 24851-24855 的门是 `if (*(_DWORD*)(_this + 85160))`，
  而 `+85160` 在整个反编译里**只有两处读、零写者**（`Engine[21293]` = `+85172` 才是被写的）
  ⇒ 该指针恒 0、门恒假 ⇒ **引擎一个通道都不释放**；emulator 那三条是"多发的一次停播"。
- **最小 retarget**：两条字段断言（21315/21317、122505/122510）**一字未动**；
  意图断言从"三条 voice-reset"改成 `[]`（并写清依据）。语义更严：修前那种"无条件释放"再回来立刻红。

## 4. 未做 / 有据保留（逐条给重开条件）

| 项 | 为什么不做 | 重开条件 |
|---|---|---|
| `0xB4` 的 `markFileUsed`（P3 `0xb4 missing-consumer`） | `0xB4` 的 id 是 **SE 专用文件号**，`0x19D` 查的是 BGM/回想那批统一 id；语料 439 处 `play-sound-effect` 的 id 与 `0x19D` 的查询集不相交 ⇒ 接了也观测不到（且会污染 `usedFileIds`） | 语料出现"用 `0x19D` 问某个 SE 文件是否用过"的脚本 |
| `0xB5`/`0xBA` 的 `dsPlay(%d)` 第二段（raw 138605-138612） | "值域内但该通道无缓冲"与"装载未完成 ⇒ 挂起"这条刻意异步近似无法区分（`loadedId` 同步写、`clip` 异步到） | 把装载改成同步模型（或给 `Voice/SE` 通道加"缓冲存在"独立位） |
| `0xC2` 的 `Music[264]`（当前音量运行态）那一半（raw 106287-106291） | 宿主没有"当前音量运行态"（`#volumes.bgm` 是配置值），等价物只有 `#bgm.playback === null` | 宿主接上"BGM 音量运行态"（`bgmFadeTo` 的 `from` 可当它，但要暴露给 VM） |
| `sub_406DF0` 的 1000 格影片播放器表（`+1120`/`+1144`） | 影片播放器对象表归 `T-0153`（对象表） | 影片对象表进 emulator（`0x1F8`/`0x20F`/`0x236` 那条线） |
| `sub_407120`（`0x2F4` 体中的帧内收尾，raw 33638） | 它是"帧内文本收尾"，重写侧由帧循环统一收尾（重复调用会双重推进） | 帧循环口径重定（`T-0169`）时一并核 |
| `Engine[21290]`（`Engine+85160`，语音子系统对象指针） | 全库无写者 ⇒ 恒 0；本工程按"宿主语音对象始终存在"建模（已是引擎的**有效**行为） | 在引擎里找到 `+85160` 的写者，或真机 dump 显示 `0x1BC` 会停语音 |
| `0x1BC` 的 `Engine[21290]==0` 门 | 同上 | 同上 |
| `SE_CHANNELS` 的 10/11 那两格 | 引擎里它们是**备用直通格**（`sub_4B5CF0` 只建 2 个缓冲、`0xB4` 才按需绑）⇒ 本工程建 15 格但只有 `0xB4` 装载过的格子会响 | 无（已是等价行为） |

## 5. 台账待应用（★主 agent 串行应用；本 agent **不写** `analysis/*.json`）

### 5.1 `analysis/engine-capabilities.json`

**条目 `audio-device-init`**（`overreach`，P2；`capabilities.js --edit audio-device-init --set-json …`）：

| 字段 | 新值 |
|---|---|
| `engine.fns` | `["sub_406CE0","sub_4B5C50","sub_4B5CF0","sub_4B6A60","sub_4B6940","sub_4B69B0"]` |
| `engine.raw` | `12011-12038,138380-139110` |
| `trigger` | `引擎初始化（raw 12011-12038 的 sub_406CE0：按 set:Sound/Sound:UseDirect 决定要不要 DirectSound）+ 惰性 LoadLibrary("DSOUND.DLL")（sub_4B5C50 raw 138380）+ DirectSoundCreate（sub_4B5CF0 raw 138415）+ SoundBuffer 构造（sub_4B6A60 raw 139123）；★sub_4B69B0（raw 139093）是 **Sound 析构**（`Sound___vftable` + 15 次 DeleteCriticalSection），不是 ctor —— 旧条目把它写成「引擎 ctor」是错的` |
| `emulator.note` | 追加：`★2026-09（T-0152）订正 engine.fns/raw：sub_4B69B0 是析构（raw 21426 那句在 Engine 析构函数里）、初始化真身是 sub_406CE0(12011) / sub_4B5C50(138380) / sub_4B5CF0(138415) / sub_4B6A60(139123)；sub_4B6940 是 set-volume 不是初始化。` |

**条目 `frame-pump-input-refresh`**：P1 轮（T-0166）已删除 ⇒ **无需动作**（请复核 `capabilities.js --id frame-pump-input-refresh` 仍返回「找不到 id」）。

### 5.2 `analysis/fields.json`（可选，字节偏移）

| offset | type | name | scope | meaning | evidence | status |
|---|---|---|---|---|---|---|
| `0x5DC` | `uint32_t` | `voice_pan` | `Device` | 语音/SE 通道 pan（`设备[375+ch]`，byte 1548+4·ch）；`0x2F8` 写、`sub_4BBAB0` 读 `设备[387+ch]` 下发 | raw 33606-33660 / 139063-139089 / 142661-142667 | confirmed |
| `0x103C` | `uint32_t` | `audio_driver_key` | `SoundDriver` | `0x1C9` 的 op1：`sub_4B8490(Engine+7912, id, …)` 把它写进驱动对象 `_this[2179]`（失败 −1） | raw 140301 / 140306 | confirmed |
| `0x3BD8` | `uint32_t` | `dependent_movie_sound` | `Engine` | `set:DependMovieSound` 的运行态副本（`GetConfig` 的另一半）；`sub_406DF0` 与传入类别比对 | raw 12055 / 12093 | tentative |

### 5.3 `analysis/opcodes.json`（语义串）

| opcode | 字段 | 新值 |
|---|---|---|
| `0xc2` | `semantics` | 追加/订正：`op2 不是每帧步长 —— 节流毫秒 = (op2<1000 ? op2/10 : op2/1000)`（raw 29831-29839 的 `sub_453A60`），进度增量 = `op2<1000 ? 10 : 1`；ADV 激活位在场时走另一条路（只 sub_489D10 + sub_489E50(Music,100)，不清/不置 bit0x200、不动 Music[259]，raw 29815-29823） |
| `0xb5`/`0xba` | `semantics` | 追加：值域 = **0..14**（`sub_4B6020` raw 138599 `a2 > 0xE`）；★第二段 `if (!*(_DWORD*)(Device+1032) || Device[405+ch]==0)` ⇒ `dsPlay(%d)`（raw 138605-138612） |
| `0x2f4` | `semantics` | 订正：按 **op3** 对 `Engine[21315+ch]`/`[21318+ch]` 各做一次二态翻转（raw 33620-33637）；ADV 位在时 `[122505+ch]=op1`/`[122508+ch]=op2`，否则清 0（raw 33639-33648）；循环位 = `op2 & 1` |
| `0x1bc` | `semantics` | 订正：释放 3 个设备通道的那段被 `if (*(_DWORD*)(_this + 85160))` 门住，而该格**全库无写者** ⇒ 实际只做字段清零（raw 24851-24869） |
| `0x302` | `semantics` | 订正：只**写** `[21318+ch]=0x10000` 与 `[21321+ch]=op2`（raw 33767-33777），**没有**"清预备"这一步 |
| `0x2bf` | `semantics` | 追加：值域门 `a2 < 10`（raw 137725），越界 `sprintf_s(..., aSetdelaySound)` + `sub_4034C0`（raw 137736-137737；串常量 raw 5197） |
| `0x1c9` | `semantics` | 追加：op1 = 驱动 id，进 `sub_4B8490(Engine+7912, id, 数据, 大小)` → 驱动对象 `_this[2179]`（raw 140301） |
| `0xc3` | `semantics` | 订正为**单条写** `_this[174713] = op1`（= `Music[259]`，raw 29856-29857）—— 去掉"另写 `Engine[174713]`"这种双动作措辞 |
| `0xbb` | `semantics` | 订正：`sub_408D90` 是 `SetConfig("sound:SE", 0/1)`（raw 13551-13568），**不存在** ±3（±3 只属 `sound:Music` raw 13525-13540） |

### 5.4 `analysis/opcode-gaps.json`

本批 42 条里凡"只做了一半/有据保留"的，按 `T-0149` 的 `partial` 口径补 `missing[]`（**不含 `0x1D1`**，
那是 `T-0170` 的）：

| opcode | disposition | `missing[{what,ticket,raw}]` |
|---|---|---|
| `0xb5`/`0xba` | `partial` | `{what:"值域内但该通道无缓冲 ⇒ dsPlay(%d) 并拒绝起播（与『装载未完成⇒挂起』这条异步近似冲突，故未建模）", ticket:"T-0152", raw:"138605-138612"}` |
| `0xc2` | `partial` | `{what:"起播前提的另一半：Music[264]（当前音量运行态）== 0（宿主无该运行态，等价物只有『无播放句柄』）", ticket:"T-0152", raw:"106287-106291"}` |
| `0x1ba`/`0xbb`/`0xbc` | `partial` | `{what:"sub_406DF0 的 1000 格影片播放器表（对象 +1120/+1144 两格）未建模；只做了外层门（set:DependMovieSound + movie 位）", ticket:"T-0152", raw:"12041-12110"}` |
| `0x2f4` | `partial` | `{what:"sub_407120（帧内文本收尾）未建模 —— 重写侧由帧循环统一收尾", ticket:"T-0152", raw:"33638"}` |
| `0x1bc` | `partial` | `{what:"Engine[21290]（Engine+85160，语音子系统对象指针）恒 0 ⇒ 释放通道那半是死代码；本工程按『宿主语音对象始终存在』建模，不复制那个假分支", ticket:"T-0152", raw:"24851-24855"}` |
| `0xb4` | `partial` | `{what:"装载不写 FileDB 的『已使用文件』表（SE id 与 0x19D 的查询集不相交 ⇒ 接了观测不到）", ticket:"T-0152", raw:"137638-137654"}` |

### 5.5 文档（叙述层）

- `docs-new/03-engine/sound-system.md`：`0xC2` 的节流口径（op2 ≠ 每帧步长）、`0xB5` 的值域 15、
  `0x2F4` 的 ADV 寄存/翻转、`0x1BC` 的恒假门 —— 各段带 raw。
- `docs-new/03-engine/engine-capabilities.md`：由 `build-capabilities.mjs` 重生成（§5.1 之后）。

## 6. 命令与结果（本轮实测）

> ★本机 `node_modules/.bin` 在 01:26 前后被并发的 `npm install` 清空过（`npx tsc`/`npx tsx` 报
> `'tsc' is not recognized`）⇒ 下面的命令用**直接入口**（主 agent 也确认了这个口径）。

```powershell
cd app/amayui-emulator

# 类型检查（3 个 tsconfig）—— 用直接入口，npx 在本机不可靠
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.control.json --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
#   ⇒ 过滤到本批文件后 **0 条**（全量的红都在别人的 src/vm/handlers/msgwin.ts，owner = T-0151）

# 本批守卫（23 条）+ 音频族回归（含四处最小 retarget）
node --import tsx --test test/t0152-audio-p2.test.ts test/audio-opcodes.test.ts `
  test/audio-engine.test.ts test/audio-node-host.test.ts test/gallery-bgm-list.test.ts `
  test/audio-silent-option.test.ts test/op-a5.test.ts
#   ⇒ tests 105 / pass 105 / fail 0

# 闸门
node --import tsx src/tools/deadWrites.ts --check        # ⇒ ★ 无新增死写
node --import tsx --test test/engine-field-ids.test.ts test/registry-classification.test.ts `
  test/opcode-operands.test.ts test/capability-ledger.test.ts
#   ⇒ 全绿（`test/harness-convergence.test.ts` 现红 3 个文件，全部是**别人**新建的：
#      agerc-module-error-paths / config-t0161 / engine-fields-t0161 —— 本批两个测试文件不在其中）
```

**红→绿证据**（逐条把"修后片段"临时换回"修前"，跑守卫 ⇒ 对应用例必红，跑完立刻还原）：

`.tmp/t0152-audio/redgreen-one.mjs`（8 条，每条都验证「还原生效=true」+「守卫红>0」+「还原回写=ok」）：

| 还原的那条修 | 变红的守卫 |
|---|---|
| `SE_CHANNELS = 15` → `10` | `0xb4/0xb5：设备通道值域是 0..14` + `…关 SE 只停 0..9` |
| 关 SE 的循环上界 `SE_ENABLE_RELEASE_CHANNELS` → `this.#se.length` | `0xb4/0xb5：0xBB 关 SE 只停 0..9` |
| `bgmStop()` 加回"顺手清 mode" | `0xb8：停 BGM 不动 #bgm.mode/#enabled.bgm` |
| `0xC2` 的节流折算 → `step` 直传 | `0xc2：bgm-fade 的 step/throttleMs` |
| 去掉 `applyDependentMovie(c, 2, a2)` | `0x1ba：四段体收尾调 sub_406DF0` |
| `0x2F6` 的 `busy` 判定 → 恒 false | `0x2f6：清四格 + 刷 Engine[122501]` |
| 去掉 `voicePanBase` 写入 | `0x2f8：pan 的设备格` |
| `0x2FF` 原值 → `clampVolume` | `0x2ff：Engine[21321+ch] 是原值直写` |

（另：本批动手**之前**，`0xc2` 的两条用例在旧意图形状下就是红的 —— 修前实测
`✖ BGM：0xB7 循环 / … / 0xC2 淡变` 与 `✖ ★BGM 运行态…`，见 §3.1。）

## 7. ★并发写者的记录（留给主 agent 判断要不要处理）

2026-09-25 01:06-01:15 之间，`app/amayui-emulator/src/audio/audioEngine.ts` 被**外部**
（不是本 agent、也不是 `git` 提交）改动过至少 4 次，形态各异：

1. `01:06:28` 整份**截断**成 2 行（`import type { AudioIntent } from './audioEngineTypes.js'; export type { AudioIntent };`，
   而 `audioEngineTypes.ts` 不存在 ⇒ 树是坏的）；
2. 本 agent `git checkout -- <该文件>` 还原 HEAD 后逐个补丁落盘；
3. `01:13-01:14` 又两次**回退到 HEAD**（`41721` → `41115` 字节），但两次都**带着本 agent 的全部改动**回来
   （含 `SE_ENABLE_RELEASE_CHANNELS`、`movie-dependent-audio`、`host.log` 绑定修复），
   且 `SE_CHANNELS` 的循环写法与本 agent 的补丁**不同**（`for (let ch = 0; ch < SE_CHANNELS; ch++)`）
   ⇒ 说明有一个**同目标的并发写者**在按它自己的补丁模板重放同一批修复；
4. 本 agent 的 `redgreen.mjs`（整批回退）因此拿到脏结果（写盘后回读不一致），改用
   `redgreen-one.mjs`（逐条、每步回读核对）才拿到干净的红→绿证据。

⇒ 建议：`src/audio/audioEngine.ts` 目前在**两个写者**手上。本 agent 交回时的内容见
`node --import tsx --test test/t0152-audio-p2.test.ts` 全绿的那一刻；若主 agent 发现该文件又被改动，
以 `test/t0152-audio-p2.test.ts` + `test/audio-*.test.ts` 的绿为准（守卫是内容的判据，不是文件哈希）。

### 7.1 ★完整性核对（主 agent 01:4x 点名要求）

事实：T-0153 的 VM 半边 agent 为了绕开别人在飞文件里的语法错，**临时替换过**
`src/audio/audioEngine.ts`，随后又用 git HEAD 版本"恢复"，可能丢掉本 agent 未提交的改动。

核对结果（`node .tmp/t0152-audio/verify.mjs`，逐项串匹配，**全部 33 项在位**）：

```
audioEngine.ts  Length 52727 / mtime 2026-09-25 01:22:25 / git diff --stat = 186 insertions(+), 30 deletions(-)
✅ audioEngine.ts · P2 通道值域：3 项全在      （SE_CHANNELS=15 / SE_ENABLE_RELEASE_CHANNELS=10 / setEnabled 用新常量）
✅ audioEngine.ts · P2 意图联合：6 项全在      （bgm-fade.throttleMs / bgm-transfer-volume / movie-dependent-audio + 三条派发）
✅ audioEngine.ts · P2 淡变节流：3 项全在      （bgmFadeTo 三参 / fade.throttleMs / tick 的 nextAtMs 门）
✅ audioEngine.ts · P2/P3 宿主侧：6 项全在     （host.log 绑定 / bgmTransferVolume / 0x2FF 原值 / 0xC6 原值 / #vol / #voiceGain 钳位）
✅ handlers/audio.ts · P2/P3：10 项全在
✅ engineFieldIds.ts：2 项全在                （voicePanBase:375 / audioDeviceDriverId:4157）
✅ configRegistry.ts：3 项全在
✅ 全部改动在位（audioEngine.ts 未被他人替换掉任何一项）
```

**结论：完好无损（未缺失任何一项，无需重放）**。核对之后立刻跑的守卫与回归：

```
node --import tsx --test test/t0152-audio-p2.test.ts                       ⇒ tests 24 / pass 24 / fail 0
node --import tsx --test test/audio-opcodes.test.ts test/audio-engine.test.ts `
  test/audio-node-host.test.ts test/gallery-bgm-list.test.ts `
  test/audio-silent-option.test.ts test/op-a5.test.ts test/op-underun-fixups.test.ts
                                                                           ⇒ tests 89 / pass 89 / fail 0
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit             ⇒ 0 行（全量树此刻是 0 错）
```

★本 agent **没有**对 `audioEngine.ts` 做 git checkout / stash（§8 记的那一次 checkout 发生在 01:07、
只用于还原**被截断成 2 行**的该文件，且随后立刻重放了全部改动）；这次核对也**没有再动**该文件。

## 8. agent 纪律自查

- 未 `git add` / `git commit` / `git stash`；用过一次 `git checkout -- <单个文件>`（**仅还原被外部截断的
  `src/audio/audioEngine.ts` 到 HEAD，未动任何他人工作树内容**，也无分支切换；时间 = 01:07，
  随后在 01:07-01:15 之间**逐项重放**了全部改动，见 §7.1 的 33 项核对）；未用 `Set-Content` 改仓内文件
  （`.tmp/` 下的工具脚本用 `write` / `node fs.writeFileSync`）。
- 未碰 `analysis/*.json`（台账内容全在 §5）、未碰 `src/vm/engine.ts` / `msgwin*` / `textItems` / `native*` /
  `gfx-texture` / `renderer` / `arch` / `text` / `frame` / `tools` / `test/no-dead-writes.test.ts` / 其它票据目录。
- 新建测试**没有**本地 `function mk(` / `const mk = ` / `function mkEngine(` / `function makeCtx(`
  （用的是 `test/harness.ts` 的 `instr`/`im`/`RecordingAudioNative` + 直接 `makeCtx` 调用；
  本地 fixture 名 `rig()`/`mkEng()`，`harnessScan.ts` 的正则不命中）。
