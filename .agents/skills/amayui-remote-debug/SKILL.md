---
name: amayui-remote-debug
description: 操纵《天結いキャッスルマイスター》emulator 的**调试实例**——发现活实例、起停、注入输入、抓帧看画面、读进度。用 `GET /dsh-emulator/api/__instances` 与磁盘注册表（.tmp/instance.json 与 .tmp/instances/<id>/instance.json）发现实例；用 `node --import tsx app/amayui-emulator/src/web/host.ts --instance <id> [--port 0] [--idle-sec N] [--attach-headless]` 起停；经 DSH 插件的每实例路由 `POST /dsh-emulator/<id>/api/debug-query` 驱动（move/leave/click/press/release/wheel/key/keyup/capture/focus/query）；用 capture 落盘 PNG 看图、用 frame/global 查询读 VM 真值、用宿主日志 `[web] status obs=#N frames=M` 看每步 bin。当用户要求「驱动/操作模拟器实例」「让 agent 自己点游戏」「截一张模拟器当前画面」「看看它跑到哪支 BIN 了」「按 id 给某个实例发命令」「起一个不依赖人看着的调试实例」时使用。引擎语义请走 amayui-engine-analysis / amayui-script-analysis，本技能只管"怎么把它驱动起来并看到画面"。
---

# amayui-remote-debug —— 操纵远程调试实例（发现 → 起停 → 驱动 → 读结果）

> 定位：本技能只回答**怎么把一个 emulator 实例驱动起来、把画面拿回来、把进度读出来**。
> **不回答**引擎/脚本语义（那是 `amayui-engine-analysis` / `amayui-script-analysis`），
> 也**不改任何生产代码**（纯手册）。
>
> 全部命令与坐标都**对当前实现逐条复核过**（写清引用位置）；**没验证的一律标「待核」**。

---

## 0. 三十秒版

```bash
# ① 起一个"agent 自己就能驱动"的实例（不需要人打开面板）
cd app/amayui-emulator
node --import tsx src/web/host.ts --instance dbg-a --port 0 --attach-headless --idle-sec 0

# ② 另开终端：读它跑到哪了（帧栈 = VM 真值）
B=http://127.0.0.1:3080/dsh-emulator/dbg-a/api/debug-query
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["frame"]}'    # 找 ←cur 那一行

# ③ 抓一帧看画面（★2026-09-25 起 **宿主直接落盘**：回执里没有图像数据）
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["capture"]}'   # → {path,dir,bytes,width,height}
#    图 = <dir>/<path>（`dir` 是绝对路径；缺省实例 = <repo>/.tmp/emudbg）

# ④ 点一下（虚拟坐标 1280×720）
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["click 807 621"]}'
```

★**为什么要 `--attach-headless`**：web 形态下 **VM 跑在页面里**，没有页面附着的实例
`/health` 正常但 `debug-query` **必然 503**。加了它，宿主自己附一个隐藏渲染页 ⇒ 不依赖人。
（`T-0140`；缺省关，因为要起一个 Electron 渲染进程。）

---

## 1. 发现：有哪些活实例

```bash
curl -s http://127.0.0.1:3080/dsh-emulator/api/__instances
```

```jsonc
{ "instances": [ { "id":"dbg-a", "port":53819, "startedAt":…, "heartbeatAt":…,
                   "bin":"TITLE.BIN", "frames":1234, "gate":"sleep", "viewers":1 } ],
  "root":"<repo>", "tmpDir":"<repo>/.tmp", "registryDir":"<repo>/.tmp/instances",
  "staleMs":20000 }
```

* 端点实现：`plugins/amayui-emulator/lib/index.js`（`INSTANCES_API`，注释在 `:28`）。
* **注册表两种落点**（两侧扫描、按 id 去重；`app/amayui-emulator/src/host/registry.ts` 的 `listInstances`）：

  | 落点 | 谁写的 |
  |---|---|
  | `<repo>/.tmp/instance.json` | **缺省实例**（起的时候没给 `--instance`） |
  | `<repo>/.tmp/instances/<id>/instance.json` | **具名实例**（`--instance dbg-a`） |

* **活实例判据**（两处口径一致）：`pid` 活着 **且** `heartbeatAt` 不早于 **20 秒**前
  （宿主每 **5s** 刷一次；`STALE_MS`/`HEARTBEAT_STALE_MS` = 20000）。
  ⇒ **`kill -9` 留下的死记录不会挡住重启**，也不会在列表里装活。
* **`viewers`** = 该实例的活 SSE 观察者数 = **有几个渲染页在跑它的 VM**。
  `>1` ⇒ **两个 VM 抢同一份 overlay/log**（见 §5）。
