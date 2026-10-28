import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import path from "path";
import {
  listPeople,
  createPerson,
  updatePerson,
  archivePerson,
  getPerson,
  listActiveReminders,
  listAllReminders,
  getReminderWithPerson,
  updateReminder,
  NewPerson,
} from "./repository";
import { CHANNELS, Channel, ReminderWithPerson } from "./db";
import { runDailyCheck, sendNow } from "./checkReminders";
import { generateBirthdayDraft } from "./messageGenerator";
import { daysUntil, formatDateFr, isValidTimezone, resolveTimezone, DEFAULT_TZ } from "./dates";
import { CHANNEL_INFO, buildSendLink, channelLabel, channelPrefills } from "./channels";
import { notifyStatus, smtpConfigured, appUrl } from "./notifier";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = (process.env.APP_PASSWORD || "").trim();
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// ---------- Sécurité ----------

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function basicAuthOk(req: Request): boolean {
  if (!APP_PASSWORD) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  return safeEqual(password, APP_PASSWORD);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (basicAuthOk(req)) return next();
  res.set("WWW-Authenticate", 'Basic realm="Birthday Reminder", charset="UTF-8"');
  res.status(401).send("Mot de passe requis.");
}

// Sonde de santé publique (aucune donnée)
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// Déclencheur de la vérification : appelé par un service de planification (cron-job.org).
// Accepte la clé CRON_SECRET (en-tête x-cron-key ou ?key=) ou le mot de passe de l'app.
async function handleRunCheck(req: Request, res: Response): Promise<void> {
  const provided = String(req.get("x-cron-key") || req.query.key || "");
  const keyOk = !!CRON_SECRET && !!provided && safeEqual(provided, CRON_SECRET);
  const open = !CRON_SECRET && !APP_PASSWORD;
  if (!keyOk && !open && !(APP_PASSWORD && basicAuthOk(req))) {
    res.set("WWW-Authenticate", 'Basic realm="Birthday Reminder", charset="UTF-8"');
    res.status(401).json({ error: "Non autorisé." });
    return;
  }
  try {
    res.json(await runDailyCheck());
  } catch (err) {
    console.error("Échec de la vérification :", err);
    res.status(500).json({ error: "Échec de la vérification.", detail: (err as Error).message });
  }
}
app.get("/api/run-check", handleRunCheck);
app.post("/api/run-check", handleRunCheck);

// Tout le reste est protégé par le mot de passe (si APP_PASSWORD est défini)
app.use(requireAuth);
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- Utilitaires ----------

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // février à 29 : on accepte le 29 février

type PersonInput = Record<string, unknown>;

/** Valide et nettoie les champs d'une personne. Renvoie une erreur lisible ou les données propres. */
function parsePerson(body: PersonInput, partial: boolean): { error?: string; data?: Partial<NewPerson> } {
  const data: Partial<NewPerson> = {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (!partial || body.name !== undefined) {
    const name = str(body.name);
    if (!name) return { error: "Le nom est obligatoire." };
    data.name = name.slice(0, 120);
  }
  if (!partial || body.relation !== undefined) {
    const relation = str(body.relation);
    if (!relation) return { error: "La relation est obligatoire." };
    data.relation = relation.slice(0, 80);
  }
  if (!partial || body.birth_month !== undefined || body.birth_day !== undefined) {
    const month = Number(body.birth_month);
    const day = Number(body.birth_day);
    if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "Mois invalide." };
    if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]) return { error: "Jour invalide pour ce mois." };
    data.birth_month = month;
    data.birth_day = day;
  }
  if (body.birth_year !== undefined) {
    const y = body.birth_year === "" || body.birth_year === null ? null : Number(body.birth_year);
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > 2100)) return { error: "Année de naissance invalide." };
    data.birth_year = y;
  }
  if (body.context !== undefined) data.context = str(body.context).slice(0, 1000);
  if (body.tone !== undefined) data.tone = str(body.tone).slice(0, 60) || "chaleureux";

  if (body.channel !== undefined) {
    if (!CHANNELS.includes(body.channel as Channel)) return { error: "Canal inconnu." };
    data.channel = body.channel as Channel;
  }
  if (body.contact !== undefined) data.contact = str(body.contact).slice(0, 200);
  if (body.timezone !== undefined) {
    const tz = str(body.timezone);
    if (tz && !isValidTimezone(tz)) return { error: `Fuseau horaire inconnu : "${tz}". Exemple : Europe/Paris.` };
    data.timezone = tz;
  }
  if (body.send_hour !== undefined) {
    const h = Number(body.send_hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return { error: "Heure d'envoi invalide (0 à 23)." };
    data.send_hour = h;
  }
  if (body.auto_send !== undefined) data.auto_send = body.auto_send === true || body.auto_send === 1 || body.auto_send === "1" || body.auto_send === "on" ? 1 : 0;

  return { data };
}

