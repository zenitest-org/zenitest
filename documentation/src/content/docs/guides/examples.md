---
title: Test Examples
description: Ready-to-use sample test cases for Web and Mobile.
---

Here are sample test cases you can copy and adapt for your own apps.

---

## 1. Web Login Test (`zenitests/web/tc_login.yaml`)

```yaml
id: tc_login
title: Standard User Login
expectedResult: User is logged in and the product inventory page is displayed.

steps:
  - navigate: /
  - act: Type 'standard_user' into 'Username'
  - act: Type '${secret.SAUCE_PASSWORD}' into 'Password'
  - act: Click 'Login'
  - validate: Verify the 'Products' heading is displayed
```

---

## 2. Web E-Commerce Checkout (`zenitests/web/tc_checkout.yaml`)

```yaml
id: tc_checkout
title: Add to Cart & Checkout Workflow
expectedResult: Order confirmation message is displayed after checkout.

steps:
  - navigate: /
  - act: Type 'standard_user' into 'Username'
  - act: Type '${secret.SAUCE_PASSWORD}' into 'Password'
  - act: Click 'Login'
  - act: Click 'Add to cart' on 'Sauce Labs Backpack'
  - act: Click the shopping cart icon
  - act: Click 'Checkout'
  - act: Type 'Alex' into 'First Name'
  - act: Type 'Morgan' into 'Last Name'
  - act: Type '90210' into 'Zip/Postal Code'
  - act: Click 'Continue'
  - act: Click 'Finish'
  - validate: Verify 'Thank you for your order!' is displayed
```

---

## 3. Mobile iOS Checkout (`zenitests/ios/tc_ios_checkout.yaml`)

```yaml
id: tc_ios_checkout
title: iOS E-Commerce Order Flow
expectedResult: Order confirmation message is displayed on iOS.

steps:
  - act: Tap the 'Add' button on the 'ZeniPods Pro' product card
  - validate: Cart badge shows '1'
  - act: Tap the Cart icon
  - validate: 'Your Cart' title and 'Proceed to Checkout' button are visible
  - act: Tap 'Proceed to Checkout'
  - validate: 'Order Placed Successfully!' is displayed
```

---

## 4. Mobile Android Checkout (`zenitests/android/tc_android_checkout.yaml`)

```yaml
id: tc_android_checkout
title: Android E-Commerce Order Flow
expectedResult: Order confirmation message is displayed on Android.

steps:
  - act: Tap the 'Add' button on the 'ZeniPods Pro' product card
  - validate: Cart badge shows '1'
  - act: Tap the Cart icon
  - validate: 'Your Cart' title and 'Proceed to Checkout' button are visible
  - act: Tap 'Proceed to Checkout'
  - validate: 'Order Placed Successfully!' is displayed
```
