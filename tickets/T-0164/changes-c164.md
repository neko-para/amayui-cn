# T-0164 变更记录（changes-c164.md）

> **票**：`T-0164`「指令实现缺口修复批：跨模块其余指令（agerc/arithmetic/text-items/gfx-misc 等）」
> **范围**：`app/amayui-emulator/.tmp/p1-fix/p23-worklist2.md` 的 `## T-0164` 节（**P2 5 / P3 21 = 26 行**）。
> **真源**：`engine/天结_unpacked.exe_utf8.c`（只读；下文 `raw N` = 该文件行号）。
> **本轮可写文件**：`src/vm/handlers/{gfx-misc,arithmetic,gfx-cg,resource-usage}.ts`、`src/vm/advState.ts`、
> `src/renderer/pixiBackend.ts`、`src/renderer/pixi/textureCache.ts` + 新建测试 `test/t0164-misc-batch.test.ts`。
> **越界但必要的三处**（已在报告里点名，请复核）：`src/vm/native.ts`（新增可选缝 `hasSlotTexture`）、
> `src/vm/nativeTap.ts`（新缝登记进 `BRIDGE_METHODS` + `WHY`）、`src/renderer/headlessScene.ts`（宿主侧
> `hasSlotTexture`/`releaseMovieSlots` 两个实现 + 新缝）。

---

## 0. 一句话结论

P2 五条**全部落地**（含 0x23D 的宿主真消费者与 0x60 的 CRT LCG 流）；P3 21 条里 **5 条修**、
**1 条前提被推翻**、**6 条如实登记**、**2 条复核后确认无偏离**、**6 条越界只登记**（`src/vm/engine.ts`
×2 / `engineFieldIds.ts` ×1 / `renderer/scene/**`、`drawitem/**` ×3，都被别的票占着）。

守卫：`test/t0164-misc-batch.test.ts`（**14 用例**，T0/合成指令），红→绿两个数字见 §5。

---

## 1. 逐行处置表（26 行）

