/**
 * Time-zone-aware meeting slot finder. Pure — unit tested. Works on absolute instants (Date) and uses the
 * IANA time zone only to decide what "9:00 on a weekday" means for the business.
 */
export type Interval = { start: Date; end: Date };

/** Offset (minutes) of `timeZone` at instant `at`. */
function offsetMinutes(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant at which the wall clock in `timeZone` shows y-m-d h:mm (handles DST by re-checking the offset). */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let at = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60_000);
  at = new Date(guess - offsetMinutes(at, timeZone) * 60_000);
  return at;
}

/** Local calendar date (y, m, d, weekday 0=Sun) of an instant in `timeZone`. */
export function localDate(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v("weekday"));
  return { y: Number(v("year")), m: Number(v("month")), d: Number(v("day")), weekday: wd };
}

export type SlotOptions = {
  from: Date;
  days: number;
  timeZone: string;
  durationMin: number;
  count: number;
  startHour?: number;
  endHour?: number;
  /** Days of week that are working days (0=Sun … 6=Sat). Default Mon–Fri; set e.g. [0,1,2,3,4] for Sun–Thu. */
  workDays?: number[];
  /** Minimum notice before the first slot. */
  minNoticeMin?: number;
};

/**
 * Up to `count` free slots in working hours, spread over different days first (more choice for the customer),
 * never overlapping a busy interval.
 */
export function findSlots(busy: Interval[], o: SlotOptions): Interval[] {
  const startHour = o.startHour ?? 9;
  const endHour = o.endHour ?? 17;
  const workDays = o.workDays ?? [1, 2, 3, 4, 5];
  const earliest = new Date(o.from.getTime() + (o.minNoticeMin ?? 120) * 60_000);
  const step = 30;
  const perDay: Interval[][] = [];
  for (let i = 0; i < o.days; i++) {
    const day = localDate(new Date(o.from.getTime() + i * 86_400_000), o.timeZone);
    if (!workDays.includes(day.weekday)) continue;
    const slots: Interval[] = [];
    for (let min = startHour * 60; min + o.durationMin <= endHour * 60; min += step) {
      const start = zonedTime(day.y, day.m, day.d, Math.floor(min / 60), min % 60, o.timeZone);
      const end = new Date(start.getTime() + o.durationMin * 60_000);
      if (start < earliest) continue;
      if (busy.some((b) => start < b.end && end > b.start)) continue;
      slots.push({ start, end });
    }
    if (slots.length) perDay.push(slots);
  }
  // Round-robin across days: first a morning option on each day, then later ones.
  const out: Interval[] = [];
  for (let round = 0; out.length < o.count && perDay.some((d) => d.length > round); round++) {
    for (const d of perDay) {
      const pick = d[Math.min(d.length - 1, round * Math.max(1, Math.floor(d.length / 3)))];
      if (pick && !out.some((x) => x.start.getTime() === pick.start.getTime())) out.push(pick);
      if (out.length === o.count) break;
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
