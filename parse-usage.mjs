import { readdir, readFile, access, stat } from 'node:fs/promises';
import { createReadStream, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const OUTPUT_DIR = process.env.DASHBOARD_OUTPUT || __dirname;

const MARKERS_PATH = join(__dirname, 'markers.json');
const MARKERS = existsSync(MARKERS_PATH)
  ? JSON.parse(readFileSync(MARKERS_PATH, 'utf-8'))
  : [];

async function findProjectDirs() {
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => join(PROJECTS_DIR, e.name));
}

async function parseJsonlFile(filePath) {
  const userMessages = new Map();
  const assistantByRequest = new Map();
  const parentChain = new Map();

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.uuid && entry.parentUuid) {
      parentChain.set(entry.uuid, entry.parentUuid);
    }

    if (entry.type === 'user' && entry.message?.role === 'user') {
      const content = entry.message.content;
      let preview = '';
      if (typeof content === 'string') {
        preview = content.slice(0, 150);
      } else if (Array.isArray(content)) {
        const textParts = content.filter(c => c.type === 'text').map(c => c.text || '');
        preview = textParts.join(' ').replace(/\[Image:.*?\]/g, '').trim().slice(0, 150);
        if (!preview) {
          const hasImage = content.some(c => c.type === 'image');
          const toolResult = content.find(c => c.type === 'tool_result');
          if (hasImage) preview = '[image]';
          else if (toolResult) preview = '[tool result]';
        }
      }

      if (preview && !preview.startsWith('[tool result]')) {
        userMessages.set(entry.uuid, {
          uuid: entry.uuid,
          timestamp: entry.timestamp,
          sessionId: entry.sessionId,
          preview,
        });
      }
    }

    if (entry.type === 'assistant' && entry.message?.usage) {
      const reqId = entry.requestId;
      if (reqId && !assistantByRequest.has(reqId)) {
        const usage = entry.message.usage;
        assistantByRequest.set(reqId, {
          parentUuid: entry.parentUuid,
          model: entry.message.model || 'unknown',
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cacheCreationTokens: usage.cache_creation_input_tokens || 0,
          timestamp: entry.timestamp,
          sessionId: entry.sessionId,
        });
      }
    }
  }

  return { userMessages, assistantByRequest, parentChain };
}

function findUserPromptForAssistant(assistant, allUserMessages, parentChain) {
  let uuid = assistant.parentUuid;
  const visited = new Set();

  while (uuid && !visited.has(uuid)) {
    visited.add(uuid);
    if (allUserMessages.has(uuid)) {
      return allUserMessages.get(uuid);
    }
    uuid = parentChain.get(uuid);
  }
  return null;
}

