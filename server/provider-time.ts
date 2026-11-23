export function parseLocalTimeInTimeZone(value: string, timeZone: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcGuess = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ));

  const offsetMs = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMs);
}

export function formatLocalTimeInTimeZone(date: Date, timeZone: string): string {
  return formatDateTimeParts(getDateTimeParts(date, timeZone));
}

export function getDateTimeParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const result: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = part.value;
    }
  }

  return result;
}

export function formatDateTimeParts(
  parts: Record<string, string>,
  overrides?: Partial<Record<"hour" | "minute" | "second", string>>
): string {
  return `${parts.year}-${parts.month}-${parts.day}T${overrides?.hour ?? parts.hour}:${overrides?.minute ?? parts.minute}:${overrides?.second ?? parts.second}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  const utcEquivalent = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return utcEquivalent - date.getTime();
}
