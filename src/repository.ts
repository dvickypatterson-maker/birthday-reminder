import { db, Person, Reminder, ReminderWithPerson } from "./db";

// ---------- Personnes ----------

export function listPeople(): Person[] {
  return db
    .prepare(`SELECT * FROM people WHERE archived = 0 ORDER BY name COLLATE NOCASE`)
    .all() as Person[];
}

export function getPerson(id: number): Person | undefined {
  return db.prepare(`SELECT * FROM people WHERE id = ?`).get(id) as Person | undefined;
}

export interface NewPerson {
  name: string;
  birth_month: number;
  birth_day: number;
  birth_year?: number | null;
  relation: string;
  context?: string;
  tone?: string;
  phone?: string;
}

export function createPerson(p: NewPerson): Person {
  const stmt = db.prepare(`
    INSERT INTO people (name, birth_month, birth_day, birth_year, relation, context, tone, phone)
    VALUES (@name, @birth_month, @birth_day, @birth_year, @relation, @context, @tone, @phone)
  `);
  const info = stmt.run({
    name: p.name,
    birth_month: p.birth_month,
    birth_day: p.birth_day,
    birth_year: p.birth_year ?? null,
    relation: p.relation,
    context: p.context ?? "",
    tone: p.tone ?? "chaleureux",
    phone: p.phone ?? "",
  });
  return getPerson(Number(info.lastInsertRowid))!;
}

export function updatePerson(id: number, p: Partial<NewPerson>): Person | undefined {
  const existing = getPerson(id);
  if (!existing) return undefined;
  const merged = { ...existing, ...p };
  db.prepare(`
    UPDATE people SET
      name = @name,
      birth_month = @birth_month,
      birth_day = @birth_day,
      birth_year = @birth_year,
      relation = @relation,
      context = @context,
      tone = @tone,
      phone = @phone
    WHERE id = @id
  `).run({ ...merged, id });
  return getPerson(id);
}

export function archivePerson(id: number): void {
  db.prepare(`UPDATE people SET archived = 1 WHERE id = ?`).run(id);
}

// ---------- Reminders ----------

export function findReminder(personId: number, targetDate: string): Reminder | undefined {
  return db
    .prepare(`SELECT * FROM reminders WHERE person_id = ? AND target_date = ?`)
    .get(personId, targetDate) as Reminder | undefined;
}

export function createReminder(personId: number, targetDate: string): Reminder {
  const stmt = db.prepare(`
    INSERT INTO reminders (person_id, target_date, status)
    VALUES (?, ?, 'a_venir')
  `);
  const info = stmt.run(personId, targetDate);
  return db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(info.lastInsertRowid) as Reminder;
}

export function updateReminder(id: number, fields: Partial<Reminder>): void {
  const current = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as Reminder;
  const merged = { ...current, ...fields, updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE reminders SET
      status = @status,
      draft_message = @draft_message,
      final_message = @final_message,
      last_stage = @last_stage,
      updated_at = @updated_at
    WHERE id = @id
  `).run({ ...merged, id });
}

export function listActiveReminders(): ReminderWithPerson[] {
  return db
    .prepare(`
      SELECT r.*, p.name, p.relation, p.context, p.tone, p.phone
      FROM reminders r
      JOIN people p ON p.id = r.person_id
      WHERE r.status != 'envoye' AND r.status != 'ignore'
      ORDER BY r.target_date ASC
    `)
    .all() as ReminderWithPerson[];
}

export function listAllReminders(): ReminderWithPerson[] {
  return db
    .prepare(`
      SELECT r.*, p.name, p.relation, p.context, p.tone, p.phone
      FROM reminders r
      JOIN people p ON p.id = r.person_id
      ORDER BY r.target_date DESC
    `)
    .all() as ReminderWithPerson[];
}

export function getReminderWithPerson(id: number): ReminderWithPerson | undefined {
  return db
    .prepare(`
      SELECT r.*, p.name, p.relation, p.context, p.tone, p.phone
      FROM reminders r
      JOIN people p ON p.id = r.person_id
      WHERE r.id = ?
    `)
    .get(id) as ReminderWithPerson | undefined;
}
