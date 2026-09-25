# T-0142 过程记录

## 第 71 轮：`capture [路径]` —— 把「两条截图管线」摆到台面上（用户报的可用性问题）

### 起因

用户实测后回了两句：① 输入注入正常；② **「新 capture 输出 base64 我不方便转换 png，能不能直接存到指令路径中」**。

第 ② 句看着是"加个小功能"，实际正命中本票的核心：`capture`（渲染窗 `FrameHost.capture`）与 `shot`
（主进程 `webContents.capturePage()`）是**两条管线**，而 ② 要做的决定（`shot` 是否统一到 `FrameHost.capture`）
**必须先把两条管线的产物摆在一起看**才能做。此前只有 `shot` 能落盘、`capture` 只回 base64
⇒ 对照这件事在工具面上是**做不了**的。所以这不是旁支需求，是 acceptance ② 的前置工具面。

### 两条管线的差别（本轮的记录口径）

| 命令 | 管线 | 产物 | HTML 覆盖层 | 尺寸 |
|---|---|---|---|---|
| `shot [名字]` | 主进程 `webContents.capturePage()`（`T-0133` §B.4.4 的**形态 C**） | 整窗图像像素 | 有 | 窗口几何相关（本机实测 1600×902） |
| `capture [路径]` | 渲染窗 `FrameHost.capture`（**B′**，`renderer.extract.canvas` 读回） | Pixi 舞台合成结果 | 无 | 舞台画布尺寸 |

★最容易被忽略的差异就是**尺寸**：`clickimg` 的坐标换算一直以 `capturePage()` 的尺寸为基准
（`imgToSendLive` 现取几何），换管线会连带影响它 —— 这是 ② 落地时要一并回答的问题，本轮只记录。

### 做了什么

1. `tools/debugsrv.cjs`：
   * 新增 `capture [路径]` 分支（与 `shot` 分支**相邻**，两条管线在代码里也并排）：
     裸命令 `capture` 转给渲染窗命令表（`sendDebugQuery('capture')` → `src/vm/debugCommand.ts`
     → `session.ts` 的 `capturePng(this.#frameHost())`），**不**在本进程抓图；
     给了路径则由主进程落盘。
   * `pngSize(buf)`：现读 PNG 的 IHDR 宽高（偏移 16 / 20），**不引依赖**；回执里报出字节数与尺寸
     ⇒ E4 取证时不必再开图工具。
   * 文件头：新增「## 两条截图管线」对照表 + 用法行。
2. `tools/dbg.cjs`：用法示例补 `shot` 与 `capture [路径]` 两行。
3. `test/agent-workflow.test.ts`：新增守卫
   「★T-0142②：`capture <路径>` 走渲染窗管线并由主进程落盘（旧 `shot` 管线保留）」——
   钉四件事：主进程认识 `capture`、转的是裸命令（不是自己抓图）、落盘在主进程、**无路径那条分支原样透传**
   （落盘是加法不是替换），以及 `capturePage` 旧管线必须还在。

### 为什么落盘在主进程

渲染进程**没有 fs**：`src/vm/engineSnapshot.ts` 连一处文件 IO 都没有（有源码棘轮守着），
`T-0122` 的 `save`/`load` 也是因此落在主进程。本条与它同一理由、同一通道，不新开第三条路。

### 一个自己踩到的坑：相对路径按谁解析

第一版把落盘写成 `path.resolve(file)`（= **daemon 的 cwd**，也就是 `app/amayui-emulator/`），
于是 `capture .tmp/x.png` 会落到 `app/amayui-emulator/.tmp/x.png`，而 `shot` 的产物在
`<仓库根>/.tmp/dbg-*.png` —— **两条管线的图不在同一个 `.tmp/` 里**，正是这次要对照的东西却对不起来。
已改成按 `ROOT`（仓库根）解析（与 `shot` 的产物落点同一口径），并且在文件头与 `dbg.cjs` 的用法里都写明，
回执里一律报**绝对路径**。★与 `save`/`load` 的 cwd 口径不同：那两条是既有行为，本轮不动（已在注释里点明差距）。

### 状态

