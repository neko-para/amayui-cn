/**
 * **Live2D 资产装配**（宿主侧；把 `.MOC` / PNG / `.MTN` 读进来接到运行态上）。
 *
 * 为什么单独一层：opcode handler 只能调 `NativeBridge.l2d*`（同步/异步缝），而"读字节 → 解析 →
 * 写运行态"这段在**两个宿主里是同一份逻辑**（Pixi 与 headless 必须一致，否则"报告说装了、画面没装"）。
 * 宿主只需提供 `loadById`（统一文件 id → 文件名字节）。
 *
 * ## id 口径
 * `0x341`/`0x345`/`0x34E` 的 op1 是**统一文件 id**（见 `resource-loading.md` §1），
 * 由 `FileSource` 的 id→(归档,偏移,长度) 表解析（`NodeFileSource.readById` / IPC 侧等价物）。
 */
import { parseMoc, type MocModel } from './moc.js';
import { parseMtn, type Mtn } from './mtn.js';
import { l2dBindTexture, l2dLoadModel, l2dStartMotion, type L2dHost } from './runtime.js';

/** 统一文件 id → 文件名 + 原始字节（`FileSource.readById` 的子集）。 */
export interface Live2dAssetSource {
  loadById(id: number): Promise<{ name: string; data: Uint8Array } | null>;
}

export interface Live2dLoadLog {
  (msg: string): void;
}

/** 解析缓存：同一次会话里同一 id 只解析一次（引擎侧 `0x341` 的"槽非空先析构再建"仍照做）。 */
export const mocCache = new WeakMap<Live2dAssetSource, Map<number, MocModel>>();

function cacheFor(src: Live2dAssetSource): Map<number, MocModel> {
  let m = mocCache.get(src);
  if (!m) {
    m = new Map();
    mocCache.set(src, m);
  }
  return m;
}

/**
 * 装 `.MOC` 进实例槽（`0x341` 的宿主侧）。
 *
 * **失败语义**：引擎读文件/解析失败会抛「L2Dモデルファイル %s の読み込みに失敗しました」（raw 34488）；
 * 宿主侧没有可抛的调用栈（异步缝已返回）⇒ 这里记一条日志并**保持槽为空**，
 * 而槽为空本身就会让 572B 节点整块不出画（引擎同一条门控 raw 134320）—— 症状与真机"文件坏了"一致。
 */
export async function loadModelIntoSlot(
  src: Live2dAssetSource,
  host: L2dHost,
  fileId: number,
  slot: number,
  log?: Live2dLoadLog,
): Promise<MocModel | null> {
  let model = cacheFor(src).get(fileId);
  if (!model) {
    const bytes = await src.loadById(fileId);
    if (!bytes) {
      log?.(`[l2d] 0x341：文件 id 0x${fileId.toString(16)} 取不到 ⇒ 槽 ${slot} 保持为空（节点不出画）`);
      return null;
    }
    try {
      model = parseMoc(bytes.data);
    } catch (e) {
      log?.(`[l2d] 0x341：${bytes.name} 解析失败（${(e as Error).message}）⇒ 槽 ${slot} 保持为空`);
      return null;
    }
    cacheFor(src).set(fileId, model);
  }
  l2dLoadModel(host, slot, fileId, model);
  return model;
}

/**
 * 装纹理（`0x345` 的宿主侧）。
 *
 * 运行态只记"模型内纹理号 → 纹理文件 id"（`l2dBindTexture`）；**真正的图像解码由渲染宿主做**
 * （Pixi 侧按 id 取 PNG 建纹理，headless 侧只需要 id 就能出报告/snapshot）。
 * ⇒ 这里只验"文件在不在"（不在就记一条），不做解码。
 */
export async function bindTextureToSlot(
  src: Live2dAssetSource,
  host: L2dHost,
  fileId: number,
  slot: number,
  textureNo: number,
  log?: Live2dLoadLog,
): Promise<boolean> {
  const bytes = await src.loadById(fileId);
  if (!bytes) {
    log?.(`[l2d] 0x345：纹理 id 0x${fileId.toString(16)} 取不到 ⇒ 槽 ${slot} 纹理 ${textureNo} 无图`);
    return false;
  }
  l2dBindTexture(host, slot, fileId, textureNo);
  return true;
}

/** `.MTN` 解析缓存（按文件 id）。 */
export const mtnCache = new WeakMap<Live2dAssetSource, Map<number, Mtn>>();

function mtnCacheFor(src: Live2dAssetSource): Map<number, Mtn> {
  let m = mtnCache.get(src);
  if (!m) {
    m = new Map();
    mtnCache.set(src, m);
  }
  return m;
}

/**
 * 装 `.MTN` 并**入队**（`0x34E` 的宿主侧；引擎里 `sub_478640` 调 `sub_4BCA20(queue, motion, 1)`）。
 */
export async function startMotionOnSlot(
  src: Live2dAssetSource,
  host: L2dHost,
  fileId: number,
  slot: number,
  motionSlot: number,
  loop: boolean,
  log?: Live2dLoadLog,
): Promise<Mtn | null> {
  let motion = mtnCacheFor(src).get(fileId);
  if (!motion) {
    const bytes = await src.loadById(fileId);
    if (!bytes) {
      log?.(`[l2d] 0x34E：动作 id 0x${fileId.toString(16)} 取不到 ⇒ 槽 ${slot} 不播动作（定格）`);
      return null;
    }
    motion = parseMtn(bytes.data, bytes.name);
    mtnCacheFor(src).set(fileId, motion);
  }
  l2dStartMotion(host, slot, fileId, motion, motionSlot, loop);
  return motion;
}
