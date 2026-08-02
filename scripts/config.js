import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 工程根目录 = E:\Games\Eushully\天结
export const ROOT_DIR = path.resolve(__dirname, '..');

// raw 软连接（junction）指向游戏本体目录
export const RAW_DIR = path.join(ROOT_DIR, 'raw');

// install 可运行测试树（全量真拷贝）
export const INSTALL_DIR = path.join(ROOT_DIR, 'install');

// 脚本目录
export const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

// raw 的目标：游戏本体目录（如果游戏目录迁移，改这里即可）
export const GAME_DIR = 'E:\\Games\\Eushully\\天結いキャッスルマイスター';

// install 采用全量真拷贝：游戏资源聚合在 ALF 内（含后续要改写的脚本），
// 硬链接可省的空间有限且重打包时有写入波及本体的风险。
// 保留 IMMUTABLE_EXTS 作为扩展点：若未来要恢复“仅对永不可变文件硬链接”，在此声明扩展名即可。
export const IMMUTABLE_EXTS = new Set([]);

// 外层两个 manifest
export const INSTALL_MANIFEST = path.join(ROOT_DIR, 'install-manifest.json');
export const RAW_MANIFEST = path.join(ROOT_DIR, 'raw-manifest.json');

// install 中排除的废弃文件（不进入测试树，也不会被复制）：
// - 天结.exe：心愿屋汉化壳（方案 B 用原版引擎 + 修改数据 + UIF，不需要它）
// - *.dmp：崩溃转储垃圾文件
export const EXCLUDED_NAMES = new Set(['天结.exe']);
export const EXCLUDED_RE = /\.dmp$/i;

// raw manifest 跳过的工作目录（不属于游戏数据，避免快照随开发活动频繁变动）
export const RAW_SKIP_DIRS = new Set(['_analysis', '.claude']);
