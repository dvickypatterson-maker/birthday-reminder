import { Channel } from "./db";

export interface ChannelInfo {
  id: Channel;
  label: string;
  /** Ce que la personne doit renseigner dans "contact" */
  contactHint: string;
  /** true si l'app peut ouvrir la conversation avec le message déjà rempli */
  prefill: boolean;
}

export const CHANNEL_INFO: ChannelInfo[] = [
  { id: "whatsapp", label: "WhatsApp", contactHint: "Numéro avec indicatif, ex : +33612345678", prefill: true },
  { id: "sms", label: "SMS", contactHint: "Numéro avec indicatif, ex : +14165551234", prefill: true },
  { id: "telegram", label: "Telegram", contactHint: "Pseudo Telegram, ex : @pseudo", prefill: false },
  { id: "email", label: "Email", contactHint: "Adresse email", prefill: true },
  { id: "messenger", label: "Messenger", contactHint: "Pseudo ou lien Messenger (facultatif)", prefill: false },
  { id: "autre", label: "Autre (je copie le message)", contactHint: "Facultatif", prefill: false },
];

function digits(contact: string): string {
  return (contact || "").replace(/[^\d]/g, "");
}

function handle(contact: string): string {
  return (contact || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(t\.me|m\.me)\//, "");
}

/**
 * Lien qui ouvre la conversation dans l'app habituelle de la personne.
 * Quand l'app ne permet pas de pré-remplir le texte (Telegram, Messenger),
 * le lien ouvre la conversation et l'interface propose un bouton "Copier le message".
 * Renvoie "" si aucun lien n'est possible (canal "autre" ou contact manquant).
 */
export function buildSendLink(channel: Channel, contact: string, message: string, subject = "Joyeux anniversaire !"): string {
  const text = encodeURIComponent(message);
  switch (channel) {
    case "whatsapp": {
      const d = digits(contact);
      return d ? `https://wa.me/${d}?text=${text}` : `https://wa.me/?text=${text}`;
    }
    case "sms": {
      const phone = (contact || "").replace(/[^\d+]/g, "");
      return phone ? `sms:${phone}?&body=${text}` : "";
    }
    case "telegram": {
      const h = handle(contact);
      return h ? `https://t.me/${encodeURIComponent(h)}` : `https://t.me/share/url?url=%20&text=${text}`;
    }
    case "email": {
      const to = (contact || "").trim();
      return to ? `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${text}` : "";
    }
    case "messenger": {
      const h = handle(contact);
      return h ? `https://m.me/${encodeURIComponent(h)}` : "";
    }
    default:
      return "";
  }
}

export function channelLabel(channel: Channel): string {
  return CHANNEL_INFO.find((c) => c.id === channel)?.label ?? channel;
}

export function channelPrefills(channel: Channel): boolean {
  return CHANNEL_INFO.find((c) => c.id === channel)?.prefill ?? false;
}
