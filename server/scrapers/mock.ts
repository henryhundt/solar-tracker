import type { Site } from "@shared/schema";
import type { HistoryWindow } from "../history";

interface MockReading {
  siteId: number;
  timestamp: Date;
  energyWh: number;
  powerW: number;
}

export async function scrapeMock(
  site: Site,
  historyWindow?: HistoryWindow
): Promise<MockReading[]> {
  console.log(`[Mock] Generating simulated data for ${site.name}`);
  
  await new Promise(resolve => setTimeout(resolve, 500));

  const defaultEnd = new Date();
  defaultEnd.setMinutes(0, 0, 0);
  const defaultStart = new Date(defaultEnd);
  defaultStart.setDate(defaultStart.getDate() - 1);
  defaultStart.setMinutes(0, 0, 0);
  
  const readings: MockReading[] = [];
  const start = historyWindow?.start ?? defaultStart;
  const end = historyWindow?.end ?? defaultEnd;
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0);

  while (cursor <= end) {
    const timestamp = new Date(cursor);
    const hour = timestamp.getHours();
    
    let energyWh = 0;
    let powerW = 0;
    
    if (hour >= 6 && hour <= 20) {
      const hourFromPeak = Math.abs(hour - 13);
      const productionFactor = Math.max(0, 1 - (hourFromPeak / 7));
      
      powerW = productionFactor * 5000 * (0.7 + Math.random() * 0.3);
      energyWh = powerW;
    }
    
    readings.push({
      siteId: site.id,
      timestamp,
      powerW: Math.round(powerW),
      energyWh: Math.round(energyWh)
    });

    cursor.setHours(cursor.getHours() + 1);
  }

  console.log(`[Mock] Generated ${readings.length} readings for ${site.name}`);
  return readings;
}
