import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDir = join(root, 'docs');
const outFile = join(root, 'data', 'cases.json');
const styleLibraryFile = join(root, 'data', 'style-library.json');
const placeholderDir = join(root, 'data', 'placeholders');
const styleLibrary = JSON.parse(readFileSync(styleLibraryFile, 'utf8'));

const galleryFiles = [
  { file: 'gallery-part-1.md', part: 1 },
  { file: 'gallery-part-2.md', part: 2 }
];

const categoryLabels = Object.fromEntries(
  styleLibrary.categories.map((category) => [category.anchor, category.value])
);

function slugifyCategory(category = 'other') {
  const slug = String(category)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'other';
}

function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return hash;
}

function escapeXml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 占位图配色：一组低饱和偏质感的渐变，按「分类 + 案例」哈希取色，
 * 让同分类相邻卡片也能拉开差异，同时保证构建结果确定（不产生无意义 diff）。
 */
const PLACEHOLDER_GRADIENTS = [
  ['#6366F1', '#312E81'],
  ['#8B5CF6', '#4C1D95'],
  ['#EC4899', '#831843'],
  ['#F43F5E', '#881337'],
  ['#F59E0B', '#7C2D12'],
  ['#14B8A6', '#134E4A'],
  ['#06B6D4', '#164E63'],
  ['#10B981', '#064E3B'],
  ['#64748B', '#1E293B'],
  ['#F97316', '#7C2D12']
];

/** 按字符宽度粗略折行，最多两行，超出加省略号 */
function wrapSvgText(text, maxChars = 24, maxLines = 2) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const lines = [];
  let rest = clean;
  while (rest && lines.length < maxLines) {
    if (rest.length <= maxChars) {
      lines.push(rest);
      rest = '';
      break;
    }
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest && lines.length) {
    const last = lines[lines.length - 1].replace(/[\s，,。.、]+$/, '');
    lines[lines.length - 1] = `${last.slice(0, Math.max(4, maxChars - 1))}…`;
  }
  return lines.length ? lines : [''];
}

/**
 * 无图条目使用的渐变占位卡：案例标题 + 分类标签 + 稳定的配色分桶。
 * 标题让卡片看起来像内容而不是空占位。
 */
