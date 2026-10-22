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
  },
  {
    name: 'awesome-gpt-image-2-youmind',
    url: 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2.git',
    type: 'youmind'
  },
  {
    name: 'GPT-Image2-Skill',
    url: 'https://github.com/wuyoscar/GPT-Image2-Skill.git',
    type: 'wuyoscar'
  },
  {
    name: 'awesome-gpt-image2-prompts',
    url: 'https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts.git',
    type: 'davidwu'
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

function extractYouMind(cacheDir, sink) {
  const dirName = existsSync(join(cacheDir, 'awesome-gpt-image-2-youmind'))
    ? 'awesome-gpt-image-2-youmind'
    : 'awesome-gpt-image-2';
  const readmePath = join(cacheDir, dirName, 'README_zh.md');
  if (!existsSync(readmePath)) return;
  const content = readFileSync(readmePath, 'utf8');
  const sections = content.split(/\n(?=###\s+No\.\s*\d+:)/);
  for (const sec of sections.slice(1)) {
    const titleMatch = sec.match(/###\s+No\.\s*\d+:\s*([^\n]+)/);
    const codeMatch = sec.match(/####\s+📝\s*提示词\s*\n+```(?:text|json)?\n([\s\S]*?)\n```/);
    if (!titleMatch || !codeMatch) continue;
    const title = titleMatch[1].trim();
    const prompt = codeMatch[1].trim();
    const imgMatch = sec.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/);
    const authorMatch = sec.match(/-\s*\*\*作者:\*\*\s*\[(.*?)\]\((.*?)\)/);
    const sourceUrl = authorMatch ? authorMatch[2].trim() : 'YouMind-OpenLab/awesome-gpt-image-2';
    sink.push({
      title,
      prompt,
      source: sourceUrl,
      image: imgMatch ? imgMatch[1].trim() : ''
    });
  }
}

function extractWuyoscar(cacheDir, sink) {
  const readmePath = join(cacheDir, 'GPT-Image2-Skill', 'README.zh.md');
  if (!existsSync(readmePath)) return;
  const content = readFileSync(readmePath, 'utf8');
  const galleryPart = content.split('## 🎨 分类图库').pop();
  if (!galleryPart) return;
  const sections = galleryPart.split(/\n(?=####\s+)/);
  for (const sec of sections.slice(1)) {
    const titleMatch = sec.match(/####\s+([^\n]+)/);
    if (!titleMatch) continue;
    const baseTitle = titleMatch[1].trim();
    const prompts = [];
    const promptRegex = /```(?:text|json)?\n([\s\S]*?)\n```/g;
    let pm;
    while ((pm = promptRegex.exec(sec)) !== null) {
      if (pm[1].trim()) prompts.push(pm[1].trim());
    }
    const imgs = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/g;
    let im;
    while ((im = imgRegex.exec(sec)) !== null) {
      imgs.push(im[1].trim());
    }

    prompts.forEach((p, idx) => {
      const subTitle = prompts.length === 1 ? baseTitle : `${baseTitle} (Part ${idx + 1})`;
      let imgUrl = '';
      if (idx < imgs.length) {
        const raw = imgs[idx];
        if (raw.startsWith('http')) {
          imgUrl = raw;
        } else if (raw.startsWith('docs/')) {
          imgUrl = `https://raw.githubusercontent.com/wuyoscar/GPT-Image2-Skill/main/${raw}`;
        }
      }
      sink.push({
        title: subTitle,
        prompt: p,
        source: 'wuyoscar/GPT-Image2-Skill',
        image: imgUrl
      });
    });
  }
}

function extractDavidWu(cacheDir, sink) {
  const jsonPath = join(cacheDir, "awesome-gpt-image2-prompts", "prompts.json");
  if (!existsSync(jsonPath)) return;
  let list = [];
  try {
    list = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch {
    return;
  }
  for (const item of list) {
    if (!item.prompt) continue;
    let imgUrl = "";
    if (item.image) {
      imgUrl = item.image.startsWith("http")
        ? item.image
        : `https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main/${item.image}`;
    }
    const title = item.title_cn || item.title_en || "Creative Design Prompt";
    const author = item.author ? item.author.trim() : "";
    const src = item.source ? item.source.trim() : "davidwuw0811-boop/awesome-gpt-image2-prompts";
    const sourceStr = author ? `${author} (${src})` : src;
    sink.push({
      title,
      prompt: item.prompt.trim(),
      source: sourceStr,
      image: imgUrl
    });
  }
}

export function collectCandidates(cacheDir) {
  const candidates = [];
  const parsers = [
    ['ZeroLu', extractZeroLu],
    ['YouArt', extractYouArt],
    ['Evolink', extractEvolink],
    ['YouMind', extractYouMind],
    ['Wuyoscar', extractWuyoscar],
    ['DavidWu', extractDavidWu]
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