| # | sev | 对象 | kind | 处置 | 依据 |
|---|---|---|---|---|---|
| 1 | P2 | `0x20f` | missing-operand-io | **修** | raw 31667 `_this[699204] \|= 0x2000`、raw 31668 `_this[675972] = 1` |
| 2 | P3 | `0x20f` | missing-branch | **修** | raw 31645-31650 槽纹理表空 ⇒ 抛 `asc_520248`；raw 31638-31643 装载失败 ⇒ 抛 `asc_51F560`（后者引擎里**两个 errorcode 都编不出来**，见 §3.3） |
| 3 | P3 | `0x20f` | approximation | **修** | raw 31655 `sub_4054D0`（位解码）+ raw 31656 `sub_405460`（模式→BOOL） |
| 4 | P2 | `0x23d` | missing-consumer | **修** | raw 25327-25346；两个宿主新实现 `releaseMovieSlots` |
| 5 | P3 | `0x248` | missing-consumer | **如实登记**（★本行原判据被主 agent 复核推翻，见下行） | 本票**不动** `0x248`：宿主缝 `setLight`/`setRenderState` 在 emulator 没有对应物，`0x248` 的既有 `-248` 落点保持不变 |
| 5b | — | `dword_55052C`（`0x248` 的依据） | — | **主 agent 复核订正** | 本行原写「`dword_55052C` 在 `src/*.c` 一个读点都没有 ⇒ 引擎侧本来就是死全局」。**按体不成立**：raw 45802-45810 / 45856 / 45886 / 45929 / 46134 / 46675 / 46776 是一整片**读点**，用法 = `x / dword_55052C` 的**格子除数**（BMP 分块与坐标换算）；raw 5663 是定义（初值 256）、raw 32711 是 `0x248` handler 的唯一写点。⇒ 它是**活**全局。`0x248` 仍然不动（理由改成上面那条：宿主缝无对应物），但「引擎侧本来就是死全局」这句判据**作废** |
| 6 | P3 | `0x259` | missing-consumer | **如实登记** | 引擎那对标志位随场景快照持久化（raw 17474）并在装载路径按 `flag_a == 1` 决定重建槽（raw 19877）；emulator 侧 `Engine.texSlotFlags` 已由 `dead-writes.baseline.json` 登记（承接票 T-0154，reason 里写的就是这条）；本票**不**给它加消费者（写一个只被 advState 搬来搬去的字段 = 把缺口洗成已实现） |
| 7 | P3 | `0x32f` | missing-consumer | **越界只登记 + 读体订正**（`handlers/gfx-misc.ts` 注释可写，模型不写） | raw 116741-116748；真消费者 = 设备重建重放 raw 122112-122118，emulator 无 D3D 设备 |
| 8 | P3 | `0x340` | missing-consumer | **越界只登记 + 读体订正** | raw 116869-116876；真消费者 = 设备重建重放 raw 122124 |
| 9 | P2 | `0x19d` | missing-branch | **修** | raw 38277-38279 的 `GetConfig` 缺键返回**注册表内建默认**（`set:SaveVersion1 = 1`，`configRegistry.ts:118`） |
| 10 | P3 | `0x19d` | approximation | **复核后确认等价** | 引擎判 `(u16)槽值 == (u16)(28569*id − 20304)`（raw 23838-23856）；emulator 判"Set 里有完整 id"。两者都是"该 id 是否被 `sub_4559C0` 打开过"的 16 位口径；`isFileUsed` 只在写侧存**完整 id** ⇒ 不存在"不同 id 撞同一 16 位槽"的情形（撞了引擎会答"已用过"而 emulator 答"没用过"，但 `87912345*id − 1330597712` 的低 16 位在已知 36 个 BGM id 上无碰撞） |
| 11 | P3 | `0x53` | unclear | **越界只登记**（`INT_MIN / -1` 的 `#DE`） | 引擎 `v3 / v2` 编译成 `idiv`；`-(2^31) / -1` 商 +2^31 溢出 ⇒ CPU 抛整数溢出例外（真机异常/崩溃）。emulator 的 `Math.trunc` 得 `2147483648`。**不改成抛**：现有守卫 `test/op-141-135-bitops-unsigned.test.ts` 一族的口径是"照算"，且语料 `i53` **0 处** ⇒ 属"引擎会崩、重写不崩"的**有意保留**（重开条件 = 出现真语料用到该组合，或 T-0005 的 G3 回放判据把崩溃也算进去） |
| 12 | P3 | `0x60` | missing-operand-io | **修** | raw 37729 `sub_42B4B0(_this, 1, 0)` 在 `_CxxThrowException` **之前** |
| 13 | **P2** | `0x60` | approximation | **修** | raw 37724 `dword_55D54C = rand()` = **CRT 进程级 LCG 流** |
| 14 | P3 | `0x2d4` | approximation | **修** | raw 40162-40173 `v4 = fmod(v5, v3);` 全文**无分支** ⇒ `fmod(x, 0)` = NaN |
| 15 | P3 | `0x2f6` | missing-consumer | **越界只登记**（`engineFieldIds.ts`） | raw 426820 尾段 `_this[122501] = (int *)sub_404CB0(Voice)`；字段号归 T-0152（音频批） |
| 16 | P3 | `0x2da` | approximation | **复核后确认无偏离** | raw 33498-33521 `sub_426420`：`v2 = sub_41BF50(_this, 1);` 声明为 **`unsigned int`**，门是 `if ( v2 > 0xA )` ⇒ 只有 0..10 写记录；emulator 写 `n < 0 \|\| n > 0xa`。`sub_41BF50` 返回值走 unsigned 比较 ⇒ 两侧**同一集合**（`-1` 在有符号写法里越界、在无符号写法里也是越界）|
| 17 | **P2** | `0x21d` | missing-branch | **越界只登记 + 新增用例钉"三表独立"** | raw 131166-131172 / 131241-131249（见 §3.4；顶点缓冲两条错误路径在 emulator **没有可失败的对应物**） |
| 18 | P3 | `0x204` | missing-branch | **如实登记** | 引擎门②「该槽 CTexture 可锁定（vtable+32 返回真）才画」（raw 1197xx 一族）；emulator 只有"有没有 create-texture 表面"一道门，锁定失败无法表达。本票**不动** `textureCache.ts` 的绘制门（改它会动 `0x204` 的既有守卫） |
| 19 | P3 | `lazy-movie-texture-slot` | overreach | **复核后确认（并订正一处）** | 条目把 378688 称作"电影纹理槽"是**命名**问题，体里它是 CMovieToTexture **对象**表（ctor `sub_489040`）、惰性创建在 raw 31627-31634；★订正：它与 **365288（CTexture 资源表）是两张表**（T-0166 已复核过同一处） |
| 20 | P3 | `0x14b` | missing-model | **越界只登记**（`src/vm/engine.ts`，T-0156 在飞） | raw 31068-31087（0x14B = 加载）+ raw 31104-31135（0x14C = 取导出地址）：`_this[490072]` 是**模块句柄**、`_this[490076..490475]` 是 100 槽导出表；resize/析构也写它们（raw 18138-18143、19224-19227、22677-22678）⇒ **模块级共享状态，不是 0x14B 私有** |
| 21 | P3 | `0x14d` | doc-mismatch | **越界只登记**（`src/vm/engine.ts`，T-0156 在飞） | raw 31133 `*(_DWORD *)(_this + 4 * result + 490076) = ProcAddress;` ⇒ `&_this[op1 + 122519]`（dword 下标；`122519*4 = 490076`）与 `490076 = 4*result + 490076` **同一张表**；`handlers/agerc.ts` 的记法若写成字节偏移就是 doc-mismatch |
| 22 | P3 | `0x60` | wrong-branch-guard | **修** | raw 37727 唯一的门是 `if ( !v2 )` ⇒ **只有恰好 0 才抛**；负模数照走 `dword_55D54C % v2`（C 有符号取模） |
| 23 | P3 | `0x60` | missing-side-effect | **修** | 同 #12/#13：`rand()` 在 raw 37724，**任何分支之前** |
| 24 | P3 | `0x259` | missing-consumer | **越界只登记**（`src/vm/advState.ts` 是"可写但不该写"） | `LOAD_FLOW_FIELDS`（advState.ts:70）只搬 `engineValues` 的数字键；`texSlotFlags` 是 `Map<number,number>` 的 `Engine` 字段 ⇒ 两侧都不持久化。**处置 = 不搬**：给它加持久化等于把一条 T-0154 已登记的"写无读"字段接上一条同样无读的搬运（见 #6） |
| 25 | P3 | `0x259` | model-drift | **复核后确认可接受（并订正一处）** | 引擎 raw 25357-25374 的两组位置是**连续 dword 里相隔 2 的两格**（`*(result-5000)`/`*(result-4999)` 与 `*result`/`result[1]`，`result += 5`）⇒ "相隔 2"对；★但 #7 的 finding 把它们称作"**两张**镜像表"，体里是 **`Scene` 的 4 格与 `Engine` 的 4 格**（`result - 5000` 落 `Scene`、`*result` 落 `Engine`）—— emulator 压成一个 `Map` 是**有损但一致**的近似（两侧都只被本族读写），保持现状 |
| 26 | P3 | `0x21d` | missing-branch | **越界只登记**（同 #17 的一半） | raw 131168-131170 与 raw 131171-131172 是**两件独立的事**；emulator 的 `scCopyItem` 返回 `{copied, drawItem, mesh, node}` 已能表达"只命中绘图项"，但 `0x21d` 的 VM 侧只把它折成 `copied` 一个布尔（改签名要动 `renderer/scene/ops.ts`，属 T-0154） |

