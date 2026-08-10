---
title: CI/CD Setup
description: Run ZeniTest in GitHub Actions.
---

# CI/CD Setup

Automate your tests on every push or pull request.

## GitHub Actions Example

Add `.github/workflows/e2e.yml`:

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Create Secrets File
        run: |
          cat <<EOF > secrets.yaml
          secrets:
            SAUCE_PASSWORD: "${{ secrets.SAUCE_PASSWORD }}"
          EOF

      - name: Run ZeniTest
        env:
          ZENI_API_KEY: ${{ secrets.ZENI_API_KEY }}
        run: |
          bunx zenitest run --dir zenitests
```
