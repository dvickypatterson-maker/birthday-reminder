import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// DATA_DIR permet de pointer vers le volume persistant (ex : /app/data sur Railway).
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "birthdays.db");
export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  birth_month   INTEGER NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_day     INTEGER NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  birth_year    INTEGER,
  relation      TEXT NOT NULL,
  context       TEXT DEFAULT '',
  tone          TEXT NOT NULL DEFAULT 'chaleureux',
  phone         TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  archived      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  target_date   TEXT NOT NULL,          -- date de l'anniversaire concerné (YYYY-MM-DD, dans le fuseau de la personne)
  status        TEXT NOT NULL DEFAULT 'a_venir', -- a_venir | brouillon_genere | valide | envoye | ignore
  draft_message TEXT DEFAULT '',
  final_message TEXT DEFAULT '',
  last_stage    TEXT DEFAULT '',        -- conservé pour compatibilité (ancien suivi J-14/J-1)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, target_date)
);
`);

/**
 * Migration légère : ajoute une colonne seulement si elle n'existe pas encore.
 * Les données déjà enregistrées ne sont jamais touchées.
 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Canal d'envoi propre à chaque personne
addColumnIfMissing("people", "channel", "TEXT NOT NULL DEFAULT 'whatsapp'"); // whatsapp | sms | telegram | email | messenger | autre
addColumnIfMissing("people", "contact", "TEXT DEFAULT ''"); // numéro, @pseudo ou email selon le canal
addColumnIfMissing("people", "timezone", "TEXT DEFAULT ''"); // fuseau IANA (ex : Europe/Paris), vide = fuseau par défaut
addColumnIfMissing("people", "send_hour", "INTEGER NOT NULL DEFAULT 9"); // heure locale d'envoi le jour J (0-23)
addColumnIfMissing("people", "auto_send", "INTEGER NOT NULL DEFAULT 0"); // 1 = envoi automatique (canal email uniquement)

// Suivi des étapes et de l'envoi
addColumnIfMissing("reminders", "notified_j14", "TEXT DEFAULT ''");
addColumnIfMissing("reminders", "notified_j7", "TEXT DEFAULT ''");
addColumnIfMissing("reminders", "notified_d0", "TEXT DEFAULT ''");
addColumnIfMissing("reminders", "send_status", "TEXT DEFAULT ''"); // '' | pret | envoye_auto | echec | manque
addColumnIfMissing("reminders", "send_error", "TEXT DEFAULT ''");
addColumnIfMissing("reminders", "sent_at", "TEXT DEFAULT ''");

// Reprise de l'ancien champ "phone" : il devient le contact WhatsApp s'il n'est pas déjà rempli
db.exec(`UPDATE people SET contact = phone WHERE (contact IS NULL OR contact = '') AND phone != ''`);

export type Channel = "whatsapp" | "sms" | "telegram" | "email" | "messenger" | "autre";
export const CHANNELS: Channel[] = ["whatsapp", "sms", "telegram", "email", "messenger", "autre"];

export interface Person {
  id: number;
  name: string;
  birth_month: number;
  birth_day: number;
  birth_year: number | null;
  relation: string;
  context: string;
  tone: string;
  phone: string;
  created_at: string;
  archived: number;
  channel: Channel;
  contact: string;
  timezone: string;
  send_hour: number;
  auto_send: number;
}

export interface Reminder {
  id: number;
  person_id: number;
  target_date: string;
  status: "a_venir" | "brouillon_genere" | "valide" | "envoye" | "ignore";
  draft_message: string;
  final_message: string;
  last_stage: string;
  created_at: string;
  updated_at: string;
  notified_j14: string;
  notified_j7: string;
  notified_d0: string;
  send_status: "" | "pret" | "envoye_auto" | "echec" | "manque";
  send_error: string;
  sent_at: string;
}

export type ReminderWithPerson = Reminder & {
  name: string;
  relation: string;
  context: string;
  tone: string;
  phone: string;
  channel: Channel;
  contact: string;
  timezone: string;
  send_hour: number;
  auto_send: number;
};
