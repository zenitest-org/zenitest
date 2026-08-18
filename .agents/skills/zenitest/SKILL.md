---
name: zenitest
description: Instructions for authoring ZeniTest YAML test cases (Web, iOS, Android) and executing suites using the zenitest CLI. Use when creating, updating, or running automated E2E tests with ZeniTest.
---

# ZeniTest Skill Guide

ZeniTest is an AI-powered end-to-end testing platform. You write tests in plain English using simple YAML files, and ZeniTest's AI agent runs them across Web, iOS, and Android apps — no selectors, no test code, no brittle scripts.

---

## 1. How Tests Are Organized

All test files and settings live inside a `zenitests/` folder at your project root. Each platform gets its own subfolder:

```text
zenitests/
├── web/
│   ├── config.yaml          # Default settings for web tests
│   ├── tc_login.yaml        # A web test case
│   └── tc_checkout.yaml     # Another web test case
├── ios/
│   ├── config.yaml          # Default settings for iOS tests
│   └── tc_ios_checkout.yaml # An iOS test case
└── android/
    ├── config.yaml          # Default settings for Android tests
    └── tc_android_order.yaml# An Android test case
```

- **`web/`** — Browser tests for websites and web apps.
- **`ios/`** — Native app tests for iPhone and iPad (`.app` or `.ipa` files).
- **`android/`** — Native app tests for Android devices (`.apk` files).

Secrets and credentials are stored separately (see Section 5).

---

## 2. Platform Settings (`config.yaml`)

Each platform folder can include a `config.yaml` to set defaults. These save you from typing the same flags every time you run tests.

### Web Settings (`zenitests/web/config.yaml`)

```yaml
browser: chromium               # Which browser to use (chromium, chrome, firefox, safari)
localURL: http://localhost:3000 # Your local dev server URL
prodURL: https://www.example.com # Your production or staging URL
parallel: 2                     # How many tests to run at the same time
```

### iOS Settings (`zenitests/ios/config.yaml`)

```yaml
bundlePath: build/Runner.app    # Path to your built iOS app (.app for Simulator, .ipa for device)
device: iPhone 15 Pro           # Simulator or device name
parallel: 1                     # How many tests to run at the same time
```

### Android Settings (`zenitests/android/config.yaml`)

```yaml
bundlePath: build/app-debug.apk # Path to your built Android app (.apk)
device: Pixel 7                  # Emulator or device name
parallel: 1                      # How many tests to run at the same time
```

---

## 3. Writing a Test Case

Each test is a `.yaml` file with a few fields at the top and a list of steps. Here is what goes in a test file:

### Required Fields

- **`id`** — A unique name for the test, written in snake_case (e.g. `tc_login`, `tc_checkout_flow`).
- **`title`** — A short sentence describing what the test does (e.g. "User Login and Product Page Verification").
- **`steps`** — The list of actions and checks to perform, in order.

### Optional Fields

- **`priority`** — How important the test is. Use `P0`, `P1`, `P2` or `high`, `medium`, `low`.
- **`variables`** — Reusable values you can reference in your steps with `${variableName}`.
- **`expectedResult`** — A plain English description of the expected outcome when all steps pass.

---

## 4. Step Actions

Every step in a test uses one of three actions:

### `navigate` (web tests only)

Opens a page in the browser. Use a relative path or a full URL.

```yaml
- navigate: /
- navigate: /login
- navigate: /settings/profile
- navigate: https://example.com/pricing
```

### `act`

Tells ZeniTest what to do on the screen. Write in plain English, describing exactly what a person would do.

**Typing text:**
```yaml
- act: Type 'john@example.com' into the Email input field
- act: Type '${secret.PASSWORD}' into the Password field
```

**Clicking and tapping:**
```yaml
- act: Click on the 'Sign In' button
- act: Tap the 'Add to Cart' button
- act: Tap the Shopping Cart icon
```

**Other interactions:**
```yaml
- act: Select 'Price: Low to High' from the sorting dropdown
- act: Check the 'I agree to Terms' checkbox
- act: Scroll down to the product reviews section
```

