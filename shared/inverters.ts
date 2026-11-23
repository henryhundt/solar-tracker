import { z } from "zod";

export const inverterReadingSchema = z.object({
  deviceId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(200),
  timestamp: z.string().datetime({ offset: true }),
  powerW: z.number().finite(),
});

export type InverterReading = z.infer<typeof inverterReadingSchema>;
