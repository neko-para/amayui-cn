/**
 * **overlay 层回归**（`src/arch/overlay.ts` + `src/arch/systemPaths.ts`）。
 *
 * 契约（一句话）：**系统存档目录下的一切访问，读 = overlay → base，写 = 只写 overlay。**
 * 这条契约同时保证两件互相拉扯的事：
 *  1. 能**继承**玩家真数据（`SYS4REG.INI` 的显示/声音/文本设置、`SAVE\SAVE.DAT` 里的设置开关）；
 *  2. **永远写不坏**真游戏目录里的任何文件（几十个存档槽就在旁边）。
 *
 * 为什么值得单独守：旧实现（往真存档旁边写 `SAVE.DAT.amayui`、读时优先它）在解码器修好之后
 * 反而把过时设置喂了回来 —— 那次的现场见 `docs-new/03-engine/save-data.md`。
 * 所以这里的断言不是"能用"，而是"**base 一个字节都没变**"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OverlayDir, assertRelative } from '../src/arch/overlay.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import {
  DEFAULT_SYSTEM_DIR_NAME,
  INI_FILE,
  OVERLAY_SUFFIX,
  SAVE_DAT_REL,
  SYSTEM_DIR_ENV,
  OVERLAY_DIR_ENV,
  resolveSystemPaths,
} from '../src/arch/systemPaths.js';
import { encodeSaveData, decodeSaveData } from '../src/vm/saveData.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

/** 造一对临时 base/overlay 目录（base 里预置几个文件，模拟真游戏那份）。 */
function makePair(seed: Record<string, string | Uint8Array> = {}): {
  dir: string;
  base: string;
  overlay: string;
  store: OverlayDir;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amayui-ovl-${process.pid}-`));
  const base = path.join(dir, 'game');
  const overlay = path.join(dir, 'game.overlay');
  fs.mkdirSync(base, { recursive: true });
  for (const [rel, data] of Object.entries(seed)) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  return {
    dir,
    base,
    overlay,
    store: new OverlayDir({ baseDir: base, overlayDir: overlay }),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('★读：overlay 优先、缺失回落 base（并如实报告命中的是哪一侧）', async () => {
  const pair = makePair({ [INI_FILE]: '[message]\r\nMesWinAlpha=8\r\n' });
  try {
    const baseHit = await pair.store.readText(INI_FILE);
    assert.equal(baseHit?.side, 'base', 'overlay 没有 ⇒ 读真游戏那份');
    assert.match(baseHit!.text, /MesWinAlpha=8/);

    await pair.store.write(INI_FILE, '[message]\r\nMesWinAlpha=3\r\n');
    const ovlHit = await pair.store.readText(INI_FILE);
    assert.equal(ovlHit?.side, 'overlay', 'overlay 有了 ⇒ 用它');
    assert.match(ovlHit!.text, /MesWinAlpha=3/);
    assert.equal(
      fs.readFileSync(path.join(pair.base, INI_FILE), 'utf8'),
      '[message]\r\nMesWinAlpha=8\r\n',
      '★base 那份一个字节都不能变',
    );
  } finally {
    pair.cleanup();
  }
});

test('★写：只写 overlay（base 不存在也照写；目录自动建）', async () => {
  const pair = makePair();
  try {
    const target = await pair.store.write(SAVE_DAT_REL, new Uint8Array([1, 2, 3, 4]));
    assert.equal(target, path.join(pair.overlay, 'SAVE', 'SAVE.DAT'));
    assert.equal(fs.existsSync(path.join(pair.base, 'SAVE', 'SAVE.DAT')), false, 'base 侧不该出现文件');
    assert.deepEqual([...fs.readFileSync(target)], [1, 2, 3, 4]);
  } finally {
    pair.cleanup();
  }
});

test('写盘是先写 .$$tmp 再改名（不会留下半截文件）', async () => {
  const pair = makePair();
  try {
    await pair.store.write('SAVE/SAVE.DAT', new Uint8Array([9]));
    const leftovers = fs.readdirSync(path.join(pair.overlay, 'SAVE')).filter((f) => f.includes('$$tmp'));
    assert.deepEqual(leftovers, [], '临时文件必须已被改名掉');
  } finally {
    pair.cleanup();
  }
});

test('路径守卫：绝对路径 / `..` 越界一律拒绝', async () => {
  const pair = makePair();
  try {
    assert.throws(() => assertRelative(path.resolve(REPO, 'x.ini')), /绝对路径/);
    assert.throws(() => assertRelative('../../evil.ini'), /越出/);
    await assert.rejects(pair.store.write('../evil.ini', 'x'), /越出/);
    await assert.rejects(pair.store.read('../../etc/passwd'), /越出/);
  } finally {
    pair.cleanup();
  }
});

test('overlay 与 base 指同一目录 ⇒ 拒绝写（防止把真数据当 overlay）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amayui-same-${process.pid}-`));
  try {
    const store = new OverlayDir({ baseDir: dir, overlayDir: dir });
    assert.rejects(store.write('x.txt', 'y'), /拒绝写/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NodeFileSource：SAVE.DAT 读 overlay → base、写只写 overlay（引擎格式真存档不被覆盖）', async () => {
  // base 里放一份"真存档"（这里用本工程编码造一份当替身，内容与真正要写的不同即可）
  const real = encodeSaveData({ tables: { ints: new Map([['\x0300000005', 1]]), strings: new Map() }, title: 'Real' });
  const pair = makePair({ [SAVE_DAT_REL]: real });
  try {
    const src = new NodeFileSource({ resourceDir: path.join(REPO, 'install'), system: { baseDir: pair.base, overlayDir: pair.overlay } });
    const first = await src.readSaveData();
    assert.ok(first, '能继承 base 那份');
    assert.deepEqual([...first!], [...real], '读到的就是真存档字节');

    const ours = encodeSaveData({ tables: { ints: new Map([['\x0300000005', 1]]), strings: new Map([['\x0500000bbb', 'Amayui CN']]) }, title: 'Ours' });
    await src.writeSaveData(ours);
    assert.deepEqual([...fs.readFileSync(path.join(pair.base, SAVE_DAT_REL))], [...real], '★真存档字节不变');
    assert.deepEqual([...fs.readFileSync(path.join(pair.overlay, SAVE_DAT_REL))], [...ours], '本工程的写到 overlay');

    const second = await src.readSaveData();
    const r = decodeSaveData(second!);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.title, 'Ours', '再次读取命中 overlay');
      assert.equal(r.data.tables.strings.get('\x0500000bbb'), 'Amayui CN');
    }
  } finally {
    pair.cleanup();
  }
});