* 磁盘上直接看（插件没起来时也能用）：

  ```bash
  cat <repo>/.tmp/instances/dbg-a/instance.json     # { id, pid, port, host, repoRoot, startedAt, heartbeatAt, lastStatus:{bin,frames,gate} }
  ```

---

## 2. 起停

```bash
cd app/amayui-emulator
node --import tsx src/web/host.ts --instance <id> [--port 0] [--idle-sec N] [--attach-headless] [--dist-dir <dir>]
```

| 参数 | 语义 |
|---|---|
| `--instance <id>` | 实例身份：决定 `.tmp/instances/<id>/` 与注册表条目。**同 id = 同一份 overlay/log** |
| `--port 0` | 让 OS 分配端口（真实端口从 `/health` 或注册表读；缺省 8899） |
| `--bind 127.0.0.1` | 缺省且**推荐**；这套路由**没有认证** |
| `--idle-sec N` | **闲置自停**阈值（秒；缺省 `600`，`0` = 关）。判据：**无观察者且无任何请求**持续超过 N ⇒ 写日志、删注册项、退 0；**磁盘状态保留** |
| `--attach-headless` | 宿主自持一个**隐藏渲染页**（`show:false`）⇒ agent 不依赖人就能驱动（`T-0140`）。也可用 env `AMAYUI_ATTACH_HEADLESS=1` |
| `--dist-dir <dir>` | 静态产物目录（缺省 `<repo>/app/amayui-emulator/dist/web`）；守卫测试用它指向临时目录 |

* **同 id 互斥**：已有活记录时第二个同 id 会**拒绝启动**并打印 `实例 <id> 已在运行 pid=… port=…`
  （先拒、绝不静默抢 overlay/log）。要并行就换 id。
* **磁盘状态保留、内存不保留**：overlay / log / trace / replay 都在磁盘上（重起还在），
  但 VM 进度、帧计数、场景状态**全丢**（下次从 `ALINIT` 重跑）。⛔ 别把"重起"当"恢复现场"。
* 停：CLI 里 `Ctrl-C`，或对进程发 `SIGTERM`（两条都走 `close()`：摘注册项 + 收掉自持的无头页）。
* **产物前提**：`dist/web/` 必须已构建，否则页面打不开（`{"error":"not found: index.html"}`）：

  ```bash
  cd app/amayui-emulator && node build-electron.mjs
  ```

  宿主启动时会自检并打一条带绝对路径与上面这条命令的告警（`T-0143`）。

---

## 3. 驱动：命令表（唯一真源 `src/vm/debugCommand.ts`）

```bash
B=http://127.0.0.1:3080/dsh-emulator/<id>/api/debug-query
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["<命令>"]}'
```

**坐标语义 = 引擎虚拟坐标 `1280×720`**（不是页面像素、不是窗口像素）。所有命令：

| 命令 | 用法 | 说明 |
|---|---|---|
| `move` | `move <x> <y>` | 移光标（`cursor` 事件） |
| `leave` | `leave` | **光标出窗**（`valid:false`）—— 悬停复位/收起菜单用得到 |
| `click` | `click <x> <y> [左\|右]` | 一次完整点击 = `cursor` + `press` + `release`（`右`/`right`/`r` = 右键） |
| `press` | `press <x> <y> [左\|右]` | 按住（拖拽起点） |
| `release` | `release` / `release 右` / `release <x> <y> [左\|右]` | 松开（三种写法都收） |
| `wheel` | `wheel <±120> [x y]` | 滚轮；`-120` = 下滚一格。给了坐标会顺带移光标 |
| `key` | `key <vk>` | 键**按下**（Windows 虚拟键码，如 `38`=↑、`13`=Enter） |
| `keyup` | `keyup <vk>` | 键**释放**（长按要成对发） |
| `capture` | `capture` | 抓一帧 → 结果带 `path`/`dir`/`bytes`（**PNG 已由宿主落盘，回执里没有图像数据**）。**只认裸命令** |
| `focus` | `focus auto\|on\|off` | 宿主焦点模式（无参 = `auto`）。`on` = 调试器显式接管 |
| `help` / `?` | | 命令帮助；**非法参数不会抛错**，而是当查询回报一句"用法…" |
| **查询** | `global <下标> [count]` / `local <下标>` / `frame [下标\|all]` / `flocal <帧> <下标>` | 读 VM 真值（见 §4.2） |

### 3.1 ★两条必须知道的输入语义

