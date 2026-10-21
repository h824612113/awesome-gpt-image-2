#!/usr/bin/env node
/**
 * 历史数据清洗（一次性 / 可重复执行）。
 *
 * 处理两类早期遗留问题：
 * 1. 提示词短于 40 字符的薄内容条目（多为早期模板句，如「生成一张 [场景 / 内容] 图像」）
 * 2. 归一化指纹重复的条目（同一提示词被重复收录），每组只保留一条：
 *    优先保留已有图片的、其次保留 id 最小（最早收录）的
 *
 * 同步删除 docs/gallery-part-*.md 中的案例块与 docs/gallery.md 中的索引行，
 * 随后由 generate-site-data.mjs 重建 data/cases.json。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePrompt } from './lib/prompt-sources.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const casesFile = join(rootDir, 'data', 'cases.json');
const MIN_PROMPT_LENGTH = 40;
const MAX_DROP_RATIO = 0.1;

const data = JSON.parse(readFileSync(casesFile, 'utf8'));
const cases = data.cases || [];

function hasImage(caseItem) {
  if (!caseItem.image) return false;
  if (/^https?:\/\//i.test(caseItem.image)) return true;
  return existsSync(join(rootDir, 'data', caseItem.image.replace(/^\//, '')));
}

const drops = new Map(); // id -> reason

// 1. 过短条目
for (const c of cases) {
  if (!c.prompt || c.prompt.trim().length < MIN_PROMPT_LENGTH) {
    drops.set(c.id, { reason: 'short', detail: `${(c.prompt || '').trim().length}字` });
  }
}

// 2. 重复条目（每组保留一条）
const groups = new Map();
for (const c of cases) {
  const key = normalizePrompt(c.prompt);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}

let dupGroups = 0;
for (const group of groups.values()) {
  if (group.length < 2) continue;
  dupGroups += 1;
  const sorted = [...group].sort((a, b) => {
    const imageScore = Number(hasImage(b)) - Number(hasImage(a));
    if (imageScore !== 0) return imageScore;
    return a.id - b.id;
  });
  const [keeper, ...rest] = sorted;
  for (const c of rest) {
    if (drops.has(c.id)) continue;
    drops.set(c.id, { reason: 'duplicate', detail: `合并到 #${keeper.id}` });
  }
}

if (drops.size === 0) {
  console.log('无需清洗：没有过短或重复的条目。');
  process.exit(0);
}

if (drops.size / cases.length > MAX_DROP_RATIO) {
  console.error(`拒绝执行：拟删除 ${drops.size} 条，超过总量 ${cases.length} 的 ${MAX_DROP_RATIO * 100}%，请先人工核对。`);
  process.exit(1);
}

const shortCount = [...drops.values()].filter((d) => d.reason === 'short').length;
const dupCount = drops.size - shortCount;
console.log(`拟删除 ${drops.size} 条（过短 ${shortCount} 条 / 重复 ${dupCount} 条，涉及 ${dupGroups} 个重复组）。`);

for (const [id, meta] of [...drops.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  - #${id} ${meta.reason === 'short' ? '过短' : '重复'}：${meta.detail}`);
}

// 3. 从 gallery-part-*.md 移除案例块
const dropIds = new Set(drops.keys());
let removedBlocks = 0;

for (const fileName of ['gallery-part-1.md', 'gallery-part-2.md']) {
  const filePath = join(rootDir, 'docs', fileName);
  const text = readFileSync(filePath, 'utf8');
  const next = text.replace(
    /<a name="case-(\d+)"><\/a>[\s\S]*?(?=<a name="case-\d+"><\/a>|$)/g,
    (block, id) => {
      if (!dropIds.has(Number(id))) return block;
      removedBlocks += 1;
      return '';
    }
  );
  if (next !== text) {
    writeFileSync(filePath, next);
    console.log(`${fileName}: 已移除 ${removedBlocks} 个案例块`);
    removedBlocks = 0;
  }
}

// 4. 从 gallery.md 移除索引行
const galleryIndexPath = join(rootDir, 'docs', 'gallery.md');
const indexText = readFileSync(galleryIndexPath, 'utf8');
let removedIndexLines = 0;
const nextIndex = indexText
  .split('\n')
  .filter((line) => {
    const match = line.match(/#case-(\d+)\)/);
    if (match && dropIds.has(Number(match[1]))) {
      removedIndexLines += 1;
      return false;
    }
    return true;
  })
  .join('\n');
if (nextIndex !== indexText) writeFileSync(galleryIndexPath, nextIndex);
console.log(`gallery.md: 已移除 ${removedIndexLines} 行索引`);

console.log('清洗完成，请执行 node scripts/generate-site-data.mjs 重建站点数据。');
