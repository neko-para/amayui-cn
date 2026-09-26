# T-0182 · before 证据：撤幕那一帧仍是旧场景（TITLE + GAMESTART 配置界面）

## 抓取口径

- 素材：`npm run record -- --scenario tools/scenarios/gamestart.json --out .tmp/flash/gamestart-before.jsonl.gz --centered`
  （2026-09-26，Electron 真宿主；`AMAYUI_RECORD=1` 从启动第一帧起逐帧录 digest）。
- 轨迹文件是 gitignore 的 `.tmp/` 产物 ⇒ 本文件归档**过渡窗口的逐帧摘要**（原始行见轨迹 `frames` 数组）。
- 时间列 = 引擎时钟 `nowMs`；`items` 只列 `flags&1` 且 diffuse α>0 的项（= 真正画出来的），格式 `handle@layer`。

## 逐帧摘要（f1160..f1175）

```
f=1160 t=11737ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#f4000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1161 t=11745ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#f5000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1162 t=11754ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#f6000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1163 t=11762ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#f8000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1164 t=11770ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#f9000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1165 t=11779ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#fb000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1166 t=11787ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#fc000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1167 t=11795ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=3 rect=-0.5,-0.5 1280x720 st0=#00000000 col=#fd000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1168 t=11804ms GAMESTART.BIN:ip=920 wait=0x400 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1169 t=11812ms GAMESTART.BIN:ip=920 wait=0x0 counts={drawItems:29,drawable:29,visible:29,meshes:2}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000 ; 0x30d40@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1170 t=11820ms SETFATE.BIN:ip=33 wait=0x0 counts={drawItems:29,drawable:29,visible:29,meshes:1}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1171 t=12012ms SETFATE.BIN:ip=2 wait=0x0 counts={drawItems:29,drawable:29,visible:29,meshes:1}
    meshes: 0x0@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(29): 0xa@L10 0x3e8@L1000 0x3e9@L1001 0x3ea@L1002 0x44c@L1100 0x4b0@L1200 0x4b1@L1201 0x4ba@L1210 0x4bb@L1211 0x4bc@L1212 0x514@L1300 0x515@L1301 0x516@L1302 0x517@L1303 0x518@L1304 0x519@L1305 0x532@L1330 0x533@L1331 0x534@L1332 0x535@L1333 0x536@L1334 0x537@L1335 0x5dc@L1500 0x5dd@L1501 0x5de@L1502 0x5df@L1503 0x5e0@L1504 0x5e1@L1505 0x640@L1600
    l2d nodes=[key=0x14(可画)]
f=1172 t=12038ms SETFATE.BIN:ip=5 wait=0x0 counts={drawItems:0,drawable:0,visible:0,meshes:0}
    meshes: （无）
    visible items(0): （无）
    l2d nodes=[]
f=1173 t=12094ms SN0000.BIN:ip=752 wait=0x600 counts={drawItems:0,drawable:0,visible:0,meshes:1}
    meshes: 0x19258@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(0): （无）
    l2d nodes=[]
f=1174 t=12121ms SN0000.BIN:ip=752 wait=0x600 counts={drawItems:0,drawable:0,visible:0,meshes:1}
    meshes: 0x19258@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(0): （无）
    l2d nodes=[]
f=1175 t=12130ms SN0000.BIN:ip=752 wait=0x600 counts={drawItems:0,drawable:0,visible:0,meshes:1}
    meshes: 0x19258@L0 flags=1 rect=-0.5,-0.5 1280x720 st0=#ff000000 col=#ff000000
    visible items(0): （无）
    l2d nodes=[]

```

## 判读（哪一帧是"闪"）

| 帧 | 引擎时钟 | 脚本:ip | 幕 0x30d40 | 幕 0x0 | 旧场景绘制项 | 该帧屏幕内容 |
|---|---|---|---|---|---|---|
| f1169 | 11812ms | GAMESTART:920 | **在**（col=#ff000000 = 不透明黑） | 在 | 29 | 黑（渐黑完成） |
| **f1170** | 11820ms | SETFATE:33 | **没了** | 在 | **29（含 0xa@L10 = TITLE 全屏背景、l2d key 0x14 可画、GAMESTART 配置界面 28 项）** | ★**旧画面（TITLE 背景+立绘+配置界面）** |
| **f1171** | 12012ms | SETFATE:2 | **没了** | 在 | **29（同上）** | ★**旧画面** |
| f1172 | 12038ms | SETFATE:5 | 没了 | 没了 | 0 | （`i1f6` 清容器；留帧在这一刻才被武装，太晚） |
| f1173 | 12094ms | SN0000:752 | 没了 | 没了 | 0（新幕 0x19258 = 不透明黑） | 黑（SN0000 的淡入幕） |

- 旧场景项里 `0xa` 的 layer=10、源矩形 1280×720、tex=4 —— 就是 TITLE 的全屏美术（`TITLE.md`：标题画面全部美术建在纹理槽 4）；`l2d key=0x14` 是 TITLE 的 Live2D 立绘节点（`TITLE.txt:589-590 i344 14 0`）。两者一直活到 f1172 的 `i1f6`。
- GAMESTART 的 28 项（layer 1000..1600）是"配置界面"，它在上一次渐黑之后本不该再出现。

## 根因（判据与顶点口径冲突）

```
#coversViewportMeshInRange（pixiBackend.ts）
  要求 Math.min(xs) <= 0 && Math.min(ys) <= 0 && Math.max(xs) >= VIEW_W(1280) && Math.max(ys) >= VIEW_H(720)
语料标准满屏幕布（T-0155 半像素订正后，gfx-item.ts 的 HALF_PIXEL）
  顶点 = (-0.5,-0.5)..(1279.5,719.5)  ⇒ Math.max(xs) = 1279.5 < 1280 ⇒ 判据恒假
```

⇒ `detachTexture h=0x30d40 count=1 REMOVE (drawItems=0, meshes=1)` 之后**不会**出现
`[frame-hold] 满屏幕布 0x30d40 被撤 → 留帧`；留帧要等到 f1172 的 `clearDrawContainer`（`Math.max(hold, 60)`）才武装，
而那一帧旧场景已经呈现过了。对照：`tickets/T-0067/evidence/transition-frame-hold.log`（2026-09-22）里
同一位置**有** `[frame-hold] 满屏幕布 0x19258 被撤 → 留帧最多 60 帧` —— 说明该判据在 T-0155（2026-09-25）之前是成立的。
