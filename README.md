# GrocIQ

The root `index.html` is the public, single-page waitlist. It uses plain HTML, CSS and JavaScript. The form sends submissions to the existing Supabase waitlist table using a browser-safe key and insert-only row policy.

## Public site

The GitHub repository is connected to Vercel. Vercel serves `index.html` without a build step. Do not replace the root page with the pilot or point the waitlist at a household database.

## Private couples pilot (in development)

The separate `/pilot/` page is an early shell for the US couples pilot. It does not use the public waitlist database, and it deliberately shows an unavailable state until a dedicated pilot Supabase project and approved hostnames are configured in `pilot/js/config.js`. Do not enter real household or receipt data yet. The current pilot page does not sign in users or save purchases.

No Node.js installation is needed to view or deploy the static pages through GitHub and Vercel. Developer-only checks run in GitHub Actions and do not change the waitlist database.
