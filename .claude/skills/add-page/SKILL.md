---
name: add-page
description: Add a new routed page to the runman React frontend, with a nav link and loading/error/empty states. Use when asked to create a new screen, view, or page.
---

# Add a frontend page

Reference implementation: `frontend/src/pages/DashboardPage.tsx`.

## Steps

1. Create `frontend/src/pages/<Name>Page.tsx` exporting `function <Name>Page()`.
   - Wrap content in `<div className="page">` with an `<h1>` title.
   - Group sections in `<Card title="...">`; use `<Button>` for actions.
   - To load data, use `useAsync(api.someCall)` and render loading, error, and empty states.

2. Register the route in `frontend/src/router.tsx` **above** the `*` catch-all:
   `{ path: '/<slug>', element: <<Name>Page /> }`.
   For URL params use `/<slug>/:id` and `useParams()` from `react-router`.

3. If the page belongs in the header, add `{ to: '/<slug>', label: '<Label>' }` to
   `NAV_LINKS` in `frontend/src/components/Layout.tsx`.

4. Styles: reuse classes from `frontend/src/styles/global.css`. If you need new ones, add them
   there using the existing CSS variables, so dark mode keeps working.

5. Verify: `npm run typecheck` from the repo root, then `npm run dev` and open
   `http://localhost:5173/<slug>`. Check it at phone width too.
