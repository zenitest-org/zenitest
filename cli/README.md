# zenitest-cli

> **ZeniTest CLI**: AI-powered automated end-to-end testing for Web, iOS, and Android applications.

`zenitest-cli` (executable command `zenitest`) is the command-line interface for ZeniTest. It enables developer teams to authenticate, establish proxy client tunnels for browser automation, execute natural-language YAML test suites, and retrieve execution reports.

---

## 📦 Installation

Install globally using `npm`:

```bash
npm install -g zenitest-cli
```

Or execute directly with `npx`:

```bash
npx zenitest-cli <command> [options]
```

---

## 🚀 Quick Start

### 1. Authenticate
Authenticate with your Zeni API key:
```bash
zenitest auth <your_api_key>
```
*Your credentials are saved securely to `~/.zenitest/config.json`.*

### 2. Create Test Cases
Organize test files inside a `zenitests/` directory (e.g., `zenitests/web/tc_saucedemo_login.yaml`):

```yaml
id: tc_saucedemo_login
title: SauceDemo Login Flow
priority: high

prodURL: https://www.saucedemo.com

variables:
  username: standard_user

expectedResult: User successfully logs in and views the product inventory.

steps:
  - navigate: /

  - act: Type '${username}' into the 'Username' input field

  - act: Type '${secret.SAUCE_PASSWORD}' into the 'Password' input field

  - act: Click on the 'Login' button

  - validate: Verify that the product inventory container or 'Products' page title is displayed on the page
```

### 3. Run Test Suites
Execute all test cases in your test directory:
```bash
zenitest run --platform web --parallel 5
```

### 4. Fetch Execution Reports
Retrieve test execution status and breakdown using the run number:
```bash
zenitest report 1
```

---

## 🛠️ CLI Commands & Options

### `zenitest auth [api_key]`
Authenticates the CLI with your Zeni API key. Prompts interactively if omitted.

### `zenitest client`
Launches the local Playwright web automation test executor and connects to the Zeni API server over WebSocket RPC.

### `zenitest run [options]`
Executes YAML test cases.

| Option | Alias | Description | Default |
| --- | --- | --- | --- |
| `--dir <directory>` | `-d` | Directory containing `.yaml` test files | `zenitests` |
| `--platform <platform>` | `-t` | Target platform: `web`, `ios`, `android` | `all` |
| `--browser <browser>` | - | Web test browser: `chromium`, `chrome`, `firefox`, `safari` | `chromium` |
| `--bundle <path>` | `-b` | Path to mobile app binary file (`.apk` or `.ipa`) | - |
| `--parallel <count>` | `-p` | Number of test cases to execute concurrently | `5` |
| `--local-api` | - | Connect to local ZeniTest API server (`http://localhost:3001`) | - |
| `--api-url <url>` | - | Custom API server base URL | `https://api.zenitest.ai` |
| `--help` | `-h` | Display CLI help message | - |

**Examples:**
```bash
# Run web test cases with custom directory and concurrency
zenitest run --dir ./my-tests --platform web --parallel 3

# Run iOS test suite
zenitest run --platform ios --bundle ./build/Runner.ipa

# Run Android test suite
zenitest run --platform android --bundle ./build/app-debug.apk
```

### `zenitest report <run_number> [--json]`
Fetches the summary report for a completed or ongoing test execution run.

```bash
# Formatted terminal output
zenitest report 42

# Structured JSON output
zenitest report 42 --json
```

---

## 🔑 Managing Secrets & Credentials

ZeniTest automatically resolves secret values referenced in steps (e.g. `${secret.SAUCE_PASSWORD}`).

Create a `secrets.yaml` or `credentials.yaml` file in your root workspace or in `~/.zenitest/secrets.yaml`:

```yaml
secrets:
  SAUCE_PASSWORD: secret_sauce
  STAGING_TOKEN: eyJhbGciOi...
```

---

## 📄 YAML Test Case Format

| Field | Type | Description | Required |
| --- | --- | --- | --- |
| `id` | `string` | Unique identifier (e.g., `tc_saucedemo_login`) | Yes |
| `title` | `string` | Descriptive title for the scenario | Yes |
| `priority` | `string` | Execution priority (`high`, `medium`, `low`) | No |
| `localUrl` / `prodUrl` | `string` | Target base URL for Web applications | Required for Web |
| `variables` | `map` | Reusable test variables referenced via `${var_name}` | No |
| `expectedResult` | `string` | Expected final condition summary | Yes |
| `steps` | `list` | Test step sequence (`navigate`, `act`, `validate`) | Yes |

---

## 📜 License

MIT © ZeniTest
