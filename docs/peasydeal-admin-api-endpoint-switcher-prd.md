# PeasyDeal Admin Console — Runtime API Endpoint Switcher PRD

> Scope note: for product draft multi-target publish behavior, do not treat this document as the frontend source of truth for draft publish state. Product drafts are stored as a single shared draft record, and `staging` / `production` are publish targets on that same draft. For frontend draft integration rules, use [`docs/product-draft-frontend-integration-guide.md`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/docs/product-draft-frontend-integration-guide.md).

## 1) Summary
Add a runtime environment switcher to the admin console so operators can switch API traffic between:

- `Production` → `https://api.peasydeal.com`
- `Staging` → `https://staging-api.peasydeal.com`

In local development, keep support for:

- `Local` → `http://localhost:3010`

The admin console should no longer depend only on build-time `VITE_API_BASE_URL` for API routing. Instead, operators should be able to switch the active target inside the UI, with the current environment clearly visible at all times.

This phase should support:

1. viewing and editing drafts against staging
2. publishing to staging for validation
3. switching to production and publishing there separately

This phase does **not** attempt to copy or promote a reviewed draft from staging into production automatically.

## 2) Problem
Today the admin console effectively uses a single API base URL chosen at build time through `VITE_API_BASE_URL`.

This creates two operational problems:

1. the team must maintain a separate staging admin console deployment if they want to test against staging safely
2. operators cannot easily verify staging behavior and then switch back to production within the same app session

This is unnecessary overhead for an internal tool.

## 3) Goals
Allow operators to:

1. switch the active backend environment from within the admin console UI
2. always know whether they are operating on staging or production
3. review and publish drafts against staging without needing a separate staging admin console
4. switch back to production without redeploying the frontend

## 4) Non-goals
This phase does not include:

1. automatic promotion of a staged draft into production
2. cross-environment draft syncing
3. arbitrary custom endpoint input by operators
4. mixing staging data and production data in one screen
5. per-page environment overrides

## 5) Product Principles

### 5.1 Safety over flexibility
Operators should choose from a fixed list of allowed environments. They should not type arbitrary URLs.

### 5.2 The current environment must be obvious
Production actions are high risk. The UI must make the active environment highly visible.

### 5.3 Switching environments should reset stale app state
When the target environment changes, the app should clear cached API state and avoid leaving the operator on a detail page that may not exist in the new environment.

## 6) User Stories
1. As an operator, I can switch the admin console to staging and create or review drafts there.
2. As an operator, I can see a strong visual indicator when I am using production.
3. As an operator, I can publish a draft to staging to inspect backend behavior there.
4. As an operator, I can switch back to production and continue normal operation without opening another admin console deployment.
5. As an operator, I understand that staging publish and production publish are separate actions against separate backends.

## 7) Current Codebase Constraints

### 7.1 Base URL is build-time today
Current API URL resolution is implemented in:

- [`src/lib/api-base-url.ts`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/lib/api-base-url.ts)

At the moment:

- `API_BASE_URL` is computed once from `import.meta.env.VITE_API_BASE_URL`
- `withApiBaseUrl()` uses that module-level constant

This means runtime switching is not possible as-is.

### 7.2 Some endpoints are precomputed too early
Current auth code computes:

- [`src/auth-provider.ts`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/auth-provider.ts)

It defines `ME_ENDPOINT` at module scope. That endpoint will not follow a runtime environment change unless the implementation is refactored.

### 7.3 Product draft APIs already flow through a shared URL helper
Most draft-related requests already call:

- [`src/lib/admin-ai-product-drafts.ts`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/lib/admin-ai-product-drafts.ts)

This is good. It means most environment switching logic can be centralized instead of patched page by page.

## 8) Proposed Solution

### 8.1 Introduce a runtime API target model
Define a frontend-only target enum:

```ts
type ApiTarget = "prod" | "staging" | "local";
```

Behavior:

- production build should expose `prod` and `staging`
- local development may additionally expose `local`
- the current target is stored in `localStorage`
- initial target comes from a default env setting

### 8.2 Use fixed env-configured URLs, not free-form URLs
Add env vars such as:

