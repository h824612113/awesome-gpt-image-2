import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 外部开源提示词源的统一解析入口。
 * 只负责「读文件 → 产出候选」，不负责克隆 / 拉取，便于被同步脚本与一次性维护脚本复用。
 *
 * 返回结构：{ title, prompt, source, image }
 * image 为远端图片 URL（拿不到时为空字符串），由下游决定直连还是降级到占位图。
 */
export const TRACKED_SOURCES = [
  {
    name: 'awesome-gpt-image',
    url: 'https://github.com/ZeroLu/awesome-gpt-image.git',
    type: 'zerolu'
  },
  {
    name: 'awesome-gpt-image-2-5-prompts',
    url: 'https://github.com/youart-open-source/awesome-gpt-image-2-5-prompts.git',
    type: 'youart'
  },
  {
    name: 'awesome-gpt-image-2-API-Prompts',
    url: 'https://github.com/Evolink-AI/awesome-gpt-image-2-API-Prompts.git',
    type: 'evolink'
  }
];

function extractZeroLu(cacheDir, sink) {
  const readmePath = join(cacheDir, 'awesome-gpt-image', 'README.md');
  if (!existsSync(readmePath)) return;
  const content = readFileSync(readmePath, 'utf8');
  for (const section of content.split(/\n(?=###?\s+)/)) {
    const titleMatch = section.match(/^###?\s+([^\n]+)/);
    const codeMatch = section.match(/```(?:text|json)?\n([\s\S]*?)\n```/);
    if (!titleMatch || !codeMatch) continue;
    const title = titleMatch[1].replace(/\[(.*?)\]\(.*?\)/g, '$1').trim();
    if (title.toLowerCase().includes('sponsor')) continue;
    const imageMatch = section.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
    sink.push({
      title,
      prompt: codeMatch[1].trim(),
      source: 'ZeroLu/awesome-gpt-image',
      image: imageMatch ? imageMatch[1] : ''
    });
  }
}

function extractYouArt(cacheDir, sink) {
  const jsonPath = join(cacheDir, 'awesome-gpt-image-2-5-prompts', 'data', 'prompts.json');
  if (!existsSync(jsonPath)) return;
  const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const list = Array.isArray(data) ? data : data.prompts || [];
  for (const item of list) {
    if (!item.prompt) continue;
    sink.push({
      title: item.title || 'Creative Prompt',
      prompt: item.prompt.trim(),
      source: item.authorUrl || item.sourceUrl || 'youart-open-source/awesome-gpt-image-2-5-prompts',
      // YouArt 数据集只有站内锚点（url 字段），没有可直接引用的图片资源
      image: ''
    });
  }
}

function extractEvolink(cacheDir, sink) {
  const casesDir = join(cacheDir, 'awesome-gpt-image-2-API-Prompts', 'cases');
  if (!existsSync(casesDir)) return;
  const files = readdirSync(casesDir).filter(
    (file) => file.endsWith('_zh-CN.md') || (!file.includes('_') && file.endsWith('.md'))
  );
  for (const file of files) {
    const content = readFileSync(join(casesDir, file), 'utf8');
    for (const section of content.split(/\n(?=###\s+Case\s+\d+:)/)) {
      const titleMatch = section.match(/###\s+Case\s+\d+:\s*(?:\[(.*?)\]\((.*?)\)|([^\n]+))/);
      const codeMatch = section.match(/```(?:text|json)?\n([\s\S]*?)\n```/);
      if (!titleMatch || !codeMatch) continue;
      const title = (titleMatch[1] || titleMatch[3] || '').trim();
      const sourceUrl = titleMatch[2] || '';
      const imageMatch = section.match(/<img[^>]+src="(https?:\/\/[^"]+)"[^>]*>/);
      sink.push({
        title: title || 'Curated Prompt',
        prompt: codeMatch[1].trim(),
        source: sourceUrl || 'Evolink-AI/awesome-gpt-image-2-API-Prompts',
        image: imageMatch ? imageMatch[1] : ''
      });
    }
  }
}

export function collectCandidates(cacheDir) {
  const candidates = [];
  const parsers = [
    ['ZeroLu', extractZeroLu],
    ['YouArt', extractYouArt],
    ['Evolink', extractEvolink]
  ];
  for (const [name, parser] of parsers) {
    try {
      parser(cacheDir, candidates);
    } catch (err) {
      console.warn(`解析 ${name} 仓库出错:`, err.message);
    }
  }
  return candidates;
}

/** 与历史数据一致的提示词指纹：去掉标点与空白后转小写 */
export function normalizePrompt(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}