async function main() {
  console.log('Scanning project directories...');
  const projectDirs = await findProjectDirs();
  console.log(`Found ${projectDirs.length} project directories`);

  const allPrompts = [];
  const seenRequests = new Set();
  let totalFiles = 0;

  for (const dir of projectDirs) {
    const files = await readdir(dir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    totalFiles += jsonlFiles.length;

    for (const file of jsonlFiles) {
      const filePath = join(dir, file);
      const { userMessages, assistantByRequest, parentChain } = await parseJsonlFile(filePath);

      const groupedByUserPrompt = new Map();

      for (const [reqId, assistant] of assistantByRequest) {
        if (seenRequests.has(reqId)) continue;
        seenRequests.add(reqId);

        const userPrompt = findUserPromptForAssistant(assistant, userMessages, parentChain);
        const groupKey = userPrompt?.uuid || `orphan-${reqId}`;

        if (!groupedByUserPrompt.has(groupKey)) {
          groupedByUserPrompt.set(groupKey, {
            timestamp: userPrompt?.timestamp || assistant.timestamp,
            sessionId: userPrompt?.sessionId || assistant.sessionId,
            promptPreview: userPrompt?.preview || '[system/continuation]',
            perModel: {},
            apiCalls: 0,
          });
        }

        const group = groupedByUserPrompt.get(groupKey);
        const m = assistant.model;
        if (!group.perModel[m]) {
          group.perModel[m] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
        }
        group.perModel[m].inputTokens += assistant.inputTokens;
        group.perModel[m].outputTokens += assistant.outputTokens;
        group.perModel[m].cacheReadTokens += assistant.cacheReadTokens;
        group.perModel[m].cacheCreationTokens += assistant.cacheCreationTokens;
        group.apiCalls++;
      }

      for (const [, group] of groupedByUserPrompt) {
        const models = Object.keys(group.perModel);
        const inputTokens = models.reduce((s, m) => s + group.perModel[m].inputTokens, 0);
        const outputTokens = models.reduce((s, m) => s + group.perModel[m].outputTokens, 0);
        const cacheReadTokens = models.reduce((s, m) => s + group.perModel[m].cacheReadTokens, 0);
        const cacheCreationTokens = models.reduce((s, m) => s + group.perModel[m].cacheCreationTokens, 0);
        const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
        if (totalTokens === 0) continue;

        // Primary model = most output tokens (the one doing the real work)
        const primaryModel = models.reduce((best, m) =>
          group.perModel[m].outputTokens > (group.perModel[best]?.outputTokens || 0) ? m : best, models[0]);

        allPrompts.push({
          timestamp: group.timestamp,
          sessionId: group.sessionId,
          promptPreview: group.promptPreview,
          model: primaryModel,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          totalTokens,
          apiCalls: group.apiCalls,
          perModel: group.perModel,
        });
      }
    }
  }

  allPrompts.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  console.log(`Parsed ${totalFiles} JSONL files, found ${allPrompts.length} unique prompts`);

  const dailyMap = new Map();
  const sessionSet = new Set();

  for (const p of allPrompts) {
    const date = p.timestamp?.slice(0, 10);
    if (!date) continue;

    sessionSet.add(p.sessionId);

    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        promptCount: 0,
        byModel: {},
        modelDetails: {},
      });
    }

    const day = dailyMap.get(date);
    day.totalTokens += p.totalTokens;
    day.inputTokens += p.inputTokens;
    day.outputTokens += p.outputTokens;
    day.cacheReadTokens += p.cacheReadTokens;
    day.cacheCreationTokens += p.cacheCreationTokens;
    day.promptCount++;
    // Split tokens to individual models via perModel breakdown
    const modelEntries = p.perModel ? Object.entries(p.perModel) : [[p.model, { inputTokens: p.inputTokens, outputTokens: p.outputTokens, cacheReadTokens: p.cacheReadTokens, cacheCreationTokens: p.cacheCreationTokens }]];
    for (const [model, mt] of modelEntries) {
      const mTotal = mt.inputTokens + mt.outputTokens + mt.cacheReadTokens + mt.cacheCreationTokens;
      day.byModel[model] = (day.byModel[model] || 0) + mTotal;

      if (!day.modelDetails[model]) {
        day.modelDetails[model] = { promptCount: 0, totalTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputTokens: 0, outputTokens: 0 };
      }
      const md = day.modelDetails[model];
      md.promptCount++;
      md.totalTokens += mTotal;
      md.cacheReadTokens += mt.cacheReadTokens;
      md.cacheCreationTokens += mt.cacheCreationTokens;
      md.inputTokens += mt.inputTokens;
      md.outputTokens += mt.outputTokens;
    }
  }

  const dailyAggregates = [...dailyMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      const modelStats = {};
      for (const [model, md] of Object.entries(d.modelDetails)) {
        modelStats[model] = {
          ...md,
          avgTokensPerPrompt: md.promptCount > 0 ? Math.round(md.totalTokens / md.promptCount) : 0,
          cacheHitRatio: md.cacheReadTokens / (md.cacheReadTokens + md.cacheCreationTokens + md.inputTokens) || 0,
          cacheCreationRatio: md.cacheCreationTokens / (md.cacheReadTokens + md.cacheCreationTokens + md.inputTokens) || 0,
        };
      }
      return {
        ...d,
        avgTokensPerPrompt: d.promptCount > 0 ? Math.round(d.totalTokens / d.promptCount) : 0,
        cacheHitRatio: d.cacheReadTokens / (d.cacheReadTokens + d.cacheCreationTokens + d.inputTokens) || 0,
        cacheCreationRatio: d.cacheCreationTokens / (d.cacheCreationTokens + d.cacheReadTokens + d.inputTokens) || 0,
        modelStats,
      };
    });

  const sessionMap = new Map();
  for (const p of allPrompts) {
    if (!p.sessionId) continue;
    if (!sessionMap.has(p.sessionId)) {
      sessionMap.set(p.sessionId, { prompts: [], firstTimestamp: p.timestamp, lastTimestamp: p.timestamp });
    }
    const sess = sessionMap.get(p.sessionId);
    sess.prompts.push(p);
    if (p.timestamp > sess.lastTimestamp) sess.lastTimestamp = p.timestamp;
    if (p.timestamp < sess.firstTimestamp) sess.firstTimestamp = p.timestamp;
  }

  const sessionAggregates = [...sessionMap.entries()].map(([id, sess]) => {
    const userPrompts = sess.prompts.filter(p => p.promptPreview !== '[system/continuation]');
    const totalOutput = sess.prompts.reduce((s, p) => s + p.outputTokens, 0);
    const totalEffective = sess.prompts.reduce((s, p) => s + p.inputTokens + p.outputTokens + p.cacheCreationTokens, 0);
    const totalRequests = sess.prompts.length;
    const durationMs = new Date(sess.lastTimestamp) - new Date(sess.firstTimestamp);
    return {
      sessionId: id,
      date: sess.firstTimestamp?.slice(0, 10),
      userPromptCount: userPrompts.length,
      totalRequests,
      requestsPerUserPrompt: userPrompts.length > 0 ? +(totalRequests / userPrompts.length).toFixed(1) : 0,
      totalOutput,
      avgOutputPerRequest: totalRequests > 0 ? Math.round(totalOutput / totalRequests) : 0,
      totalEffective,
      durationMinutes: Math.round(durationMs / 60000),
    };
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  for (const day of dailyAggregates) {
    const daySessions = sessionAggregates.filter(s => s.date === day.date);
    day.avgRequestsPerUserPrompt = daySessions.length > 0
      ? +(daySessions.reduce((s, sess) => s + sess.requestsPerUserPrompt, 0) / daySessions.length).toFixed(1) : 0;
    day.avgOutputPerRequest = day.promptCount > 0 ? Math.round(day.outputTokens / day.promptCount) : 0;
    day.outputToInputRatio = (day.inputTokens + day.cacheCreationTokens) > 0
      ? +(day.outputTokens / (day.inputTokens + day.cacheCreationTokens)).toFixed(2) : 0;
  }

  // Detect active plugins
  const plugins = [];
  const projectRoots = (await findProjectDirs()).map(d => {
    const decoded = d.split('/').pop().replace(/-/g, '/');
    return decoded.startsWith('/') ? decoded : '/' + decoded;
  });
  const codesightActive = projectRoots.some(r => existsSync(join(r, '.codesight')));
  const pluginChecks = [
    { name: 'CodeSight', forceActive: codesightActive, type: 'dir', description: 'Codebase index for fewer Grep/Read calls' },
    { name: 'Context Optimizer', path: join(CLAUDE_DIR, 'plugins', 'claude-context-optimizer'), type: 'dir', description: 'Blocks redundant file reads' },
    { name: 'LSP Enforcement Kit', path: join(CLAUDE_DIR, 'hooks'), type: 'file', checkFile: 'lsp', description: 'Enforces LSP over Grep for navigation' },
    { name: 'Skill Manager', path: join(CLAUDE_DIR, 'skills-disabled'), type: 'dir', description: 'Parks unused skills (~4K tokens/conversation)' },
  ];

  for (const check of pluginChecks) {
    try {
      if (check.forceActive !== undefined) {
        plugins.push({ name: check.name, active: check.forceActive, description: check.description });
        continue;
      }
      if (check.type === 'dir') {
        await access(check.path);
        const s = await stat(check.path);
        if (s.isDirectory()) plugins.push({ name: check.name, active: true, description: check.description });
      } else if (check.checkFile) {
        const hookDir = check.path;
        if (existsSync(hookDir)) {
          const files = await readdir(hookDir);
          if (files.some(f => f.toLowerCase().includes(check.checkFile))) {
            plugins.push({ name: check.name, active: true, description: check.description });
          }
        }
      }
    } catch {
      plugins.push({ name: check.name, active: false, description: check.description });
    }
  }

  try {
    const settingsPath = join(CLAUDE_DIR, 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
    const mcpServers = settings.mcpServers || {};
    for (const [name] of Object.entries(mcpServers)) {
      if (!plugins.some(p => p.name === name)) {
        plugins.push({ name, active: true, description: 'MCP server', type: 'mcp' });
      }
    }
  } catch {}

  try {
    const mcpPath = join(process.cwd(), '.mcp.json');
    const mcp = JSON.parse(await readFile(mcpPath, 'utf-8'));
    const mcpServers = mcp.mcpServers || {};
    for (const [name] of Object.entries(mcpServers)) {
      if (!plugins.some(p => p.name === name)) {
        plugins.push({ name, active: true, description: 'MCP server (project)', type: 'mcp' });
      }
    }
  } catch {}

  console.log(`  Plugins detected: ${plugins.filter(p => p.active).map(p => p.name).join(', ') || 'none'}`);

  const output = {
    generated: new Date().toISOString(),
    markers: MARKERS,
    plugins,
    totalSessions: sessionSet.size,
    totalPrompts: allPrompts.length,
    prompts: allPrompts,
    dailyAggregates,
    sessionAggregates,
  };

  const jsonPath = join(OUTPUT_DIR, 'dashboard-data.json');
  const jsPath = join(OUTPUT_DIR, 'dashboard-data.js');
  writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  writeFileSync(jsPath, `window.__DASHBOARD_DATA__ = ${JSON.stringify(output)};\n`);
  console.log(`Dashboard data written to ${jsonPath}`);
  console.log(`  ${allPrompts.length} prompts across ${dailyAggregates.length} days`);
  console.log(`  ${sessionSet.size} unique sessions`);

  const totalAll = allPrompts.reduce((s, p) => s + p.totalTokens, 0);
  console.log(`  Total tokens: ${(totalAll / 1_000_000).toFixed(1)}M`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
