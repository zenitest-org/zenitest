---
title: Quickstart
description: Get started with ZeniTest in under 2 minutes.
---

# Quickstart Guide

Run your first automated test in under 2 minutes.

---

## 1. Install ZeniTest CLI

Install the CLI globally using npm or bun:

```bash
# Using npm
npm install -g zenitest

# Or using bun
bun install -g zenitest
```

---

## 2. Authenticate API Key

```bash
zenitest auth your_api_key
```

---

## 3. Install AI Agent Skill (Optional)

Enable coding assistants (Claude Code, Cursor, Codex, etc.) to generate and maintain tests automatically:

```bash
npx skills add zeni-org/zenitest
```

---

## 4. Create Test Case (`zeni_tests/tc_login.yaml`)

Write manually or prompt your AI agent: *"Create a login test case for SauceDemo"*.

```yaml
id: tc_login
title: SauceDemo Login Test
prodURL: https://www.saucedemo.com
expectedResult: Inventory page loaded.

steps:
  - navigate: /
  - act: Type 'standard_user' into 'Username'
  - act: Type 'secret_sauce' into 'Password'
  - act: Click 'Login'
  - validate: Verify 'Products' page title is displayed
```

---

## 5. Run Tests

```bash
zenitest run --dir zeni_tests
```

That's it! ZeniTest will execute your test actions and report pass/fail status in your terminal.
