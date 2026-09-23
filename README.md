# Birthday Reminder

Petite app qui garde en mémoire les anniversaires de tes proches, génère un
brouillon de message personnalisé à l'avance, et te laisse le valider avant
de l'envoyer sur WhatsApp. Rien ne part automatiquement sans ta validation.

## Comment ça marche

1. Tu ajoutes un proche : nom, date de naissance, relation, un peu de
   contexte (ex : "petite sœur, j'ai donné son prénom à ma fille") et le ton
   souhaité.
2. Chaque jour, l'app vérifie les anniversaires à venir :
   - **À J-14** : elle génère un brouillon de message et te le montre dans
     l'onglet "À valider".
   - **À J-1** : si tu n'as toujours pas validé, le rappel remonte (via
     `last_stage`), pour que tu ne le rates pas.
3. Tu relis, tu modifies si besoin, tu cliques **Valider**, puis
   **Envoyer sur WhatsApp** — ça ouvre WhatsApp avec le message déjà rempli,
   c'est toi qui appuies sur envoyer.

Rien n'est envoyé sans que tu cliques toi-même sur "Envoyer" dans WhatsApp.

## Installation

Prérequis : Node.js 18+ installé sur ta machine.

```bash
cd birthday-reminder
npm install
cp .env.example .env
```

Ouvre `.env` et, si tu veux des messages générés par Claude plutôt que le
template local :

```
ANTHROPIC_API_KEY=ta_cle_api_ici
MY_NAME=Vicky
```

Sans clé API, l'app fonctionne quand même — elle utilise un template de
message local (moins personnalisé, mais fiable et gratuit).

## Lancer l'app

```bash
npm run build
npm start
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

En développement (rechargement automatique) :
```bash
npm run dev
```

## Automatiser la vérification quotidienne

L'app ne se met à jour toute seule que si quelque chose déclenche la
vérification. Deux options :

**Option simple** : clique sur "Vérifier maintenant" dans l'app à chaque
fois que tu l'ouvres. Suffisant si tu ouvres l'app tous les jours ou presque.

**Option automatique (recommandée)** : programme une tâche qui appelle la
vérification chaque jour, même app fermée. Sur Mac/Linux, avec `cron` :

```bash
# Édite le crontab :
crontab -e

# Ajoute cette ligne (vérifie chaque jour à 8h) :
0 8 * * * cd /chemin/vers/birthday-reminder && npm run check
```

Sur Windows, utilise le Planificateur de tâches pour lancer
`node dist/checkReminders.js` chaque jour.

Si l'app tourne déjà comme serveur, tu peux aussi simplement faire un appel
HTTP quotidien à `POST /api/run-check` (via cron + curl, par exemple) plutôt
que d'exécuter le script directement :

```bash
0 8 * * * curl -s -X POST http://localhost:3000/api/run-check
```

## Structure du projet

```
src/
  db.ts               → schéma SQLite (people, reminders)
  repository.ts        → accès aux données (CRUD)
  dates.ts              → calcul des prochaines occurrences d'anniversaire
  messageGenerator.ts   → génération de message (Claude API ou template local)
  checkReminders.ts     → logique J-14 / J-1, exécutable en script ou via l'API
  server.ts              → serveur Express (API + sert l'interface web)
public/
  index.html / app.js   → interface de validation (aucun framework)
data/
  birthdays.db            → base SQLite locale (créée automatiquement)
```

## Statuts d'un rappel

`a_venir` → `brouillon_genere` → `valide` → `envoye`
(ou `ignore` si tu choisis de sauter cette année pour cette personne)

## Prochaines évolutions possibles

- Rappels à plusieurs paliers configurables (pas juste J-14/J-1)
- Envoi automatique réel (nécessiterait l'API WhatsApp Business ou un envoi
  par email/SMS — volontairement laissé de côté en V1 pour garder le
  contrôle humain sur chaque envoi)
- Intégration comme module dans CreatorOS (le code est déjà découplé :
  aucune dépendance à CreatorOS, juste une base SQLite locale)
