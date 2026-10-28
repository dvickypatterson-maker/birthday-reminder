import dotenv from "dotenv";
dotenv.config();

import {
  listPeople,
  findReminder,
  createReminder,
  updateReminder,
  listPendingReminders,
  getPerson,
  getReminderWithPerson,
} from "./repository";
import { Person, Reminder } from "./db";
import { nextOccurrence, diffDays, localNow, resolveTimezone, formatDateFr } from "./dates";
import { generateBirthdayDraft } from "./messageGenerator";
import { buildSendLink, channelLabel } from "./channels";
import { notifyOwner, sendEmailToPerson, smtpConfigured, appUrl } from "./notifier";

/**
 * Cycle de vie d'un rappel (dates calculées dans le fuseau de la personne) :
 *  - J-14 : le brouillon est généré et Vicky est prévenue
 *  - J-7  : relance si le message n'est pas encore validé
 *  - Jour J, à l'heure locale choisie : envoi automatique (email) ou alerte "prêt à envoyer" avec lien
 *  - Après : échec d'envoi -> alerte ; envoi jamais confirmé -> alerte de suivi
 *
 * À appeler régulièrement (idéalement toutes les heures, pour respecter l'heure locale de chaque personne).
 */

const STAGE_DRAFT = 14;
const STAGE_REMINDER = 7;

export interface CheckOptions {
  /** Instant simulé, pour les tests. Par défaut : maintenant. */
  now?: Date;
}

export interface CheckResult {
  created: number;
  drafted: number;
  notified: number;
  autoSent: number;
  failed: number;
  missed: number;
}

let inFlight: Promise<CheckResult> | null = null;

