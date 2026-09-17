# T-0056 过程笔记 —— 读档崩在 `Depth が不正です` + 控制面版看不到错误

## 1. 现场（用户给的两条信息都很关键）

`.tmp/amayui-emulator.log`（boot harness，目标 = 跑到 SAVE.BIN）：

```
1798: [audio] SE ch1 起播 id=50                 ← SAVE.txt:922 play-sound-effect 32 1（读档 YES 分支）
1799: bindTexture imgid=0x5251 slot=14          ← SAVE.txt:925 set-texture 5251 e
1801: configureDrawItem h=0x30d41 layer=200001  ← SAVE.txt:927 draw-texture
1803: [input-state] ... mouseJump=0x26f mouseSlot=0x10   ← ★登记的是 SBUNKI 的回调（623 = 0x26f）
1804: [present 17045ms]
1806: === gate sleep cleared (t=17270ms) ===
1807: [error] Depth が不正です 51 != 54（跨脚本派发 label：热点/回调注册于脚本 id 54，当前 51 SAVE.BIN）
1808: [boot] done script=SAVE.BIN ip=191 steps=174143
```

用户另一条：**「这个信息在控制面板没有显示，我是看日志才发现的」**。

## 2. 报错是谁抛的

`Engine.guardScriptIdentity`（`src/vm/engine.ts`，引擎 `sub_4083B0` raw 13112-13131）。
调用点之一 = `0xCD get-input-type`（`handlers/input.ts:201`），比对的是 **`mouse-callback` 的 owner**：

```c
// sub_421980 (0xCC, raw 30317)
_this[107664] = readIntOperand(2);                    // 目标 label
_this[107674] = _this[30 * _this[95776] + 95796];     // ★owner = 登记那一刻的脚本身份
...
// sub_41ACD0 (0xCD, raw 25851-25861)
v4 = _this[430656];                                   // 目标
if (v4 == -1) return;                                 // 没登记 ⇒ 不查
if (frames[cur][95796] != _this[430696]) throw "Depth が不正です";
```

⇒ owner 是**全局一格**，**每次登记都改写**（raw 30323）。所以：

| 时刻 | cur | owner | 说明 |
|---|---|---|---|
| SAVE.BIN 初始化（`SAVE.txt:219`） | 51 | 51 | `mouse-callback 10 label_00001104` |
| `call-script 36` 进确认框（`SBUNKI.txt:118`） | 54 | **54** | `mouse-callback 10 label_000009f8`（= 0x26f = 623，日志对得上） |
| SBUNKI `exit` 回 SAVE.BIN | 51 | **54** | ★没人恢复 |
| SAVE.BIN 主循环 `get-input-type` | 51 | 54 | **54 != 51 ⇒ 抛** |

## 3. 为什么真引擎不崩：读档是**控制转移**，不是普通还原

关键旁证在脚本自己身上：

* **存档**路径（`SAVE.txt:1148-1154`）结尾是
  ```
  label_00004c80
  call label_00002dd8
  call label_00007670
  call label_00008438
  call label_0000a474
  mov (local-int e) 4      ; ★让主循环跳回 label_00000e60 —— 那里重新登记全部回调
  ret
  ```
* **读档**路径（`label_000039cc`，`SAVE.txt:921-936`）结尾是
  ```
  i1a1 (local-int 12) (local-int 214)   ; 读档
  ret
  ```
  —— **没有** `e = 4`。它凭什么能继续跑？凭 `0x1A1` 之后脚本系统就被**复位**了：

```c
// sub_410160（0x1A1/0x19F/0x190 的装载内核）a6=1 段，raw 19464-19476
qmemcpy(Engine+84088, Engine+497416, 0x28);   // 字体/消息窗状态拷回
sub_4B5090(Engine+82876);                     // 文本/窗口子系统复位
sub_403EF0(Engine+51904); sub_403EF0(Engine+21976);  // 两张面板复位（路由表清空）
v20 = sub_455000(FileDB, String2);            // ★解析存档里记录的脚本名
Engine[383120] = 1;                           // 「正在读档」门（0xAE 读它）
Engine[383104] = 0;                           // ★cur = 0
if (v20 < 0) { sub_40F750(Engine, 1, 10); return 0; }
... LABEL_136：把 v20 装进帧 0
```