```bash
VITE_API_BASE_URL_PROD=https://api.peasydeal.com
VITE_API_BASE_URL_STAGING=https://staging-api.peasydeal.com
VITE_API_BASE_URL_LOCAL=http://localhost:3010
VITE_DEFAULT_API_TARGET=prod
```

The UI should only switch among configured targets.

### 8.3 Resolve API base URL at request time
Refactor the API URL layer so requests resolve the active base URL dynamically.

Recommended direction:

```ts
function getApiTarget(): ApiTarget
function setApiTarget(target: ApiTarget): void
function getApiBaseUrl(): string
function withApiBaseUrl(pathOrUrl: string): string
```

Important rule:

- `withApiBaseUrl()` must call `getApiBaseUrl()` every time
- it must no longer depend on a module-level `API_BASE_URL` constant

### 8.4 Centralize URL application in api client
Recommended follow-up:

- allow `apiFetch("/v1/admin/...")`
- let [`src/lib/api-client.ts`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/lib/api-client.ts) apply the active base URL automatically for relative paths

This reduces the risk of future callers forgetting to honor the runtime environment.

### 8.5 Add a global environment switcher in the layout header
Add a small but obvious switcher in the top-level app layout, likely near the user controls or top navigation.

Suggested UI:

- a labeled select or segmented control
- badge showing `Production` or `Staging`
- stronger destructive color treatment for `Production`

Suggested copy:

- `Environment`
- `Production`
- `Staging`

Optional dev-only:

- `Local`

### 8.6 Force safe reset behavior after switching
When environment changes:

1. persist the new target to `localStorage`
2. clear app-level cached API results
3. remount providers that hold endpoint-specific state if necessary
4. redirect to a safe list page such as `/products/drafts`
5. show a toast confirming the new target

This avoids stale detail pages and mixed-environment UI state.

## 9) Publish Flow Design

### 9.1 Phase 1 behavior
In phase 1, publish always targets the currently selected environment.

Examples:

- if current target is `staging`, publish goes to `https://staging-api.peasydeal.com`
- if current target is `prod`, publish goes to `https://api.peasydeal.com`

Recommended UX:

- button label or helper text should reflect the current target
- for example: `Publish to Staging` and `Publish to Production`

### 9.2 Important limitation
This does **not** mean one reviewed staging draft can automatically become a production draft.

If staging and production are separate backends, then:

- draft IDs may not match
- published product IDs will not match
- one environment cannot assume objects exist in the other

Therefore, phase 1 should be positioned as:

- "publish to the currently selected environment"

not:

- "promote this staging draft into production"

## 10) Phase 2 Option: Promote to Production
If the team later wants a true staging-to-production handoff, backend support will be required.

Examples of acceptable backend designs:

1. `POST /v1/admin/product-drafts/:id/promote-to-production`
2. `POST /v1/admin/product-drafts/promote` with a full reviewed payload
3. a backend copy/import endpoint that recreates the reviewed draft in production

This PRD does not require that backend work, but it should keep the phase 2 direction explicit so operators do not assume phase 1 already does it.

## 11) Technical Design

### 11.1 New frontend config module
Add a small config module, for example:

- `src/lib/api-target-config.ts`

Responsibilities:

1. map target keys to env-configured URLs
2. expose allowed targets
3. hide `local` outside dev if desired
4. validate that required env vars exist

### 11.2 Runtime target store
Add a lightweight store, for example:

- `src/lib/api-target-store.ts`

Responsibilities:

1. read current target from `localStorage`
2. write updated target to `localStorage`
3. notify subscribers on change

This can be implemented with:

- React context + state
- or `useSyncExternalStore`
- or a very small custom event-based store

Recommended preference: a small dedicated store plus a React provider.

### 11.3 Refactor URL helpers
Update:

- [`src/lib/api-base-url.ts`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/lib/api-base-url.ts)

Changes:

1. remove module-scope fixed base URL behavior
2. compute base URL from current runtime target
3. keep support for absolute URLs unchanged

### 11.4 Refactor auth endpoint resolution
Update:

- [`src/auth-provider.ts`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/auth-provider.ts)

Changes:

1. remove module-scope `ME_ENDPOINT`
2. compute `/api/me` at request time
3. ensure auth checks follow the active environment after a switch

