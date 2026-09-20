# T-0096 · 过程文档（changes.md）

## 2026-09-20

## 轮 8 · 实现完成（IMPLEMENTATION 子代理 + 主 agent 结算）

**规格**：`tickets/T-0096/design.md`（轮 7 只读分析）。★**真身体 = raw 121131-121655**（票面旧写的 121131-121520 是**截断**的：被截掉的正是第 4 个窗（平移）的全部求值 + 最终 6 次 `D3DXMatrixMultiply` 与 `T(+pivot)`）。

**改动**
| 文件 | 改动 |
|---|---|
| `src/live2d/nodeMatrix.ts` | **新增**（591 行）：`sub_4A07F0` 逐句直译。导出 `l2dComposeNode`（就地推进 4 个窗 + 组合矩阵 + 颜色/alpha）、4 个窗的 `advanceXWindow` 纯函数、`makeNodeWindows`、颜色打包、`syncWindowsFromFields/Back`；模块头含 572B 字段语义 / 4 窗表 / **组合式推导与三个坐标约定** / 颜色窗"输出无消费者但有副作用"的登记 |
| `src/live2d/runtime.ts` | `L2dNode` 补 `wins`（`startedAtMs`/`latched`/`color.from/to`、三窗改 `{delay,dur,from,to}`）、`gate504`、`matrixDirty`、`matrixBase`、`matrix`；`winGate` 补 `+24=0`/`latched=false`/`matrixDirty=true`；三个窗 setter 补写 `delay/dur`；★**`l2dNodeReset` 订正**（旧实现用 `makeNode()` 重建整节点 ⇒ 清了 `wins`；引擎 `sub_4AFC40` 只清 4 块矩阵 + `+76`）；新增 `l2dComposeNodeAt` 门面；三处注释体区间改 `121131-121655` |
| `src/live2d/render.ts` | `l2dNodeTransform` 由恒单位 → **返回 `Affine`（读 `node.matrix`）**；顶点段改 `affineApply(nt, mx, my)` 后**最后**才加 `dx/dy`（引擎顺序） |
| `src/renderer/scene/ops.ts` | `scL2dTick`：动作推进保留 `delta>0` 门，但**合成器每帧每节点都跑**（★首帧 `delta=0` 也要跑 —— `record+24` 的起点锁存在里面） |
| `src/vm/handlers/live2d.ts` | 注释体区间 + "未实现的消费端"改写成"已实现 + 颜色出参被丢" |
| `test/l2d-node-transform-ops.test.ts` | 4 条断言按新 `wins` 结构订正（`value`→`to`、rotation 改 `from/to`），补 `+24`/`+76`/复位保留 `wins` 的断言 |

**守卫**：新增 `test/l2d-node-compose.test.ts`（**18 条**）：组合序 / 4 窗四点（`start+delay`、中点、窗末、窗末+999）/ 起点锁存 / 两道门（`flags&2`、`record[0]&1`）/ `+504` / 旋转（单位轴 + **非单位轴**）/ 颜色（字节序 + 副作用）/ 场景级 `snapshot.l2d.nodes[].rect` 不变量 / **E3：真 `TITLE.MOC` + 3 纹理零回归（`node.matrix === I` 且逐批次 `positions`/`rect` 逐字节相同）**。`test/l2d-node-transform-ops.test.ts` **10/10**。

**验证强度（★本轮最值得一提的是"外部 DLL 当 oracle"）**：E2 = 矩阵数值 + 对**真实第三方 `d3dx9_43.dll`** 的逐步重放对照（探针在 `.tmp/t0096b/`：`D3dxComposeProbe.cs` 把组合链每步行与 3 个点的映射钉下来 ⇒ `a3` 第 4 行 = `[-7,-16,0,1]`；`d3dx-convention-probe.cs` 证明 `D3DXMatrixTranslation(1,0,0)` 的 `m30=1` = **行向量**约定、`Multiply(out,T,S)` 的 `t=(2,0)` = **`pOut = pM1·pM2`**）。子代理自报全量 `909/909 pass` + `tsc` 干净；主 agent 另行复跑（见下）。

**★四条把规格"未确证项"钉死（体/实测）**
1. `dbl_51FB50` = **1000.0**（规格猜 100.0）⇒ `record+64` 的单位是 **alpha×1000**（`.lst` 427476）；
2. `a2[18]` 的立即数 = **`0xFFFFFFFF`**（Hex-Rays 渲染成 `NaN`）（`.lst` 004A0AAC）；
3. **`D3DXMatrixRotationAxis` 内部会归一化轴**（对第三方 DLL 实测：轴 `(0,0,2)` 与 `(0,0,1)` 结果**逐位相同**、`(3,0,4)` 与 `(0.6,0,0.8)` 逐位相同）⇒ `.c` 里"不 normalize 直接传"的净效果就是归一化；
4. **★`pivot` 不是不动点**（规格 §1.6 的"pivot 是缩/旋转中心"**说法错**，点公式本身对）：`T(t)` 在 `T(+p)` **之前** ⇒ `q0 = p` 映到 `p + t`，真正的不动点是 `p − t/(s−1)`。

**★一条 emulator 结构性发现（规格未提）**：引擎用 `+24 == 0` 当"未锁存"哨兵，而 `0` **同时是合法时钟值**（emulator 首帧就是 `scL2dTick(s, 0)`）⇒ 只按 `==0` 判断会**每帧重新锁存、窗永远开不了**（实测踩到并修掉）。加了 emulator 专有位 `wins.latched`（引擎侧不可观测，因为出画时 `M[11625]` 早已 ≫0），已在 `nodeMatrix.ts` 写明。

**未建模 / 未确证（如实登记）**：帧首 alpha 分支（`+64`/`+124`，需模型 vtable，本作语料不可达）；合成结果的 `alpha` 当前**无消费端**（`render.ts` 的批次 opacity 来自模型自己的 `pivotOpacities`）；`+504 bit0` 语义（只确证对 `0x342`-`0x352` 族恒 0，且它在窗块内 ⇒ 没窗在跑时走不到）；`+20`/`+44`/`+500`；`M[11625]` 无写点；轴反向时 `len == 0` 取单位阵（D3DX 那头是 0 除、无定义）；颜色窗无设置端 + 输出被丢弃。

**E4**：`shot` 归主 agent ⇒ **本轮未跑**。TITLE 零回归已用 E3 真资产兜底；INFOEN 正例可达性**未知**（语料确认 `INFOEN.txt:1593/1596` 的 `i349` 平移量是运行时变量、且为负向；`TITLE.txt` 只有 `i34e`+`i344`、**无任何变换指令**）。

**主 agent 结算**：能力台账新增 `live2d-node-matrix-compose`（subsystem Live2D，`modeled-verified`/E3，guard `test/l2d-node-compose.test.ts`，`engine.raw = 121131-121655`）⇒ 134 → **135 条**（已核验 49 → **50**）；`docs-new/03-engine/live2d.md` 的 §5（组合式 + pivot 不是不动点 + 四条钉死口径 + emulator 落点）、§5.1（`+508` 那条"恒为单位阵"的措辞）、§6（未读项重列）已按体订正；`opcode-table.md` 的 `0x346` 行补了**这 8 条字段本身不出画**的消费端说明（含 `+76` 的三个 raw 行号 134048/134081/134119）。
