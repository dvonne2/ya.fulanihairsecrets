# Meta Pixel + CAPI Hardening Test Plan

## Objective
Verify that Event Match Quality (EMQ) has improved from 5.4-5.7/10 to 8.0+/10 after implementing the hardening changes.

## Pre-Test Checklist
- [ ] All code changes deployed to production
- [ ] Google Apps Script updated with new version
- [ ] Test event code obtained from Meta Events Manager → Test Events tab
- [ ] Meta Pixel Helper extension installed in browser
- [ ] Browser DevTools Network tab ready for inspection

## Test Scenarios

### Test 1: Test Order Isolation (Priority 1)
**Purpose:** Verify test orders cannot reach production Events Manager

**Steps:**
1. Open site with URL: `https://fulanihairsecrets.com/?test=1`
2. Complete a test order (₦32,750 - SELF LOVE PLUS)
3. Check browser console for: `[META] Test order detected, skipping all Pixel/CAPI events`
4. Check Meta Events Manager → Test Events tab
   - Should see events with test_event_code
   - Should NOT see events in production dashboard

**Expected Result:**
- Console shows test order skipped
- Test events appear in Test Events tab only
- Production Events Manager shows 0 new events

---

### Test 2: fbc/fbp Cookie Capture (Priority 7)
**Purpose:** Verify click ID capture for iOS attribution

**Steps:**
1. Clear all cookies and localStorage
2. Click a Meta ad with fbclid parameter (simulated: `?fbclid=test123`)
3. Open browser DevTools → Application → Cookies
4. Check for `_fbc` cookie with format: `fb.1.{timestamp}.{fbclid}`
5. Check localStorage for `meta_fbc_data` and `meta_fbp_persist`
6. Complete an order
7. Check CAPI payload in Network tab for `fbc` and `fbp` fields

**Expected Result:**
- `_fbc` cookie set correctly
- localStorage contains persisted fbc/fbp data
- CAPI payload includes fbc and fbp values
- 90-day expiration on fbp persistence

---

### Test 3: Purchase Payload Enhancement (Priority 4)
**Purpose:** Verify rich Purchase payload with content_ids, contents, num_items

**Steps:**
1. Open site and complete an order (₦32,750 - SELF LOVE PLUS)
2. Open DevTools → Network tab
3. Filter for `facebook.com` requests
4. Click the Purchase event request
5. Check payload → custom_data section

**Expected Result:**
```json
{
  "value": 32750,
  "currency": "NGN",
  "content_ids": ["SELF_LOVE_PLUS"],
  "content_name": "SELF LOVE PLUS",
  "content_type": "product",
  "contents": [{
    "id": "SELF_LOVE_PLUS",
    "quantity": 1,
    "item_price": 32750
  }],
  "num_items": 1,
  "order_id": "<ORDER_ID>",
  "media_buyer": "<VALUE>",
  "source": "<VALUE>"
}
```

---

### Test 4: Value Standardization (Priority 5)
**Purpose:** Verify value field is product price ONLY (no delivery fee)

**Steps:**
1. Select a package (₦32,750)
2. Select a state with delivery fee (₦3,000)
3. Complete the order
4. Check Purchase event payload → custom_data → value

**Expected Result:**
- value = 32750 (product price only)
- NOT 35750 (product + delivery)
- Consistent across all events (Purchase, InitiateCheckout, AddToCart)

---

### Test 5: Pixel↔CAPI Deduplication (Priority 3)
**Purpose:** Verify shared event_id between browser and CAPI

**Steps:**
1. Complete an order
2. Open DevTools → Network tab
3. Find the browser Pixel Purchase event (fbq call)
4. Find the CAPI Purchase event (POST to graph.facebook.com)
5. Compare event_id values

**Expected Result:**
- Both events have identical event_id
- Same event_name: "Purchase"
- Events fire within 1 second of each other
- Test Events tab shows ONE event with both "Browser" and "CAPI" sources

---

### Test 6: CAPI User Data Enhancement (Priority 2)
**Purpose:** Verify full identifier set in CAPI user_data

**Steps:**
1. Complete an order with full user data
2. Check CAPI payload → user_data section