### 11.5 Handle Refine provider state
Update:

- [`src/App.tsx`](/Users/huangchihan/develop/bbj/peasydeal/peasydeal-admin-console/src/App.tsx)

Needs analysis during implementation:

1. if `Refine` data providers are unused for current product flows, keep scope limited
2. if any active pages depend on `dataProvider`, it must also follow the runtime target
3. if provider internals cache endpoint-specific state, use a `key={apiTarget}` remount strategy

### 11.6 Operator-facing environment banner
The top-level layout should render a persistent visual indicator such as:

- `Connected to Production`
- `Connected to Staging`

Production styling should be stronger than staging styling.

## 12) UX Requirements

### FR-1: Fixed target selection
Operator can switch only between configured targets.

### FR-2: Persistent selection
The chosen target persists across reloads in the same browser.

### FR-3: Obvious active environment
The active target is visible globally, not only inside a settings screen.

### FR-4: Publish respects active target
Draft publish calls go to the active target's backend.

### FR-5: Safe switch behavior
Switching target clears stale state and returns the operator to a safe route.

### FR-6: No silent target changes
Whenever the environment changes, the UI should confirm it explicitly.

## 13) Risks

### 13.1 Auth compatibility
Clerk tokens or backend auth expectations must work against both staging and production APIs.

### 13.2 CORS
Both staging and production APIs must allow the admin console origin.

### 13.3 Data confusion
An operator may assume a staging draft and production draft are the same object. The UI copy must avoid this misunderstanding.

### 13.4 Cache leakage
If query caches are not cleared on switch, the app may display data from the wrong environment.

### 13.5 High-risk prod operations
If the environment marker is too subtle, operators may modify production unintentionally.

## 14) Recommended UX Copy

### Environment selector label
- `Environment`

### Options
- `Production`
- `Staging`
- `Local` (dev only)

### Status banner examples
- `Connected to Production API`
- `Connected to Staging API`

### Publish button examples
- `Publish to Production`
- `Publish to Staging`

### Switch toast example
- `Environment switched to Staging`

## 15) Acceptance Criteria
1. An operator can switch between production and staging without redeploying the frontend.
2. After switching, subsequent draft API requests go to the selected backend.
3. The current environment is clearly visible in the app shell.
4. Publish actions target the selected backend.
5. Switching environment clears stale state and avoids mixed-environment UI.
6. The app does not rely on free-form operator-entered URLs.

## 16) Implementation Plan

### Phase 1: Runtime switching foundation
1. Add runtime target config and storage modules
2. Refactor `api-base-url.ts` to compute base URL dynamically
3. Refactor `auth-provider.ts` to compute `/api/me` dynamically
4. Ensure product draft API helpers follow the runtime target

### Phase 2: Global UI
1. Add environment switcher to app layout
2. Add persistent environment badge/banner
3. Add switch confirmation toast
4. Redirect to a safe route after target change

### Phase 3: Publish UX alignment
1. Update publish copy to reflect the active target
2. Review staging vs production behavior across draft list, draft detail, and publish flow
3. Confirm no ambiguous copy implies cross-environment promotion

### Phase 4: Hardening
1. Verify auth on both environments
2. Verify CORS on both environments
3. Verify cache reset and route reset behavior
4. Verify local dev still works with `http://localhost:3010`

## 17) Verification Checklist
- [ ] Switching from production to staging changes subsequent draft list requests to staging
- [ ] Switching from staging to production changes subsequent draft detail requests to production
- [ ] `/api/me` follows the new target after switching
- [ ] Publish button text reflects the active target
- [ ] Publish on staging creates results only in staging
- [ ] Publish on production creates results only in production
- [ ] Switching target while viewing a detail page resets safely to a list route
- [ ] Local development still works with `VITE_API_BASE_URL_LOCAL=http://localhost:3010`

## 18) Open Questions
1. Should `Local` be visible only in development builds, or also available in non-production internal builds?
2. Should switching to `Production` require an extra confirmation click?
3. Do staging and production both accept the same Clerk-issued tokens today?
4. Are there any active pages besides product drafts that must also switch backend targets immediately?
5. In phase 2, does the business want true cross-environment promotion, or is "publish separately in each environment" sufficient?
