import https from "https";
import { Person } from "./db";

const MY_NAME = process.env.MY_NAME?.trim() || "";
const API_KEY = process.env.ANTHROPIC_API_KEY?.trim() || "";

/**
 * Génère un brouillon de message d'anniversaire personnalisé.
 * Utilise l'API Claude si une clé est configurée, sinon retombe sur un
 * template local (toujours fonctionnel, moins riche).
 */
export async function generateBirthdayDraft(person: Pick<Person, "name" | "relation" | "context" | "tone">): Promise<string> {
  if (API_KEY) {
    try {
      return await generateWithClaude(person);
    } catch (err) {
      console.error("Génération via Claude API échouée, repli sur le template local:", (err as Error).message);
      return generateWithTemplate(person);
    }
  }
  return generateWithTemplate(person);
}

function generateWithClaude(person: Pick<Person, "name" | "relation" | "context" | "tone">): Promise<string> {
  const signature = MY_NAME ? `Signe le message avec le prénom "${MY_NAME}".` : "Ne mets pas de signature explicite.";

  const prompt = `Tu écris un message d'anniversaire en français, à envoyer sur WhatsApp à un(e) proche.

Destinataire : ${person.name}
Relation avec l'expéditeur : ${person.relation}
Contexte / détails personnels donnés par l'expéditeur : ${person.context || "aucun détail particulier fourni"}
Ton souhaité : ${person.tone}

Consignes :
- Écris un message chaleureux, sincère, pas générique, qui utilise si possible le contexte donné.
- Longueur : 3 à 8 phrases, adaptée à un message WhatsApp (pas une lettre).
- Pas de balises, pas de guillemets autour du message, juste le texte du message tel qu'il sera envoyé.
- ${signature}
- Ne commence pas par "Cher/Chère", préfère une entrée en matière plus naturelle et directe.`;

  const payload = JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const options: https.RequestOptions = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`API Anthropic a répondu ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          const text = parsed?.content?.[0]?.text;
          if (!text) {
            reject(new Error("Réponse API sans texte exploitable"));
            return;
          }
          resolve(text.trim());
        } catch (e) {
          reject(e as Error);
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function generateWithTemplate(person: Pick<Person, "name" | "relation" | "context" | "tone">): string {
  const firstName = person.name.split(" ")[0];
  const context = person.context ? ` ${person.context.trim()}` : "";
  const signature = MY_NAME ? `\n\n${MY_NAME}` : "";

  return (
    `Joyeux anniversaire ${firstName} ! 🎉\n\n` +
    `Je pense fort à toi en ce jour spécial.${context} ` +
    `J'espère que cette nouvelle année t'apporte plein de belles choses, de la santé et de la joie au quotidien.\n\n` +
    `Passe une journée magnifique, tu le mérites amplement !${signature}`
  );
}
