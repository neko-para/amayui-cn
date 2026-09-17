# T-0057 changes —— 实施记录

> 全部改动都在 `app/amayui-emulator`（+ 数据层/文档/票据）。判据统一为
> `cd app/amayui-emulator && npm run verify`（3×tsc + `npm test` + 死写棘轮）。
> **终态：603 pass / 0 fail / 9 skip（612 条）**；改动前基线是 604 条中 **1 fail**（`ticket-ledger.test.ts` 的
> T-0054 `.tmp` 证据文件不存在）⇒ 本轮同时把预红项修掉。

## 第 1 次变更：R3 修 `0x1F5` 的字节偏移/dword 下标混用（真 bug）

- **改前**：`src/vm/handlers/frame.ts` 的 `op_frame_countdown` 用 `engineValues.get(429756)` / `set(429752, 0)`。
- **证据（raw）**：`sub_41A0E0`（0x1F5）是 `v1 = *(_DWORD *)(_this + 429756)`（`_this` 为 `int`，**字节**寻址）
  ⇒ 下标 `107439`；清的是 `*(_DWORD *)(_this + 429752)` ⇒ 下标 `107438` —— 与 `sub_41A090`（0x1F4）的
  `_this[107439]/[107438]` **是同一对格**（raw 25200-25234）。
- **实测（本会话探针）**：两次 `i1f4` 后 `107439=1`、`92333` 停在第一次的值；`i1f5` 后 `107439` 仍为 1、
  `429756=undefined`（读的是幽灵键）。
- **改法**：两处改用 `ENGINE_FIELD.frameCount/frameTickLock`；`0x1F5` 释放锁后 `0x1F4` 恢复刷时钟。
- **守卫**：`test/engine-field-ids.test.ts` 的「0x1F4 / 0x1F5：停靠锁 + 帧计数 + 时钟刷新成对」。
- **顺带同型修正**：`0x7B`/`0x199` 的「重显示游标」值 = **dword 偏移**（引擎 `ip = base + 4*游标`），
  旧实现当数组下标直接 `c.jump()`（真语料 `$1$SC0330.txt:42` 的 `i07b label_000036a4` + `i199` 会跳错位）。
  现在经 `dwordToInstr` 换算（与 `call`/`ret` 同口径），`122453` 写「指令 dword 偏移 + 1」。
  守卫 `test/op-a2-a3.test.ts`（该用例原先把错误模型钉死了，已按订正重写）。

## 第 2 次变更：R2 引擎字段单一真源（`ENGINE_FIELD` 表 + 68 处裸字面量清零）

- `src/vm/engineFieldIds.ts` 重写为 `ENGINE_FIELD`（`as const`，60+ 字段，分组 + 逐条语义/写者/读者；
  旧 8 个 `FIELD_*` 导出保留为 `@deprecated` 别名）。
- 机械替换 `src/vm/**` 的 `engineValues.get/set(<数字>)`（脚本 `.tmp/replace-fields.mjs`，逐个数字→常量映射），
  涉及 frame/engine-fields/msgwin/audio/text-items/panel/gfx-state/input/control + `route.ts` 的面板常量。
- 顺带：`TEXT_BASE_GATE`、`LOAD_IN_PROGRESS_FLAG` 改为引用 `ENGINE_FIELD.*`；删 `ENGINE_FIELD_STORE` 的死 spec
  （`0x107` 的 `map:{2:-1}`，该 opcode 注册的是专用 handler）、`field < 0` 分支与无人用的 `after` 钩子；
  `op_get_engine_value` 改成 `ENGINE_FIELD_GET` 表驱动。
- **守卫**：`test/engine-field-ids.test.ts` 的两条（关键取值锚点 + ratchet「不得再出现裸数字键」）。
- **数据层**：`analysis/fields.json` 补 `frame_tick_lock`(0x68F70) / `frame_count`(0x68F74)。

## 第 3 次变更：R1 配置键单一真源（3 个幽灵键修正 + `cfgEquals`）

- `src/configRegistry.ts`：新增 `CFG` 键常量表、`cfgSoundVolumeKey(n)`、`DYNAMIC_INI_KEY_PATTERNS`、
  `isRegistryKey/isDynamicIniKey`，以及**模块加载期自检**（`CFG.*` 必须在权威键表里）。
- `src/engineConfig.ts`：新增 `cfgBool`（非 0）与 `cfgEquals`（精确相等）；绑定表与两键门改用 `CFG.*`；
  `font:antialias` 这个"合成标签"改成不带 `section:` 形态，避免被守卫误判。
- **修正的幽灵键**（raw 里 0 次 ⇒ 恒读 fallback）：
  | 旧 | 新 | 引擎判据 |
  |---|---|---|
  | `set:keepmusicvoice` | `set:KeepMusicVolume`（raw 4411） | `== 1`（raw 29769-29777） |
  | `set:cancelmessagekey` | `set:CancelMesSkipOnClick`（raw 4346） | 门是**非 0**（raw 20115）；`== 2` 只是门内收尾分支 |
  | `set:controldisibiecursor` | `set:ControlDisibleCursor`（raw 4348） | 非 0（raw 20246/20335） |
  另修 `audioBootIntents` 的 `num()` 未小写化键的隐患，并把策略判据从"非 0"改成 `== 1`（与 `op_play_bgm` 同口径）。