* acceptance ① 通道：已落地（第 70 轮）+ 用户本轮实测"输入注入正常"。
  ★待确认**走的是哪条通道**（`AMAYUI_DEBUG_INPUT=vm` 的 VM 桥，还是默认的 DOM 那条）——
  这决定 ④ 的"证明经 `applyScenarioEvent`"能否就此成立；没确认前不记为 ④ 的证据。

## 第 71 轮第二报：`capture <路径>` 没落盘 —— 原因是**守护进程还是旧代码**

用户跑 `node tools/dbg.cjs capture .tmp/vm.png` 得到的是**渲染窗那行**回执：

```
capture: 1784412B PNG（base64 在 png 字段）
```

而新代码的落盘分支回执应当是 `capture → <绝对路径>（… 字节，WxH；管线 = 渲染窗 FrameHost.capture）`。
拿到渲染窗原样的回执 ⇒ 走的是"无路径"那条透传分支 ⇒ **在跑的那个守护进程里根本没有这段新代码**。

根因不是代码写错，是**进程模型**：守护进程是 `tools/` 里**唯一长期活着的**进程，`require` 那一刻
代码就定死了；改磁盘上的 `debugsrv.cjs` **不影响**已经在跑的它（而 `dbg.cjs` 每次都是新进程 ⇒ 永远是新的）。
"我改了代码但没生效"于是被误读成"代码写错了"—— 这正是本工程最忌的那种**结论与真因不符**。

### 修法：把"要不要重启"从**猜**变成**查**（`tickets/T-0142`）

| 位置 | 行为 |
|---|---|
| `debugsrv.cjs` 的 `--ping` 回执 | 加两行：本进程**启动时刻** + 磁盘上 `debugsrv.cjs` 的 **mtime**；磁盘更新 ⇒ 追两行"★本进程是旧代码 + 两步重启法" |
| `debugsrv.cjs` 的 `hello` 广播 | 带上同一组字段（`stale` / `disk` / `startedAt`）⇒ **每条命令**都会先自报新鲜度 |
| `dbg.cjs` | `hello` 里 `stale` ⇒ 直接打警告；★另外对 **`--ping` 特判**：回执里**没有**新鲜度字段 ⇒ 对面是旧代码 —— 旧代码自己当然不会报告这件事，只能由**永远新鲜的客户端**来判定 |

★第三种情形是必须的：用户这次撞上的就是"对面根本没有这套字段"，只有客户端能发现。

守卫：`test/agent-workflow.test.ts` 的「★T-0142：旧守护进程（不报告版本）必须被客户端点破，且不许对新的误报」
—— 起一个**假守护进程**，两种情形各断言一次（不报告 ⇒ 必须点破 + 给重启两步；报告 ⇒ 不许误报）。
★写这条测试时自己踩了一个坑：第一版用 `spawnSync`，而假守护进程就在**同一个测试进程**里
⇒ `spawnSync` 阻塞事件循环、本进程收不到子进程的连接（子进程什么都收不到就默默退出、断言只看到空输出）。
改成异步 `spawn` 才对；另外替身必须咽掉对面断开时的 `ECONNRESET`，否则 `net.Socket` 的未处理 `'error'`
会把整条测试打红。这两个坑都写在测试的注释里了。

**现场核实**（只读，未动用户实例）：对用户那个守护进程跑 `node tools/dbg.cjs --ping` ⇒ 回执只有
`pong / game=true`、没有新鲜度行 ⇒ 新客户端当场点破"它跑的是旧代码"。**用户要做的就两步**：

```
node tools/dbg.cjs --quit     # 关掉旧守护进程（会一并关掉游戏窗口）
npm run dbg:srv               # 用新代码重起（tools/*.cjs 不参与编译，但入口进程必须重起）
```

## 第 71 轮第三报：acceptance ② 落地（`shot` → `FrameHost.capture`）

用户回"看截图应该没什么问题"后落。**先说清它证明了什么**：`vm.png` 确实生成了（仓库根 `.tmp/`，
1784063 字节）⇒ 落盘那条路是通的；而我看过那张图 —— 1280×720 的**完整** title 帧（背景/人物/标题 logo/
四个按钮/版本号/版权行都在），**没有 HTML 覆盖层**。

但"目视没问题"只覆盖了"产物本身可用"这一半。于是又补了两条可核的判据，才动默认：

