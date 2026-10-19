# Codex Skill Manager · 技能管理器

**Understand what you installed, see what you actually use, and decide what to keep.**

[简体中文 — default](README.md) · English

A Chinese-first plugin for the **Codex desktop app**. It brings installed plugins, apps, MCP servers, skills, and discoverable command declarations into one place, with explanations, installation sources, usage evidence, and management actions.

## Why I built it

I'm not good at English. Many English names and descriptions are difficult for me to understand.

English is common in both built-in Codex capabilities and community plugins and skills. I kept asking myself: What have I installed? What does it do? Which skill should I choose for this task? Should I keep something I rarely use?

I built this plugin for that personal need: **make installed capabilities easier to inspect, understand, use, and manage**. I hope it helps others facing the same problem.

## Features

| Feature | What it provides |
|---|---|
| Unified inventory | Plugins, apps, MCP servers, skills, and discoverable command declarations |
| Chinese explanations | Purpose, use cases, inputs, outputs, dependencies, permissions, and the effects of disabling or removal |
| Installation sources | Recorded repository or parent-plugin source, with filtering; unknown sources stay unknown |
| Locations and scope | Loading entries, resolved paths, links, and personal/project environments |
| Usage evidence | 30/90-day actual tool calls, explicit skill-use receipts, recent use, and frequency when coverage supports it |
| Management | Search, filters, details, enable/disable, and supported uninstall or configuration-removal actions |
| Partial failure handling | Preserve usable entries during slow or failed reads; unknown is not treated as uninstalled |

Chinese explanations are stored separately without rewriting managed plugins or skills. **The manager never automatically removes items because their usage is low.**

## One-command installation

Requires **Node.js 24+ with npm/npx, Git, and Codex with the `plugin` commands**. The tested desktop environment is Windows. Other operating systems have not completed real-client acceptance.

```sh
npx --yes github:maple192600-LI/codex-skill-manager install
```

The installer comes from GitHub and invokes native Codex marketplace and plugin commands. The runtime bundle is included; normal installation does not require compilation. **Distribution is currently through GitHub, not the npm registry.**

Restart Codex after installation, then ask your agent:

```text
Open Skill Manager.
```

Repeating the command preserves an existing installation's enabled/disabled state. If a plugin with the same name is installed from another source, the installer stops and preserves it rather than creating a duplicate.

### Give this to your agent

```text
Install Codex Skill Manager from:
https://github.com/maple192600-LI/codex-skill-manager
Read README.en.md and docs/INSTALL.md, check Node.js 24+, Git, and Codex plugin support,
then run npx --yes github:maple192600-LI/codex-skill-manager install.
Install only this plugin. Preserve my other plugins, skills, and global AGENTS.md.
If the same plugin exists from another source, keep it and tell me.
Verify native installation records, explain any restart requirement, and after restart
verify the plugin in the actual Codex sidebar.
```

### Native commands and diagnostics

```sh
codex plugin marketplace add maple192600-LI/codex-skill-manager --ref main
codex plugin add skill-manager@codex-skill-manager
```

```sh
npx --yes github:maple192600-LI/codex-skill-manager doctor
```

See [installation and acceptance](docs/INSTALL.md), the [Codex repository marketplace documentation](https://developers.openai.com/plugins/build/plugins), and [npm exec documentation](https://docs.npmjs.com/cli/v11/commands/npm-exec/).

## What counts as usage?

**Reading skill instructions is not actual skill use. Missing records do not prove a skill was never used.**

- Plugin, app, and MCP statistics use readable local tool-call history. Discovery and connection checks are excluded from business usage.
- Skill counts require explicit full `SKILL.md` path receipts submitted after the agent actually applies a skill. A skill counts once per turn. Plans, instruction reads, and prose inference do not count.
- Agents must submit these receipts. Installation does not modify global instructions. Optional setup is described in [skill-use recording](docs/SKILL_USAGE.md). Past unrecorded activity cannot be reconstructed as fact.
- Incomplete history produces lower-bound confirmed counts and unknown percentages, not invented zero usage. With complete coverage, skill frequency is used days divided by active days within its effective scope.
- Project skills use the corresponding project's denominator. Call counts, conversations, and active days are distinct measures.

## Management boundaries

- Disable and uninstall are separate. Bundled skills may have independent switches; **Uninstall owning plugin** explains and confirms whole-plugin removal.
- Built-in skills, default-provided plugins, managed restrictions, and unconfirmed state may limit available actions. The UI explains the reason.
- Standalone skill removal preserves recoverable content. Removing a link affects that entry. Removing MCP configuration does not delete its server program.
- Independent app connections remain separate from plugin installation; use supported native Codex settings to disconnect them.
- Displayed state describes the queried installation/configuration environment. Existing conversations may need reloading.

## Local data and model use

Inventory, Chinese explanation caches, and statistics are stored locally. The plugin has no telemetry backend or chat-upload service. Usage analysis reads local Codex history.

**Generating Chinese explanations invokes your configured Codex model**, sending the relevant names, descriptions, and skill documentation. This may consume model quota and send private skill documentation to that model. Local statistics do not make translation fully offline. Obtain permission before processing someone else's private documentation.

## Development

```sh
npm ci
npm --prefix ui ci
npm run build
npm test
```

Runtime: `server/server.bundle.mjs`; UI: `ui/src`; shared rules: `shared`. Tests include isolated native configuration and plugin lifecycles and require Codex CLI. Never run uninstall acceptance against active user installations.

This is a local Codex plugin with a host-dependent UI. It is not a standalone web application and has not been adapted for Claude Code. See [CHANGELOG](CHANGELOG.md).

## Feedback and license

Use [Issues](https://github.com/maple192600-LI/codex-skill-manager/issues) for feedback. Remove account details, tokens, private paths, and chat content from reports.

[MIT License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
