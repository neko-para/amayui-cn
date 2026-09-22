# T-0102 · 「未配置纹理 ⇒ 引擎整笔忽略」的**判决**（2026-09-23，轮 20）

> 触发：用户用 inspector 在**真机**上量到 `global 0 = 1`（并存档到槽 77），但**真机进入时 ADV 背景就是黑色**，
> 于是提出：会不会引擎**允许**拿"没配纹理"的槽去画，并且在这种情况下**忽略整笔操作**？
>
> **结论：成立。** 而且这条不是"某条 opcode 的实现细节"，是引擎**全系统一致**的策略
> （已落第二层台账 `texture-absent-draw-is-dropped`）。

---

## 1. 先落定上一轮的未决（用户给的真机 oracle）

§F 的 (a)/(b) 二选一，被这一条实测**判死**：**真机 `global 0 = 1`，与模拟器同值**。

⇒ 分歧**不在 `global 0`**。窗口例程两边都走 `!= 6` 那一支（`draw-texture 19640/19641 11 …`），
所以差异只能出在**"这两笔 `draw-texture` 到底画出了什么"**上。用户的问题正好指向这里。

---

## 2. 引擎侧：**允许** + **整笔忽略**（逐条都是反编译原文，不是推断）

| 环节 | 引擎行为 | 证据（`engine/天结_unpacked.exe_utf8.c` raw） |
|---|---|---|
| **入队** | `0x1FB draw-texture` 的 handler `sub_422E70` **完全不校验槽**：读 op1..op8 → `sub_4ACE50(Scene, handle, slot, left, top, right, bottom, fx, fy, 0.0)` 建绘制项。**体内对槽表零引用** | 31271-31300 |
| **出画** | 渲染器 `sub_4A2D50`：`v8 = *(CTexture**)(Scene + 4*slot + 42456)`；`if (!v8)` ⇒ `sprintf_s("関数：DrawTexture エラー：描画元テクスチャが作成されていません． TEXTURE=%d\r\n")` + `sub_4034D0` + **`return 0`** | 122890（函数头）/ 122952-122963（门） |
| **"报错"有多重** | **不致命**：`sub_4034D0` → `sub_4976A0`（补 `(脚本：N行目)`）→ `sub_497620` → `sub_438CC0` = **`WriteFile(handle, msg, …)`**。落点 `Error.log`（`aErrorLog = "Error.log"`；`CreateFileA(..., OPEN_ALWAYS)` ⇒ **追加**，且**只在配置 `system:OutErrorLog` 打开时才建这个文件**）。不抛、不弹窗、不退出 | 45660-45667 / 45647-45656 / 4512 / 42956-42962（开关） |
| **一致性** | 同型"未创建纹理 ⇒ 报一行 + 跳过"的串在引擎里有 **25+ 处**：BlendTexture / CopyTexture / StretchTexture / FillTexture / BlurTexture / MosaicTexture / MonoToneTexture / MirrorTexture / CaptureTexture / SetClipRectTexture / Set3DEffectSnow / RenderFrame / CreateBuffer / SetTargetTexture …；`draw-string` 同样是"三个门，缺纹理整条不做（不抛错）" | 5145-5176 串表；23904/23942/84108/120455/124878/125130/125523…；draw-string 68478-68480 |

**⇒ 引擎里根本没有"替代纹理 / 占位块"这个概念。** 槽没有对象，就**什么都不画**（而且连"画了个透明"都不是，
是**整笔不进合成**）。

### 2.1 两张表要分清（这次的关键）

| 表 | 位置 | 步长 | 谁写 | 用途 |
|---|---|---|---|---|
| **绑定表** `image_slot_table` | `Scene+0x748` = `Engine+0x4F458` | 20 B/槽（`[0]`=imgid、`[+8]`/`[+12]`=标志两格） | `0x1F9 set-texture`（`[0]`）、`0x258`（标志） | 脚本问"这个槽绑了哪个图"（`0x216` 读它） |
| **对象表** `image_object_table` | `Scene+0xA5D8` = `Engine+0x592E8` | 4 B/槽 | 解码/释放（`sub_49E9D0` 等） | ★**`DrawTexture` 的门看的是这一张** |

⇒ 一个槽完全可能 **"绑过 imgid" 而 "对象不存在"**（没解码成功 / 被释放过）——
**那时引擎的行为仍然是"什么都不画"**。

---

## 3. 模拟器侧：分歧点与已做的订正

`app/amayui-emulator/src/renderer/pixi/presenter.ts` 原来在"宿主没有纹理"时画 **1×1 白占位块**：

```ts
const spr = tex ? cropSprite(tex, rect) : this.#placeholder(it);   // ← 旧
```