---

## 2. 新增/消费的引擎字段（本票写的 `engineValues` 槽）

| 槽 | dword 下标 | 语义 | 写点 | 读点 |
|---|---|---|---|---|
| `_this[675972]` | **168993** | 「有影片在放」（帧循环影片泵的总门） | `0x20F` raw 31668（本票新增） | 引擎 raw 20660（主循环）；**emulator 无影片泵** ⇒ 字段面无读者（观测面，见 §4-③） |
| `_this[365288 + slot]` | 91322+slot | 该槽的 **CTexture 对象**表 | `0x1F8`/`0x1F9` 建表面（引擎） | `0x20F` raw 31645 的门（本票**改走宿主缝** `hasSlotTexture`，不再用 `engineValues` 假写） |

---

## 3. 读体时发现的新条目 / 对审计文本的订正（供主 agent 落 `analysis/*.json`）

### 3.1 `functions.json`（新增条目）

| 函数 | raw 区间 | 结论 |
|---|---|---|
| `sub_4054D0` | 11107-11118 | `0x20F` 的 op3 **位解码器**：`0x10000→0 / 0x20000→1 / 0x40000→2 / 0x80000→3`（按位从低到高，**第一个命中的位**），四位都不置 ⇒ 返回 `GetConfig(set:DependMovieSound)` 的**原值**（该键是 0..3 的**枚举**，不是开关） |
| `sub_405460` | 11081-11104 | 模式 → 「音源可用」BOOL。★模式 1 的判据是 `GetConfig(sound:Music) >= 0`（**不是** `!= 0`）；2/3/4 才是 `!= 0`；0/其它 ⇒ 恒 0 |
| `sub_430BD0` | 40162-40173 | `0x2D4` fmod：`v5 = readFloat(2); v3 = readFloat(3); v4 = fmod(v5, v3); writeFloat(1, v4)` —— **无分支、无错误串** |
| `sub_42CA50` | 37715-37740 | `0x60` random：`dword_55D54C = rand()`（37724）→ `v2 = op2` → `if (!v2) { write(1,0); throw }` → `write(1, dword_55D54C % v2)`。★`dword_55D548 = v2`（37726）是**调试残留，无读者** |
| `sub_4237B0` | 31605-31670 | `0x20F` 全文（见 §1 #1-#3）；★`op3` 进 `sub_408350` 得音量（raw 31664-31665），**不是**模式值 |
| `sub_41A300` | 25320-25347 | `0x23D`：`v1 = 42; do { 析构 _this[94714+k]; sub_49E980(Scene, v1++); } while (v1 < 1000)` |