You can use variables in any act step with `${variableName}` and secrets with `${secret.KEY_NAME}`.

### `validate`

Checks that something is visible or correct on the screen.

```yaml
- validate: Verify that the 'Products' heading is displayed
- validate: Cart badge shows '1'
- validate: 'Order Placed Successfully!' message is displayed
- validate: Verify the 'Checkout' button is enabled
```

---

## 5. Variables and Secrets

### Variables

Define reusable values at the top of your test file and reference them in steps:

```yaml
variables:
  username: standard_user
  searchTerm: Wireless Headphones

steps:
  - act: Type '${username}' into the Username field
  - act: Type '${searchTerm}' into the Search bar
```

### Secrets

Never put real passwords or tokens directly in your test files. Use secret placeholders instead:

```yaml
- act: Type '${secret.SAUCE_PASSWORD}' into the Password field
- act: Type '${secret.API_TOKEN}' into the Auth Token field
```

**Where to store secrets:** Create a `secrets.yaml` or `credentials.yaml` file. ZeniTest looks for this file in multiple places, in this order:

1. Inside your test directory (e.g. `zenitests/secrets.yaml`)
2. In your project root (e.g. `./secrets.yaml` or `./credentials.yaml`)
3. In your home folder at `~/.zenitest/secrets.yaml`

The file can use either a flat format or a nested format:

```yaml
# Flat format (keys at the top level)
SAUCE_PASSWORD: secret_sauce
API_TOKEN: my_secure_token

# Nested format (under a "secrets" key)
secrets:
  SAUCE_PASSWORD: secret_sauce
  API_TOKEN: my_secure_token
```

Both formats work the same way. Always add your secrets file to `.gitignore` so it never gets committed.

---

## 6. Complete Test Case Examples

### Web Test (`zenitests/web/tc_login.yaml`)

```yaml
id: tc_login
title: SauceDemo Login and Product Page Verification
priority: high

variables:
  username: standard_user

expectedResult: User logs in successfully and sees the product catalog.

steps:
  - navigate: /
  - act: Type '${username}' into the 'Username' input field
  - act: Type '${secret.SAUCE_PASSWORD}' into the 'Password' input field
  - act: Click on the 'Login' button
  - validate: Verify that the product catalog and 'Products' page title are visible
```

### iOS Test (`zenitests/ios/tc_ios_checkout.yaml`)

```yaml
id: tc_ios_checkout
title: iOS E-Commerce Checkout Workflow
priority: P0
expectedResult: Item added to cart and checkout completed on iOS device.

steps:
  - act: Tap the 'Add' button on the 'ZeniPods Pro Wireless' product card
  - validate: Cart badge displays 1
  - act: Tap the Cart icon to open the cart drawer
  - validate: 'Your Cart' header and 'Proceed to Checkout' button are visible
  - act: Tap the 'Proceed to Checkout' button
  - validate: 'Order Placed Successfully!' message is displayed
```

### Android Test (`zenitests/android/tc_android_checkout.yaml`)

```yaml
id: tc_android_checkout
title: Android E-Commerce Checkout Workflow
priority: P0
expectedResult: Item added to cart and checkout completed on Android device.

steps:
  - act: Tap the 'Add' button on the 'ZeniPods Pro Wireless' product card
  - validate: Cart badge displays 1
  - act: Tap the Cart icon to open the cart drawer
  - validate: 'Your Cart' header and 'Proceed to Checkout' button are visible
  - act: Tap the 'Proceed to Checkout' button
  - validate: 'Order Placed Successfully!' message is displayed
```

---

## 7. CLI Commands

### Authentication

Save your API key so the CLI remembers it:

```bash
zenitest auth <your_api_key>
```

Your key is saved to `~/.zenitest/config.json`. If you run any command without authenticating first, the CLI will prompt you to enter your key.

### Running Tests

```bash
# Run all tests across all platforms
zenitest run

# Run only web tests
zenitest run --platform web

# Run only iOS tests
zenitest run --platform ios

# Run only Android tests
zenitest run --platform android
```

#### Choosing the Target Environment (web tests)

By default, web tests run against the production URL set in your `config.yaml`. You can switch to your local dev server:

