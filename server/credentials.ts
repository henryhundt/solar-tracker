import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "./db";
import { sites, type Site } from "@shared/schema";
import { eq } from "drizzle-orm";

const ENCRYPTED_PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const AAD = Buffer.from("solar-tracker:credential:v1", "utf8");

type CredentialFields = Pick<Site, "username" | "password" | "apiKey">;

export async function initializeCredentialEncryption(): Promise<void> {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY must be set to a 32-byte base64 or 64-character hex key in production.");
    }
    return;
  }

  const storedSites = await db.select({
    id: sites.id,
    username: sites.username,
    password: sites.password,
    apiKey: sites.apiKey,
  }).from(sites);
  let migrated = 0;

  await db.transaction(async (tx) => {
    for (const site of storedSites) {
      const encrypted = encryptCredentialFields(site, key);
      if (
        encrypted.username === site.username &&
        encrypted.password === site.password &&
        encrypted.apiKey === site.apiKey
      ) {
        continue;
      }

      await tx.update(sites)
        .set(encrypted)
        .where(eq(sites.id, site.id));
      migrated += 1;
    }
  });

  if (migrated > 0) {
    console.log(`Encrypted direct credentials for ${migrated} site(s).`);
  }
}

export function encryptSiteCredentials<T extends Partial<CredentialFields>>(value: T): T {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production" && hasCredentialValue(value)) {
      throw new Error("Cannot store direct credentials without CREDENTIAL_ENCRYPTION_KEY.");
    }
    return value;
  }

  return encryptCredentialFields(value, key);
}

export function decryptSiteCredentials(site: Site): Site {
  const key = getEncryptionKey();
  return {
    ...site,
    username: decryptCredentialValue(site.username, key) ?? null,
    password: decryptCredentialValue(site.password, key) ?? null,
    apiKey: decryptCredentialValue(site.apiKey, key) ?? null,
  };
}

function encryptCredentialFields<T extends Partial<CredentialFields>>(value: T, key: Buffer): T {
  return {
    ...value,
    ...(Object.prototype.hasOwnProperty.call(value, "username")
      ? { username: encryptCredentialValue(value.username, key) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "password")
      ? { password: encryptCredentialValue(value.password, key) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "apiKey")
      ? { apiKey: encryptCredentialValue(value.apiKey, key) }
      : {}),
  };
}

function encryptCredentialValue(value: string | null | undefined, key: Buffer): string | null | undefined {
  if (!value) {
    return value;
  }

  if (value.startsWith(ENCRYPTED_PREFIX)) {
    decryptCredentialValue(value, key);
    return value;
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_PREFIX.slice(0, -1),
    nonce.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decryptCredentialValue(value: string | null | undefined, key: Buffer | null): string | null | undefined {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) {
    return value;
  }

  if (!key) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required to decrypt stored credentials.");
  }

  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Stored credential has an invalid encrypted format.");
  }

  try {
    const nonce = Buffer.from(parts[2], "base64");
    const authTag = Buffer.from(parts[3], "base64");
    const ciphertext = Buffer.from(parts[4], "base64");
    if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error("invalid encrypted credential metadata");
    }

    const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new Error("Stored credential could not be decrypted. Verify CREDENTIAL_ENCRYPTION_KEY.", { cause: error });
  }
}

function getEncryptionKey(): Buffer | null {
  const configured = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!configured) {
    return null;
  }

  const key = /^[a-fA-F0-9]{64}$/.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  return key;
}

function hasCredentialValue(value: Partial<CredentialFields>): boolean {
  return Boolean(value.username || value.password || value.apiKey);
}
