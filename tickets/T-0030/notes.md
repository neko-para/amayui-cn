# T-0030 · 过程文档（notes.md）

## 2026-09-14

## 定因（早退把两条持久化通路一起跳过）

`src/renderer/app/configBoot.ts` 的 `loadEngineConfig()`：

```ts
17:  if (!ini) {
18:    trace('[config] 未找到 SYS4REG.INI（引擎字段用默认值）');
19:    return;                        // ★★ 早退
20:  }
...
31:  e.onConfigChanged = (c) => { … }  // 配置回写（SYS4REG.INI）
57:  await loadSaveData(e, trace);     // ★ SAVE.DAT 装载（save-int/save-string 两张表）
74:  e.onSaveDataChanged = () => { … } // ★ SAVE.DAT 回写接线
```

⇒ 无 INI ⇒ 57/74 都不执行 ⇒ ①启动时表是空的（`SYSTEM4.txt:71 load-int (global 5)` 读 0）
⇒ 每次走 `INITCONFIG`+`INITCHARM`（`:78-79`）覆盖玩家数据；②`save-int` 改动不回写（`:81` 那次也丢）。
INI 又只能由 `onConfigChanged` 写 ⇒ **死循环**，首次运行的环境永远无法自愈。

## 实测（Electron 产品路径，可复现）

```bash
cd app/amayui-emulator
ELECTRON_DISABLE_SANDBOX=1 npm run shot -- --gamestart --name savecheck
grep -nE "^\[config\]|^\[save\]|save data" ../../.tmp/amayui-emulator.log
ls -la "../../.tmp/appdata/Eushully/天結いキャッスルマイスター.overlay" 2>&1
```

结果：日志只有 `[config] 未找到 SYS4REG.INI（引擎字段用默认值）`，**没有 `[save]` 行、也没有 `[main] save data <-`**；
overlay 目录**不存在**。而这次运行确实执行了 `INITCONFIG`/`INITCONFIG0..5`（日志 `[call-script] 0x51dc/0x51d3…` 可见）
——本该触发 `save-int (global 5) 1` 的写盘。

## 为什么一直没被发现（两条）

1. 有真游戏存档目录的环境（`%LOCALAPPDATA%\Eushully\…` 里有 `SYS4REG.INI`）不走早退，通路是通的；
2. `analysis/engine-capabilities.json` 的 `save-data-tables-persistence`（E3，守卫 `test/save-data.test.ts`）
   验的是**编解码 + 两张表**本身，没有覆盖"宿主 boot 里无 INI"这条分支 ⇒ 守卫绿、缺陷在。

## 修法方向（留给实现）

把 SAVE.DAT 那一段（`loadSaveData` + `onSaveDataChanged`）从 `if (!ini) return` 的**后面**提到**前面/并列**：
无 INI 时 `e.config` 保持 undefined（`cfgInt` 已有缺省回退，现有测试已覆盖"无配置"路径），
但 SAVE.DAT 的装载与回写必须照常接线。改完补一条"无 INI 也能装载+回写"的守卫，并在
`save-data-tables-persistence` 的 note 里写清这条前提。