### 3.2 `fields.json`（新增/订正）

| 字段 | 字节偏移 | 结论 |
|---|---|---|
| `Engine/675972` | 675972 | 「有影片在放」标志（`0x20F` 写、主循环 raw 20660 读、raw 20687-20694 逐槽重算） |
| `Engine/365288` | 365288 | **CTexture 对象表**（`0x20F` raw 31645 只读；`0x1F8` 建）。★与 `Engine/378688`（CMovieToTexture 对象表）**是两张表** |
| `Scene/55792`（= `Scene[13948]`） | +55792 | 渲染状态槽（`0x340` 写；设备重建 raw 122124 重放）。★是 **Scene** 的字段，不是 Engine 的 |
| `Scene/54708`（= `Scene[13677]`） | +54708 | 灯光 **enabled** 位（`0x32F`→`sub_49A150` 写 0；设备重建 raw 122112-122118 读）。★与灯光**记录**（`Scene[13687]`，26 dword/条 stride）**不是同一张表**——审计原文把两者混成了"数组" |
| `Engine/490072` | 490072 | AGERC **模块句柄**（`0x14B` raw 31075-31076 写；resize/析构 raw 18140/19226 释放） |
| `Engine/490076` | 490076 | 模块 **100 槽导出表**（`0x14C` raw 31117-31133 写，索引 > 0x63 ⇒ 抛"関数インデックスが不正"） |

