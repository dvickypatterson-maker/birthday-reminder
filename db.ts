import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(__dirname, "..", "data");
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
  target_date   TEXT NOT NULL,          -- date de l'anniversaire concerné (YYYY-MM-DD)
  status        TEXT NOT NULL DEFAULT 'a_venir', -- a_venir | brouillon_genere | valide | envoye | ignore
  draft_message TEXT DEFAULT '',
  final_message TEXT DEFAULT '',
  last_stage    TEXT DEFAULT '',        -- j14 | j1 (dernier palier ayant déclenché une génération/relance)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, target_date)
);
`);

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
}

export type ReminderWithPerson = Reminder & {
  name: string;
  relation: string;
  context: string;
  tone: string;
  phone: string;
};
