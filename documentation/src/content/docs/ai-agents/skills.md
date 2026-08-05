---
title: Agent Skills Setup
description: How to install and use ZeniTest Agent Skills with Claude Code, Codex, and Cursor.
---

# ZeniTest AI Agent Skills

ZeniTest provides a dedicated **Agent Skill** so AI coding assistants (**Claude Code**, **OpenAI Codex**, **Cursor**, **Antigravity**, etc.) can automatically generate, run, and maintain test cases as your application evolves.

---

## Installing the Skill

### Option 1: Automatic Installation (Recommended)

Run the CLI command in your project root:

```bash
npx skills add zeni-org/zenitest
```

This installs the `zenitest` skill configuration into your project's `.agents/skills/` directory.

---

### Option 2: Manual Installation

Create `.agents/skills/zenitest/SKILL.md` (or `.claude/skills/zenitest/SKILL.md` / `.cursor/skills/zenitest/SKILL.md`) in your project:

```bash
mkdir -p .agents/skills/zenitest
```

Add the following content to `.agents/skills/zenitest/SKILL.md`:

```markdown
---
name: zenitest
description: Instructions for generating and maintaining ZeniTest YAML test cases and running the zenitest CLI.
---

# ZeniTest Agent Skill Guide

## 1. Test Case YAML Format

Save test files in `zeni_tests/*.yaml`.

### Required Fields
- `id`: Unique identifier (e.g. `tc_login_001`)
- `title`: Short scenario description
- `prodURL`: Target app URL (e.g. `https://app.example.com` or `http://localhost:3000`)
- `expectedResult`: Expected outcome description
- `steps`: Sequence of test actions (`navigate`, `act`, `validate`)

### Step Actions
- `- navigate: /path`
- `- act: Type '${username}' into 'Username'`
- `- act: Click 'Submit'`
- `- validate: Verify 'Dashboard' is displayed`

## 2. CLI Execution

To run tests:
```bash
zenitest run --dir zeni_tests
```
```

---

## Using Skills with AI Coding Agents

Once installed, your AI coding assistant will automatically detect the ZeniTest skill and help you generate and maintain test suites:

### 1. Generate Tests for New Features
> *"I built a checkout feature. Use ZeniTest to create an E2E test file in `zeni_tests/`."*

### 2. Auto-Maintain Tests During Refactoring
> *"We updated the login button text to 'Sign In'. Please update our ZeniTest suite."*

### 3. Run and Self-Heal Tests
> *"Run `zenitest run` and fix any failing test scenarios."*
