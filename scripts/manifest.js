import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT_DIR,
  RAW_DIR,
  INSTALL_DIR,
  INSTALL_MANIFEST,
  RAW_MANIFEST,
  RAW_SKIP_DIRS,
  EXCLUDED_NAMES,
  EXCLUDED_RE,
} from './config.js';

function relativePosix(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

// 递归收集目录下所有普通文件（跟随 junction/符号链接；skipDirs 用于跳过工作目录）
function walkFiles(rootDir, skipDirs) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs && skipDirs.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
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

async function writeManifest(root, manifestPath, label, skipDirs) {
  if (!fs.existsSync(root)) {
    console.error(`[FAIL] ${label} 目录不存在: ${root}`);
    process.exit(1);
  }
  const files = walkFiles(root, skipDirs);
  const out = {};
  for (const file of files) {
    const rel = relativePosix(root, file);
    out[rel] = await md5File(file);
    console.log('[md5]', rel);
  }
  const manifest = {
    generated: new Date().toISOString(),
    root,
    count: Object.keys(out).length,
    files: out,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${manifestPath} (${manifest.count} 个文件)`);
}

async function updateInstall() {
  await writeManifest(INSTALL_DIR, INSTALL_MANIFEST, 'install');
}

async function updateRaw() {
  await writeManifest(RAW_DIR, RAW_MANIFEST, 'raw', RAW_SKIP_DIRS);
}

async function checkInstall() {
  if (!fs.existsSync(INSTALL_MANIFEST)) {
    console.error('install-manifest.json 不存在，先运行: npm run manifest');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(INSTALL_MANIFEST, 'utf8'));
  console.log(`检查 ${manifest.count} 个文件的 MD5（对照 ${INSTALL_MANIFEST}）...`);

  const files = walkFiles(INSTALL_DIR);
  const current = {};
  for (const file of files) {
    const rel = relativePosix(INSTALL_DIR, file);
    current[rel] = await md5File(file);
  }

  const problems = [];
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

  // raw 根层文件应在 install 中（排除文件除外）
  for (const rel of Object.keys(rm.files)) {
    if (rel.includes('/')) continue; // 子目录文件不属于 install 范围
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
const fail = (err) => {
  console.error(err);
  process.exit(1);
};

if (mode === '--update' || mode === '--update-install') {
  updateInstall().catch(fail);
} else if (mode === '--update-raw') {
  updateRaw().catch(fail);
} else if (mode === '--update-all') {
  updateRaw()
    .then(updateInstall)
    .catch(fail);
} else if (mode === '--check') {
  checkInstall().catch(fail);
} else if (mode === '--compare') {
  compareInstallRaw();
} else {
  console.error('用法: node manifest.js [--update|--update-raw|--update-all|--check|--compare]');
  process.exit(1);
}
