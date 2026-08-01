'use strict';

/**
 * Native Agent Skills — Skill 发现和按需加载
 *
 * 从 skills 目录发现所有 SKILL.md 文件，
 * 构建 skill 索引 (name + description) 注入 system prompt。
 *
 * Skill body 在 LLM 请求时按需注入 (通过 tool call `load_skill`)。
 *
 * 目录优先级: ~/.cloe/skills/ → ~/.hermes/skills/ (fallback)
 */

const fs = require('fs');
const path = require('path');
const { getSkillsDir } = require('./paths');

let cachedIndex = null;
let cachedMtime = 0;
let cachedDir = null;

/**
 * Recursively find all SKILL.md files under skills dir.
 * Returns array of { name, description, fullPath }
 */
function discoverSkills() {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) return [];
  
  // Invalidate cache if directory changed
  if (cachedDir !== skillsDir) {
    cachedIndex = null;
  }

  // Check if we can use cache (30s TTL)
  try {
    const stat = fs.statSync(skillsDir);
    const dirMtime = stat.mtimeMs;
    if (cachedIndex && Date.now() - cachedIndex._ts < 30000) return cachedIndex.skills;
  } catch {
    return [];
  }
  
  const skills = [];
  
  function walk(dir, depth = 0) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.name === 'SKILL.md') {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          // Parse YAML frontmatter for name + description
          const { name, description } = parseFrontmatter(content, fullPath);
          skills.push({ name, description, fullPath });
        } catch {}
      }
    }
  }
  
  walk(skillsDir);
  
  cachedIndex = { skills, _ts: Date.now() };
  cachedDir = skillsDir;
  return skills;
}

/**
 * Parse YAML frontmatter from SKILL.md.
 * Minimal parser — just extracts `name` and `description`.
 */
function parseFrontmatter(content, fullPath) {
  let name = '';
  let description = '';
  
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)/m);
    const descMatch = fm.match(/^description:\s*(.+)/m);
    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }
  
  // Fallback: use directory name
  if (!name) {
    const dir = path.dirname(fullPath);
    name = path.basename(dir);
  }
  
  return { name, description };
}

/**
 * Render skills index as text for system prompt injection.
 * Format: compact one-liner per skill.
 */
function renderIndex() {
  const skills = discoverSkills();
  if (!skills.length) return '';
  
  const lines = skills.map(s => {
    const desc = s.description ? s.description.slice(0, 80) : '';
    return `- ${s.name}: ${desc}`;
  });
  return `Use load_skill(name) to load full instructions. Available:\n${lines.join('\n')}`;
}

/**
 * Load full skill content by name.
 * Returns the SKILL.md content or null.
 */
function loadSkillBody(name) {
  const skills = discoverSkills();
  const skill = skills.find(s => s.name === name || s.name.endsWith('/' + name));
  if (!skill) return null;
  
  try {
    let content = fs.readFileSync(skill.fullPath, 'utf-8');
    
    // Also check for linked reference files
    const dir = path.dirname(skill.fullPath);
    const referencesDir = path.join(dir, 'references');
    const templatesDir = path.join(dir, 'templates');
    const scriptsDir = path.join(dir, 'scripts');
    
    const linked = [];
    for (const subdir of ['references', 'templates', 'scripts']) {
      const p = path.join(dir, subdir);
      if (fs.existsSync(p)) {
        try {
          const files = fs.readdirSync(p);
          for (const f of files) {
            linked.push(`${subdir}/${f}`);
          }
        } catch {}
      }
    }
    
    if (linked.length) {
      content += `\n\n--- Linked files (use file_read to access) ---\n${linked.join('\n')}`;
    }
    
    return content;
  } catch {
    return null;
  }
}

module.exports = {
  discoverSkills,
  renderIndex,
  loadSkillBody,
};