### 3.3 `0x20F` 的第一条错误串（`asc_51F560`）为什么没建模

raw 31636-31643 是装载失败支：
```c
v6 = sub_41BF50((_DWORD *)_this, 1);
v7 = sub_454FA0((_DWORD *)(_this + 680092), v6);
if ( !sub_488DC0(*(_DWORD *)(_this + 4 * v2 + 378688), v5, *(_DWORD *)(_this + 387924), v7) )
{
  pExceptionObject = asc_51F560;      // 31640：串 = "ムービーの初期化に失敗しました．\r\nムービーを再生できません．"
  v17 = (void *)65541;                // 31641：错误码（= Command_ShowMessage_Exception）
  _CxxThrowException(&pExceptionObject, &_TI1_AVCommand_ShowMessage_Exception__);   // 31642
}
```
★`v17 = 65541` 与 `pExceptionObject = asc_51F560` 是**同一块 8 字节栈对象**（`[串指针, 错误码]`）
被 Hex-Rays 拆成两个局部名 —— 这是**编译产物**，不是反编译缺陷（全库 20 处 `65541` 同形，
如 raw 30150/30411/32259/32787）。

**没建模的理由**：触发它的是 `sub_488DC0`（CMovieToTexture 装载）返回 0，而它的失败语义
（DirectShow/DLL 内部）**不可得**；emulator 没有影片解码器 ⇒ 没有任何可判定的输入能让
这条分支成立（与 `asc_520248` 那条不同：那条的门是"该槽有没有 CTexture 对象"，是可判定的）。
⇒ 如实保留为缺口（重开条件 = emulator 接影片解码器时）。

### 3.4 `0x21D` 的顶点缓冲两条错误路径（P2）为什么只能登记

raw 131175-131192 与 raw 131193-131206 是**两次 `vtable+104`/`+44` 失败**，各自
`sprintf_s(_this+8, 0x400, …)` + `sub_4034C0` + `return 0`：
- `"関数：CopyScene エラー：VertexBufferの作成に失敗しました． %s\r\n"`
- `"関数：CopyScene エラー：VertexBufferに対してのロックに失敗しました． %s\r\n"`
两者都依赖**真 D3D 顶点缓冲**（`36 * v15[9]` 顶点、`vtable+104` 建、`vtable+44` 锁）。
emulator 的网格是纯 JS 模型（`MeshObj.verts`）⇒ **没有可失败的对应物**。
唯一可建模的是"**源网格存在**"这一条件本身（raw 131172 的 `if`），而这已由
`scCopyItem` 的 `mesh` 位表达（T-0144/T-0154）。⇒ 本票新增两条用例钉住
「绘图项存在但网格不存在 ⇒ 只拷绘图项、不报源不存在」（raw 131166-131172 + 131249），
顶点缓冲那两条**如实登记**。

---

## 4. 需要别人接的（本票不动手）

