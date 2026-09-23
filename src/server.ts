import dotenv from "dotenv";
dotenv.config();

import express from "express";
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
} from "./repository";
import { runDailyCheck } from "./checkReminders";
import { generateBirthdayDraft } from "./messageGenerator";
import { daysUntil, formatDateFr } from "./dates";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- API : Personnes ----------

app.get("/api/people", (_req, res) => {
  res.json(listPeople());
});

app.post("/api/people", (req, res) => {
  const { name, birth_month, birth_day, birth_year, relation, context, tone, phone } = req.body;
  if (!name || !birth_month || !birth_day || !relation) {
    return res.status(400).json({ error: "Champs requis manquants (name, birth_month, birth_day, relation)." });
  }
  const person = createPerson({
    name,
    birth_month: Number(birth_month),
    birth_day: Number(birth_day),
    birth_year: birth_year ? Number(birth_year) : null,
    relation,
    context: context || "",
    tone: tone || "chaleureux",
    phone: phone || "",
  });
  res.status(201).json(person);
});

app.put("/api/people/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = getPerson(id);
  if (!existing) return res.status(404).json({ error: "Personne introuvable." });

  const { name, birth_month, birth_day, birth_year, relation, context, tone, phone } = req.body;
  const updated = updatePerson(id, {
    name,
    birth_month: birth_month ? Number(birth_month) : undefined,
    birth_day: birth_day ? Number(birth_day) : undefined,
    birth_year: birth_year !== undefined ? (birth_year ? Number(birth_year) : null) : undefined,
    relation,
    context,
    tone,
    phone,
  });
  res.json(updated);
});

app.delete("/api/people/:id", (req, res) => {
  const id = Number(req.params.id);
  archivePerson(id);
  res.status(204).end();
});

// ---------- API : Reminders ----------

app.get("/api/reminders", (req, res) => {
  const all = req.query.all === "1" ? listAllReminders() : listActiveReminders();
  const enriched = all.map((r) => ({
    ...r,
    days_until: daysUntil(r.target_date),
    target_date_fr: formatDateFr(r.target_date),
  }));
  res.json(enriched);
});

app.post("/api/reminders/:id/regenerate", async (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });

  try {
    const draft = await generateBirthdayDraft(reminder);
    updateReminder(id, { draft_message: draft, status: "brouillon_genere" });
    res.json(getReminderWithPerson(id));
  } catch (err) {
    res.status(500).json({ error: "Échec de la génération du message.", detail: (err as Error).message });
  }
});

app.put("/api/reminders/:id", (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });

  const { final_message, status } = req.body;
  updateReminder(id, {
    final_message: final_message !== undefined ? final_message : reminder.final_message,
    status: status || reminder.status,
  });
  res.json(getReminderWithPerson(id));
});

app.post("/api/reminders/:id/validate", (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });

  const finalMessage = req.body.final_message ?? reminder.draft_message;
  updateReminder(id, { final_message: finalMessage, status: "valide" });
  res.json(getReminderWithPerson(id));
});

app.post("/api/reminders/:id/mark-sent", (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  updateReminder(id, { status: "envoye" });
  res.json(getReminderWithPerson(id));
});

app.post("/api/reminders/:id/ignore", (req, res) => {
  const id = Number(req.params.id);
  const reminder = getReminderWithPerson(id);
  if (!reminder) return res.status(404).json({ error: "Rappel introuvable." });
  updateReminder(id, { status: "ignore" });
  res.json(getReminderWithPerson(id));
});

// ---------- API : déclenchement manuel de la vérification quotidienne ----------

app.post("/api/run-check", async (_req, res) => {
  try {
    const result = await runDailyCheck();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Échec de la vérification.", detail: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Birthday Reminder lancé : http://localhost:${PORT}`);
});
