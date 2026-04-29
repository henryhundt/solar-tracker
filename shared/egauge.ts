import { z } from "zod";

export const eGaugeSelectionModeSchema = z.enum(["auto", "manual"]);

export const eGaugeRegisterSelectionSchema = z.object({
  idx: z.number().int().nonnegative(),
  name: z.string().min(1),
  type: z.string().min(1),
  did: z.number().int().nonnegative().optional(),
});

export const eGaugeRegisterInspectionSchema = eGaugeRegisterSelectionSchema.extend({
  rate: z.number().optional(),
  isRecommendedSolar: z.boolean().default(false),
});

export const eGaugeProviderConfigSchema = z.object({
  selectionMode: eGaugeSelectionModeSchema.default("manual"),
  selectedRegisters: z.array(eGaugeRegisterSelectionSchema).default([]),
  legacyRegisterName: z.string().min(1).optional(),
});

export type EGaugeSelectionMode = z.infer<typeof eGaugeSelectionModeSchema>;
export type EGaugeRegisterSelection = z.infer<typeof eGaugeRegisterSelectionSchema>;
export type EGaugeRegisterInspection = z.infer<typeof eGaugeRegisterInspectionSchema>;
export type EGaugeProviderConfig = z.infer<typeof eGaugeProviderConfigSchema>;

export function parseEGaugeProviderConfig(config: unknown): EGaugeProviderConfig | null {
  const result = eGaugeProviderConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

export function getLegacyEGaugeRegisterName(site: {
  providerConfig?: unknown;
  siteIdentifier?: string | null;
}): string | null {
  const config = parseEGaugeProviderConfig(site.providerConfig);
  const fromConfig = config?.legacyRegisterName?.trim();
  if (fromConfig) {
    return fromConfig;
  }

  const fromSiteIdentifier = site.siteIdentifier?.trim();
  return fromSiteIdentifier ? fromSiteIdentifier : null;
}

export function getSelectedEGaugeRegisters(site: {
  providerConfig?: unknown;
}): EGaugeRegisterSelection[] {
  return parseEGaugeProviderConfig(site.providerConfig)?.selectedRegisters ?? [];
}

export function getEGaugeSelectionMode(site: {
  providerConfig?: unknown;
}): EGaugeSelectionMode {
  return parseEGaugeProviderConfig(site.providerConfig)?.selectionMode ?? "manual";
}

export function getRecommendedEGaugeRegisterIds(registers: EGaugeRegisterInspection[]): number[] {
  return registers.filter((register) => register.isRecommendedSolar).map((register) => register.idx);
}

export function toEGaugeSelectedRegisters(
  registers: EGaugeRegisterInspection[],
  selectedRegisterIds: Iterable<number>
): EGaugeRegisterSelection[] {
  const selectedIds = new Set(selectedRegisterIds);
  return registers
    .filter((register) => selectedIds.has(register.idx))
    .map(({ idx, name, type, did }) => ({ idx, name, type, did }));
}
