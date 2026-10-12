# GrocIQ

The root `index.html` is the public, single-page waitlist. It uses plain HTML, CSS and JavaScript. The form sends submissions to the existing Supabase waitlist table using a browser-safe key and insert-only row policy.

## Public site

The GitHub repository is connected to Vercel. Vercel serves `index.html` without a build step. Do not replace the root page with the pilot or point the waitlist at a household database.

## Private couples pilot (in development)

The separate `/pilot/` page is for a two-person US household. It points only to the isolated GrocIQ Couples Pilot Test project in North Virginia, never to the public waitlist database. Its SQL migrations live in `supabase/migrations/` and have been applied to that test project. The first household can be created only by the approved pilot email; a second verified email joins through a private, expiring invitation.

The pilot code now includes a shared grocery list, reviewed manual purchases, a monthly USD budget and an optional pre-order check. It uses confirmed purchases for spending, keeps unknown fees unknown, and does not place grocery orders. A receipt/OCR flow and a real two-person browser journey are still pending. **Do not enter real household or receipt data yet.**

Six-digit email sign-in is intentionally disabled in the test-page configuration until custom SMTP and an email template are tested. Supabase requires custom SMTP to customize a new free project's template for codes. The exact Vercel test-branch alias is connected to the isolated test project, but email sign-in remains disabled. Configure and test a sending domain and provider, then switch `emailCodesReady` in `pilot/js/config.js` and verify two separate accounts. Do not enable sign-in just by changing that flag before the provider test passes.

Unknown Vercel hostnames fail closed. The pilot is not wired to a production Supabase project or approved for a real-couple launch. GitHub-to-Vercel deployment serves static files only; database migrations and service configuration must be applied separately under the release approval gates.

No Node.js installation is needed to view or deploy the static pages through GitHub and Vercel. Developer-only checks run in GitHub Actions and do not change the waitlist database.
