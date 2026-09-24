# T-0103 · 现场证据：新游戏路径的 TITLE Live2D 残留（vs 读档路径）

> 来源：本机 headless 调试实例 `t0103`（`node --import tsx src/web/host.ts --instance t0103 --port 0 --attach-headless --idle-sec 0`），
> 驱动方式 = `debug-query`（`{"args":["click <x> <y>"]}` / `{"args":["frame"]}` / `{"args":["capture"]}`）。
> 原日志在 `.tmp/instances/t0103/log/amayui-emulator.log`（**临时区，不是证据落点**）⇒ 关键片段摘录在这里，行号保留。
> 取数时间 2026-09-24。判据字段 = presenter 的节流日志 `[present …] … l2d={槽N 节点M 可画K 纹理T 缓存C}`（`src/renderer/pixi/presenter.ts:566-570/605-616`）。

## 1. 两条路径的对照（同一份日志文件）

| | 新游戏路径（TITLE → Game Start → GAMESTART「ゲーム開始」→ SN0000） | 读档路径（TITLE → Load Data → 槽 78 → SN0000） |
|---|---|---|
| 判据行 | 最后一次 `[call-script] … -> SN0000.BIN` = **line 42091** | 最后一次 `[slot-load] 清掉上一个执行链的 L2D 运行态…` = **line 62368** |
| 之后的 `[present …] l2d={槽1 节点1 …}` 条数 | **513 条** | **0 条** |
| 结论 | TITLE 的 572B 立绘节点（key `0x14`）+ 模型（槽 0）**活过了整条新游戏链** | 节点/槽在装载点被清掉 ⇒ 之后永不出画 |

### 1.1 新游戏路径：进 SN0000 后节点仍在且"可画"

```
（line 42091）  [call-script] 0x74 -> SN0000.BIN (2793 instr)
（line 42095）[present 273229ms] items={无} meshes={0x19258:255/#000000(0,0..1280,720)} slotTex=6 \
              l2d={槽1 节点1 可画1 纹理3 缓存60} 帧间隔 avg=14.1ms … wait=0x400
```

⇒ 该帧 `items={无}`（绘制项一个都没有）、满屏 mesh `0x19258` 是**不透明黑**（α=255）——
L2D 节点**在表里、可画**，只是被 handle 更大的 mesh 盖住（引擎/emulator 都按 key 升序归并；
节点 key `0x14`=20 是最小的一档）。**一旦它上面的东西被撤掉，它就会显形。**

### 1.2 读档路径：装载点"发现"了 TITLE 的残留，然后清掉

```
（line 62368）[slot-load] 清掉上一个执行链的 L2D 运行态：实例槽 1 个 / 立绘节点 1 个（L2D 不在存档 body 里；见 tickets/T-0090）
```

⇒ ★这条日志本身就是反证：**在读档之前，TITLE 的节点与实例槽都还活着**（1 个 / 1 个），
读档点这一刀（`src/vm/handlers/save-slot.ts:321` 的 `l2dResetHost`）把它抹掉，所以读档路径没有这个症状。
也就是说：症状的差别**不是**新游戏"少做了步骤"，而是 **emulator 只有读档点这一处会清 L2D 节点**。

## 2. 引擎口径：本该在 TITLE 退场时就被清掉（脚本确实调了）

* `src/TITLE.txt:820-825`（退场例程）：

  ```
  label_0000384c:
  810: i1f6              ← clearDrawContainer（引擎里会清 4 张表，含 572B 立绘节点表）
  811: release-texture 4
  812: release-texture 5
  813: i23d
  814: i32b
  815: ret
  label_0000388c:
  822: call label_0000384c
  823: poll-input
  824: i19c
  825: exit
  ```

* 引擎 `0x1F6` 的体（`engine/天结_unpacked.exe_utf8.c`，`sub_4AB7A0`）：

  ```
  130699:   sub_40BF80(_this + 258);          // Scene+1032 DrawItem 容器：清
  130764:   sub_40BFE0(v1 + 266);             // Scene+1064 MeshEntry：清
  130765:   sub_4A9D10(v1 + 270);             // Scene+1080 572B-A：清
  130766:   result = sub_4A9D10(v1 + 274);    // Scene+1096 572B-B = **Live2D 立绘节点表**：清
  ```

* 出画门（`sub_4B0360` raw 134316-134320）= `节点[0] bit0 && Scene[13953+节点[4]] != 0`，而帧归并只遍历**表里已有的**
  节点 ⇒ 节点被清 ⇒ 立绘不再出画。★**10 个实例槽不会因此被清**（TITLE 从不调 `i342`），
  所以引擎侧"槽里模型还在、节点没了"是正常状态 —— 缺的是 `0x1F6` 对 572B 表的擦除。

* 因此：真机在同一时刻（`SN0000:3072 exit` → `SC0000:1321` 画章头背景之间）**不会有** TITLE 的立绘；
  本机新游戏路径有 ⇒ 与本票用户口径「本该是黑色，实际却是 TITLE 的 Live2D」一致。

## 3. 复现配方（固化在技能脚本里）

```bash
# ① 起一个带渲染页的实例（同 id 会拒绝并行）
cd app/amayui-emulator && node --import tsx src/web/host.ts --instance t0103 --port 0 --attach-headless --idle-sec 0
# ② 新游戏路径：点 Game Start (1180,372) → 点「ゲーム開始」(811,605) → 进 SN0000
#    读档路径：node .agents/skills/amayui-remote-debug/scripts/load-slot.mjs --instance t0103 --slot 78
# ③ 判据：grep 实例日志的 [present …] 里的 l2d= 字段（新游戏路径应为 节点1；读档路径应为 无）
```

槽文件要能被实例看到：`<repo>/.tmp/instances/t0103/{base,overlay}/SAVE/SAVE78.DAT`（+ `.STH`；加槽后需重起实例）。