⇒ **调用方脚本被放弃**（SAVE.BIN 再也不会被派发）⇒ 那个 0xCD 守卫**不可能**被触发。

emulator 此前只做了"恢复两张表 + 游玩秒数"，于是调用方接着跑 ⇒ 撞守卫。
修法 = 把这段控制转移补上（`transferToRootAfterLoad`）。本工程解析不了"存档记录的脚本名"
（真槽状态主体未分析，`SLOT_GAPS`）⇒ 退回**重载根脚本 0、由启动链接管**（与 `exit-script` 同口径）。
实测：读完真槽后启动链重新跑，**400 帧内到 TITLE**（`test/slot-load-transfer.test.ts` 的轨迹断言）。

## 4. 顺手修掉的一个数据破坏

`loadSlotIntoEngine` 在真槽路径上会 `applySaveDataTables(空表)` + `setUsedFileIds(空集)` ——
因为真槽的这两块**没解析**（`SLOT_GAPS`：`parseSlotFile` 对 format 1..3 返回 `engineFormat: true` + 空表）。
`applySaveDataTables` 是**覆盖**语义 ⇒ 读一次真槽就把当前 SAVE.DAT 的表（含 `global 5`「已初始化」）
与「已使用文件」标志（回想/CG/BGM 解锁依据）洗掉，而且完全无报错。
现在改成 `if (!engineFormat)` 才写（守卫里放了一个 `\x0300000005` 哨兵锁住）。

## 5. 控制面版为什么看不到

`session.ts` 的 `#onError` **确实**调了 `notifyStatus(emsg)`，但状态上报是**幂等快照**：

```ts
window.api?.sendRendererStatus?.({ ..., error: errorOverride ?? autoError, ... });
```

而 `run()` 出错后会 break 出去，**收尾再上报一次**（"把最终态给控制窗"）：

```ts
this.notifyStatus(); // ★不带 override ⇒ error: undefined ⇒ 控制窗 renderError(undefined) 擦掉横幅
```

⇒ 横幅只亮了不到一个上报周期。修法：把硬错误文本**粘住**（`#errorText`），每次上报都带上，
直到有更明确的文本（override / 暂停提示 = 未知指令）或显式清除（跳过未知指令）。
优先级抽成纯函数 `controlErrorText(override, sticky, paused)` 便于守卫。

## 6. 验证

```
cd app/amayui-emulator
npx tsx --test test/slot-load-transfer.test.ts test/control-error-banner.test.ts
npm run verify        # typecheck ×3 + 604 测试（603 通过 / 0 失败）+ dead-writes
```

E3 要点（`test/slot-load-transfer.test.ts`）：用**本机真存档槽**（`%LOCALAPPDATA%\Eushully\…\SAVE\SAVE??.DAT`）
+ **真资源根**，合成一个"SAVE.BIN 形状"的调用方帧（`0x1A1` 后紧跟 `0xCD`，并把 owner 摆成 54），
断言读档后 `cur=0`、帧 0 = 重载的 SYSTEM4、`383120=1`、调用方帧 ip 不前进；
再跑 400 帧帧循环：**不报错**且启动链重新走到 TITLE。

## 7. 没做的（写进 `SLOT_GAPS`，不假装）

真槽里"**存档记录的脚本名 + 帧 ip 表**"没有解析 ⇒ 读档后只能回到根脚本（启动链 → 标题），
**不能续到存档当时的场景位置**。那是 T-0018 的剩余工作；本单只把"控制转移"这一层补齐
（它才是崩溃的直接原因，也是引擎语义里最容易被当成细节漏掉的一环）。

## 现场日志（★证据不放 `.tmp/`，见 T-0057 R6）

用户实测的读档崩溃现场（boot harness 日志；读出档 YES 分支的 SE/绘图/阶梯动画之后立刻报错）：

```
[error] Depth が不正です 51 != 54
```

`.tmp/amayui-emulator.log` 是临时产物（gitignore，会被清理）⇒ 该证据改为锚在本文件。