```bash
# Run against your local development server
zenitest run --platform web --local

# Run against production (this is the default)
zenitest run --platform web --prod

# Or use the --env flag
zenitest run --platform web --env local
```

#### Choosing a Browser (web tests)

```bash
# Default is chromium
zenitest run --platform web --browser firefox
zenitest run --platform web --browser chrome
zenitest run --platform web --browser safari
```

#### Running Mobile Tests with an App Bundle

```bash
# Android with a specific APK
zenitest run --platform android --bundle ./build/app-debug.apk

# iOS with a specific IPA or .app
zenitest run --platform ios --bundle ./build/Runner.ipa

# Specify a target device
zenitest run --platform ios --bundle ./build/Runner.ipa --device "iPhone 15 Pro"
```

#### Running a Single Test File

You can run a specific test by passing its file path or test ID:

```bash
# By file path
zenitest run zenitests/web/tc_login.yaml

# By test ID (searches all platform folders)
zenitest run tc_login

# Using the --file flag
zenitest run --file tc_login.yaml
```

#### Parallel Execution

Control how many tests run at the same time:

```bash
# Run 4 tests in parallel (default is 5)
zenitest run --parallel 4
```

#### Custom Test Directory

If your tests are in a different folder:

```bash
zenitest run --dir ./my-custom-tests
```

### Viewing Reports

After a test run, fetch the summary report using the run number:

```bash
# Formatted terminal output
zenitest report 21

# Machine-readable JSON output
zenitest report 21 --json
```

After each test run, the CLI also prints a link to the full report on the ZeniTest dashboard.

### All Flags at a Glance

| Flag | Short | What it does |
| :--- | :--- | :--- |
| `--platform` | `-t` | Filter by platform: `web`, `ios`, `android` |
| `--dir` | `-d` | Folder containing test files (default: `zenitests`) |
| `--file` | `-f` | Run a specific test file by name |
| `--parallel` | `-p` | Number of tests to run at the same time (default: 5) |
| `--local` | | Run web tests against the local URL from config |
| `--prod` | | Run web tests against the production URL from config (default) |
| `--env` | `-e` | Target environment: `local` or `prod` |
| `--browser` | | Web browser: `chromium`, `chrome`, `firefox`, `safari` |
| `--bundle` | `-b` | Path to mobile app binary (`.ipa`, `.app`, `.apk`) |
| `--device` | | Target device name or simulator (e.g. `"iPhone 15 Pro"`) |
| `--json` | | Output report in JSON format (with `report` command) |
| `--version` | `-v` | Show CLI version |
| `--help` | `-h` | Show help message |

---

## 8. Best Practices

1. **Use visible text in steps** — Refer to the exact words shown on buttons, links, and input labels (e.g. `Click the 'Checkout' button`, `Type into 'Email Address'`). This helps the AI find the right element.

2. **Keep steps atomic** — Do one thing per step. Type text on one line, click the button on the next. Don't combine multiple actions into a single step.

3. **Validate after key transitions** — Add a `validate` step after important actions like form submissions, page navigations, or checkout completions.

4. **Set both URLs in config.yaml** — Include both `localURL` and `prodURL` in your `config.yaml` so you can switch between environments using `--local` or `--prod`.

5. **Never hardcode credentials** — Always use `${secret.KEY_NAME}` for passwords, API tokens, and any sensitive data. Store them in `secrets.yaml` and add that file to `.gitignore`.

6. **Use clear test IDs** — Name test files and IDs descriptively using snake_case: `tc_login`, `tc_checkout_flow`, `tc_password_reset`. Start with `tc_` for consistency.

7. **Group tests by platform** — Keep web tests in `zenitests/web/`, iOS tests in `zenitests/ios/`, and Android tests in `zenitests/android/`. The CLI auto-detects the platform from the folder name.

8. **Use variables for repeated data** — If the same value (like a username) appears in multiple steps, define it in the `variables` section and reference it with `${variableName}`.

9. **Set defaults in config.yaml** — Put browser, device, bundle path, and parallelism settings in `config.yaml` so you don't have to type them every run.
