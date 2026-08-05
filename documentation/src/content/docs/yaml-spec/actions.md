---
title: Step Actions
description: Learn how to use navigate, act, and validate actions.
---

# Test Step Actions

Every step in your test uses one of three simple actions:

## 1. `navigate`
Opens a relative path or full URL.

```yaml
- navigate: /
- navigate: /settings
- navigate: https://example.com/checkout
```

## 2. `act`
Performs an action using natural language.

### Typing Text
```yaml
- act: Type 'John' into the 'First Name' input field
- act: Type '${secret.MY_PASSWORD}' into 'Password'
```

### Clicking Elements
```yaml
- act: Click on the 'Login' button
- act: Click 'Submit'
```

### Selecting & Checking
```yaml
- act: Select 'Price: Low to High' from dropdown
- act: Check 'Remember me' checkbox
```

## 3. `validate`
Verifies page state visually or by text content.

```yaml
- validate: Verify 'Welcome back' message appears
- validate: Verify shopping cart shows 2 items
```