- 删掉 `handlers/audio.ts` 的两份私有 `cfgBool/cfgNum` 与 `handlers/resource-usage.ts` 的私有 `cfgInt`。
- **守卫**：`test/config-keys.test.ts`（静态扫 `section:key` 字面量，**先剥注释** —— T-0039 的教训；
  ∪ 动态键白名单 ∪ 显式豁免；另测 `cfgBool/cfgEquals` 语义）。
- **测试同步**：`test/audio-opcodes.test.ts` / `test/audio-engine.test.ts` 的 fixture 由 `KeepMusicVoice`
  改为真键 `KeepMusicVolume`；`test/adv-msgwin.test.ts` 的手工 values Map 改用小写真键。

## 第 4 次变更：R4 静默错值（getter 读真字段 / C 截断取模 / 除零统一）

- `0x106` → `Engine[550]`、`0x201` → `Engine[166964]`（DrawMode）：raw 39043/39862 + opcode-table:214/345；
  不再 `v = 0` 伪造（未定位的 getter 未进表 ⇒ 直接抛错）。
- `0x53/0x54`：`intDiv/intMod` 共享原语 = **C 截断**（`-5 % 3 = -2`）+ 除零抛错（此前 div 静默 0、mod 静默 NaN、
  random 抛，同族三种处理）。守卫见 `test/engine-field-store.test.ts` 新增两条。

## 第 5 次变更：R5 删临时物与死码（保守清单）

| 删除 | 依据 |
|---|---|
| `src/tools/t0042c-colors.ts` | T-0042 的一次性探针；0 import、0 npm script；refactor-plan 明写"探针不进 src" |
| `src/vm/lzss.ts` + `src/script/lzss.ts` → `src/util/lzss.ts` | 同一 LZSS 两份实现（改一处漏一处）；保留版还带 `(dat as any).state` 残留与零引用导出 |
| `ScriptReset`（含 `StopReason='reset'`、4 处测试 catch、session/report/run 的分支） | `grep "new ScriptReset"` = 0：`op_exit_script` 改为重载根脚本后 `jump(0)`，该信号永不抛 |
| `stubs.ts` 的 7 个死 `case`（0xB4/0xBF/0xC4/0x1FB/0x1F9/0xCD/0xC8） | 全部早已转真实现，唯一活的 0x308 原本落在 `default` |
| `FACE_MAP`/`DEFAULT_FAMILY`/`defaultFamilyOf`/`SAVE_SUBDIR`/`affineLerp`/`idClassOf`/`PANEL_FIELD`/`AUDIO_VOLUME_MAX`/`ENGINE_MSG_HWND_FIELD` | 全仓（src/test/tools/electron/control）零引用 |
| `strings.ts` 的悬空段头/无指代注释、`readTextSkipOf`/`globalFontSnapshot`/`textRecordingEnabled`/`op_sort_index_arrays`/`AGERC_MODULE_NAME` 的 `export`、`gfx-state.ts` 的 `const e = …; void e;`、`save-slot.ts` 的摇树防护再导出 | 分文件重构残留 |
| `gameStartChain.ts` 的 `void clock/harness` | `harness` 后面其实在用（假引用）；`pumpFrames` 接回 `GameStartResult.hoverLeaveFrames` |

**保留未做**（需要行为决策，已在 `notes.md` 记录）：`0x308` 的 `_this[1954]` 语义、`stubs.ts` 之外的
`AMYTH1` 缩略图格式、BGM 的"退回统一 id"兜底、`forceAdvance` 不压返回点、猴补 `setVertexColor` 等。

## 第 6 次变更：R6 修预红项（evidence 不得指 `.tmp/`）

- `T-0054` 的 E4 证据（`.tmp/l2dfix-0-title.png`）与 `T-0056` 的现场日志（`.tmp/amayui-emulator.log`）
  改锚 `tickets/<ID>/notes.md`（内容已抄进 notes，附复现命令）。
- 锚点棘轮按设计报了 `T-0031` 与 `T-0057` 的漂移（我改了它们锚定的代码）⇒ 逐条刷新到新位置。
- `tickets.js --validate` → ✅ 57 张全过；`node scripts/build-tickets.mjs` 重建看板。

## 第 7 次变更：R7 文档/数据层

- `analysis/fields.json`：+`frame_tick_lock` / `frame_count`（dword 107438/107439 = 字节 429752/429756）。
- `docs-new/03-engine/opcode-table.md`：`0x54`（C 截断 + 除零）、`0x1F4`/`0x1F5`（字节↔下标换算与订正）、
  `0x201`（DrawMode / 不再恒 0）加订正注。
- `docs-new/04-app/emulator.md`：测试数更新为 612；§3.2 增两条"单一真源"纪律（`ENGINE_FIELD` / `CFG`）。
- `docs-new/04-app/emulator-refactor-plan.md` §9：本轮条目（新条目置顶）。

## 终态验证

```
cd app/amayui-emulator && npm run verify
→ 3×tsc 干净；tests 612 / pass 603 / fail 0 / skip 9；死写棘轮"无新增"
node .agents/skills/amayui-ticket-ledger/scripts/tickets.js --validate → ✅ 57 张
node scripts/build-tickets.mjs → 看板 57 张
```
