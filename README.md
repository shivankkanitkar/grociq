# GrocIQ

GrocIQ is a grocery-management website for busy US households. The public landing page and waitlist live at `/`; the signed-in grocery workspace lives at `/app/`. Both are static HTML, CSS, and vanilla JavaScript, deployed by connecting this GitHub repository to Vercel. Visitors need no local Node.js installation.

## What the app does

One person can start a grocery space and optionally invite one partner. Household members can track grocery availability and quantities, record and correct purchases, review spending against a monthly budget, and run a pre-order check for relevant refills. Purchases are entered manually or drafted from a receipt photo and reviewed before saving. Receipt text extraction runs in the browser; the image is not uploaded or stored. The app does not place orders or connect to grocery stores.

The `/app/` workspace uses Supabase Auth and a separate Supabase database from the public waitlist. The browser contains only a Supabase publishable key; household data is protected by row-level security and member-scoped database functions. SQL changes are in `supabase/migrations/` and must be applied to the app database separately from Vercel deployment.

## Deploy

1. Upload or push this repository to GitHub.
2. Import it into Vercel as a static site. No build command, package install, or environment variables are needed for the website.
3. Configure the app's Supabase Auth provider and allowed redirect URLs before enabling sign-in in `pilot/js/config.js`. Add the exact deployed hostname to its allowlist. Do not use a service-role key in browser code.
4. Open `/app/` on the deployment and complete a real sign-in, grocery update, purchase, budget, and sign-out test before sharing it as a working app.

The root landing-page waitlist remains separate. `npm test` and `npm run test:e2e` are developer checks; GitHub Actions runs them without requiring users to install Node.js.