| 判据 | 实测 |
|---|---|
| 两条管线抓的是不是**同一画面** | 整窗 1604×903 vs 舞台 1280×720；两方向缩放 **1.2531 / 1.2542**（一致）、宽高比 **1.7763 / 1.7778**（一致）⇒ 同一画面按 DPR ≈1.2535 缩放，**无 letterbox、无额外区域** |
| 覆盖层到底有没有丢 | `dbg-15-fixed-window.png`（整窗那条的产物，1604×903）通体是游戏画面、**没有 HTML 框/条** ⇒ 本 app 的覆盖层为空，游戏窗的内容区**就是画布** |
| 哪条更适合当取证基准 | 舞台那条尺寸**与窗口几何无关**（恒 = 引擎虚拟分辨率 1280×720）⇒ 换窗口/换机器后仍可比；整窗那条会随窗口尺寸/缩放漂 |

### 改了什么

* `shot [名字]` → 走渲染窗 `FrameHost.capture`（B′），产物落点不变（`<仓库根>/.tmp/dbg-<名字>.png`）。
* 旧管线**不删**、降级为**显式**的 `screencap [名字]`（`imgToSendLive` 的换算基准还在它那儿；
  要看"整窗含覆盖层"时也只有它给得出）。
* 两处共用同一步：`rendererCapturePng()` / `writePng()` / `pngSize()`（`capture [路径]` 也改用它，
  三条路径只剩一份取帧与落盘实现）。
* 命令名与管线**一一对应**（acceptance ③ 的命名分裂就此消掉）：`shot` = 舞台 + 固定落点、
  `capture` = 舞台 + 任意路径、`screencap` = 整窗。
* 守卫（`test/agent-workflow.test.ts` 的 ② 那条）改成钉四件事：`shot` 必须走 `screenshotStage`、
  `screencap` 才是 `screenshotWholeWindow`、`screenshotStage` 必须经 `sendDebugQuery` 的 capture
  （不许自己 `capturePage`）、无路径的 `capture` 仍原样透传。

### ★由 ② 带出的连带项（已登记为 acceptance ⑦，⏳ 待定）

`clickimg` 的换算基准（`imgToSendLive`）仍是 `capturePage()` 的**整窗图像像素** ⇒
**它配的是 `screencap` 的产物**。拿 `shot`（舞台 1280×720）的坐标去 `clickimg`，会再被乘一次
`内容区/整窗宽 ≈ 0.798` ⇒ **点偏**。在换基准之前，正确配对是：

* 从 **`shot`** 的图上量坐标 → 用 **`click`**（VM 通道下舞台**就是**虚拟坐标，`CONFIG_XY` 那套）；
* 要 **`clickimg`** → 用 **`screencap`** 的图。

（换基准的好处很实在：VM 通道下是**恒等映射**、DOM 通道下是 1280×720 → 内容区的定比缩放，
还能省掉每次点击的一次 `capturePage()` 往返 —— 但它会改掉 `T-0102` evidence 那族的既有用法，
所以要先有同帧 A/B + 一次真机点选来核。）

### 还缺什么

* ② 的**同帧 A/B**：同一帧上 `shot` 与 `screencap` 各一张并排。现在手上那对不是同帧
  （`vm.png` 是 title、`dbg-*.png` 是 09-23 的 ADV/窗口实验），只是**同画面按 DPR 缩放**这个
  尺寸关系成立 ⇒ 属 ④ 的取样范围，等一次 `dbg:srv` 会话（起会话时顺手就取了）。

## 第 71 轮第四报：`clickimg` 改成**内容区**口径，`capturePage()` 与点击解耦（acceptance ⑦）

用户的决定原话：

> 我直接目视确认了，可以认为142无问题了。将clickimg直接改为基于content的点击，后续可以废弃基于capurePage的了（因为本身携带标题后就不可控）

### 那条"不可控"到底是什么

先把事实摆清（本工程的老规矩：**声明与实盘相符**）：

* `capturePage()` 抓的是**页面**（web contents），**不含 OS 标题栏** —— 若含，纵向缩放会与横向不同；
  实测两方向 1.2531 / 1.2542（一致）⇒ 那张 1604×903 就是内容区按 DPR 放大。
