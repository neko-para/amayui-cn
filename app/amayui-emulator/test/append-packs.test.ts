/**
 * 扩展包（APPENDnn.AAI）测试 —— 引擎 `sub_455750`（发现/注册）+ `i143`（激活）的等价物。
 *
 * 覆盖三层：
 *  1. **索引解析**：包号取自 AAI 头 @264（不是文件名）；压缩形态（S4AC，12B 头 + LZSS）与
 *     直读形态（S4AI，头后整段）都要认（引擎魔数门 raw 7883-7892）。
 *  2. **发现/注册**（NodeFileSource）：扫资源根下的 `*.AAI`、按头包号入表；坏包跳过、重复包号后者覆盖；
 *     访问未装载的包 ⇒ `MissingAppendPackError`（引擎「拡張ファイル情報ファイル %d は…」可见异常）。
 *  3. **激活**（0x143 = `i143`）：本体 INIT2 里的 i143 按包号升序逐个派发各包的 `$n$AUTORUN.BIN`（帧 37），
 *     每个跑完 `exit` 走 `-10` 哨兵继续下一条；队列排空后回到发起者的**下一条指令**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAppendPack, parseAppendIndex, resolveFileEntry, type Sys4Index } from '../src/script/alf.js';
import { NodeFileSource } from '../src/arch/nodeFileSource.js';
import { MissingAppendPackError, type FileSource, type ScriptBytes } from '../src/arch/fileSource.js';
import { resolveResourceDir } from '../src/arch/resourceDir.js';
import { parseScriptBytes } from '../src/script/bin.js';
import { Engine } from '../src/vm/engine.js';
import { StubNative } from '../src/vm/native.js';
import { loadScriptData, stepOnce } from '../src/vm/interpreter.js';
import { ExitScript } from '../src/vm/ops.js';
import { dec } from '../src/vm/bits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RES = resolveResourceDir(ROOT);
const hasCorpus = fs.existsSync(path.join(RES, 'SYS4INI.BIN'));

// ---------------------------------------------------------------------------
// 合成 AAI：把一份 TOC 摆到 268 字节处（直读形态 S4AI）
// ---------------------------------------------------------------------------

interface TocFile {
  name: string;
  offset: number;
  length: number;
}

/** 造一个最小的 S4 TOC 缓冲：arcCount=1（归档名 256B）+ fileCount=n + n×80B 文件项。 */
function makeToc(arcName: string, files: TocFile[]): Uint8Array {
  const buf = new Uint8Array(4 + 256 + 4 + files.length * 80);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 1, true); // arcCount
  for (let i = 0; i < Math.min(arcName.length, 255); i++) buf[4 + i] = arcName.charCodeAt(i);
  const filHdr = 4 + 256;
  dv.setUint32(filHdr, files.length, true);
  files.forEach((f, i) => {
    const off = filHdr + 4 + i * 80;
    for (let k = 0; k < Math.min(f.name.length, 63); k++) buf[off + k] = f.name.charCodeAt(k);
    dv.setUint32(off + 64, 0, true); // archiveIndex
    dv.setUint32(off + 68, i, true); // fileIndex
    dv.setUint32(off + 72, f.offset, true);
    dv.setUint32(off + 76, f.length, true);
  });
  return buf;
}

/** 造一个**直读形态**（S4AI）的 AAI：268B 头（@264 = 包号）+ 原始 TOC。 */
function makeRawAai(packNumber: number, arcName: string, files: TocFile[]): Uint8Array {
  const toc = makeToc(arcName, files);
  const out = new Uint8Array(268 + toc.length);
  out.set([0x53, 0x34, 0x41, 0x49], 0); // 'S4AI' = 头后整段直读
  out.set([0x34, 0x35, 0x30], 4); // 版本 3 字节（450）
  new DataView(out.buffer).setUint32(264, packNumber, true); // ★包号
  out.set(toc, 268);
  return out;
}

/** 造一个**直读形态**（S4IN）的 SYS4INI：300B 头 + 空 TOC（arcCount=0 / fileCount=0）。 */
function makeRawSys4Ini(): Uint8Array {
  const out = new Uint8Array(300 + 8);
  out.set([0x53, 0x34, 0x49, 0x4e], 0); // 'S4IN' = 头后整段直读
  out.set([0x34, 0x35, 0x30], 4); // 版本 3 字节
  return out; // TOC = 全 0（arcCount=0、fileCount=0）
}

