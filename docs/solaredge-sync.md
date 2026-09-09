# SolarEdge browser sync

Verified against the provider dashboard on 2026-09-09 using read-only requests.

## Login readiness

The current Cognito login is a React/Remix form. Its visible fields can precede initialization. The `cognitoAsfData` hidden input is populated asynchronously by a React effect; wait for a nonempty value in the visible password field's form before entering credentials. This is a readiness signal, not a field to generate or override. Legacy monitoring forms do not use this guard.

The handler submits once. It records request starts, pending responses, response statuses, and network failures separately, without recording request bodies, credential values, or OAuth parameters. A pending request is never resubmitted. An absent request is reported explicitly. Browser fixtures reproduce delayed initialization and a request that remains pending.

The production timeout's exact cause is not proven by the old logs, which only recorded responses and failed requests. The initialization fix addresses a reproduced failure mode; production confirmation is still required.

## Dashboard API contract

The dashboard uses these query parameters:

- Energy: `chart-time-unit=days`, repeated `measurement-types=production` and `measurement-types=yield`, and `isCniViewer=true`.
- Power: `chart-time-unit=quarter-hours`, repeated `measurement-types=production` and `measurement-types=storage-charge-level`.
- Both use inclusive `start-date` and `end-date` calendar dates.

Its frontend switches energy resolution to months when the date span exceeds 31 days. A 120-day daily request reproduced HTTP 400 with `BAD_ARGUMENTS: DAYS`; corrected 31-day and one-day requests returned HTTP 200 with 31 and one daily measurements respectively. Use at most 31 inclusive days per daily chunk.

Energy values are Wh; quarter-hour power values are W. Keep the provider's offset-bearing timestamps. A quarter-hour interval contributes W / 4 Wh without integer rounding. A daily energy total has no measured instantaneous power (`powerW` is null). Null production is missing data, while numeric zero is a valid reading. Reject malformed measurement schemas and fail if the requested window has no production measurements.

Do not scrape arbitrary numbers from dashboard text. Such numbers may be lifetime totals, capacity, or unrelated metrics; they cannot be assigned a daily timestamp.

After all API pages succeed, replace readings in the refreshed window atomically using the existing range replacement transaction. This avoids retaining old fallback totals or overlapping daily/quarter-hour representations in that window. If fetching or validation fails, leave existing readings unchanged. This does not repair data outside the refreshed window or windows for which the provider returns no measurements.
