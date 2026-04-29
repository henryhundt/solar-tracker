import { z } from "zod";

export const alsoEnergyProviderConfigSchema = z.object({
  browserSiteKey: z.string().regex(/^S\d+$/i).optional(),
  apiSiteId: z.string().regex(/^\d+$/).optional(),
});

export type AlsoEnergyProviderConfig = z.infer<typeof alsoEnergyProviderConfigSchema>;

export function parseAlsoEnergyProviderConfig(config: unknown): AlsoEnergyProviderConfig | null {
  const result = alsoEnergyProviderConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

export function isAlsoEnergyPowerTrackKey(siteIdentifier: string | null | undefined): boolean {
  return /^S\d+$/i.test(siteIdentifier?.trim() ?? "");
}

export function normalizeAlsoEnergyBrowserSiteKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !isAlsoEnergyPowerTrackKey(trimmed)) {
    return null;
  }

  return trimmed.toUpperCase();
}

export function normalizeAlsoEnergyApiSiteId(value: string | number | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  const trimmed = value?.toString().trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function buildAlsoEnergyProviderConfig(input: {
  browserSiteKey?: string | null;
  apiSiteId?: string | number | null;
}): AlsoEnergyProviderConfig | null {
  const browserSiteKey = normalizeAlsoEnergyBrowserSiteKey(input.browserSiteKey);
  const apiSiteId = normalizeAlsoEnergyApiSiteId(input.apiSiteId);

  if (!browserSiteKey && !apiSiteId) {
    return null;
  }

  return {
    ...(browserSiteKey ? { browserSiteKey } : {}),
    ...(apiSiteId ? { apiSiteId } : {}),
  };
}

export function getAlsoEnergyBrowserSiteKey(site: {
  providerConfig?: unknown;
  siteIdentifier?: string | null;
}): string | null {
  const config = parseAlsoEnergyProviderConfig(site.providerConfig);
  return normalizeAlsoEnergyBrowserSiteKey(config?.browserSiteKey) ??
    normalizeAlsoEnergyBrowserSiteKey(site.siteIdentifier);
}

export function getAlsoEnergyApiSiteId(site: {
  providerConfig?: unknown;
  siteIdentifier?: string | null;
}): string | null {
  const config = parseAlsoEnergyProviderConfig(site.providerConfig);
  return normalizeAlsoEnergyApiSiteId(config?.apiSiteId) ??
    normalizeAlsoEnergyApiSiteId(site.siteIdentifier);
}

export function getPreferredAlsoEnergySiteIdentifier(site: {
  providerConfig?: unknown;
  siteIdentifier?: string | null;
}): string {
  return getAlsoEnergyBrowserSiteKey(site) ??
    getAlsoEnergyApiSiteId(site) ??
    site.siteIdentifier?.trim() ??
    "";
}