/** 真语料里某个包内文件的统一 id（`包号<<24 | 包内编号`）。 */
function packFileId(packNo: number, name: string): number {
  const bytes = new Uint8Array(fs.readFileSync(path.join(RES, `APPEND0${packNo}.AAI`)));
  const idx = parseAppendIndex(bytes);
  const i = idx.files.findIndex((f) => f.name === name);
  assert.ok(i >= 0, `包 ${packNo} 里应有 ${name}`);
  return (packNo << 24) | i;
}

// ---------------------------------------------------------------------------
// 1. 索引解析
// ---------------------------------------------------------------------------

test('AAI：包号取自头部 @264（不是文件名）；归档名/文件项解析正确', () => {
  const aai = makeRawAai(7, 'MYEXP.ALF', [
    { name: '$7$AUTORUN.BIN', offset: 0, length: 111 },
    { name: '$7$SC9999.BIN', offset: 111, length: 222 },
  ]);
  const pack = parseAppendPack(aai);
  assert.equal(pack.packNumber, 7, '包号 = 头 @264');
  assert.equal(pack.index.arcCount, 1);
  assert.deepEqual(pack.index.archives, ['MYEXP.ALF']);
  assert.equal(pack.index.files.length, 2);
  assert.equal(pack.index.files[0]!.name, '$7$AUTORUN.BIN');
  assert.equal(pack.index.files[1]!.offset, 111);
  assert.equal(pack.index.files[1]!.length, 222);
  // 直读形态 = 头后整段（没有 12 字节区段头）：parseAppendIndex 与 parseAppendPack 同源
  assert.deepEqual(parseAppendIndex(aai), pack.index);
});

test('AAI：魔数不认识 ⇒ 抛错（引擎「AAIファイルの読み込みに失敗しました」）', () => {
  const bad = makeRawAai(1, 'X.ALF', []);
  bad.set([0x41, 0x41, 0x41, 0x41], 0); // 'AAAA'
  assert.throws(() => parseAppendPack(bad), /魔数不认识/);
  // S4IC（本体索引的魔数）不能被当扩展包收下
  const wrongKind = makeRawAai(1, 'X.ALF', []);
  wrongKind.set([0x53, 0x34, 0x49, 0x43], 0); // 'S4IC'
  assert.throws(() => parseAppendPack(wrongKind), /魔数不认识/);
});

test('真语料：5 个官方包的包号 = 1..5，归档名 = APPEND0n.ALF，文件名带 $n$ 前缀', { skip: !hasCorpus }, () => {
  for (let n = 1; n <= 5; n++) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(RES, `APPEND0${n}.AAI`)));
    const pack = parseAppendPack(bytes);
    assert.equal(pack.packNumber, n, `APPEND0${n}.AAI 头 @264 应为 ${n}`);
    assert.deepEqual(pack.index.archives, [`APPEND0${n}.ALF`]);
    assert.ok(pack.index.files.length > 0);
    assert.ok(
      pack.index.files.every((f) => f.name.startsWith(`$${n}$`)),
      '包内文件名应带 $n$ 前缀',
    );
    assert.equal(pack.index.files[0]!.name, `$${n}$AUTORUN.BIN`, '文件 #0 = $n$AUTORUN.BIN（i143 派发的就是它）');
  }
});

test('id 空间：高字节 = 包号、低 24 位 = 包内编号；判据是高字节是否为 0（与表长无关）', () => {
  const base: Sys4Index = { arcCount: 1, archives: ['B.ALF'], files: [{ name: 'A.BIN', archiveIndex: 0, fileIndex: 0, offset: 0, length: 1 }] };
  const packs: (Sys4Index | null)[] = [];
  packs[3] = parseAppendIndex(makeRawAai(3, 'P3.ALF', [{ name: '$3$AOTRUN.BIN', offset: 5, length: 9 }]));
  assert.equal(resolveFileEntry(0, base, packs)?.name, 'A.BIN', '高字节 0 ⇒ 本体');
  assert.equal(resolveFileEntry(0x3000000, base, packs)?.name, '$3$AOTRUN.BIN', '0x3000000 = 包 3 文件 0');
  assert.equal(resolveFileEntry(0x3000001, base, packs), null, '包内编号越界 ⇒ null');
  assert.equal(resolveFileEntry(0x2000000, base, packs), null, '包未装载 ⇒ null（异常由上层决定）');
  assert.equal(resolveFileEntry(-1, base, packs), null, '负 id ⇒ null');
});

