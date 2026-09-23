/**
 * Calcule la prochaine occurrence (YYYY-MM-DD) d'un anniversaire mois/jour
 * à partir d'aujourd'hui. Si la date est déjà passée cette année, on prend
 * l'année suivante. Si c'est aujourd'hui, on la garde (jour J).
 */
export function nextOccurrence(month: number, day: number, from: Date = new Date()): string {
  const year = from.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  if (candidate < today) {
    return formatDate(new Date(year + 1, month - 1, day));
  }
  return formatDate(candidate);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysUntil(targetDate: string, from: Date = new Date()): number {
  const [y, m, d] = targetDate.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function formatDateFr(targetDate: string): string {
  const [y, m, d] = targetDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}
