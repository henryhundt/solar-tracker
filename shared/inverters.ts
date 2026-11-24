import { z } from "zod";

export const inverterReadingSchema = z.object({
  deviceId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(200),
  timestamp: z.string().datetime({ offset: true }),
  powerW: z.number().finite(),
});

export type InverterReading = z.infer<typeof inverterReadingSchema>;

export const inverterFaultSchema = z.object({
  code: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  openedAt: z.string().datetime({ offset: true }).optional(),
  lastReportedAt: z.string().datetime({ offset: true }).nullable(),
});

export const inverterFaultSnapshotSchema = z.object({
  deviceId: inverterReadingSchema.shape.deviceId,
  name: inverterReadingSchema.shape.name,
  checkedAt: z.string().datetime({ offset: true }),
  complete: z.boolean(),
  faults: z.array(inverterFaultSchema).max(500),
});

export type InverterFaultSnapshot = z.infer<typeof inverterFaultSnapshotSchema>;
export type InverterOverview = Pick<InverterReading, "deviceId" | "name"> & {
  timestamp: string | null;
  powerW: number | null;
  faultCheckedAt: string | null;
  faultsComplete: boolean | null;
  faults: InverterFaultSnapshot["faults"] | null;
};