1. **hover 靠"位置变化"触发**：`InputManager.setCursor(x,y)` 只在 `x/y` **真的变了**时才置
   `mouseMoved` / `hitTestPending` 并做命中测试（`src/vm/input.ts:250-265`）。
   ⇒ **对同一点连发两次 `move` 不会产生第二次 hover**。要重触发就先 `move` 到别处（或 `leave`）再移回来。
2. **一次 `click` 是三连事件**（`cursor`+`press`+`release`），所以它**天然会**先移动再点；
   但如果目标界面需要"先悬停若干帧让菜单展开/高亮"再点，就得拆成 `move …` → 等几帧 → `press`/`release`。
3. 命令的执行侧是**渲染页**（`session.ts` 用共享的 `applyScenarioEvent` 逐个事件落到 `InputManager`，
   不经 DOM ⇒ 浏览器宿主与 Electron 宿主同一套词汇）。

### 3.2 ★读档固定流程（`scripts/load-slot.mjs`）—— 后续大量读档就用它，别每次重对坐标

```bash
# 从 TITLE 起跑（若已在存档列表也能接着用）：载入槽 78 并做日志判据
node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --instance t0103 --slot 78
node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --list     # 只列活实例 + 槽目录口径
```

* **前置**：实例活着且 `viewers ≥ 1`（`--attach-headless`，否则 debug-query 503）；槽文件要能被该实例的文件源看到
  （`<repo>/.tmp/instances/<id>/{overlay,base}/SAVE/SAVE<NN>.DAT`；槽缓存是启动时建的 ⇒ **加槽后要重起实例**）。
* **判据**：日志出现 `[slot-load]`（退出码 0/1/2 = 成功 / 起跑状态问题 / 载入未发生）。日志**不含槽号**
  ⇒ 「载入的是不是目标槽」要用内容指纹核（`src/tools/slotThumbPng.ts <SAVE78.STH> out.png` 或 `capture` 看画面）。
* **已实测的坐标与坑**（2026-09-24，`debug-query` 虚拟坐标 = `capture` 的 1280×720 像素坐标）：
  Load Data `(1070,480)`；页号按钮「N0」`(606 + 42*N, 30)`（页 0 → x606、页 70 → x900，绿高亮像素扫描标定）；
  第 i 行 `y = 90 + 60*i`（行分隔带 64/124/…/604）；LOAD `(145,686)`；确认「是」`(636,321)`。
  ★**左右大箭头到底能不能点：证据互相矛盾，别当结论抄**（2026-09-25 更新）：
  · **能点**：用户明确说「两侧的三角形箭头（这个我测试是可用的了，和之前不一样）」；
    独立一轮实测用 `(1231,358)` **连续两次成功翻页**（截图 `after-arrow.png` = 槽 080-089、
    `page90.png` = 090-099，且该页那一帧的 `profile` 报告可查）。
  · **点不动**：本文旧记录 `(41,359)`/`(1238,359)` 点了不翻页；另一次独立验收在 `(1231,358)`
    也没翻页（但那次实例的 base 是**隔离的空存档目录**）。
  ⇒ 未收敛。**稳的做法**：先用 `capture` 现量落点（像素坐标 = 虚拟坐标 1:1），
    点了没反应就换**页号按钮**（下面的 `(606 + 42*N, 30)`，那条多种场合都验过），
    并用 `wait`/`run` 看脚本名与 cur 有没有变来判"到底动没动"。
  ★**别用 `tools/shot.cjs --load N` 当"载入第 N 槽"**：它自陈只是标记，实际载入列表当前行（`shot.cjs:254-256`）。

---

## 4. 读结果

### 4.1 抓帧 + 看图

```bash
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["capture"]}'
# → {"ok":true,"path":"capture-20260925-131502-1234.png","dir":"<abs>/.tmp/emudbg","bytes":1712345,…}
```

* ★**PNG 由宿主直接写盘**（`tickets/T-0180` ②）：渲染页把字节按 `application/octet-stream` 上送给宿主，
  宿主落到 `layout.debugArtifactDir`（缺省实例 = `<repo>/.tmp/emudbg`，具名实例 = `<实例根>/emudbg`），
  回执只带 `path`/`dir`/`bytes` ⇒ 那条 JSON 腿**不再搬 2.38MB 的 base64**
  （旧宿主/旧 preload 没有那条通道时**仍会**回退成 `png`（base64）字段 —— 看到它就是宿主太旧）。
* 图是**引擎虚拟视口 1280×720**（与窗口大小无关）。落盘后直接用看图工具/`read_image` 打开 `<dir>/<path>`。
* **DSH 插件**（`amayui_emulator` 的 `action=capture`）还会读回那份量尺寸，返回 `{path,bytes,width,height}`；
  传 `out` 可改名（宿主那份会被**搬**过去，不重复写）。