/** Règles croisées (canal / contact / envoi automatique), sur la personne telle qu'elle sera enregistrée. */
function crossCheck(p: { channel: string; contact: string; auto_send: number }): string | undefined {
  if (p.channel === "email" && p.auto_send) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.contact)) return "L'envoi automatique par email demande une adresse email valide.";
    if (!smtpConfigured()) return "L'envoi automatique par email n'est pas encore configuré sur le serveur (variables SMTP_*).";
  }
  if (p.auto_send && p.channel !== "email") return "L'envoi automatique n'existe que pour le canal Email.";
  return undefined;
}

function enrich(r: ReminderWithPerson) {
  const message = r.final_message || r.draft_message || "";
  return {
    ...r,
    resolved_timezone: resolveTimezone(r.timezone),
    days_until: daysUntil(r.target_date, r.timezone),
    target_date_fr: formatDateFr(r.target_date),
    channel_label: channelLabel(r.channel),
    channel_prefills: channelPrefills(r.channel),
    send_link: buildSendLink(r.channel, r.contact, message),
  };
}

function bgCheck(label: string): Promise<unknown> {
  return runDailyCheck().catch((err) => console.error(`Vérification (${label}) échouée :`, err));
}

// ---------- API : État ----------

app.get("/api/status", (_req, res) => {
  res.json({
    protected: !!APP_PASSWORD,
    cron_protected: !!CRON_SECRET,
    notify: notifyStatus(),
    smtp: smtpConfigured(),
    default_timezone: DEFAULT_TZ,
    app_url: appUrl(),
    channels: CHANNEL_INFO,
  });
});

// ---------- API : Personnes ----------

app.get("/api/people", (_req, res) => {
  res.json(listPeople());
});

app.post("/api/people", async (req, res) => {
  const parsed = parsePerson(req.body || {}, false);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const data = parsed.data as NewPerson;
  const cross = crossCheck({ channel: data.channel ?? "whatsapp", contact: data.contact ?? "", auto_send: data.auto_send ?? 0 });
  if (cross) return res.status(400).json({ error: cross });

  const person = createPerson(data);
  await bgCheck("ajout"); // génère tout de suite le brouillon si l'anniversaire est dans moins de 14 jours
  res.status(201).json(person);
});

app.put("/api/people/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = getPerson(id);
  if (!existing) return res.status(404).json({ error: "Personne introuvable." });

  const parsed = parsePerson(req.body || {}, true);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const merged = { ...existing, ...parsed.data };
  const cross = crossCheck({ channel: merged.channel, contact: merged.contact ?? "", auto_send: merged.auto_send ? 1 : 0 });
  if (cross) return res.status(400).json({ error: cross });

  const updated = updatePerson(id, parsed.data!);
  await bgCheck("modification");
  res.json(updated);
});

app.delete("/api/people/:id", (req, res) => {
  archivePerson(Number(req.params.id));
  res.status(204).end();
});

// ---------- API : Rappels ----------

app.get("/api/reminders", (req, res) => {
  const list = req.query.all === "1" ? listAllReminders() : listActiveReminders();
  res.json(list.map(enrich));
});

app.post("/api/reminders/:id/regenerate", async (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  if (reminder.status === "envoye") return res.status(409).json({ error: "Ce message a déjà été envoyé." });

  try {
    const draft = await generateBirthdayDraft(reminder);
    // Un nouveau brouillon remplace l'ancien : le message doit être relu et revalidé.
    updateReminder(id, { draft_message: draft, final_message: "", status: "brouillon_genere", send_status: "" });
    res.json(enrich(getReminderWithPerson(id)!));
  } catch (err) {
    res.status(500).json({ error: "Échec de la génération du message.", detail: (err as Error).message });
  }
});

app.post("/api/reminders/:id/validate", async (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  if (reminder.status === "envoye") return res.status(409).json({ error: "Ce message a déjà été envoyé." });

  const finalMessage = typeof req.body?.final_message === "string" ? req.body.final_message.trim() : reminder.draft_message;
  if (!finalMessage) return res.status(400).json({ error: "Le message est vide." });
  updateReminder(id, { final_message: finalMessage, status: "valide" });
  await bgCheck("validation"); // si c'est déjà l'heure d'envoi, la suite part tout de suite
  res.json(enrich(getReminderWithPerson(id)!));
});

app.post("/api/reminders/:id/mark-sent", (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  updateReminder(id, { status: "envoye", sent_at: new Date().toISOString() });
  res.json(enrich(getReminderWithPerson(id)!));
});

app.post("/api/reminders/:id/ignore", (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  updateReminder(id, { status: "ignore" });
  res.json(enrich(getReminderWithPerson(id)!));
});

app.post("/api/reminders/:id/send-now", async (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  const outcome = await sendNow(id);
  if (!outcome.ok) return res.status(400).json({ error: outcome.error });
  res.json(enrich(getReminderWithPerson(id)!));
});

app.listen(PORT, () => {
  console.log(`Birthday Reminder lancé : http://localhost:${PORT}`);
  if (!APP_PASSWORD) console.warn("ATTENTION : APP_PASSWORD n'est pas défini, l'app est ouverte à toute personne qui a le lien.");
  if (!CRON_SECRET) console.warn("Info : CRON_SECRET n'est pas défini, le déclencheur quotidien n'est protégé que par le mot de passe de l'app.");
});
