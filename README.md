# Claude Code Usage Dashboard

Visueel dashboard voor het tracken van Claude Code tokenverbruik, met per-prompt granulariteit, plugin-effectiviteit tracking, en optimalisatie-advies.

## Features

- Per-prompt token breakdown (input, output, cache read, cache creation)
- Dagelijks verbruik per model (Opus, Sonnet, Haiku)
- Voor/na plugin vergelijking met effectieve tokens (zonder cache reads)
- Cache hit ratio tracking
- Actieve plugin detectie (CodeSight, Context Optimizer, Skill Manager, MCP servers)
- Automatische advies & suggesties (model routing, dure prompts, cache efficiency)
- Filterbaar op model, datum, zoekterm
- "DUUR" labels voor prompts die 5x+ het gemiddelde kosten

## Installatie

```bash
# Kopieer naar ~/.claude/tools/
cp dashboard.html parse-usage.mjs run-dashboard.sh ~/.claude/tools/
chmod +x ~/.claude/tools/run-dashboard.sh
```

## Gebruik

```bash
# Genereer data en open dashboard
bash ~/.claude/tools/run-dashboard.sh

# Of apart:
cd ~/.claude/tools
node parse-usage.mjs    # Parse JSONL bestanden
open dashboard.html     # Open in browser
```

## Plugin markers

Voeg markers toe in `parse-usage.mjs` om voor/na vergelijkingen te maken:

```js
const MARKERS = [
  { date: '2026-04-18', label: 'CodeSight geinstalleerd' },
];
```

## Vereisten

- Node.js 18+
- Claude Code (data in `~/.claude/projects/`)