* 走的是页面内读回（`FrameHost.capture` → Pixi stage canvas），**不是** Electron 的 `capturePage()`。
* **命令名叫 `capture`，不叫 `shot`**：`shot` 被 `tools/debugsrv.cjs` 在**主进程**截获（走 `capturePage()`），
  对 `debug-query` 发 `shot` 永远收不到（`debugCommand.ts:147-149` 的注释就是记这个坑的）。

### 4.2 读 VM 真值（不用截图猜）

```bash
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["frame"]}'
```

```text
cur=3  帧数=40（活帧 11，空槽 29，已折叠）  key=0
  [0] SYSTEM4.BIN scriptId=0x0 ip=137/545 caller=-1 …
  [2] CONFIG.BIN  scriptId=0x34 ip=40/426 caller=1
  [3] CONFIG1.BIN scriptId=0x51cc ip=48/2378 caller=2  ←cur
```

* `←cur` 那一行 = **当前正在跑的脚本**（`bin` 的真值，比注册表心跳**实时**）。
* `global <下标>` 读全局 int 槽并给**解码值 + 原始编码值**（例：`global 12721e` → `4 (0x4) [raw 0x10000]`）。
* 非法查询会回一句"未知查询 + 可用查询列表"（不抛错）。

### 4.3 看进度 / 每步 bin

* **注册表**（每 5s 刷，**滞后可达 5s**）：`instance.json` 的 `lastStatus.{bin,frames,gate}`，
  或 `GET /dsh-emulator/<id>/health` 的 `viewers`/`viewersWarn`。
* **宿主日志**（实时、每步一条）：`[web] status obs=#<观察者序号> frames=<N> {…}`。
  * `obs=#N` = **哪个页面**报的（`#0` 常是宿主自持的无头页）。★多页面时**必须按 `obs` 拆开看**，
    否则两套 `frames` 计数器交错，看起来像"同一实例的帧数往回跳"（`T-0138` 踩过）。
  * 宿主日志在**起实例那个终端的 stdout**；无头页自己的输出带 `[headless]` 前缀。
* 想判"**实例有没有被重启**"：看 `pid`/`startedAt`（注册表）**与**宿主日志里启动链是否被**连续重现**
  —— ⛔ 不要只看 `frames` 单调性（它会被多观察者搅乱）。

---

## 5. 硬约束与已知坑

| # | 约束 / 坑 | 后果与对策 |
|---|---|---|
| 1 | **没有渲染页 ⇒ `debug-query` 必然 503** | web 形态下 VM 活在页面里。加 `--attach-headless`，或让人在 DSH 面板里选中该实例 |
| 2 | 抓帧命令是 **`capture`**（`shot` 被主进程截获） | 发 `shot` 会没有回应；见 `debugCommand.ts:147` |
| 3 | `AMAYUI_DEBUG_QUERY_TIMEOUT_MS`（缺省 8000ms） | 页面卡住时 504；"没渲染页"是 503 ⇒ **两者语义不同**（宿主 `host.ts` 的 /api/debug-query 分支） |
| 4 | **同一时刻只跑一个 Electron / `npm run verify`** | 会抢窗口与 `.tmp` 日志（`shot`/`record`/`verify` 都属于这类） |
| 5 | **`viewers > 1` = 两个 VM 抢同一份 overlay/log** | 宿主会打 `⚠ 第二渲染者…`，`/health` 里 `viewersWarn:true`。**浏览器刷新**会造成瞬时 `viewers=2`（正常）；长期 >1 就要关掉多余页面 |
| 6 | 面板「收起」**不杀会话** | iframe 仍挂 DOM（`visibility:hidden`）。但被隐藏的页面**可能被浏览器节流**（帧变慢）⇒ 要盯着跑就别收起 |
| 7 | **同 id 互斥** | 第二个同 id 拒绝启动；并行请换 id（各自独立的 overlay/log） |
| 8 | 闲置自停会**悄悄退 0** | 想让它常驻：`--idle-sec 0`；`viewers>0` 期间不会自停 |
| 9 | 注册表心跳**滞后 5s** | 刚点完就读注册表会读到上一状态 ⇒ **要即时真值就用 §4.2 的 `frame`** |
| 10 | 坐标是**虚拟 1280×720** | 与窗口/DPR 无关；面板缩放（0.5×/0.25×）也不影响 |
| 11 | 悬停靠**位置变化** | 同一点重复 `move` 无效（§3.1） |

---

## 6. 两个可复制的完整示例

> 两条都在本机实测过（2026-09-23，实例 `t141`，`--attach-headless`，`viewers` 恒 = 1）。
> 坐标口径与"期望观察"都写明了出处。

