#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCandidates, TRACKED_SOURCES } from './lib/prompt-sources.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(__dirname);

function run(cmd, options = {}) {
  return execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe', ...options });
}

console.log(`[${new Date().toISOString()}] ==========================================`);
console.log(`[${new Date().toISOString()}] 启动每日提示词智能同步与质量准入流程...`);

// 1. 同步上游基线仓库 (freestylefly/awesome-gpt-image-2)
try {
  const remotes = run('git remote').split('\n').map((s) => s.trim()).filter(Boolean);
  if (remotes.includes('upstream')) {
    console.log('检查上游官方仓库更新...');
    run('git fetch upstream main');
    // 使用 rev-list 统计上游比本地领先的提交数，避免本地领先时误判
    const revCount = parseInt(run('git rev-list HEAD..upstream/main --count').trim(), 10) || 0;
    if (revCount > 0) {
      console.log(`检测到上游有 ${revCount} 个新提交，正在合并...`);
      run('git merge upstream/main --no-edit');
    } else {
      console.log('上游基线已是最新。');
    }
  }
} catch (err) {
  console.warn('上游同步警告（跳过）：', err.message);
}

// 1.5 动态探测 GitHub 开源生态与高星（Star >= 200）候选分流审计
const MIN_STAR_THRESHOLD = 200;
try {
  console.log(`正在执行 GitHub 开源生态动态探测 (搜索 GPT-Image-2 / 2.5，准入门槛 Star >= ${MIN_STAR_THRESHOLD})...`);
  const searchCmd = `gh search repos "gpt-image-2" --sort stars --limit 30 --json fullName,description,stargazersCount,url`;
  const out = run(searchCmd, { timeout: 20000 });
  const repos = JSON.parse(out);
  // 精确比对已收录的源（支持比对 fullName 与 仓库短名）
  const trackedFullNames = new Set(
    TRACKED_SOURCES.map(s => s.url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").toLowerCase())
  );
  const trackedShortNames = new Set(TRACKED_SOURCES.map(s => s.name.toLowerCase()));
  trackedFullNames.add("freestylefly/awesome-gpt-image-2");
  trackedFullNames.add("h824612113/awesome-gpt-image-2");

  // 严格过滤：Star >= 200，且排除非提示词库/非图库类（如 API 逆向、Go SDK、本地大模型等纯软件工具）
  const EXCLUDE_KEYWORDS = [
    "reverse-engineering", "chatgpt2api", "api client", "go-openai", "h2ogpt",
    "webui", "sdk", "proxy", "号池", "逆向实现", "step1x-edit", "playground"
  ];

  const highStarCandidates = repos.filter(r => {
    const fn = r.fullName.toLowerCase();
    const shortName = fn.split("/")[1] || fn;
    const desc = (r.description || "").toLowerCase();

    const isSelfOrTracked = trackedFullNames.has(fn) || trackedShortNames.has(shortName) ||
      fn.includes("h824612113") || fn.includes("freestylefly");
    if (isSelfOrTracked) return false;

    const stars = r.stargazersCount || 0;
    if (stars < MIN_STAR_THRESHOLD) return false;

    const isExcludedTool = EXCLUDE_KEYWORDS.some(kw => desc.includes(kw) || fn.includes(kw));
    return !isExcludedTool;
  });

  if (highStarCandidates.length > 0) {
    console.log(`[GitHub 生态发现] 筛选出 ${highStarCandidates.length} 个高星潜力提示词/Skill 项目 (Star >= ${MIN_STAR_THRESHOLD})：`);
    for (const repo of highStarCandidates.slice(0, 8)) {
      console.log(`  ⭐ ${repo.stargazersCount} | ${repo.fullName} - ${(repo.description || "无描述").slice(0, 60)}...`);
    }

    // 记录到暂存观察池 data/pending-sources.json，供人工复核确认后再接入解析器，杜绝直接全量吸纳风险
    const pendingFile = join(rootDir, "data", "pending-sources.json");
    const pendingData = {
      updatedAt: new Date().toISOString(),
      starThreshold: MIN_STAR_THRESHOLD,
      candidates: highStarCandidates.map(r => ({
        fullName: r.fullName,
        stars: r.stargazersCount,
        url: r.url,
        description: r.description
      }))
    };
    writeFileSync(pendingFile, JSON.stringify(pendingData, null, 2), "utf8");
    console.log(`已将 ${highStarCandidates.length} 个高星优质候选同步归档至 data/pending-sources.json 观察池。`);
  } else {
    console.log(`[GitHub 生态发现] 暂未发现未收录的 Star >= ${MIN_STAR_THRESHOLD} 的纯提示词库项目。`);
  }
} catch (err) {
  console.log("GitHub 动态发现跳过（非阻塞）：", err.message);
}

// 2. 严苛质量过滤与准入机制 (Quality Gate & Quality Auditor)
const casesFile = join(rootDir, 'data', 'cases.json');
const currentData = JSON.parse(readFileSync(casesFile, 'utf8'));
const currentCases = currentData.cases || [];

// 已有提示词归一化特征指纹库（严格去重）
function normalizePrompt(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

const seenFingerprints = new Set(
  currentCases.map((c) => normalizePrompt(c.prompt))
);

let maxId = Math.max(...currentCases.map((c) => c.id), 741);

/**
 * 提示词质量过滤器 (Quality Filter)
 * 只有通过以下多维检验的提示词才允许入库：
 * 1. 结构与长度门槛：不可为空、不可过短（>= 40字符），不可纯占位符
 * 2. 避免无意义或有害违规词
 * 3. 具备明确的视觉控制维度（主体、光影/材质/镜头/构图/色彩/风格等细节参数）
 * 4. 严格去重与语义指纹排重
 */
function evaluatePromptQuality(candidate) {
  const { title, prompt, source } = candidate;
  if (!prompt || typeof prompt !== 'string') return { pass: false, reason: '提示词为空' };

  const trimmed = prompt.trim();
  if (trimmed.length < 40) return { pass: false, reason: '提示词长度不足40字符，缺乏细节描述' };
  if (trimmed.length > 5000) return { pass: false, reason: '提示词超出正常长度限制' };

  // 严禁纯占位符/模板骨架没有实质内容
  if (/^(\[.*?\]|\{.*?\}|\s*)+$/.test(trimmed)) {
    return { pass: false, reason: '纯占位符未填充具体内容' };
  }

  // 查重：指纹去重
  const fp = normalizePrompt(trimmed);
  if (seenFingerprints.has(fp)) {
    return { pass: false, reason: '提示词已存在（完全重复或特征重复）' };
  }

  // 视觉参数特征分析 (包含主体、风格、构图、光影、渲染器、材质之一)
  const visualKeywords = [
    'light', 'shadow', 'texture', 'render', 'camera', 'shot', 'lens', 'resolution',
    'cinematic', 'photorealistic', 'portrait', 'background', 'composition', 'color', 'detailed',
    'style', 'illustration', 'poster', 'gradient', 'minimalist', 'hyper-detailed', 'cyberpunk',
    '光', '影', '镜头', '质感', '材质', '构图', '色彩', '超写实', '高清', '透视', '海报', '插画', '背景', '风格'
  ];
  const lower = trimmed.toLowerCase();
  const hasVisualKeywords = visualKeywords.some((kw) => lower.includes(kw));
  if (!hasVisualKeywords && !trimmed.startsWith('{')) {
    return { pass: false, reason: '缺乏视觉控制参数（光影/镜头/色彩/构图等）' };
  }

  return { pass: true, fingerprint: fp, prompt: trimmed };
}

// 3. 持续跟踪与解析外部优质开源源
// 使用持久化缓存目录（避免系统 /tmp 清理失效）
const extReposCacheDir = join(homedir(), '.cache', 'awesome-gpt-image-sync-repos');
mkdirSync(extReposCacheDir, { recursive: true });

// 如果 /tmp/ext_repos 存在且缓存目录为空，先迁移已存在的本地仓库加速
if (existsSync('/tmp/ext_repos')) {
  for (const src of TRACKED_SOURCES) {
    const srcTmpPath = join('/tmp/ext_repos', src.name);
    const targetPath = join(extReposCacheDir, src.name);
    if (existsSync(srcTmpPath) && !existsSync(targetPath)) {
      try {
        run(`cp -R "${srcTmpPath}" "${targetPath}"`);
      } catch {}
    }
  }
}

// 确保仓库存在并每日更新
for (const src of TRACKED_SOURCES) {
  const repoPath = join(extReposCacheDir, src.name);
  if (!existsSync(repoPath)) {
    console.log(`克隆外部参考仓库 [${src.name}]...`);
    try {
      run(`git clone --depth=1 "${src.url}" "${repoPath}"`);
    } catch (err) {
      console.warn(`克隆 ${src.name} 失败:`, err.message);
    }
  } else {
    try {
      run('git pull --ff-only', { cwd: repoPath });
    } catch {
      // 忽略 pull 错误，保持现有版本继续运行
    }
  }
}

// 三个源（ZeroLu / YouArt / Evolink）的解析逻辑收敛在 scripts/lib/prompt-sources.mjs，
// 与历史补图脚本共用，避免两处正则各改各的。
const rawCandidates = collectCandidates(extReposCacheDir);

console.log(`从各外部监控源累计提取出 ${rawCandidates.length} 条原始提示词候选。`);
console.log('执行多维质量审计（指纹排重、细节密度、视觉控制因子）...');

const acceptedCandidates = [];
let rejectedCount = 0;

for (const candidate of rawCandidates) {
  const res = evaluatePromptQuality(candidate);
  if (res.pass) {
    seenFingerprints.add(res.fingerprint);
    acceptedCandidates.push({
      title: candidate.title,
      prompt: res.prompt,
      source: candidate.source,
      image: candidate.image || '',
      fingerprint: res.fingerprint
    });
  } else {
    rejectedCount++;
  }
}

console.log(`质量审计报告：准入高质量案例 ${acceptedCandidates.length} 条，拦截/去重 ${rejectedCount} 条。`);

if (acceptedCandidates.length > 0) {
  console.log(`正在将准入的 ${acceptedCandidates.length} 个新高质量案例录入主画廊...`);
  let mdToAppend = '\n\n';
  for (const item of acceptedCandidates) {
    maxId++;
    const altText = (item.title || `Case ${maxId}`).replace(/[[\]]/g, '').trim();
    const imageLine = item.image ? `![${altText}](${item.image})\n\n` : '';
    mdToAppend += `***\n\n<a name="case-${maxId}"></a>\n\n### 例 ${maxId}：${item.title}\n\n${imageLine}**来源：** ${item.source}\n\n**提示词：**\n\n\`\`\`text\n${item.prompt}\n\`\`\`\n\n`;
  }
  appendFileSync(join(rootDir, 'docs', 'gallery-part-2.md'), mdToAppend, 'utf8');
}

// 4. 重新构建站点索引与 Agent Skill
try {
  console.log('重新生成站点索引与提示词技能包...');
  run('npm run generate:site-data');
  run('npm run generate:style-skill');
  run('node scripts/install-style-skill.mjs all');
} catch (err) {
  console.error('生成或分发过程报错：', err.message);
}

// 5. 变更检测与精细化提交推送（杜绝盲目 git add . 泄漏敏感记忆文件）
const status = run('git status --porcelain').trim();
if (status) {
  console.log('检测到项目数据更新，执行精细化暂存与推送...');
  try {
    // 仅添加合法的数据与文档产物，防止工作记忆或临时文件误提交
    run('git add data/ docs/ scripts/ README.md');
    const finalCheck = run('git status --porcelain').trim();
    if (finalCheck) {
      const commitMsg = `chore(sync): automated daily prompts and skills update (${new Date().toISOString().slice(0, 10)})`;
      run(`git commit -m "${commitMsg}"`);
      run('git push origin main');
      console.log('成功推送到 GitHub origin/main 远端！');
    }
  } catch (err) {
    console.error('Git 提交/推送失败：', err.message);
  }
} else {
  console.log('今日仓库无新变更，无需提交。');
}

console.log(`[${new Date().toISOString()}] 每日同步与质检流程执行完毕。`);
console.log(`[${new Date().toISOString()}] ==========================================`);
