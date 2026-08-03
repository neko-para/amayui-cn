# 天結いキャッスルマイスター 工程脚本

## 结构

```
E:\Games\Eushully\天結\
├── raw\       软连接(junction) -> 游戏本体目录(只读参照)
├── install\   可运行测试树（与本体完全独立的全量真拷贝，含 DATA1-8 解包目录）
├── data\      文案语料（341 个反汇编 txt，松散版基线，由人工编辑）
├── scripts\   本脚本目录
├── install-manifest.json   install 文件 MD5
└── raw-manifest.json       raw（游戏本体）文件 MD5
```

## 使用

```bash
cd scripts
npm run setup              # 创建 raw 软连接 + install 全量真拷贝（幂等）
npm run setup -- --rebuild # 删除并重建 install（按当前规则）
npm run setup -- --prune   # 清理 install 中已被排除的废弃文件
npm run verify             # 校验 install 均为独立副本、无硬链接、无缺失
npm run manifest           # 生成/更新 install-manifest.json
npm run manifest-raw       # 生成/更新 raw-manifest.json
npm run manifest-all       # 同时更新两份 manifest
npm run check              # 对照 install-manifest 检查 install 改动
npm run compare            # 对照 raw-manifest 比较 install 与 raw 是否一致
```

## 文件策略（config.js）

- install 为**全量真拷贝**：游戏资源聚合在 ALF 内（含后续要改写的脚本），硬链接可省空间有限，
  且重打包时有写入波及本体的风险，故不做硬链接。
- 排除（不进入 install）：`天结.exe`（心愿屋汉化壳，方案 B 弃用）、`*.dmp`（崩溃转储）。
- `IMMUTABLE_EXTS` 保留为扩展点：将来若确定某类文件永不可变，可恢复对其硬链接。

游戏本体目录不会被修改；install 树里修改文案文件即可测试。

## manifest 说明

- `install-manifest.json`：install 中每个文件（相对 install 根）的 MD5，追踪改动。
- `raw-manifest.json`：raw（即游戏本体）文件的 MD5，作为原始基线；
  跳过 `_analysis`、`.claude` 等开发工作目录（见 config.js 的 RAW_SKIP_DIRS）。
- `npm run compare` 基于两份 manifest 对比：install 与 raw 不一致、缺失、多出的文件都会列出
  （排除项除外），不重新哈希，秒级完成。

注意：`manifest/manifest-all` 会重新读取全部文件（install 7.5GB + raw 7.5GB），耗时约 1-2 分钟。