test('NodeFileSource：配置回写的防丢键棘轮比的是**当前生效**的那份（overlay 优先，否则 base）', async () => {
  const pair = makePair({ [INI_FILE]: '[display]\r\nScreenMode=1\r\n[sound]\r\nMusic=2\r\n' });
  try {
    const src = new NodeFileSource({ resourceDir: path.join(REPO, 'install'), system: { baseDir: pair.base, overlayDir: pair.overlay } });
    // 少键（配置没装载就写回）⇒ 拒绝，overlay 不产生文件
    await src.saveConfig('[display]\r\nScreenMode=1\r\n');
    assert.equal(fs.existsSync(path.join(pair.overlay, INI_FILE)), false, '棘轮拦下了这次写');
    // 等量/更多键 ⇒ 放行
    await src.saveConfig('[display]\r\nScreenMode=0\r\n[sound]\r\nMusic=2\r\n');
    const hit = await src.readConfig();
    assert.equal(hit?.side, 'overlay');
    assert.match(hit!.text, /ScreenMode=0/);
    // base 仍然没人动
    assert.match(fs.readFileSync(path.join(pair.base, INI_FILE), 'utf8'), /ScreenMode=1/);
    // 之后棘轮比的是 overlay 那份（2 个键）：再来一份 1 键的仍然被拒
    await src.saveConfig('[display]\r\nScreenMode=1\r\n');
    assert.match(fs.readFileSync(path.join(pair.overlay, INI_FILE), 'utf8'), /ScreenMode=0/, 'overlay 内容不变');
  } finally {
    pair.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 目录解析：base/overlay 的唯一解析点
// ---------------------------------------------------------------------------

test('resolveSystemPaths：默认 = %LOCALAPPDATA%\\Eushully\\<game> 与其同级 .overlay', () => {
  const p = resolveSystemPaths(REPO, { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' } as NodeJS.ProcessEnv);
  assert.equal(p.baseDir, path.join('C:\\Users\\x\\AppData\\Local', 'Eushully', DEFAULT_SYSTEM_DIR_NAME));
  assert.equal(p.overlayDir, `${p.baseDir}${OVERLAY_SUFFIX}`, 'overlay 与 base 同级');
});

test('resolveSystemPaths：AMAYUI_SYSTEM_DIR / AMAYUI_OVERLAY_DIR 覆盖（相对路径按仓库根解析）', () => {
  const p = resolveSystemPaths(REPO, {
    LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
    [SYSTEM_DIR_ENV]: 'D:\\game',
    [OVERLAY_DIR_ENV]: 'my-overlay',
  } as NodeJS.ProcessEnv);
  assert.equal(p.baseDir, 'D:\\game');
  assert.equal(p.overlayDir, path.join(REPO, 'my-overlay'));
});

test('resolveSystemPaths：旧 AMAYUI_SAVE_DIR（指向 SAVE/ 子目录）按"上一级 = base"兼容', () => {
  const p = resolveSystemPaths(REPO, {
    LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
    AMAYUI_SAVE_DIR: 'C:\\Games\\Tianjie\\SAVE',
  } as NodeJS.ProcessEnv);
  assert.equal(p.baseDir, 'C:\\Games\\Tianjie');
  assert.equal(p.overlayDir, 'C:\\Games\\Tianjie' + OVERLAY_SUFFIX);
});

test('resolveSystemPaths：没有 LOCALAPPDATA（非 Windows/CI）退到仓库 .tmp 下，不抛', () => {
  const p = resolveSystemPaths(REPO, {} as NodeJS.ProcessEnv);
  assert.match(p.baseDir, /\.tmp[\\/]appdata[\\/]Eushully[\\/]/);
  assert.equal(p.overlayDir, `${p.baseDir}${OVERLAY_SUFFIX}`);
});

test('真实 base 目录就在本机（存在则校验结构：SYS4REG.INI + SAVE\\SAVE.DAT 至少有一个）', (t) => {
  const p = resolveSystemPaths(REPO);
  if (!fs.existsSync(p.baseDir)) {
    t.skip(`本机没有 ${p.baseDir}`);
    return;
  }
  const hasIni = fs.existsSync(path.join(p.baseDir, INI_FILE));
  const hasSave = fs.existsSync(path.join(p.baseDir, SAVE_DAT_REL));
  assert.ok(hasIni || hasSave, `${p.baseDir} 里应有 ${INI_FILE} 或 ${SAVE_DAT_REL}`);
  assert.equal(
    p.overlayDir,
    `${p.baseDir}${OVERLAY_SUFFIX}`,
    '默认 overlay 与 base 同级（删掉它即彻底复原）',
  );
});
