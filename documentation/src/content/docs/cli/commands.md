---
title: CLI Commands
description: Reference for zenitest CLI commands and installation.
---

# CLI Reference

Execute tests and manage authentication from your terminal.

---

## Installation

Install the `zenitest` CLI globally:

```bash
# Using npm
npm install -g zenitest

# Or using bun
bun install -g zenitest
```

---

## `zenitest auth`

Saves your Zeni API key to local configuration (`~/.zenitest/config.json`).

```bash
zenitest auth YOUR_API_KEY
```

---

## `zenitest run`

Runs all `.yaml` test files in your test directory.

```bash
zenitest run
```

### Options & Flags

| Flag | Short | Description | Default |
| --- | --- | --- | --- |
| `--dir <path>` | `-d` | Path to test directory | `zeni_tests` |
| `--parallel <n>` | `-p` | Number of test cases to run concurrently | `5` |
| `--help` | `-h` | Show CLI help screen | |

### Example Usage

```bash
zenitest run --dir zeni_tests --parallel 3
```
