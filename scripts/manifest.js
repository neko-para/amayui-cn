import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT_DIR,
  RAW_DIR,
  INSTALL_DIR,
  INSTALL_MANIFEST,
  RAW_MANIFEST,
  EXCLUDED_NAMES,
  EXCLUDED_RE,
} from './config.js';

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

// manifest 文件名按不区分大小写的字典序排列（与 NTFS/现有 manifest 约定一致）
function compareFileKeys(a, b) {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  if (x < y) return -1;
  if (x > y) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// 只统计根目录下的顶层文件（DATA1-8 等解包子目录不属于改动追踪范围）
function topLevelFiles(rootDir) {
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(rootDir, entry.name));
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function writeManifest(root, manifestPath, label, targets = null) {
  if (!fs.existsSync(root)) {
    console.error(`[FAIL] ${label} 目录不存在: ${root}`);
    process.exit(1);
  }
  let out;
  if (targets) {
    if (!fs.existsSync(manifestPath)) {
      console.error(`[FAIL] ${manifestPath} 不存在，先运行全量更新: npm run manifest`);
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    out = { ...existing.files };
    for (const rel of targets) {
      const file = path.join(root, ...rel.split('/'));
      if (!fs.existsSync(file)) {
        console.error(`[FAIL] ${label} 中不存在: ${rel}`);
        process.exit(1);
      }
      out[rel] = await md5File(file);
      console.log('[md5]', rel);
    }
  } else {
    out = {};
    for (const file of topLevelFiles(root)) {
      const rel = relativePosix(root, file);
      out[rel] = await md5File(file);
      console.log('[md5]', rel);
    }
  }
  // 无论全量还是增量更新，最终写出的 JSON 都按文件名排序，避免增量新增项堆积在末尾
  const files = {};
  for (const rel of Object.keys(out).sort(compareFileKeys)) {
    files[rel] = out[rel];
  }
  const manifest = {
    generated: new Date().toISOString(),
    root,
    count: Object.keys(files).length,
    files,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${manifestPath} (${manifest.count} 个文件)`);
}

async function updateInstall(targets = null) {
  await writeManifest(INSTALL_DIR, INSTALL_MANIFEST, 'install', targets);
}

async function updateRaw(targets = null) {
  await writeManifest(RAW_DIR, RAW_MANIFEST, 'raw', targets);
}

async function checkInstall(targets = null) {
  if (!fs.existsSync(INSTALL_MANIFEST)) {
    console.error('install-manifest.json 不存在，先运行: npm run manifest');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8'));
  const problems = [];
  if (targets) {
    console.log(`检查 ${targets.length} 个指定文件（对照 ${INSTALL_MANIFEST}）...`);
    for (const rel of targets) {
      const file = path.join(INSTALL_DIR, ...rel.split('/'));
      if (!(rel in manifest.files)) {
        problems.push(fs.existsSync(file) ? `新增（未收录）: ${rel}` : `未收录且不存在: ${rel}`);
        continue;
      }
      if (!fs.existsSync(file)) {
        problems.push(`缺失: ${rel}`);
        continue;
      }
      const hash = await md5File(file);
      if (hash !== manifest.files[rel]) {
        problems.push(`已修改: ${rel}`);
        problems.push(`        ${manifest.files[rel]} -> ${hash}`);
      }
    }
  } else {
    console.log(`检查 ${manifest.count} 个文件的 MD5（对照 ${INSTALL_MANIFEST}）...`);
    const files = topLevelFiles(INSTALL_DIR);
    const current = {};
    for (const file of files) {
      const rel = relativePosix(INSTALL_DIR, file);
      current[rel] = await md5File(file);
    }

    for (const [rel, hash] of Object.entries(manifest.files)) {
      if (!(rel in current)) {
        problems.push(`缺失: ${rel}`);
      } else if (current[rel] !== hash) {
        problems.push(`已修改: ${rel}`);
        problems.push(`        ${hash} -> ${current[rel]}`);
      }
    }
    for (const rel of Object.keys(current)) {
      if (!(rel in manifest.files)) {
        problems.push(`新增: ${rel}`);
      }
    }
  }

  if (problems.length > 0) {
    console.log(`\n发现 ${problems.length} 处变化:`);
    problems.forEach((p) => console.log(' ', p));
    process.exit(1);
  } else {
    console.log('\n全部一致 ✓');
  }
}

// 对比 install 与 raw（基于两份 manifest，不重新哈希）
function compareInstallRaw() {
  if (!fs.existsSync(INSTALL_MANIFEST) || !fs.existsSync(RAW_MANIFEST)) {
    console.error('缺少 manifest，先运行: npm run manifest-all');
    process.exit(1);
  }
  const im = JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8'));
  const rm = JSON.parse(fs.readFileSync(RAW_MANIFEST, 'utf8'));

  const problems = [];
  let matched = 0;

  for (const [rel, hash] of Object.entries(im.files)) {
    if (!(rel in rm.files)) {
      problems.push(`raw 中不存在: ${rel}`);
    } else if (rm.files[rel] !== hash) {
      problems.push(`与 raw 不一致: ${rel}`);
    } else {
      matched++;
    }
  }

  // raw 顶层文件应在 install 中（排除文件除外）
  for (const rel of Object.keys(rm.files)) {
    const base = path.basename(rel);
    if (EXCLUDED_NAMES.has(base) || EXCLUDED_RE.test(base)) continue;
    if (!(rel in im.files)) {
      problems.push(`install 中缺失: ${rel}`);
    }
  }

  console.log(`对比 install(${im.count}) 与 raw(${rm.count}) ...`);
  if (problems.length > 0) {
    console.log(`\n发现 ${problems.length} 处不一致:`);
    problems.forEach((p) => console.log(' ', p));
    process.exit(1);
  } else {
    console.log(`一致 ✓（install 中 ${matched} 个文件与 raw 完全匹配）`);
  }
}

const mode = process.argv[2] ?? '--update';
const rawTargets = process.argv.slice(3).filter(Boolean);
const fail = (err) => {
  console.error(err);
  process.exit(1);
};

// 把文件参数统一解析为相对根目录的正斜杠路径（绝对/相对路径均可，越界即报错）
function resolveTargets(root, args) {
  if (!args.length) return null;
  return args.map((arg) => {
    const abs = path.resolve(root, arg);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      console.error(`[FAIL] 文件路径不在 ${root} 内: ${arg}`);
      process.exit(1);
    }
    return rel.split(path.sep).join('/');
  });
}

if (mode === '--update' || mode === '--update-install') {
  updateInstall(resolveTargets(INSTALL_DIR, rawTargets)).catch(fail);
} else if (mode === '--update-raw') {
  updateRaw(resolveTargets(RAW_DIR, rawTargets)).catch(fail);
} else if (mode === '--update-all') {
  updateRaw(resolveTargets(RAW_DIR, rawTargets))
    .then(() => updateInstall(resolveTargets(INSTALL_DIR, rawTargets)))
    .catch(fail);
} else if (mode === '--check') {
  checkInstall(resolveTargets(INSTALL_DIR, rawTargets)).catch(fail);
} else if (mode === '--compare') {
  compareInstallRaw();
} else {
  console.error('用法: node manifest.js [--update|--update-raw|--update-all|--check|--compare] [文件...]');
  console.error('  文件... 为相对目录顶层的路径（如 AIM.BIN，绝对路径也可），可多个；');
  console.error('  仅 --update* / --check 支持指定文件；省略文件时处理全部（原行为）。');
  process.exit(1);
}
