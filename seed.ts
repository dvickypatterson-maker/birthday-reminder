import { createPerson, listPeople } from "./repository";

/**
 * Seed optionnel : ajoute un exemple si la base est vide, pour que l'UI
 * ne soit pas vide au premier lancement. N'écrase jamais de données existantes.
 */
function seed() {
  const existing = listPeople();
  if (existing.length > 0) {
    console.log(`Déjà ${existing.length} personne(s) en base, rien à faire.`);
    return;
  }

  createPerson({
    name: "Exemple — à modifier ou supprimer",
    birth_month: 1,
    birth_day: 1,
    relation: "ami(e)",
    context: "Remplace-moi par une vraie personne depuis l'interface.",
    tone: "chaleureux",
  });

  console.log("Personne d'exemple créée. Ajoute tes vrais proches depuis l'interface web.");
}

seed();