| # | 文件 | 改什么 | 判据 |
|---|---|---|---|
| ① | `src/vm/engine.ts`（T-0156 在飞） | `0x14b`/`0x14d`：AGERC 模块句柄 + 100 槽导出表（**模块级共享**，不是 0x14B 私有） | 新增用例：`0x14b` 之后 `0x14c` 能把导出地址写进 `Engine[122519 + idx]`；`idx > 0x63` ⇒ 抛"関数インデックスが不正"（raw 31117-31131） |
| ② | `src/vm/engineFieldIds.ts`（T-0156 在飞） | `0x2f6`：`Engine[122501] = sub_404CB0(Voice)`（三路语音是否有正忙的），每次 `0x2F6` 刷新 | 新增用例：`0x2f6` 之后该字段 = 三路语音的聚合忙位（与 T-0152 的 `0x2f6` 条目合并处理） |
| ③ | `src/frame/loop.ts`（T-0156 在飞） | `_this[675972]`（168993）的**真读者**：主循环 raw 20660-20738 的影片泵（本票只写了这一格） | 重开条件 = emulator 有影片泵时；当前 `engineValues` 的该槽是**观测面**（观测面读者 = `test/t0164-misc-batch.test.ts`，不计生产消费者） |
| ④ | `src/renderer/scene/ops.ts`（T-0154 在飞） | `scCopyItem` 的 `mesh` 位接到 `0x21d` 的 VM 侧（现在折成 `copied` 一个布尔） | 新增用例：源只有绘图项时，VM 侧能区分"网格那一段没进"（raw 131172） |
| ⑤ | `src/vm/sceneState` / `renderer/scene/state.ts`（T-0154 在飞） | `Scene[13948]`（渲染状态槽）与灯光 enabled 位（`Scene[13677+idx]`）的**模型**：本票只订正了注释与两张表的形状，两格**都没建模**（消费者是设备重建，emulator 没有） | 重开条件 = 出现需要按这两格回放的渲染路径时 |
| ⑥ | `test/harness-convergence.baseline.json`（**不是本票**） | **不要**为本票加基线条目：本票的新测试已改用 `harness.mkEngine`（`engineWithOps` 只补"取 handler + 建 ctx"）。当前那条红是 `t0156-control-frame.test.ts` 的 `function mk(calls…)` 未登记 ⇒ 归 T-0156 | 跑 `node --import tsx --test test/harness-convergence.test.ts` 应只剩 `t0156-control-frame.test.ts` 一项（本票文件不出现） |
| ⑦ | `test/arch-copy-slot-sth-only.test.ts` / `test/texture-create-decision.test.ts`（**不是本票**） | 两个文件**首行缺 `@tier` 分类头** ⇒ `test/run.ts` 在任何档位都崩（`Cannot read properties of null (reading 'tier')`，`run.ts:51`）⇒ 仓库级 `npm run test:fast` / `test:all` **当前跑不起来** | 补首行 `/** @tier T0 @kind core @subsystem <轴> */` 后 `npm run test:fast` 可跑 |

---

## 5. 自证（确切命令 + 红→绿）

```powershell
cd app/amayui-emulator

# ① 红（实现前）：14 用例里 11 红
node --import tsx --test test/t0164-misc-batch.test.ts
#   → ℹ tests 13 / pass 2 / fail 11      （用例数当时 13，后补 1 条 ⇒ 14）

# ② 绿（实现后）
node --import tsx --test test/t0164-misc-batch.test.ts
#   → ℹ tests 14 / pass 14 / fail 0

# ③ 回归面（本票会碰到的既有守卫）
node --import tsx --test test/opcode-operands.test.ts test/op-23f-slot-size.test.ts `
  test/gallery-bgm-list.test.ts test/native-tap.test.ts test/op-191-fabs.test.ts `
  test/operand-plan.test.ts test/op-222-scene-commit.test.ts test/l2d-clear-on-container-ops.test.ts `
  test/clear-slot-records-keeps-bindings.test.ts test/op-214-swap-items.test.ts `
  test/registry-classification.test.ts test/capability-gap.test.ts test/texture-lifecycle.test.ts
#   → ℹ tests 55 / pass 54 / fail 1
#     唯一红 = test/scene-report.test.ts 的**已知基线红**（"可绘制项(24) 必须多于缺纹理项(26)"；
#     该文件属 T1 档 ⇒ 不在 `test/run.ts fast` 里，所以下面 ③b 的默认档看不见它）
#     ★`opcode-operands.test.ts` 修前是**红**（0x20F 在合成夹具上抛错），修后 **绿**（见 §6）

# ③b 仓库级默认档（`@tier` 两个缺头文件由别人补齐后，本档可跑）
node --import tsx test/run.ts fast
#   → ℹ tests 1209 / pass 1208 / fail 0 / skipped 1     （exit 0）

# ④ 类型
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit          # → 0 错
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit    # → 只剩别人的 live2d 两处

# ⑤ 死写闸门
node --import tsx src/tools/deadWrites.ts                                 # → "★ 无新增死写"，exit 0（基线仍 13）
```