// ---------------------------------------------------------------------------
// 2. 发现 / 注册（NodeFileSource）
// ---------------------------------------------------------------------------

test('NodeFileSource：扫 *.AAI、按头包号注册（与文件名无关）；坏包跳过；越界包号跳过；不递归子目录', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'amayui-append-'));
  try {
    // 文件名叫 APPEND01，但头里写的是 7 ⇒ 注册到 7（引擎就是按头注册的）
    await fsp.writeFile(path.join(dir, 'APPEND01.AAI'), makeRawAai(7, 'A.ALF', [{ name: '$7$X.BIN', offset: 0, length: 4 }]));
    // 非 APPEND0n 命名照样收
    await fsp.writeFile(path.join(dir, 'MYSTERY.AAI'), makeRawAai(2, 'B.ALF', [{ name: '$2$Y.BIN', offset: 0, length: 4 }]));
    // 坏包（魔数不认识）⇒ 跳过，不影响其它包
    const bad = makeRawAai(9, 'C.ALF', []);
    bad.set([0x5a, 0x5a, 0x5a, 0x5a], 0);
    await fsp.writeFile(path.join(dir, 'ZZZ.AAI'), bad);
    // 包号 0 / 300 ⇒ 引擎语义上不可达（槽 0 无人读、槽 ≥256 越界写）⇒ 跳过
    await fsp.writeFile(path.join(dir, 'ZERO.AAI'), makeRawAai(0, 'D.ALF', []));
    await fsp.writeFile(path.join(dir, 'BIG.AAI'), makeRawAai(300, 'E.ALF', []));
    // 子目录里的 AAI 不算（引擎搜索模式是 <CWD>\*.AAI）
    await fsp.mkdir(path.join(dir, 'sub'));
    await fsp.writeFile(path.join(dir, 'sub', 'NESTED.AAI'), makeRawAai(5, 'F.ALF', []));
    // 本体索引（直读形态 S4IN）：resolveEntry 会先读它，再判 id 空间
    await fsp.writeFile(path.join(dir, 'SYS4INI.BIN'), makeRawSys4Ini());

    const logs: string[] = [];
    const src = new NodeFileSource({ resourceDir: dir, log: (m) => logs.push(m) });
    assert.deepEqual(await src.appendPackNumbers(), [2, 7], '只应注册 2 与 7（升序）');
    assert.ok(
      logs.some((l) => l.includes('装载失败')),
      '坏包要留下一行日志（引擎 AAIファイルの読み込みに失敗しました）',
    );
    assert.ok(
      logs.some((l) => l.includes('不在 1..255')),
      '越界包号要留下日志',
    );
    assert.ok(!logs.some((l) => l.includes('NESTED.AAI')), '子目录里的 AAI 不应被发现');

    // 访问未装载的包 ⇒ 引擎同款可见异常
    await assert.rejects(
      () => src.resolveEntry(0x5000000),
      (err: unknown) => {
        assert.ok(err instanceof MissingAppendPackError);
        assert.equal((err as MissingAppendPackError).packNumber, 5);
        assert.match((err as Error).message, /拡張ファイル情報ファイル 5/);
        return true;
      },
    );
    // 已装载的包：低 24 位取文件项
    const hit = await src.resolveEntry(0x7000000);
    assert.equal(hit?.entry.name, '$7$X.BIN');
    assert.equal(hit?.archives[0], 'A.ALF');
    await src.dispose?.();
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. 激活：0x143（i143）
// ---------------------------------------------------------------------------

/** 假 FileSource：只回答"装了哪些包"与"包脚本字节"（包脚本统一给一份 1 指令 = exit 的脚本）。 */
class FakeAppendSource implements FileSource {
  readonly loaded: number[] = [];
  constructor(
    private readonly packs: number[],
    private readonly packScript: Uint8Array,
    private readonly failPack?: number,
  ) {}
  async readFile(): Promise<Uint8Array> {
    throw new Error('unused');
  }
  async appendPackNumbers(): Promise<number[]> {
    return [...this.packs];
  }
  async readScript(index: number): Promise<ScriptBytes | null> {
    this.loaded.push(index);
    const pack = index >>> 24;
    if (this.failPack !== undefined && pack === this.failPack) throw new MissingAppendPackError(pack, index);
    return { index, name: `$${pack}$AUTORUN.BIN`, data: this.packScript };
  }
}

/** 取本体 INIT2 + 其中 i143 的指令下标 + 一份 1 指令（`exit`）的包脚本字节。 */
async function fixture(): Promise<{ init2: ScriptBytes; i143Ip: number; oneExit: Uint8Array }> {
  const real = new NodeFileSource({ resourceDir: RES });
  const init2 = await real.readScript(0x5261); // SYSTEM4.txt:124 call-script 5261 = INIT2
  assert.ok(init2, '应能读到 INIT2.BIN');
  const oneExit = await real.readScript(packFileId(1, '$1$WDINIT.BIN')); // 1 条指令：exit
  assert.ok(oneExit, '应能读到 $1$WDINIT.BIN');
  await real.dispose?.();
  const ip = parseScriptBytes(init2.data).instructions.findIndex((i) => i.opcode === 0x143);
  assert.ok(ip >= 0, 'INIT2 里应有 i143（INIT2.txt:140）');
  return { init2, i143Ip: ip, oneExit: oneExit.data };
}

test('i143：按包号升序逐个派发 $n$AUTORUN（帧 37），排空后回到发起者的下一条指令', { skip: !hasCorpus }, async () => {
  const { init2, i143Ip, oneExit } = await fixture();
  const fake = new FakeAppendSource([3, 1, 2], oneExit); // 故意乱序：引擎按槽序（升序）派发
  const e = new Engine(new StubNative());
  e.fileSource = fake;
  loadScriptData(e, init2.data, init2.name);
  e.frames[0]!.ip = i143Ip;

  // ① i143 本身：派发第 1 条（包 1），控制转到帧 37
  await stepOnce(e);
  assert.equal(e.frames[0]!.ip, i143Ip + 1, '发起者 ip 前进 1 条（引擎 ip += 4）');
  assert.deepEqual(fake.loaded, [0x1000000], '先派发包 1（升序，忽略宿主给的乱序）');
  assert.equal(e.cur, 37, '派发帧 = 37（引擎 sub_40FB60 的 cur=37）');
  assert.equal(e.curScript().name, '$1$AUTORUN.BIN');
  assert.equal(e.curScript().caller, -10, '派发脚本的 caller = -10 哨兵');
  assert.deepEqual(e.scriptRequests, [0x2000000, 0x3000000], '其余请求在队列里');

  // ② 包 1 的 exit → -10 分支：继续派发包 2（帧 37 复用）
  await stepOnce(e);
  assert.equal(e.cur, 37);
  assert.equal(e.curScript().name, '$2$AUTORUN.BIN');
  assert.deepEqual(fake.loaded, [0x1000000, 0x2000000]);

  // ③ 包 2 → 包 3
  await stepOnce(e);
  assert.equal(e.curScript().name, '$3$AUTORUN.BIN');
  assert.deepEqual(fake.loaded, [0x1000000, 0x2000000, 0x3000000]);

  // ④ 包 3 跑完、队列排空 ⇒ 还原现场：回到 INIT2，且它的 ip 已在 i143 之后
  await stepOnce(e);
  assert.equal(e.cur, 0, '还原到发起者帧');
  assert.equal(e.curScript().name, init2.name);
  assert.equal(e.curScript().ip, i143Ip + 1, '★回到下一条指令（不是重跑 i143）');
  assert.deepEqual(e.scriptRequests, []);
  assert.equal(e.dispatchSavedCur, -1, '现场还原后清空保存值');
  assert.equal(e.dispatching, false);
});

test('i143：宿主不提供扩展包表（无 appendPackNumbers）⇒ 静默跳过、ip 前进 1（= 引擎槽全 NULL）', { skip: !hasCorpus }, async () => {
  const { init2, i143Ip } = await fixture();
  const bare: FileSource = {
    readFile: async () => {
      throw new Error('unused');
    },
    readScript: async () => null,
  };
  const e = new Engine(new StubNative());
  e.fileSource = bare;
  loadScriptData(e, init2.data, init2.name);
  e.frames[0]!.ip = i143Ip;
  await stepOnce(e);
  assert.equal(e.cur, 0);
  assert.equal(e.frames[0]!.ip, i143Ip + 1);
  assert.deepEqual(e.scriptRequests, []);
});

test('i143：包未装载 ⇒ 派发时抛 MissingAppendPackError（引擎的可见异常，不是静默）', { skip: !hasCorpus }, async () => {
  const { init2, i143Ip, oneExit } = await fixture();
  const fake = new FakeAppendSource([4], oneExit, 4);
  const e = new Engine(new StubNative());
  e.fileSource = fake;
  loadScriptData(e, init2.data, init2.name);
  e.frames[0]!.ip = i143Ip;
  await assert.rejects(
    () => stepOnce(e),
    (err: unknown) => {
      assert.ok(err instanceof MissingAppendPackError, `应抛 MissingAppendPackError，实际 ${String(err)}`);
      return true;
    },
  );
});

/** 记录 pack AUTORUN（`包号<<24 | 0`）的装载顺序 —— 派发链的观测点。 */
class RecordingSource implements FileSource {
  readonly packLoads: number[] = [];
  constructor(private readonly inner: NodeFileSource) {}
  readFile(p: string): Promise<Uint8Array> {
    return this.inner.readFile(p);
  }
  appendPackNumbers(): Promise<number[]> {
    return this.inner.appendPackNumbers();
  }
  async readScript(index: number): Promise<ScriptBytes | null> {
    const r = await this.inner.readScript(index);
    if (r && (index & 0xffffff) === 0 && index >>> 24 >= 1) this.packLoads.push(index);
    return r;
  }
  dispose(): Promise<void> {
    return this.inner.dispose?.() ?? Promise.resolve();
  }
}

test('★真实语料：跑完 INIT2 的 i143 派发链后，5 包全激活、global 7087f5 第 1..5 位置起', { skip: !hasCorpus }, async () => {
  const inner = new NodeFileSource({ resourceDir: RES });
  const src = new RecordingSource(inner);
  const e = new Engine(new StubNative());
  e.fileSource = src;
  const boot = await src.readScript(0);
  assert.ok(boot, '应能读到 SYSTEM4.BIN');
  loadScriptData(e, boot.data, boot.name);

  // 跑到「5 个包的 AUTORUN 都装载过 + 队列排空（现场已还原）」为止
  let steps = 0;
  const cap = 900000;
  let exited = false;
  while (steps < cap) {
    try {
      await stepOnce(e);
      steps++;
    } catch (err) {
      if (err instanceof ExitScript) {
        exited = true;
        break;
      }
      throw err;
    }
    if (src.packLoads.length >= 5 && e.scriptRequests.length === 0 && e.dispatchSavedCur === -1) break;
  }
  assert.ok(!exited, '不应在派发链跑完前退出程序');
  assert.ok(src.packLoads.length >= 5, `5 个包的 AUTORUN 都应在 ${cap} 步内装载（steps=${steps}）`);
  assert.deepEqual(
    src.packLoads.slice(0, 5),
    [0x1000000, 0x2000000, 0x3000000, 0x4000000, 0x5000000],
    '★派发顺序 = 包号升序（引擎扫 FileDB.packs 槽 1..255）',
  );
  assert.equal(e.scriptRequests.length, 0, '队列已排空');
  assert.equal(e.dispatchSavedCur, -1, '现场已还原（回到 INIT2 帧）');
  // 全局 int 池是**加密存储**的（引擎 ENC/DEC，见 src/vm/bits.ts）⇒ 读之前要 dec
  const mask = dec(e.key, e.globals.int.get(0x7087f5) ?? 0);
  for (let n = 1; n <= 5; n++) {
    assert.ok(
      (mask & (1 << n)) !== 0,
      `第 ${n} 包应已安装：$n$AUTORUN 末尾的 bit-set ⇒ global 7087f5 bit${n}（mask=0x${mask.toString(16)}，steps=${steps}）`,
    );
  }
  await src.dispose();
});