**Expected Result:**
```json
{
  "em": ["<SHA256_EMAIL>"],
  "ph": ["<SHA256_PHONE>"],
  "fn": ["<SHA256_FIRSTNAME>"],
  "ln": ["<SHA256_LASTNAME>"],
  "ct": ["<SHA256_CITY>"],
  "st": ["<SHA256_STATE>"],
  "country": ["<SHA256_NG>"],
  "external_id": ["<SHA256_ORDER_ID>"],
  "fbp": "<FBP_COOKIE_VALUE>",
  "fbc": "<FBC_COOKIE_VALUE>",
  "fbclid": "<FBCLID_VALUE>",
  "client_ip_address": "<IP>",
  "client_user_agent": "<UA_STRING>"
}
```

---

### Test 7: No Double-Firing Purchase (Priority 8)
**Purpose:** Verify Purchase fires only once per order

**Steps:**
1. Complete an order
2. Refresh the thank-you page multiple times
3. Check console for: `[Meta] Events already fired, skipping`
4. Check Meta Events Manager → Purchase event count

**Expected Result:**
- Console shows "Events already fired, skipping" on refresh
- Purchase count = 1 (not 2, 3, or 8)
- Ref guard prevents re-firing

---

### Test 8: Full End-to-End Order Trace
**Purpose:** Verify complete event sequence with test_event_code

**Steps:**
1. Open site with `?test=1&mb=test_buyer&src=test_source`
2. Fill form (email, phone, name, state, city)
3. Select package
4. Complete order
5. Check console logs for all events in sequence:
   - PageView
   - FormStart
   - AddToCart
   - InitiateCheckout
   - LeadSync
   - Purchase
6. Check Test Events tab for all events with test_event_code
7. Verify each event has full user_data

**Expected Result:**
- All events fire in correct order
- Each event has test_event_code
- All events appear in Test Events tab
- Production Events Manager shows 0 new events

---

## Post-Test Verification (24 hours after deployment)

### Check Event Match Quality Scores
1. Go to Meta Events Manager
2. For each event (Purchase, InitiateCheckout, LeadSync, FormStart, AddToCart):
   - Click event name
   - Check "Event Match Quality" score
3. Expected: 7.5-10/10 on all events

### Check Diagnostics Tab
1. Go to Meta Events Manager → Diagnostics
2. Check for issues
3. Expected: 0 issues (currently 2)

### Compare Against Ground Truth
1. Check Google Sheets for orders on test date
2. Compare with Meta Events Manager counts
3. Expected: Meta counts within ±5% of Google Sheets

### Verify Deduplication
1. In Test Events tab, check Purchase event
2. Expected: ONE event showing both "Browser" and "CAPI" as sources
3. NOT two separate events

## Manual Configuration Steps (Not in Code)

### Aggregated Event Measurement (AEM) Priorities
1. Go to Events Manager → Aggregated Event Measurement
2. Set priorities for your domain in this order:
   1. Purchase
   2. HighValuePurchase
   3. pod66750
   4. pod32750
   5. InitiateCheckout
   6. AddToCart
   7. LeadSync
   8. FormStart

### Domain Verification
1. Go to Business Settings → Brand Safety → Domains
2. Verify fulanihairsecrets.com is verified
3. If not, add and verify via DNS or HTML file upload

### Test Event Code
1. Go to Events Manager → Test Events
2. Get your test_event_code (e.g., TEST12345)
3. Update code with your actual test_event_code if different

## Success Criteria

- ✅ Test orders isolated in Test Events tab (0 production leakage)
- ✅ EMQ scores 7.5-10/10 on all events
- ✅ 0 issues in Diagnostics tab
- ✅ Purchase fires exactly once per order
- ✅ Pixel↔CAPI deduplication working (single event with both sources)
- ✅ Meta counts within ±5% of Google Sheets ground truth
- ✅ Full user_data payload on all CAPI events
- ✅ fbc/fbp captured and persisted correctly

## Rollback Plan

If issues occur:
1. Revert metaTracking.ts to previous version
2. Revert Code_v16.1_FULL.gs to previous version
3. Revert ThankYou.tsx to previous version
4. Clear localStorage and cookies
5. Monitor Events Manager for 1 hour

## Notes

- CSS inline style lint warnings in ThankYou.tsx are unrelated to tracking and can be addressed separately
- Advanced Matching in index.html is skipped since we don't have user data on initial load
- Pixel re-init with user data should be called from OrderFormEmbed.tsx after email/phone capture (implementation optional)
