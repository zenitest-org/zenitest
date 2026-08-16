---
name: zenitest
description: Instructions for generating test cases in ZeniTest YAML format and executing them using the zenitest CLI.
---

# ZeniTest Skill Guide

This skill describes how to write ZeniTest automated test cases in the simplified YAML format and how to execute test suites using the `zenitest` CLI.

---

## 1. Test Case YAML Specification

Test cases are defined as YAML files stored in the `zenitests/` directory (subfolders: `web/`, `ios/`, `android/` or a custom directory passed to the CLI).

### Root Attributes

| Key | Type | Description | Required |
| --- | --- | --- | --- |
| `id` | `string` | Unique identifier for the test case (e.g. `tc_saucedemo_login`) | Yes |
| `title` | `string` | Human-readable title describing the test scenario | Yes |
| `priority` | `string` | Priority level (`high`, `medium`, `low`) | Optional |
| `localUrl` / `localURL` | `string` | Local development URL (e.g. `http://localhost:3000`) | Optional |
| `prodURL` / `prodUrl` | `string` | Base production URL for the target application | Optional (for Web) |
| `variables` | `map` | Key-value pairs for reusable test data referenced in steps | Optional |
| `expectedResult` | `string` | Summary of expected final outcome | Yes |
| `steps` | `list` | Sequence of test steps (`navigate`, `act`, `validate`) | Yes |

---

### Simplified Step Syntax

Each item under `steps` must use one of the simplified action keys with a blank line separating steps:

- **`navigate: <path>`**  
  Navigates the browser to a relative path or full URL.  
  Example: `- navigate: /`

- **`act: <instruction>`**  
  Describes an action for the AI agent to perform on the page. Supports variable substitution (`${variable}`) and secret references (`${secret.SECRET_KEY}`).  
  Examples:
  - `- act: Type '${username}' into the 'Username' input field`
  - `- act: Type '${secret.SAUCE_PASSWORD}' into the 'Password' input field`
  - `- act: Click on the 'Login' button`

- **`validate: <condition>`**  
  Prompts the AI agent to verify page state or visual content.  
  Example: `- validate: Verify that the product inventory container or 'Products' page title is displayed on the page`

---

### Example Test Case (`zenitests/web/tc_saucedemo_login.yaml`)

```yaml
id: tc_saucedemo_login
title: SauceDemo Login Test Case with Secret Credentials
priority: high

prodURL: https://www.saucedemo.com

variables:
  username: standard_user

expectedResult: Swag Labs inventory page is displayed after login.

steps:
  - navigate: /

  - act: Type '${username}' into the 'Username' input field

  - act: Type '${secret.SAUCE_PASSWORD}' into the 'Password' input field

  - act: Click on the 'Login' button

  - validate: Verify that the product inventory container or 'Products' page title is displayed on the page
```

---

## 2. Using the `zenitest` CLI

The `zenitest` CLI is used to authenticate, tunnel browser actions, and execute YAML test cases.

### CLI Commands

#### 1. Authenticate API Key
```bash
zenitest auth <api_key>
```
Saves the API key to `~/.zenitest/config.json` and verifies credentials against the Zeni server.

#### 2. Start Proxy Client Tunnel
```bash
zenitest client
```
Launches a headless browser proxy client and establishes a CDP WebSocket tunnel to the server.

#### 3. Run Test Cases
```bash
zenitest run [options]
```

**Options:**
- `--dir, -d <directory>`: Folder containing `.yaml` test files (default: `zenitests`).
- `--platform, -t <target>`: Filter test platform target: `web`, `ios`, `android` (comma-separated list).
- `--browser <browser>`: Web browser: `chromium`, `chrome`, `firefox`, `safari` (default: config or `chromium`).
- `--bundle, -b <path>`: Path to built mobile app binary file (`.ipa` or `.apk`).
- `--parallel, -p <count>`: Number of web test cases to run concurrently (default: `5`).
- `--help, -h`: Display CLI help screen.

---

### Step-by-Step Execution Workflow

1. **Create Test File**: Save your `.yaml` file inside `zenitests/web/`, `zenitests/ios/`, or `zenitests/android/`.
2. **Set Secrets (Optional)**: Store secret keys in `secrets.yaml` or `credentials.yaml` in the working directory:
   ```yaml
   secrets:
     SAUCE_PASSWORD: secret_sauce
     AWS_PROJECT_ARN: arn:aws:devicefarm:us-west-2:123456789012:testgrid-project:xxx
   ```
3. **Execute Test Cases**:
   - **Web Suite**: `zenitest run --platform web --parallel 2`
   - **Mobile iOS Suite**: `zenitest run --platform ios --bundle ./build/Runner.ipa`
   - **Mobile Android Suite**: `zenitest run --platform android --bundle ./build/app-debug.apk`
