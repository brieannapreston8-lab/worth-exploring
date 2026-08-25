# Worth Exploring Analytics

Worth Exploring uses a deliberately small PostHog Product Analytics implementation for early product validation.

## Architecture

Browser lifecycle events are defined in `analytics.js` and sent only to the first-party `/api/analytics` endpoint.

`api/analytics.js` passes events through the whitelist and sanitizer in `api/_analytics.js` before forwarding them to PostHog's event ingestion API.

There is no PostHog browser SDK in Worth Exploring. This intentionally avoids autocapture, automatic page tracking, session replay, heatmaps, DOM/form inspection, and other unnecessary browser analytics features.

Analytics failures are ignored and must never interrupt the questionnaire or report generation.

## Production gating

Events are forwarded to PostHog only when both conditions are true:

1. `VERCEL_ENV === 'production'`
2. `POSTHOG_PROJECT_TOKEN` is configured

Preview and local deployments therefore do not write events to the production PostHog project.

## Environment variables

- `POSTHOG_PROJECT_TOKEN` — PostHog project token. Required to enable production analytics.
- `POSTHOG_HOST` — optional ingestion host. Defaults to `https://us.i.posthog.com`. Use the matching PostHog Cloud host for the selected project region.

Do not add a PostHog personal API key to the browser or repository.

## Anonymous identifiers

The browser creates:

- a random anonymous visitor ID stored in localStorage for up to 90 days;
- a random anonymous session ID stored in sessionStorage.

No account identity, name, email, questionnaire answer, report text, or career recommendation is attached to these identifiers.

If the browser's Do Not Track signal is enabled, Worth Exploring does not send analytics events.

## Events

- `landing_viewed` — the Worth Exploring page loaded.
- `questionnaire_started` — the user successfully passed the age confirmation and entered the questionnaire.
- `questionnaire_progress` — the required flow crossed 25%, 50%, 75%, or 100%.
- `questionnaire_completed` — the user submitted the final optional context step and began report generation.
- `report_generation_started` — one report-generation attempt began.
- `report_generation_succeeded` — `/api/generate` returned a successful, structurally usable report.
- `report_generation_failed` — report generation failed, recorded only with a sanitized category.
- `report_viewed` — the generated report was actually rendered and visible.
- `feedback_started` — the user clicked the external Google Forms feedback link.

`feedback_completed` is not currently tracked because completion happens on an external Google Form and Worth Exploring cannot reliably observe it.

## Progress milestones

The experience has 15 required questionnaire screens plus one optional context screen.

Progress events represent completion of the required flow:

- 25%: after required screen 4
- 50%: after required screen 8
- 75%: after required screen 12
- 100%: after required screen 15, when the user reaches the optional context screen

## Safe properties

The server accepts only explicitly whitelisted properties. Unrecognized properties are discarded.

Common behavioural/acquisition properties:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `referrer_category`
- `device_category`

Timing/progress properties include milestone, elapsed/completion time, generation duration, generation attempt number, safe HTTP status, and sanitized error category.

Every event is automatically tagged server-side with:

- `questionnaire_version`
- `prompt_version`
- `report_methodology_version`
- `app_version` (Vercel Git commit SHA)
- `environment`

Generation events also receive the model provider and model name.

## Data that is never intentionally sent to PostHog

- questionnaire answers or selections
- free-text responses
- optional context text
- prompt text or system prompt contents
- generated report contents
- patterns, tensions, hypotheses, occupations, or experiments
- names or email addresses
- health information
- full referrer URLs
- precise user location
- raw provider error payloads

Because browser events are proxied through Vercel, the PostHog ingestion request is made by the server rather than directly from the user's browser. Worth Exploring does not forward the user's IP address.

## Error categories

Generation errors are reduced to one of these categories before analytics capture:

- `application_rate_limit`
- `provider_rate_limit`
- `provider_unavailable`
- `provider_timeout`
- `invalid_structured_output`
- `empty_provider_response`
- `configuration_error`
- `invalid_request`
- `network_error`
- `server_error`
- `unknown_generation_error`

Raw error messages are never sent to PostHog.

## Versioning

Current baseline identifiers live in `api/_analytics.js`:

- `questionnaire_v1`
- `prompt_v1`
- `methodology_v1`

Increment only the relevant identifier when that layer materially changes. The application version is automatic through the Vercel Git commit SHA.

## Later, not now

Potential later additions include reliable feedback-completion tracking and dedicated AI cost/token observability. They are intentionally excluded from the first analytics implementation.