* 但它**确实不可控**，有三条实测依据：① 比例依赖窗口尺寸/DPI（本机内容区 1283×722、DPR 1.25，
  换机器/换缩放就变）；② 每次点击都要现取一次几何，**多一次往返**；③ 历史包袱更糟 ——
  `T-0114` 记着 `shot.cjs` 那份 `toSend` 常数 `(x+28.4)/0.955` 就是"另一台机器 + 标题栏偏移揉在一起"
  标出来的，2026-09-23 本机实测**直接对不上**（点存档列表的行没反应）。

⇒ 结论与用户的判断一致：**点击坐标不该依赖任何"截图"**。

### 改成什么

| 通道 | `clickimg <x> <y>` 的含义 | 送出去的东西 |
|---|---|---|
| DOM（默认） | x,y = **内容区 CSS 像素** | **恒等**（`sendInputEvent` 要的口径就是它） |
| VM（`AMAYUI_DEBUG_INPUT=vm`） | 同上 | 按 `getContentSize()` 折成**虚拟坐标**（`contentToVirtual`，基准 1280×720） |

* 旧的 `imgToSendLive`（`capturePage()` 现算"整窗图像像素 → 内容区"）**已删**。
* `capturePage()` 从此只负责 `screencap` 的产物 ⇒ **坐标换算与截图彻底解耦**。
* `STAGE_W/STAGE_H = 1280/720` 提为常量（= 引擎虚拟分辨率 = `shot` 舞台图尺寸），
  与 `debugCommand.ts` 的坐标口径同一处声明。
* 回执里印**折算结果**（`（内容区 400,325 → 虚拟 399,325）`），`shot` / `screencap` 的回执都印
  `内容区=WxH` ⇒ "点了没反应"时第一件要排除的事（坐标口径）能一眼看到。
* 文件头补「⚠ 三种坐标别混」一节：**内容区 CSS 像素**（`clickimg`）/ **虚拟坐标**（VM 命令表，
  = `shot` 舞台图）/ **整窗图像像素**（`screencap`，只作目视）—— 本机三者数值接近
  （1283×722 / 1280×720 / 1604×903），照抄旧例常常"碰巧能跑"，**换尺寸或 DPI 就分叉**。

### ★必须记住：历史 evidence 里的 clickimg 坐标是**旧口径**

`T-0114/changes.md`、`T-0102/evidence/*.md`、`T-0124/evidence/G6-save-config.md` 里那些
`clickimg 677 181` / `190 865` / `802 400` 是按**整窗图像像素**标的 ⇒ 换成新口径要
**× (内容区/整窗宽) ≈ ×0.80**（本机 1283/1604 = 0.7999）。**重跑那些取证步骤前必须先折一次**。
（这不是"文档写错了"：它们在当时的口径下是对的；口径换了，数字就得跟着换。）

### 守卫

`test/agent-workflow.test.ts` 新增「★T-0142⑦：`clickimg` 按**内容区**口径，且 `capturePage`
不再参与坐标换算」，钉五件事：旧实现 `imgToSendLive` **必须已删**、`contentToVirtual` 存在、
基准是 `STAGE_W = 1280`、**VM 分支必须折算**、**DOM 分支必须恒等**（两边都断言，防"只改了一边"
——那正是会点偏的那种改法）、几何只来自 `getContentSize()`。

## 收口（用户：「可以认为 142 无问题了」）

`doing → done`。**收口依据**（写清楚是谁证的，别让后人以为是自动跑出来的）：

| 判据 | 依据 | 谁做的 |
|---|---|---|
| ① 输入两通道显式可切 | 代码 + 守卫（第 70 轮） | 我 |
| ② `shot` → `FrameHost.capture` | 尺寸关系实测（同画面按 DPR 缩放）+ 用户目视产物 | 我 + 用户 |
| ③ 命令名/帮助两侧一致 | 命令 ↔ 管线一一对应（`shot`/`capture` = B′，`screencap` = 形态 C） | 我 |
| ④ 端到端（经 `applyScenarioEvent`） | **用户真机实测**：VM 通道回执 `已注入 3 个输入事件（cursor, press, release）`（那三个 kind 只有 VM 桥会产出） | 用户 |
| ⑤ `verify` 全绿 | `npm run verify` = exit 0（tests 1694 / pass 1692 / fail 0 / skipped 2） | 我 |
| ⑦ `clickimg` 改内容区口径 | 代码 + 守卫（本文件上一节） | 我 |

