---
name: regenerate-fixtures
description: Refresh recorded API fixtures from the live Azure Retail Prices API. Destructive — overwrites existing fixture data.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Refresh Recorded API Fixtures

Re-records the live Azure pricing responses that the parser tests run against.

**Invocation:** `/regenerate-fixtures` — never auto-triggers.

## What changed and why

This skill previously described generating JSON files of pre-computed expected costs (`payg-fixtures.json`, `tier-fixtures.json`, and so on) into `src/__fixtures__/`. That directory was never created and the skill referenced `src/data/logSources.ts` and `src/data/defenderMapping.ts`, neither of which exists — log sources live in `LOG_SOURCES` inside `src/data/pricing.ts`.

The approach was also the wrong shape. Pre-computing expected values into a file means every rate change silently invalidates the whole set, and a stale oracle reports failures against correct code. The suite now derives expectations from the constants at runtime instead, so re-pricing needs no fixture regeneration at all.

What genuinely benefits from being recorded is the **shape and spelling of the live API response** — because that is where a real bug hid for the life of the project. A filter searched for `Data Lake` while the API spells it `Data lake`, matching nothing in every region. Hand-written mocks would have used whatever spelling the parser expected and hidden it.

## Current fixtures

| File | Purpose |
|---|---|
| `src/services/__tests__/sentinel-uksouth.fixture.json` | Recorded Sentinel consumption meters for UK South, used by the parser tests |

## Steps

### 1. Re-record the API response

```bash
curl -s "https://prices.azure.com/api/retail/prices?\$filter=serviceName%20eq%20%27Sentinel%27%20and%20armRegionName%20eq%20%27uksouth%27" -o /tmp/sentinel.json
```

Keep only `type === 'Consumption'` items, and only the fields the parser reads: `meterName`, `retailPrice`, `unitOfMeasure`, `armRegionName`, `skuName`, `productName`. Write the result as `{ "Items": [...] }` to the fixture path above. Keeping the fixture minimal makes its intent legible in diffs.

### 2. Run the parser tests

```bash
npm run test:run
```

`src/services/__tests__/azurePricing.test.ts` asserts that the parsers agree with the static constants in `src/data/pricing.ts`. **A failure here is meaningful**, not noise — it means Microsoft's published rates have moved away from the values in the repo, or a meter has been renamed.

### 3. If the tests now fail, reconcile rather than paper over

Compare the recorded meters against `src/data/pricing.ts` and update the constants to match the API. Do not adjust the tests to accommodate stale constants — the API is the authority.

Watch for the two traps that have caused real bugs:

- **`contains()` is case-sensitive.** Meters are `Data lake ingestion`, `Data lake query`, `Data lake storage`.
- **Lake ingestion is two meters**: `Data lake ingestion Data Processed` plus `Data processing Data Processed`. The second does not contain "Data lake", so no lake-named filter returns it.

Also check for meters the parser does not model. Compare the recorded meter names against the meter map in `src/services/azurePricing.ts` — that map, not this file, is the authority on what is currently modelled (Basic Logs, Auxiliary Logs, Graph and Advanced Data Insights are all in it today). If a meter appears that the map does not cover and it materially affects a customer's bill, raise it rather than silently ignoring it.

### 4. Update dependent constants

If rates changed, remember that `src/data/logTiers.ts` imports from `pricing.ts` and needs no edit, but the commitment tier table's *daily costs* are the authoritative input — effective rates and savings derive from them automatically.

## Output

Report:
- Which meters changed, with old and new values
- Whether the static constants needed updating
- Any new meters that appeared, and whether they are modelled
- Test results after the refresh
