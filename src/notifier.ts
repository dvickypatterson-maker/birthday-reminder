import https from "https";
import nodemailer from "nodemailer";

/**
 * Alertes envoyées à Vicky (pas aux proches) : Telegram et/ou email.
 * Tout est facultatif : sans configuration, les alertes restent visibles dans l'app.
 *
 * Variables d'environnement :
 *   NOTIFY_TELEGRAM_BOT_TOKEN + NOTIFY_TELEGRAM_CHAT_ID  -> alertes Telegram
 *   NOTIFY_EMAIL_TO + SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (+ SMTP_FROM) -> alertes email
 *   APP_URL -> lien vers l'app dans les alertes
 *   NOTIFY_DRY_RUN=1 -> n'envoie rien, garde les messages en mémoire (tests)
 */

export interface SentRecord {
  channel: "telegram" | "email" | "email-person";
  to: string;
  subject: string;
  body: string;
}

/** Journal en mémoire, utilisé seulement en mode test (NOTIFY_DRY_RUN=1). */
export const dryRunLog: SentRecord[] = [];

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function dryRun(): boolean {
  return env("NOTIFY_DRY_RUN") === "1";
}

export function telegramConfigured(): boolean {
  return !!(env("NOTIFY_TELEGRAM_BOT_TOKEN") && env("NOTIFY_TELEGRAM_CHAT_ID"));
}

export function smtpConfigured(): boolean {
  return !!(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

export function ownerEmailConfigured(): boolean {
  return smtpConfigured() && !!env("NOTIFY_EMAIL_TO");
}

export function notifyStatus(): { telegram: boolean; email: boolean } {
  return { telegram: telegramConfigured(), email: ownerEmailConfigured() };
}

export function appUrl(): string {
  return env("APP_URL").replace(/\/+$/, "");
}

function postJson(hostname: string, path: string, payload: unknown): Promise<string> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Délai dépassé")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function transporter() {
  const port = Number(env("SMTP_PORT")) || 587;
  return nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
}

function fromAddress(): string {
  return env("SMTP_FROM") || env("SMTP_USER");
}

export interface NotifyResult {
  ok: boolean; // true si au moins un canal d'alerte a réussi
  channels: string[];
  errors: string[];
}

/** Envoie une alerte à Vicky sur tous les canaux configurés. */
export async function notifyOwner(subject: string, body: string): Promise<NotifyResult> {
  const result: NotifyResult = { ok: false, channels: [], errors: [] };
  const text = `${subject}\n\n${body}`;

  if (telegramConfigured()) {
    try {
      if (dryRun()) {
        dryRunLog.push({ channel: "telegram", to: env("NOTIFY_TELEGRAM_CHAT_ID"), subject, body });
      } else {
        await postJson("api.telegram.org", `/bot${env("NOTIFY_TELEGRAM_BOT_TOKEN")}/sendMessage`, {
          chat_id: env("NOTIFY_TELEGRAM_CHAT_ID"),
          text,
          disable_web_page_preview: true,
        });
      }
      result.channels.push("telegram");
    } catch (e) {
      result.errors.push(`Telegram : ${(e as Error).message}`);
    }
  }

  if (ownerEmailConfigured()) {
    try {
      if (dryRun()) {
        dryRunLog.push({ channel: "email", to: env("NOTIFY_EMAIL_TO"), subject, body });
      } else {
        await transporter().sendMail({ from: fromAddress(), to: env("NOTIFY_EMAIL_TO"), subject, text: body });
      }
      result.channels.push("email");
    } catch (e) {
      result.errors.push(`Email : ${(e as Error).message}`);
    }
  }

  result.ok = result.channels.length > 0;
  return result;
}

/** Envoi automatique d'un message à un proche par email (seul canal automatisable en toute sécurité). */
export async function sendEmailToPerson(to: string, subject: string, body: string): Promise<void> {
  if (!smtpConfigured()) throw new Error("Email non configuré (SMTP_HOST, SMTP_USER, SMTP_PASS manquants).");
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error(`Adresse email invalide : "${to}"`);
  if (dryRun()) {
    if (env("NOTIFY_DRY_RUN_FAIL") === "1") throw new Error("Échec simulé (test)");
    dryRunLog.push({ channel: "email-person", to, subject, body });
    return;
  }
  await transporter().sendMail({ from: fromAddress(), to, subject, text: body });
}