★**如实披露未做的两项**（不写成做了）：

1. ④ 里原本点名的「打开 Option → 切分类 → 关闭」**逐步截图**与 `[main]` 日志**未单独留档** ——
   它要独占 `dbg:srv` 若干分钟（与用户实例共用 log/overlay），用户判定不必再补。
2. ② 的**同帧 A/B**（同一帧上 `shot` 与 `screencap` 各一张并排）**未单独产出** ——
   现有依据是"用户目视 + 同画面按 DPR 缩放"的尺寸关系实测。

两项都在同一次 `dbg:srv` 会话里顺手可取；要补时起一次即可。





## 第 71 轮补记：用户实测的反馈暴露了「票面把验收引到看不见的地方」

用户确认走的是 `AMAYUI_DEBUG_INPUT=vm`，回执原文：

```
# amayui debug server（game=true）

已注入 3 个输入事件（cursor, press, release）
```

而 acceptance ① 的原话是「trace 里会出现 `[input] 注入 N 个事件`」。两处都真实存在，但**是同一件事的两种呈现**：

| | 出处 | 文本 |
|---|---|---|
| **回执**（CLI 打给人看的） | `src/renderer/app/session.ts:608` | `已注入 3 个输入事件（cursor, press, release）` |
| **trace**（日志面板里那行） | `src/renderer/app/session.ts:607` | `[input] 注入 3 个事件：cursor, press, release` |

两者都由 `case 'input'`（`session.ts:605` 的 `applyScenarioEvent`）产出。票面只写了 trace ⇒ 用户照着票面
在回执里找不到证据。**这是判据的写法问题，不是工具的问题。**

★**顺带把 ④ 的输入半边钉死了**：`cursor, press, release` 这三个 kind 只有 VM 那条路会产出
（DOM 那条只回 `click x,y`）⇒ "证明经 `applyScenarioEvent`"**成立**。④ 只剩逐步截图 + `[main]` 日志。

### 由此补的第二处差别：坐标口径

顺手核代码时发现两条路的差别**不止**"真 DOM 保真度"一条：

| 通道 | 命令行里那两个数是什么 | 依据 |
|---|---|---|
| DOM（默认） | **内容区 CSS 像素**（`shot.cjs` 的 `CONFIG_XY` 就是这么标的） | `sendInputEvent({x,y})` |
| VM（`AMAYUI_DEBUG_INPUT=vm`） | **虚拟坐标 0..1280 / 0..720** | `debugCommand.ts:197` |

本机内容区 ≈1280×722 CSS（截图 1600×902 ÷ DPR 1.25）**恰好与虚拟系重合** ⇒ 照抄 `CONFIG_XY` 碰巧有效。
**窗口尺寸/缩放一变就会分叉**（那时 VM 通道须按 1280×720 折算，或改走 `clickimg` 的图像坐标）。
这条此前没人写下过，属于"碰巧能跑"型的坑 ⇒ 已写进 `debugsrv.cjs` 文件头（差别四条：两处呈现 / 坐标口径 /
保真度 / 截图管线）与 `dbg.cjs` 的用法示例，并补两条守卫 assert。

### 票面改动

* `acceptance[0]`：两处呈现都写明，并点出「验收看回执即可」。
* 新增 `acceptance[5]`：「两条路的差别必须写全」成为**独立判据**（四条清单 + 守卫）。
* 证据：新增第 4 条锚点 `if (head === 'capture') {`（② 的前置工具面）。
* `tests`：登记 `app/amayui-emulator/test/agent-workflow.test.ts`。

### 状态

* acceptance ① 通道：✅ 已落地 + **用户实测走 VM 桥**（见上）。
* acceptance ②（`shot` → `FrameHost.capture`）：**仍未做**。本轮只把"能对照"补齐；
  改默认行为前要用户看过两张图并回答"差异可否接受"，还要回答 `record.cjs`（同为 `capturePage`）是否一并收。
* acceptance ④（Electron 端到端证据）：**输入半边已成立**，剩逐步截图 + `[main]` 日志。
* `npm run verify` = **exit 0**（tests 1692 / pass 1690 / fail 0 / skipped 2）。

