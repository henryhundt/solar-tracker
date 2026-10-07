# SMA Sunny Portal browser monitoring

Start login at https://ennexos.sunnyportal.com/ so the portal creates a fresh
OAuth/PKCE flow. Do not save a login URL containing state, nonce, or code challenge.

## Configuration

Select **SMA Sunny Portal (Browser)**, enter the numeric system ID from
`https://ennexos.sunnyportal.com/<system ID>/dashboard`, and supply SMA ID
username/password through direct encrypted credentials or the existing stored
credential-key mechanism. Set the site timezone to match the SMA system.
No API key is used. Apply `0002_sma_browser.sql` before saving SMA sites.

This version uses the English portal interface. MFA, CAPTCHA, or account-action
prompts are reported as login failures. The interactive Codex browser session
is not saved or transferred to the server.

## Data contract

Observed in the signed-in portal on 2026-09-10:

- System production is at `/<system ID>/monitoring/view-energy-and-power`.
- Day details show five-minute **Power [kW]**.
- Month details show **Total yield [kWh]**, with MM/DD/YYYY dates and comma
  thousands separators. A Download control is also available.
- Month/year selectors are disabled when only one choice exists. The inspected
  account offered only its commissioning month. Older history needs live
  confirmation on an account with more available months.
- Chart changes leave the previous table visible while loading. A changed
  selector alone is not evidence that new measurements are ready.

Sync enumerates offered years/months in the existing retention window and waits
for an energy header and matching row dates. It rejects malformed, duplicate,
missing, and stale values. Zero remains a valid measurement. Dates become
midnight in the configured site timezone, and kWh become Wh. Daily totals have
`powerW: null`. The whole first calendar day of a refresh is included so overlap
windows refresh its daily total. All requested available tables must parse
before the existing upsert path saves anything.

This implementation supplies daily production history. Five-minute power,
inverter faults, and account discovery/bulk add are not included. Unattended
login and scheduled sync need validation with SMA credentials configured in
the app; live exploration used a user login.