### 示例 A：起实例 → 等 TITLE → 抓帧看图

```bash
cd app/amayui-emulator
node --import tsx src/web/host.ts --instance demo-a --port 0 --attach-headless --idle-sec 0
# 另开终端：
B=http://127.0.0.1:3080/dsh-emulator/demo-a/api/debug-query
sleep 15
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["frame"]}'   # 期望出现 TITLE.BIN ←cur
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["capture"]}' > /tmp/title.json
```

**期望观察**：`frame` 的 `←cur` 是 `TITLE.BIN`；宿主落盘的 PNG 是 **1280×720** 的标题画面
（实测约 1.7MB，内容 = 「天結いキャッスルマイスター」标题 + Game Start / Load Data /
Eushully-chan Room / Option / Quit）。

### 示例 B：打开 OPTION → 切分类（坐标**已验证**）

左侧分类的贴片画在 `(24, 106+50i)`、尺寸 `190×26`（口径见 `src/tools/config1Chain.ts` 的注释）。
**分类 ↔ 脚本的真源是 `src/CONFIG.txt:51`**：只有当前分类 `12721e == 4` 才载入 `CONFIG2`。

| # | 分类 | 点击坐标（已验证） | 期望当前脚本 |
|---|---|---|---|
| 1 | 系统设定 | `(120, 119)` | `CONFIG1.BIN` |
| 2 | 游戏设定 | `(120, 169)` | `CONFIG1.BIN` |
| 3 | ADV设定 | `(120, 219)` | `CONFIG1.BIN` （★换页发生在 CONFIG1 **内部**，bin 不变） |
| 4 | 声音设定 | `(120, 269)` | `CONFIG1.BIN` |
| 5 | **角色设定** | `(120, 319)` | **`CONFIG2.BIN`** |
| 6 | 操作设定 | `(120, 369)` | `CONFIG1.BIN` |

```bash
B=http://127.0.0.1:3080/dsh-emulator/demo-a/api/debug-query
# ① 打开 OPTION：TITLE 菜单第 3 项（CONFIG）中心 —— 口径 src/tools/config1Chain.ts:51 `CONFIG_XY = [807,621]`
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["click 807 621"]}'
sleep 3
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["frame"]}'    # 期望 … > CONFIG.BIN > CONFIG1.BIN ←cur
# ② 切到第 5 项「角色设定」（唯一会进 CONFIG2 的那一页）
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["click 120 319"]}'
sleep 2
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["frame"]}'    # 期望 … > CONFIG.BIN > CONFIG2.BIN ←cur
curl -s -X POST $B -H 'content-type: application/json' -d '{"args":["capture"]}' > /tmp/cfg2.json
```

**期望观察**：第 ① 步后 `←cur` 变 `CONFIG1.BIN`（页面标题「系统设定」）；
第 ② 步后变 **`CONFIG2.BIN`**（页面标题「角色设定」、9 个角色位、左侧「角色设定」高亮）。

**★命中带实测**（`T-0141`：x=120 逐 y 扫 + 每次读 `global 12721e`）：
真实命中带是 **`y = 100+50i .. 149+50i`**（每项**整 50 高、无缝隙**），
比上面那个 26 高的**绘制**贴片更高 —— 两者不是一回事：

* 上表那些**中心坐标全部落在正确项内**（实测 6/6 命中），**可以放心用**；
* 但**别拿贴片矩形去推边界**：`y = 150` 已经是第 2 项（不是第 1 项的下边界）；
* `y ≥ 400` 落到下方「初始化本页 / 初始化全部」区（点了会把分类重置回 0）。

**待核 / 未验证**（别当结论用）：

* 底部「初始化本页 / 初始化全部 / 返回」三个按钮的**精确**命中矩形（只知 y≥400 是那个区域，未逐个量）；
* 其它界面（存档页、ADV 推进、列表滚动…）的坐标：`T-0109`/`T-0067`/`T-0051` 等票里有各自的进度，
  用之前先看那张票，不要照搬本手册。

---

## 7. 边界（本技能不做什么）

* **不解释引擎/脚本语义**：某个 opcode 什么行为、某支 BIN 是什么页面、字段含义 ——
  走 `amayui-engine-analysis` / `amayui-script-analysis`（那边有 `analysis/functions.json`、
  `analysis/scripts.json`、`docs-new/03-engine/*`）。
* **不改生产代码**：本技能是手册。（要记录"驱动不了 / 行为不对"就开票，走 `amayui-ticket-ledger`。）
* **不代跑批处理**：要顺次驱动几十次，那是 `batch-task-runner` 的事。