这与引擎**不同构**：引擎什么都不画，模拟器多画一块白的 —— 这正是"白底"那一**类**症状的形状
（2026-09-22 的 E4 日志里 `未绑定纹理槽` 那一批就是它）。

**已改**（轮 20）：

- `!tex` ⇒ **`return null`（跳过该项）** + 一条日志，并区分两种"没有"：
  ① `imgid === undefined`（该槽从未绑过图 —— 引擎：对象为 0 ⇒ 跳过）；
  ② 绑过但宿主还没就位（**引擎里不存在这个态**：`set-texture` `sub_422CB0` 是**同步**读 AGF + 解码的
     ⇒ 这是模拟器异步载入的自己人问题，正解是**在屏障处等**：T-0102 已修的 H2/H3/H4 + `BARRIER_*`，
     不是画白块掩盖）。
- 删掉 `#placeholder` 方法本体。
- 守卫 `test/missing-texture-skips-item.test.ts`（**双侧棘轮**）：引擎侧钉"错误串 + 紧随的 `return 0`"
  "错误汇是 `WriteFile`""入队 handler 不碰槽表"；emulator 侧钉"`!tex ⇒ return null`""`#placeholder` 不得回来"。
  **突变已证明**：把那一支改成 `return cropSprite(this.unit, rect)` ⇒ 该用例红。
- 连带修一处**假夹具**：`test/transition-render-wiring.test.ts` 原来靠占位块才"画得出来"
  （4 项 `tex: 1` 但槽 1 没绑图）⇒ 夹具补 `cache.slotTex.set(1, Texture.WHITE)`（引擎里"能画"就意味着有对象）。

---

## 4. 你这次那帧白到底是哪一类？——两个**能一次判死**的 oracle

### (A) 引擎自己的错误日志（最直接）

`SYS4REG.INI` 里：

```ini
[debug]
OutErrorLog=0        ← 现在关着；改成 1
```

（引擎：`sub_4350B0` 读配置键 `system:OutErrorLog` → `sub_438C50` → `CreateFileA("Error.log", OPEN_ALWAYS)`。）
改完复现一次（进 SC0000 那一刻），看游戏目录下的 **`Error.log`** 有没有：

```text
関数：DrawTexture エラー：描画元テクスチャが作成されていません． TEXTURE=17
```

- **有** ⇒ 真机那一刻槽 17 **没有纹理对象** ⇒ 那两笔被**整笔丢弃**，**真机根本没画窗图**；
  "黑"来自别的东西（不是这两片 SO001 的窗图）。而模拟器（只看**绑定表** + 宿主有图）却画了 ⇒ 白 = 模拟器多画。
- **没有** ⇒ 真机确实画了那两片 ⇒ 白/黑之分在**纹理内容/区域/alpha**（下一轮查 `draw-texture 19640 11 0 0 43e 95 5d 22c`
  取的那块 `SO001.AGF(0,0,1086,149)` 在两边的实际像素，以及 `set-draw-color-alpha 19640 0 (global f807d) (global a9db)`）。

### (B) inspector 直接看两张表（槽 17）

| 看什么 | 地址（`Scene` 基址 +） | 期望（"绑过且对象在"） |
|---|---|---|
| **绑定表** `[0]` = imgid | `Scene + 0x748 + 0x14*17` = `Scene + 0x89C` | `0x5260` |
| **对象表** = `CTexture*` | `Scene + 0xA5D8 + 4*17` = `Scene + 0xA61C` | **非 0**（为 0 就是上面 (A) 命中） |

（等价说法：`Engine+0x4F458+0x14*17` 与 `Engine+0x592E8+4*17`。存档 77 里也能看出槽记录 ——
`tex_slot_table`（12 B/槽）与 `image_slot_table`（20 B/槽）都有存档镜像。）

---

## 5. 本轮**没有**改的（登记，别当已解决）

1. **`0x1FB` 的入队侧**：模拟器 `gfx-texture.ts:195` 有一句
   `if (!c.e.texSlots.has(slot)) c.e.texSlots.set(slot, 0);` —— 引擎的 `draw-texture` **不写槽表**，
   而且未绑定的槽在引擎里是 **`-1`**（raw 122847）而不是 `0`。这句会让"从未绑过"与"绑到 0"分不开
   （只影响诊断日志的措辞，不影响本次的绘制判据 —— 判据看的是**宿主纹理**）。
2. **对象表没有 VM 侧模型**：`Engine.texSlots` 是**绑定表**，"对象是否存在"目前由宿主 `slotTex` 隐式代表。
   若要精确复现"绑过但对象被释放"的态，需要 VM 侧补一张对象表（`Scene+0xA5D8` 那一张）。
3. **纹理内容本身**：如果 (A) 判定"真机画了"，那要查的是 `SO001.AGF` 的取图区域与 alpha，不在本轮范围。
