#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEMO_PROMPTS = [
  'Fix the authentication middleware to handle expired tokens',
  'Add pagination to the /api/users endpoint',
  'Refactor the payment service to use the strategy pattern',
  'Write unit tests for the OrderProcessor class',
  'Why is the CI pipeline failing on the staging branch?',
  'Update the Dockerfile to use Node 22 alpine',
  'Add a dark mode toggle to the settings page',
  'Review this migration for safety before I run it',
  'Create a new API endpoint for bulk user imports',
  'Fix the N+1 query in the dashboard controller',
  'Add rate limiting to the webhook endpoint',
  'Explain how the event sourcing works in this codebase',
  'Optimize the search query — it takes 3s on production',
  'Set up GitHub Actions for automated deployments',
  'Add input validation to the registration form',
  'Debug why WebSocket connections drop after 30 seconds',
  'Implement soft deletes for the Project model',
  'Add Sentry error tracking to the API layer',
  'Create a data migration for the new permission system',
  'Write an integration test for the Stripe webhook handler',
  'Refactor the monolith notification service into separate channels',
  'Fix timezone handling in the scheduling module',
  'Add caching to the product catalog endpoint',
  'Generate TypeScript types from the OpenAPI spec',
  'Set up database seeding for local development',
  'Add health check endpoint for Kubernetes probes',
  'Fix CORS configuration for the mobile app',
  'Implement retry logic for failed email deliveries',
  'Update dependencies and fix breaking changes',
  'Add audit logging for admin actions',
  'Create a CLI command for data cleanup',
  'Fix the memory leak in the background worker',
  'Add 2FA support to the login flow',
  'Optimize Docker image size — currently 1.2GB',
  'Write documentation for the internal API',
  'Set up feature flags for the new checkout flow',
  'Debug the race condition in concurrent order processing',
  'Add OpenTelemetry tracing to the microservices',
  'Implement a circuit breaker for the external payment API',
  'Fix the flaky test in UserServiceTest',
];

const MODELS = [
  { id: 'claude-opus-4-6-20260401', weight: 0.55 },
  { id: 'claude-opus-4-7-20260415', weight: 0.25 },
  { id: 'claude-sonnet-4-6-20260401', weight: 0.15 },
  { id: 'claude-haiku-4-5-20251001', weight: 0.05 },
];

function pickModel() {
  const r = Math.random();
  let cum = 0;
  for (const m of MODELS) {
    cum += m.weight;
    if (r < cum) return m.id;
  }
  return MODELS[0].id;
}

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePrompts() {
  const prompts = [];
  const startDate = new Date('2026-04-10T08:00:00Z');
  const endDate = new Date('2026-04-20T18:00:00Z');
  const markerDate = '2026-04-14';

  let sessionId = 'sess-demo-001';
  let sessionPromptCount = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const promptsPerDay = randBetween(15, 45);
    sessionId = `sess-${date}-${randBetween(1, 3)}`;
    sessionPromptCount = 0;

    for (let i = 0; i < promptsPerDay; i++) {
      const hour = randBetween(8, 19);
      const minute = randBetween(0, 59);
      const timestamp = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(randBetween(0, 59)).padStart(2, '0')}Z`;

      if (sessionPromptCount > randBetween(5, 15)) {
        sessionId = `sess-${date}-${randBetween(1, 5)}`;
        sessionPromptCount = 0;
      }

      const model = pickModel();
      const isAfterMarker = date >= markerDate;

      const baseInput = model.includes('opus-4-7') ? randBetween(8000, 25000) : randBetween(3000, 15000);
      const baseOutput = model.includes('opus') ? randBetween(800, 4000) : randBetween(400, 2000);
      const baseCacheRead = randBetween(5000, 80000);
      const baseCacheCreate = randBetween(500, 8000);

      const efficiencyFactor = isAfterMarker ? 0.7 : 1.0;
      const cacheBoost = isAfterMarker ? 1.3 : 1.0;

      const inputTokens = Math.round(baseInput * efficiencyFactor);
      const outputTokens = baseOutput;
      const cacheReadTokens = Math.round(baseCacheRead * cacheBoost);
      const cacheCreationTokens = Math.round(baseCacheCreate * efficiencyFactor);

      const promptText = DEMO_PROMPTS[randBetween(0, DEMO_PROMPTS.length - 1)];
      const perModel = {};
      perModel[model] = { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };

      prompts.push({
        timestamp,
        sessionId,
        promptPreview: promptText,
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
        apiCalls: randBetween(1, 8),
        perModel,
      });

      sessionPromptCount++;
    }
  }

  prompts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return prompts;
}

const prompts = generatePrompts();

const dailyMap = new Map();
const sessionSet = new Set();

for (const p of prompts) {
  const date = p.timestamp.slice(0, 10);
  sessionSet.add(p.sessionId);

  if (!dailyMap.has(date)) {
    dailyMap.set(date, {
      date,
      totalTokens: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0,
      promptCount: 0, byModel: {}, modelDetails: {},
    });
  }

  const day = dailyMap.get(date);
  day.totalTokens += p.totalTokens;
  day.inputTokens += p.inputTokens;
  day.outputTokens += p.outputTokens;
  day.cacheReadTokens += p.cacheReadTokens;
  day.cacheCreationTokens += p.cacheCreationTokens;
  day.promptCount++;

  for (const [model, mt] of Object.entries(p.perModel)) {
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
      avgRequestsPerUserPrompt: 3.2,
      avgOutputPerRequest: d.promptCount > 0 ? Math.round(d.outputTokens / d.promptCount) : 0,
      outputToInputRatio: (d.inputTokens + d.cacheCreationTokens) > 0 ? +(d.outputTokens / (d.inputTokens + d.cacheCreationTokens)).toFixed(2) : 0,
      modelStats,
    };
  });

const output = {
  generated: new Date().toISOString(),
  markers: [{ date: '2026-04-14', label: 'CodeSight' }],
  plugins: [
    { name: 'CodeSight', active: true, description: 'Codebase index for fewer Grep/Read calls' },
    { name: 'Context Optimizer', active: false, description: 'Blocks redundant file reads' },
  ],
  totalSessions: sessionSet.size,
  totalPrompts: prompts.length,
  prompts,
  dailyAggregates,
  sessionAggregates: [],
};

const jsPath = join(__dirname, 'dashboard-data.js');
const jsonPath = join(__dirname, 'dashboard-data.json');
writeFileSync(jsPath, `window.__DASHBOARD_DATA__ = ${JSON.stringify(output)};\n`);
writeFileSync(jsonPath, JSON.stringify(output, null, 2));
console.log(`Demo data generated: ${prompts.length} prompts across ${dailyAggregates.length} days`);
