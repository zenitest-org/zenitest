---
title: CI/CD Setup
description: Automatically run your tests on every push or pull request with GitHub Actions.
---

Run your ZeniTest suite automatically whenever you push code or open a pull request.

---

## GitHub Actions Workflow

Create a file named `.github/workflows/e2e.yml` in your repository:

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install ZeniTest
        run: npm install -g zenitest

      - name: Run Tests
        env:
          ZENI_API_KEY: ${{ secrets.ZENI_API_KEY }}
        run: zenitest run --platform web
```

---

## Adding your API Key to GitHub

1. Go to your GitHub repository **Settings**.
2. Click **Secrets and variables** > **Actions**.
3. Click **New repository secret**.
4. Set the name to `ZENI_API_KEY` and paste your API key in the value box.