/** Un seul passage à la fois : évite un double envoi si deux déclenchements se chevauchent. */
export function runDailyCheck(opts: CheckOptions = {}): Promise<CheckResult> {
  if (inFlight) return inFlight;
  inFlight = doCheck(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function firstName(p: Pick<Person, "name">): string {
  return p.name.split(" ")[0];
}

function appLine(): string {
  const url = appUrl();
  return url ? `\n\nOuvrir l'app : ${url}` : "";
}

function messageOf(r: Reminder): string {
  return r.final_message || r.draft_message || "";
}

async function doCheck(opts: CheckOptions): Promise<CheckResult> {
  const result: CheckResult = { created: 0, drafted: 0, notified: 0, autoSent: 0, failed: 0, missed: 0 };
  const stamp = (opts.now ?? new Date()).toISOString();

  // 1) Rappels dont la date est passée sans envoi confirmé : on le signale une seule fois, puis on les range.
  for (const r of listPendingReminders()) {
    const tz = resolveTimezone(r.timezone);
    const today = localNow(tz, opts.now).date;
    if (r.target_date >= today) continue;

    const fn = r.name.split(" ")[0];
    const wasReady = r.send_status === "pret";
    updateReminder(r.id, { status: "ignore", send_status: "manque" });
    result.missed++;
    await notifyOwner(
      wasReady ? `Envoi à confirmer : ${fn}` : `Anniversaire manqué : ${fn}`,
      wasReady
        ? `Tu n'as pas confirmé l'envoi du message à ${r.name} (anniversaire du ${formatDateFr(r.target_date)}). A-t-il bien été envoyé ? Si non, un petit mot de rattrapage fera toujours plaisir.${appLine()}`
        : `L'anniversaire de ${r.name} (${formatDateFr(r.target_date)}) est passé sans message envoyé. Pense à lui écrire un mot de rattrapage.${appLine()}`
    );
  }

  // 2) Étapes de chaque personne
  for (const person of listPeople()) {
    const tz = resolveTimezone(person.timezone);
    const now = localNow(tz, opts.now);
    const target = nextOccurrence(person.birth_month, person.birth_day, now.date);
    const days = diffDays(now.date, target);

    let reminder = findReminder(person.id, target);
    if (!reminder) {
      reminder = createReminder(person.id, target);
      result.created++;
    }
    if (reminder.status === "envoye" || reminder.status === "ignore") continue;

    // Brouillon à J-14 (ou dès l'ajout si la personne est ajoutée tard)
    if (days <= STAGE_DRAFT && reminder.status === "a_venir") {
      const draft = await generateBirthdayDraft(person);
      updateReminder(reminder.id, { status: "brouillon_genere", draft_message: draft });
      reminder = findReminder(person.id, target)!;
      result.drafted++;
    }

    // Alerte J-14 (si on est déjà passé J-7, on saute : l'alerte J-7 ou jour J prendra le relais)
    if (days <= STAGE_DRAFT && !reminder.notified_j14) {
      if (days > STAGE_REMINDER) {
        const n = await notifyOwner(
          `Anniversaire de ${firstName(person)} dans ${days} jours`,
          `${person.name} fête son anniversaire le ${formatDateFr(target)} (dans ${days} jours). Un brouillon de message est prêt : relis-le, modifie-le si besoin et valide-le.${appLine()}`
        );
        if (n.ok) {
          updateReminder(reminder.id, { notified_j14: stamp });
          result.notified++;
        }
      } else {
        updateReminder(reminder.id, { notified_j14: "ignore" });
      }
      reminder = findReminder(person.id, target)!;
    }

    // Relance J-7 si le message n'est pas validé
    if (days <= STAGE_REMINDER && !reminder.notified_j7) {
      if (days > 0 && reminder.status !== "valide") {
        const n = await notifyOwner(
          `Plus que ${days} jour${days > 1 ? "s" : ""} : ${firstName(person)}`,
          `L'anniversaire de ${person.name} est le ${formatDateFr(target)} et son message n'est pas encore validé. Relis-le et valide-le, ou demande une nouvelle version.${appLine()}`
        );
        if (n.ok) {
          updateReminder(reminder.id, { notified_j7: stamp });
          result.notified++;
        }
      } else {
        updateReminder(reminder.id, { notified_j7: "ignore" });
      }
      reminder = findReminder(person.id, target)!;
    }

    // Jour J, à partir de l'heure locale choisie
    if (days === 0 && now.hour >= person.send_hour) {
      if (reminder.status === "valide" && !reminder.send_status) {
        await handleSendMoment(person, reminder, stamp, result);
      } else if (reminder.status !== "valide" && !reminder.notified_d0) {
        const n = await notifyOwner(
          `C'est l'anniversaire de ${firstName(person)} aujourd'hui`,
          `Le message pour ${person.name} n'est pas encore validé. Ouvre l'app, valide-le et envoie-le maintenant.${appLine()}`
        );
        if (n.ok) {
          updateReminder(reminder.id, { notified_d0: stamp });
          result.notified++;
        }
      }
    }
  }

  return result;
}

/** Le moment d'envoi est arrivé pour un message validé. */
async function handleSendMoment(person: Person, reminder: Reminder, stamp: string, result: CheckResult): Promise<void> {
  const message = messageOf(reminder);
  const fn = firstName(person);
  const link = buildSendLink(person.channel, person.contact, message);

  // Envoi automatique : uniquement par email, et seulement si l'email est configuré
  if (person.channel === "email" && person.auto_send && smtpConfigured()) {
    try {
      await sendEmailToPerson(person.contact, `Joyeux anniversaire ${fn} !`, message);
      updateReminder(reminder.id, { status: "envoye", send_status: "envoye_auto", sent_at: stamp, notified_d0: stamp });
      result.autoSent++;
      await notifyOwner(`Message envoyé à ${fn}`, `Le message d'anniversaire a bien été envoyé par email à ${person.name} (${person.contact}).${appLine()}`);
    } catch (e) {
      const error = (e as Error).message;
      updateReminder(reminder.id, { send_status: "echec", send_error: error, notified_d0: stamp });
      result.failed++;
      await notifyOwner(
        `Échec de l'envoi à ${fn}`,
        `L'envoi automatique à ${person.name} a échoué : ${error}\n\nEnvoie-le toi-même${link ? ` : ${link}` : "."}\n\nMessage :\n${message}${appLine()}`
      );
    }
    return;
  }

  // Sinon : tout est prêt, Vicky n'a plus qu'à appuyer sur envoyer dans l'app du proche
  updateReminder(reminder.id, { send_status: "pret" });
  const n = await notifyOwner(
    `C'est le moment : écris à ${fn} (${channelLabel(person.channel)})`,
    `C'est l'anniversaire de ${person.name}.${link ? `\nOuvre ce lien, le message est prêt : ${link}` : ""}\n\nMessage à envoyer :\n${message}${appLine()}`
  );
  if (n.ok) {
    updateReminder(reminder.id, { notified_d0: stamp });
    result.notified++;
  }
}

/**
 * Envoi immédiat par email d'un message validé (bouton "Réessayer" de l'app).
 * Renvoie { ok, error }. Ne fait rien pour les autres canaux.
 */
export async function sendNow(reminderId: number): Promise<{ ok: boolean; error?: string }> {
  const r = getReminderWithPerson(reminderId);
  if (!r) return { ok: false, error: "Rappel introuvable." };
  const person = getPerson(r.person_id);
  if (!person) return { ok: false, error: "Personne introuvable." };
  if (person.channel !== "email") return { ok: false, error: "L'envoi automatique n'existe que pour l'email." };
  if (r.status === "envoye") return { ok: false, error: "Déjà envoyé." };
  const message = messageOf(r);
  if (!message) return { ok: false, error: "Aucun message à envoyer." };
  try {
    await sendEmailToPerson(person.contact, `Joyeux anniversaire ${firstName(person)} !`, message);
    updateReminder(reminderId, { status: "envoye", send_status: "envoye_auto", send_error: "", sent_at: new Date().toISOString() });
    return { ok: true };
  } catch (e) {
    updateReminder(reminderId, { send_status: "echec", send_error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
}

if (require.main === module) {
  runDailyCheck()
    .then((r) => {
      console.log(
        `Vérification terminée : ${r.created} nouveau(x) rappel(s), ${r.drafted} brouillon(s), ` +
          `${r.notified} alerte(s), ${r.autoSent} envoi(s) automatique(s), ${r.failed} échec(s), ${r.missed} manqué(s).`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erreur pendant la vérification des anniversaires:", err);
      process.exit(1);
    });
}
