# Fullstack Refactoring Scenarios

This document outlines complex, cross-cutting codemod scenarios involving both the frontend and backend workspaces.

## Scenario 1: Frontend Logger Swap
**Objective:** Migrate away from `fictional-logger` to `realistic-logger` across the React frontend.
- **Action:** Replace all usage of `fictional-logger` in the `frontend` workspace with the newly created `realistic-logger`.
- **Imports:** Update `import ... from 'fictional-logger'` to resolve to `realistic-logger` instead, keeping aliases functionally intact.
- **Constraint:** Usage and imports of the `loglevel` package must be strictly preserved and remain completely untouched during this migration.

## Scenario 2: Backend Middleware Pipeline Overhaul
**Objective:** Maintain and evolve the Koa backend's middleware stack.
- **Add:** Implement a brand new middleware function (e.g., an `execution-time` logger or similar) and register it in `app.ts`.
- **Modify:** Adjust the business logic of an existing middleware (e.g., modifying headers in `security-headers.ts` or changing how `error-handler.ts` parses errors).
- **Remove:** Delete an existing middleware file entirely (e.g., `request-id.ts` or `rate-limit.ts`) and strip its corresponding `app.use(...)` injection from the main application flow.

## Scenario 3: Monorepo-Wide Function Maintenance
**Objective:** Execute standardized utility maintenance across both the `frontend` and `backend` workspaces targeting the newly isolated `src/utils/formatters.ts` files, ensuring no interference with logging.
- **Modify Existing Function:** Update `capitalizeFirstLetter(text: string): string` to not only capitalize the first letter, but also explicitly lowercase the rest of the string (e.g. `text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()`).
- **Add New Function:** Introduce a new exported function `truncateText(text: string, maxLength: number): string`. It should return a string that slices the input to `maxLength` and appends `...` if the original text exceeded that length.
- **Delete Existing Function:** Locate the function `obsoleteReverseString(text: string): string`, completely remove its implementation from `src/utils/formatters.ts` in both workspaces, and prune any potential import references.