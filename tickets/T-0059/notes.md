# T-0059 · 过程文档（notes.md）

## 2026-09-17

## 逆向过程与证据（2026-09）

### 1. 容器解码（真槽 = format 3）
- 292 B 头（+240 = payload 逻辑字节数、+284 = format、+288 = aux = SaveVersion2 = 20）
- 20 B 块 {storedDwords, ?, ?, seed1, seed2}；置乱流 = storedDwords 个 dword（2×逻辑 dword）
- 反置乱 = sub_436E90：out = a2 ^ (lo/a3 + (hi/a3)<<16)、a2 += 0x0B0B0B0B、**a3 = (a3 + 2818) & 0xFFFF**（a3 是 u16 会绕回；不绕回就解不出，这是最初的失败原因）
- 前 3 个逻辑 dword = {解压后字节数, 同, 压缩流字节数}，其后 LZSS（sub_436A80 = util/lzss.ts）
- 解压结果前 2 dword = 两个内层 CRC，**都覆盖其后全部 body**；本机 47 个真槽全过（E4）

### 2. body（a4 == 3，sub_410160 raw 19703-19927 读 / sub_40CD10 raw 17464-17672 写）
帧镜像 = 1044*savedCur + 22296 = 21252 B 固定前导 + (savedCur+1) × 1044 B 帧记录：
- +0 savedCur（0xAE 走栈目标）/ +4 savedRet / +8 _this[174713] / +12..51 Engine+84088（40 B）/ +52..1251 100 个解码图槽（12 B 槽）/ +1252..21251 1000 条 20 B 记录
- 第 k 帧记录（261 dword）：[0] 返回帧（frames[k][95795]）/ [1] **脚本统一 id**（sub_40ED40 按它装载）/ [2] 返回栈深度 / [3..] 返回栈（**表 C 下标**）/ [259] **0x71 消息表下标** / [260] **0x3 call-script 表下标**（末帧恒 -1）
池块：24 B 头 {ints, floats, strings, 表A len, 表B len, 表C len} + **定长稀疏 int 池**（本机 1,015,792 项 = 4 MB）+ float 池 + 字符串区长度 + NUL 串 + 三张**全局** ip 表；末尾是图像清单 {740, count, …}
**三个池在文件里是明文**：引擎的 ENC/DEC 只发生在内存侧（key = _this[97059] 每次启动 rand 派生）⇒ 装载直接读、不需要密钥。

### 3. 三张 ip 表 = 脚本头里的三张偏移表（决定性验证）
头 0x24/0x28 = 表1 {len, offset}、0x2c/0x30 = 表2、0x34/0x38 = 表3；**表位置与表项都相对 headerLen**（dword 下标）。
表1/2/3 分别 =
