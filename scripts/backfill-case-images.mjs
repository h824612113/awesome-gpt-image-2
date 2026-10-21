#!/usr/bin/env node
/**
 * 历史案例补图脚本（一次性 / 可重复执行）。
 *
 * 早期入库的案例只有标题、来源和提示词，没有图片引用，导致前端只能走占位图。
 * 本脚本用统一的提示词指纹，把外部源（ZeroLu README / Evolink cases）里的远端图片 URL
 * 回填到 docs/gallery-part-*.md 对应的案例块中。
 *
 * 幂等：已有图片引用的案例块会被跳过，重复执行不会产生重复行。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCandidates, normalizePrompt } from './lib/prompt-sources.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheDir = join(homedir(), '.cache', 'awesome-gpt-image-sync-repos');
const galleryFiles = ['gallery-part-1.md', 'gallery-part-2.md'].map((file) => join(rootDir, 'docs', file));

if (!existsSync(cacheDir)) {
  console.error(`外部源缓存目录不存在：${cacheDir}\n请先执行一次 scripts/daily-sync-prompts.mjs 完成克隆。`);
  process.exit(0);
}

const candidates = collectCandidates(cacheDir);
const imageByFingerprint = new Map();
for (const candidate of candidates) {
  if (!candidate.image) continue;
  const key = normalizePrompt(candidate.prompt);
  if (key && !imageByFingerprint.has(key)) imageByFingerprint.set(key, candidate.image);
}
console.log(`外部源候选 ${candidates.length} 条，其中带图 ${imageByFingerprint.size} 条。`);

let patched = 0;
let skippedHasImage = 0;
let skippedNoMatch = 0;

for (const file of galleryFiles) {
  const text = readFileSync(file, 'utf8');
  const chunks = text.split(/(<a name="case-\d+"><\/a>)/g);
  let filePatched = 0;

  for (let i = 1; i < chunks.length; i += 2) {
    const anchor = chunks[i];
    const block = chunks[i + 1] || '';
    if (/!\[[^\]]*\]\([^)]*\)/.test(block)) {
      skippedHasImage += 1;
      continue;
    }
    const promptMatch = block.match(/```(?:text|json)?\n([\s\S]*?)```/);
    if (!promptMatch) {
      skippedNoMatch += 1;
      continue;
    }
    const imageUrl = imageByFingerprint.get(normalizePrompt(promptMatch[1]));
    if (!imageUrl) {
      skippedNoMatch += 1;
      continue;
    }
    const titleMatch = block.match(/^(\s*###[^\n]*\n\n)/);
    if (!titleMatch) {
      skippedNoMatch += 1;
      continue;
    }
    const title = block.match(/###[^\n]*?[：:]\s*([^\n]+)/)?.[1] || 'Case image';
    const alt = title.replace(/[[\]]/g, '').trim();
    chunks[i + 1] = block.replace(titleMatch[1], `${titleMatch[1]}![${alt}](${imageUrl})\n\n`);
    patched += 1;
    filePatched += 1;
  }

  if (filePatched > 0) {
    writeFileSync(file, chunks.join(''));
    console.log(`${file.split('/').pop()}: 回填 ${filePatched} 条`);
  }
}

console.log(`完成：回填 ${patched} 条；已有图跳过 ${skippedHasImage} 条；无匹配源 ${skippedNoMatch} 条。`);
