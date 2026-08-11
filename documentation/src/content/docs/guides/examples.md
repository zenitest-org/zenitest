---
title: Test Examples
description: Sample ZeniTest YAML test cases.
---

# Sample Test Cases

## Login Test Example

```yaml
id: tc_login
title: Login Test
localUrl: http://localhost:3000
prodURL: https://www.saucedemo.com
expectedResult: Swag Labs inventory page is displayed.

steps:
  - navigate: /
  - act: Type 'standard_user' into 'Username'
  - act: Type '${secret.SAUCE_PASSWORD}' into 'Password'
  - act: Click 'Login'
  - validate: Verify 'Products' page title is displayed
```

## E-Commerce Checkout Example

```yaml
id: tc_checkout
title: Add to Cart & Checkout
localUrl: http://localhost:3000
prodURL: https://www.saucedemo.com
expectedResult: Order confirmation message displayed.

steps:
  - navigate: /
  - act: Type 'standard_user' into 'Username'
  - act: Type '${secret.SAUCE_PASSWORD}' into 'Password'
  - act: Click 'Login'
  - act: Click 'Add to cart' on 'Sauce Labs Backpack'
  - act: Click shopping cart icon
  - act: Click 'Checkout'
  - act: Type 'Alex' into 'First Name'
  - act: Type 'Morgan' into 'Last Name'
  - act: Type '90210' into 'Zip/Postal Code'
  - act: Click 'Continue'
  - act: Click 'Finish'
  - validate: Verify 'Thank you for your order!' is displayed
```