function buildPlaceholderSvg(category, seed = '', title = '') {
  const index = hashHue(`${category}|${seed || category}`) % PLACEHOLDER_GRADIENTS.length;
  const [from, to] = PLACEHOLDER_GRADIENTS[index];
  const heading = title || category;
  const lines = wrapSvgText(heading, 22, 2);
  const startY = lines.length > 1 ? 268 : 300;
  const headingMarkup = lines
    .map((line, i) => `<tspan x="400" dy="${i === 0 ? 0 : 40}">${escapeXml(line)}</tspan>`)
    .join('');
  const categoryLabel = escapeXml(String(category).toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="${escapeXml(heading)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.74" cy="0.16" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="lines" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <rect width="800" height="600" fill="url(#lines)"/>
  <rect width="800" height="600" fill="url(#glow)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="674" y="50" width="64" height="64" rx="16"/>
    <path d="M692 96l17-17 11 11 9-9"/>
  </g>
  <g fill="#ffffff" font-family="'Helvetica Neue',Arial,'PingFang SC','Hiragino Sans GB',sans-serif" text-anchor="middle">
    <text x="400" y="${startY}" font-size="30" font-weight="600" fill-opacity="0.96">${headingMarkup}</text>
    <text x="400" y="352" font-size="14" fill-opacity="0.62" letter-spacing="3">${categoryLabel}</text>
  </g>
</svg>
`;
}

function ensurePlaceholders(categories) {
  mkdirSync(placeholderDir, { recursive: true });
  for (const category of categories) {
    writeFileSync(join(placeholderDir, `${slugifyCategory(category)}.svg`), buildPlaceholderSvg(category));
  }
  writeFileSync(join(placeholderDir, 'fallback.svg'), buildPlaceholderSvg('Prompt Gallery'));
}

/** 为单个无图案例落一张专属占位图，色相在分类基调上微调 */
function placeholderFor(category, id, title = '') {
  const slug = slugifyCategory(category);
  if (!id) return `/placeholders/${slug}.svg`;
  mkdirSync(placeholderDir, { recursive: true });
  const fileName = `case-${id}.svg`;
  writeFileSync(join(placeholderDir, fileName), buildPlaceholderSvg(category, String(id), title));
  return `/placeholders/${fileName}`;
}

/**
 * 图片解析优先级：
 * 1. 远端 URL（外部源直连，不进仓库）
 * 2. 本地 ../data/** 引用且文件真实存在
 * 3. 分类渐变占位图（绝不让前端出现破图）
 */
function resolveImage(imageMatch, category, id, title) {
  const raw = imageMatch?.[2]?.trim();
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    const localPath = raw.replace('../data/', '/');
    if (existsSync(join(root, 'data', localPath.replace(/^\//, '')))) return localPath;
  }
  return placeholderFor(category, id, title);
}

const featuredIds = new Set([
  1, 2, 6, 17, 166, 310, 330, 334, 338, 341, 344, 346, 350, 353, 354, 359, 360,
  361, 362, 365, 370, 373, 375, 376, 377, 378
]);

function cleanText(value = '') {
  return value
    .replace(/\\_/g, '_')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function stripMarkdown(value = '') {
  return cleanText(value)
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .trim();
}

function parseCategoryMap() {
  const text = readFileSync(join(docsDir, 'gallery.md'), 'utf8');
  const map = new Map();
  const sections = text.split(/<a name="(cat-[^"]+)"><\/a>/g);

  for (let i = 1; i < sections.length; i += 2) {
    const categoryId = sections[i];
    const body = sections[i + 1] || '';
    const category = categoryLabels[categoryId] || 'Other Use Cases';
    for (const match of body.matchAll(/#case-(\d+)\)/g)) {
      map.set(Number(match[1]), category);
    }
  }

  return map;
}

function extractPrompt(block) {
  const normalized = block.replace(/\r/g, '');
  const match = normalized.match(/\*\*提示词：\*\*[\s\S]*?```(?:text)?\n([\s\S]*?)```/);
  return cleanText(match?.[1] || '');
}

function prettifySourceLabel(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const segments = url.pathname.split('/').filter(Boolean);
    if (/^(x|twitter)\.com$/.test(host) && segments[0]) return `@${segments[0]}`;
    if (host === 'github.com' && segments[0]) {
      return segments[1] ? `${segments[0]}/${segments[1]}` : segments[0];
    }
    return host;
  } catch {
    return value;
  }
}

function extractSource(block) {
  const line = block.match(/\*\*来源：\*\*\s*([^\n]+)/)?.[1] || '';
  const link = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (link) {
    return {
      label: stripMarkdown(link[1]),
      url: link[2]
    };
  }
  const plain = stripMarkdown(line);
  if (/^https?:\/\/\S+$/.test(plain)) {
    return {
      label: prettifySourceLabel(plain),
      url: plain
    };
  }
  return {
    label: plain || 'Community',
    url: ''
  };
}

function inferCategory(caseItem) {
  if (caseItem.category) return caseItem.category;
  const text = `${caseItem.title} ${caseItem.prompt}`.toLowerCase();
  const rules = [
    ['UI & Interfaces', ['ui', 'app', 'interface', 'dashboard', 'screenshot', '网页', '界面', '截图']],
    ['Charts & Infographics', ['infographic', 'diagram', 'chart', 'atlas', '图谱', '信息图', '图解']],
    ['Posters & Typography', ['poster', 'cover', 'typography', '海报', '封面', '字体']],
    ['Products & E-commerce', ['product', 'packaging', 'e-commerce', '商品', '电商', '包装']],
    ['Brand & Logos', ['logo', 'brand', 'identity', '品牌', '标志']],
    ['Architecture & Spaces', ['architecture', 'interior', 'map', '建筑', '室内', '地图']],
    ['Photography & Realism', ['photo', 'portrait', 'camera', 'realistic', '写真', '摄影', '写实']],
    ['Illustration & Art', ['illustration', 'painting', 'watercolor', '插画', '艺术', '水墨']],
    ['Characters & People', ['character', 'pose', 'avatar', '角色', '人物', '头像']],
    ['Scenes & Storytelling', ['storyboard', 'scene', 'narrative', '场景', '叙事', '分镜']],
    ['History & Classical Themes', ['history', 'dynasty', 'classical', '历史', '古风', '唐朝', '宋']],
    ['Documents & Publishing', ['document', 'manual', 'prescription', '文档', '手册', '处方']]
  ];
  return rules.find(([, keys]) => keys.some((key) => text.includes(key)))?.[0] || 'Other Use Cases';
}

function inferTags(caseItem) {
  const text = `${caseItem.title} ${caseItem.prompt}`.toLowerCase();
  const styleOrder = ['UI', 'Infographic', 'Poster', 'Realistic', 'Illustration', 'Product', 'Brand', 'Character', 'Classical', '3D'];
  const sceneOrder = ['Tech', 'Commerce', 'Education', 'Social', 'Fashion', 'Food', 'Travel', 'Story', 'History', 'Creative'];
  const styleByValue = new Map(styleLibrary.styles.map((style) => [style.value, style]));
  const sceneByValue = new Map(styleLibrary.scenes.map((scene) => [scene.value, scene]));
  const styleRules = styleOrder.map((value) => [
    value,
    (styleByValue.get(value)?.keywords || []).map((key) => key.toLowerCase())
  ]);
  const sceneRules = sceneOrder.map((value) => [
    value,
    (sceneByValue.get(value)?.keywords || []).map((key) => key.toLowerCase())
  ]);

  const pick = (rules, fallback) => {
    const tags = rules
      .filter(([, keys]) => keys.some((key) => text.includes(key)))
      .map(([label]) => label);
    return tags.length ? tags.slice(0, 3) : [fallback];
  };

  return {
    styles: pick(styleRules, caseItem.category.split(' & ')[0].replace('Posters', 'Poster')),
    scenes: pick(sceneRules, 'Creative')
  };
}

function parseCases() {
  const categoryMap = parseCategoryMap();
  const cases = [];

  for (const { file, part } of galleryFiles) {
    const text = readFileSync(join(docsDir, file), 'utf8');
    const chunks = text.split(/<a name="case-(\d+)"><\/a>/g);

    for (let i = 1; i < chunks.length; i += 2) {
      const id = Number(chunks[i]);
      const block = chunks[i + 1] || '';
      const title = stripMarkdown(block.match(/###\s*例\s*\d+：([^\n]+)/)?.[1] || `Case ${id}`);
      const imageMatch = block.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      const prompt = extractPrompt(block);
      const source = extractSource(block);
      const category = inferCategory({
        title,
        prompt,
        category: categoryMap.get(id)
      });
      const image = resolveImage(imageMatch, category, id, title);
      const tags = inferTags({ title, prompt, category });

      cases.push({
        id,
        title,
        image,
        imageAlt: stripMarkdown(imageMatch?.[1] || title),
        sourceLabel: source.label,
        sourceUrl: source.url,
        prompt,
        promptPreview: prompt.replace(/\n+/g, ' ').slice(0, 220),
        category,
        styles: tags.styles,
        scenes: tags.scenes,
        featured: featuredIds.has(id),
        githubUrl: `https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-${part}.md#case-${id}`
      });
    }
  }

  return cases.sort((a, b) => b.id - a.id);
}

const cases = parseCases();
const categories = [...new Set(cases.map((item) => item.category))].sort();
const styles = [...new Set(cases.flatMap((item) => item.styles))].sort();
const scenes = [...new Set(cases.flatMap((item) => item.scenes))].sort();

ensurePlaceholders(categories);

const payload = {
  repository: 'https://github.com/freestylefly/awesome-gpt-image-2',
  totalCases: cases.length,
  categories,
  styles,
  scenes,
  cases
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Generated ${cases.length} cases at ${outFile}`);
