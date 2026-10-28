/**
 * Fuseau utilisé quand une personne n'en a pas : celui de Vicky.
 * Modifiable avec la variable d'environnement DEFAULT_TZ.
 */
export const DEFAULT_TZ = process.env.DEFAULT_TZ?.trim() || "America/Toronto";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(tz: string | null | undefined): string {
  const candidate = (tz || "").trim();
  if (candidate && isValidTimezone(candidate)) return candidate;
  return isValidTimezone(DEFAULT_TZ) ? DEFAULT_TZ : "UTC";
}

export interface LocalNow {
  date: string; // YYYY-MM-DD, date locale dans le fuseau demandé
  hour: number; // heure locale 0-23
}

/** Date et heure qu'il est dans un fuseau donné, à l'instant `base`. */
export function localNow(tz: string, base: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(base);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
  };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateFor(year: number, month: number, day: number): string {
  // Né un 29 février : on fête le 28 février les années non bissextiles.
  const safeDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return `${year}-${pad(month)}-${pad(safeDay)}`;
}

/**
 * Prochaine occurrence (YYYY-MM-DD) d'un anniversaire à partir d'une date locale.
 * Si c'est aujourd'hui, on garde aujourd'hui (jour J).
 */
export function nextOccurrence(month: number, day: number, fromDate: string): string {
  const year = Number(fromDate.slice(0, 4));
  const thisYear = dateFor(year, month, day);
  return thisYear >= fromDate ? thisYear : dateFor(year + 1, month, day);
}

/** Nombre de jours entre deux dates YYYY-MM-DD (positif si `to` est après `from`). */
export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

/** Jours restants avant `targetDate`, comptés dans le fuseau de la personne. */
export function daysUntil(targetDate: string, tz: string = DEFAULT_TZ, base: Date = new Date()): number {
  return diffDays(localNow(resolveTimezone(tz), base).date, targetDate);
}

export function formatDateFr(targetDate: string): string {
  const [y, m, d] = targetDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
}
