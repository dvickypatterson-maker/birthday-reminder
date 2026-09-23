import { listPeople, findReminder, createReminder, updateReminder } from "./repository";
import { nextOccurrence, daysUntil } from "./dates";
import { generateBirthdayDraft } from "./messageGenerator";

const STAGE_J14 = 14;
const STAGE_J1 = 1;

/**
 * À exécuter une fois par jour (cron / tâche planifiée).
 * Pour chaque personne :
 *  - calcule la prochaine occurrence de son anniversaire
 *  - crée un reminder s'il n'existe pas encore pour cette date
 *  - à J-14 : génère un brouillon si pas encore fait (statut -> brouillon_genere)
 *  - à J-1  : si toujours pas validé, relance (le statut reste, mais last_stage est mis à jour
 *             pour que l'UI puisse afficher une relance visible)
 */
export async function runDailyCheck(): Promise<{ created: number; drafted: number; reminded: number }> {
  const people = listPeople();
  let created = 0;
  let drafted = 0;
  let reminded = 0;

  for (const person of people) {
    const targetDate = nextOccurrence(person.birth_month, person.birth_day);
    let reminder = findReminder(person.id, targetDate);

    if (!reminder) {
      reminder = createReminder(person.id, targetDate);
      created++;
    }

    if (reminder.status === "envoye" || reminder.status === "ignore") {
      continue;
    }

    const remaining = daysUntil(targetDate);

    // Palier J-14 : générer le brouillon
    if (remaining <= STAGE_J14 && reminder.status === "a_venir") {
      const draft = await generateBirthdayDraft(person);
      updateReminder(reminder.id, {
        status: "brouillon_genere",
        draft_message: draft,
        last_stage: "j14",
      });
      drafted++;
      continue;
    }

    // Palier J-1 : relance si toujours pas validé
    if (remaining <= STAGE_J1 && reminder.status === "brouillon_genere" && reminder.last_stage !== "j1") {
      updateReminder(reminder.id, {
        last_stage: "j1",
      });
      reminded++;
    }
  }

  return { created, drafted, reminded };
}

if (require.main === module) {
  runDailyCheck()
    .then((result) => {
      console.log(
        `Vérification terminée — ${result.created} nouveau(x) rappel(s), ` +
          `${result.drafted} brouillon(s) généré(s), ${result.reminded} relance(s) à J-1.`
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erreur pendant la vérification des anniversaires:", err);
      process.exit(1);
    });
}