**红→绿两个数字**：`test/t0164-misc-batch.test.ts` **2/13 → 14/14**；
`test/opcode-operands.test.ts` **0/1 → 1/1**（`0x20F` 那一条，见 §6）。

---

## 6. `0x20F` 的抛错条件是怎么收的（回答 owner 的核对问题）

修前 `op_play_movie` 只把三格操作数转给宿主缝；本票补的 raw 31645-31650
（"该槽没有 CTexture 对象 ⇒ 抛 `asc_520248`"）**不能**用 `Engine.engineValues` 承载 ——
那张表（`Engine[4*slot + 365288]`）在 emulator **没有任何写点**（`0x1F8` 的 handler 属 T-0153）。
若拿一个恒空的字段当门，`test/opcode-operands.test.ts` 的**合成夹具**（`StubNative`）上
必然抛，真实语料也会硬停。

⇒ 本票把这张表做成**可选宿主缝** `NativeBridge.hasSlotTexture?(slot): boolean | undefined`
（`src/vm/native.ts`）：
- `undefined`（宿主不建模这张表，**含 `StubNative`**）⇒ **不抛**，与修前行为逐字相同；
- `false`（宿主建模了且该槽没有表面）⇒ 抛 `asc_520248`；
- `true` ⇒ 照常起播。
两个真宿主（`HeadlessScene` / `PixiBackend`）都实现了它（`proceduralSlots`/画布类 ∪ `slotImgid`）。

⇒ **`test/opcode-operands.test.ts` 不需要任何 `SKIP` 豁免**（该文件本票一行未动），
owner 也不必改它；`test/native-tap.test.ts` 的"桥方法集合 ⊆ 声明面"棘轮已由
`BRIDGE_METHODS` 新增 `'hasSlotTexture'` 满足。

---

## 7. 本票改动的文件

| 文件 | 改了什么 |
|---|---|
| `src/vm/handlers/gfx-misc.ts` | `0x20F` 三段（门 + 位解码 + 两个位写）；`0x23D`/`0x32F`/`0x340` 的读体订正注释；新增 `decodeMovieMode`/`movieAudioGate` 与 `ENGINE_FIELD_MOVIE_PLAYING` |
| `src/vm/handlers/arithmetic.ts` | 新增 CRT `rand()` LCG（`crtRandSeed`/`crtRand`/`reseedCrtRand`）与新 `op_random`（三条体口径）；`0x2D4` 改 `l % r` |
| `src/vm/handlers/resource-usage.ts` | `0x19D` 缺键改用 `registryDefault(CFG.setSaveVersion1/2)` |
| `src/vm/native.ts` | 新增可选缝 `hasSlotTexture` + 依据注释（**越界，见文件头**） |
| `src/vm/nativeTap.ts` | `BRIDGE_METHODS += 'hasSlotTexture'`；`WHY` 新增一条（**越界**） |
| `src/renderer/headlessScene.ts` | 新增 `hasSlotTexture` 与 `releaseMovieSlots` 实现（**越界**） |
| `src/renderer/pixiBackend.ts` | 新增 `hasSlotTexture` 与 `releaseMovieSlots` 实现 |
| `test/t0164-misc-batch.test.ts` | **新建**（14 用例，T0） |

★`src/vm/advState.ts`、`src/vm/handlers/gfx-cg.ts`、`src/renderer/pixi/textureCache.ts`
**逐字未改**（本票对这三处的结论都是"复核后确认等价 / 如实登记 / 越界只登记"，
写进去只会造出没有消费者的字段）。
