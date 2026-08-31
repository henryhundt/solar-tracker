import test from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../shared/schema";

test("direct credentials are encrypted with authenticated random nonces", async () => {
  process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
  process.env.NODE_ENV = "development";
  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  const { decryptSiteCredentials, encryptSiteCredentials } = await import("../server/credentials");
  const first = encryptSiteCredentials({ username: "operator", password: "secret", apiKey: "api-key" });
  const second = encryptSiteCredentials({ username: "operator", password: "secret", apiKey: "api-key" });

  assert.match(first.password ?? "", /^enc:v1:/);
  assert.notEqual(first.password, second.password);

  const encryptedSite: Site = {
    id: 1,
    name: "Test",
    url: "https://example.com",
    timezone: "America/Chicago",
    acCapacityKw: null,
    dcCapacityKw: null,
    notes: null,
    username: first.username ?? null,
    password: first.password ?? null,
    apiKey: first.apiKey ?? null,
    credentialKey: null,
    siteIdentifier: null,
    providerConfig: null,
    scraperType: "egauge",
    lastSyncedAt: null,
    syncStartedAt: null,
    status: "idle",
    lastError: null,
    archivedAt: null,
  };
  const decrypted = decryptSiteCredentials(encryptedSite);

  assert.equal(decrypted.username, "operator");
  assert.equal(decrypted.password, "secret");
  assert.equal(decrypted.apiKey, "api-key");

  process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  assert.throws(
    () => decryptSiteCredentials(encryptedSite),
    /could not be decrypted/,
  );
});
