import test from "node:test";
import assert from "node:assert/strict";
import { insertSiteSchema } from "../shared/schema";

test("site input accepts a supported scraper and IANA timezone", () => {
  const result = insertSiteSchema.safeParse({
    name: "Main Array",
    url: "https://example.com",
    scraperType: "egauge",
    timezone: "America/Chicago",
  });

  assert.equal(result.success, true);
});

test("site input rejects unsupported scrapers instead of falling back to mock", () => {
  const result = insertSiteSchema.safeParse({
    name: "Main Array",
    url: "https://example.com",
    scraperType: "typo-provider",
  });

  assert.equal(result.success, false);
});

test("site input rejects invalid timezone and secret-key names", () => {
  const result = insertSiteSchema.safeParse({
    name: "Main Array",
    url: "https://example.com",
    scraperType: "egauge",
    timezone: "Central-ish",
    credentialKey: "lowercase key",
  });

  assert.equal(result.success, false);
});
