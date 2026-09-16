import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 工程根目录 = E:\Games\Eushully\天结
export const ROOT_DIR = path.resolve(__dirname, '..');

// raw 软连接（junction）指向游戏本体目录
export const RAW_DIR = path.join(ROOT_DIR, 'raw');

// install 可运行测试树（全量真拷贝）
export const INSTALL_DIR = path.join(ROOT_DIR, 'install');

// 原始数据（ALF）**解包根**：默认 = install（与游戏同布局的可运行测试树，里面本应含 DATA1-8/ 解包子目录）。
// ★这是**只读基**：AGF 注入的底图、`patch-menu.js` 的未修改 AGERC.DLL、"还原原图"的来源都在
//   `<解包根>/DATA1/` 下 —— **汇编产物只写 install 根**，绝不往这里写（见 `scripts/translate.js`）。
// 某些机器/checkout 的 install 里没有解包子目录（省空间），解包树放在别处（本工程常见：`raw-parts/`，
// 由 `node scripts/alf/unpack_alf.mjs --out raw-parts raw/SYS4INI.BIN` 生成）⇒ 用环境变量指过去：
//   AMAYUI_ORIG_DATA_DIR=raw-parts npm run patch-menu
export const ORIG_DATA_ROOT = path.resolve(ROOT_DIR, process.env.AMAYUI_ORIG_DATA_DIR ?? 'install');
export const ORIG_DATA1_DIR = path.join(ORIG_DATA_ROOT, 'DATA1');

// data：只读比较基线（原始日文，不再修改）；src：可编辑开发源（含翻译语法）
export const SRC_DIR = path.join(ROOT_DIR, 'src');
export const DATA_DIR = path.join(ROOT_DIR, 'data');

// res：工程自有资源（字体资产、SJIS 映射字典、AGERC 资源脚本等）
export const RES_DIR = path.join(ROOT_DIR, 'res');

// res/fonts：cnjp 字体成品与重建基底
export const FONTS_DIR = path.join(RES_DIR, 'fonts');

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
// - AGE-EXTEND.TTF：引擎内置字体文件。实测移除后引擎回退到系统字体设置
//   （ＡＤＶメッセージ 等设置项才真正生效），字体渲染统一走 Amayui CN，无需外挂该文件。
export const EXCLUDED_NAMES = new Set(['天结.exe', 'AGE-EXTEND.TTF']);
export const EXCLUDED_RE = /\.dmp$/i;
