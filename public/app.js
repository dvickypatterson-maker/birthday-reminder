// ---------- Utilitaires ----------

const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* réponse vide (204) */
  }
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

// Même logique que src/channels.ts : lien qui ouvre la conversation dans l'app habituelle de la personne.
function digits(c) { return (c || "").replace(/[^\d]/g, ""); }
function handle(c) { return (c || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(t\.me|m\.me)\//, ""); }
function buildSendLink(channel, contact, message) {
  const text = encodeURIComponent(message);
  switch (channel) {
    case "whatsapp": {
      const d = digits(contact);
      return d ? `https://wa.me/${d}?text=${text}` : `https://wa.me/?text=${text}`;
    }
    case "sms": {
      const p = (contact || "").replace(/[^\d+]/g, "");
      return p ? `sms:${p}?&body=${text}` : "";
    }
    case "telegram": {
      const h = handle(contact);
      return h ? `https://t.me/${encodeURIComponent(h)}` : `https://t.me/share/url?url=%20&text=${text}`;
    }
    case "email": {
      const to = (contact || "").trim();
      return to ? `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent("Joyeux anniversaire !")}&body=${text}` : "";
    }
    case "messenger": {
      const h = handle(contact);
      return h ? `https://m.me/${encodeURIComponent(h)}` : "";
    }
    default:
      return "";
  }
}

let appStatus = { channels: [], notify: {}, protected: true, smtp: false };

// ---------- Onglets ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("main section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "people") loadPeople();
    else loadReminders();
  });
});

// ---------- Bandeaux d'état ----------

function renderBanners() {
  const banners = [];
  if (!appStatus.protected) {
    banners.push(`<div class="banner bad">Cette app n'est pas protégée par un mot de passe : toute personne qui a le lien peut voir les noms, dates et contacts de tes proches. Ajoute la variable <b>APP_PASSWORD</b> sur Railway.</div>`);
  }
  if (!appStatus.notify.telegram && !appStatus.notify.email) {
    banners.push(`<div class="banner warn">Aucune alerte n'est configurée : tu ne seras prévenue que si tu ouvres l'app. Configure Telegram ou l'email (voir le README) pour recevoir les rappels à J-14, J-7 et le jour J.</div>`);
  }
  document.getElementById("banners").innerHTML = banners.join("");
}

// ---------- Rappels ----------

const remindersById = new Map();

function badgeClass(days) {
  if (days <= 0) return "j-today";
  if (days <= 14) return "j-soon";
  return "j-far";
}

function badgeLabel(days) {
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  if (days < 0) return `Il y a ${Math.abs(days)} j`;
  return `Dans ${days} j`;
}

function statusOf(r) {
  if (r.send_status === "echec") return { text: "Échec d'envoi", cls: "bad" };
  if (r.send_status === "envoye_auto") return { text: "Envoyé automatiquement", cls: "ok" };
  if (r.send_status === "manque") return { text: "Manqué", cls: "bad" };
  if (r.status === "envoye") return { text: "Envoyé", cls: "ok" };
  if (r.status === "ignore") return { text: "Ignoré", cls: "" };
  if (r.send_status === "pret") return { text: "Prêt à envoyer", cls: "warn" };
  if (r.status === "valide") return { text: "Validé", cls: "ok" };
  if (r.status === "brouillon_genere") return { text: "Brouillon à relire", cls: "warn" };
  return { text: "En attente du brouillon", cls: "" };
}

function renderReminderCard(r) {
  const message = r.final_message || r.draft_message || "";
  const st = statusOf(r);
  const closed = r.status === "envoye" || r.status === "ignore";
  const canSendVia = r.channel !== "autre";
  const showAutoSend = r.channel === "email" && r.auto_send && !closed && (r.status === "valide" || r.send_status === "echec");

  const meta = [
    escapeHtml(r.relation),
    `via ${escapeHtml(r.channel_label)}${r.contact ? ` (${escapeHtml(r.contact)})` : ""}`,
    `fuseau ${escapeHtml(r.resolved_timezone)}, envoi à ${r.send_hour} h`,
  ].join(" · ");

  const buttons = closed
    ? ""
    : `
      <div class="actions">
        <button class="btn btn-secondary" data-act="regenerate" data-id="${r.id}">Nouvelle version</button>
        <button class="btn btn-primary" data-act="validate" data-id="${r.id}">Valider</button>
        ${canSendVia ? `<button class="btn btn-send" data-act="send" data-id="${r.id}">Envoyer par ${escapeHtml(r.channel_label)}</button>` : ""}
        ${showAutoSend ? `<button class="btn btn-send" data-act="send-now" data-id="${r.id}">${r.send_status === "echec" ? "Réessayer l'envoi" : "Envoyer maintenant"}</button>` : ""}
        <button class="btn btn-ghost" data-act="copy" data-id="${r.id}">Copier</button>
        <button class="btn btn-ghost" data-act="ignore" data-id="${r.id}">Ignorer cette année</button>
      </div>`;

  return `
    <div class="card" id="reminder-${r.id}">
      <div class="reminder-head">
        <h3>${escapeHtml(r.name)}</h3>
        <span class="badge ${badgeClass(r.days_until)}">${badgeLabel(r.days_until)} · ${escapeHtml(r.target_date_fr)}</span>
      </div>
      <div class="meta">${meta}<span class="status-pill ${st.cls}">${st.text}</span></div>
      ${r.send_status === "echec" && r.send_error ? `<div class="error-line">Détail : ${escapeHtml(r.send_error)}</div>` : ""}
      <textarea data-id="${r.id}" aria-label="Message pour ${escapeHtml(r.name)}" ${closed ? "readonly" : ""}>${escapeHtml(message)}</textarea>
      ${buttons}
    </div>
  `;
}

async function loadReminders() {
  const all = document.getElementById("showAll").checked;
  let reminders;
  try {
    reminders = await api(`/api/reminders${all ? "?all=1" : ""}`);
  } catch (e) {
    toast(e.message);
    return;
  }
  remindersById.clear();
  reminders.forEach((r) => remindersById.set(r.id, r));
  const container = document.getElementById("remindersList");

  if (reminders.length === 0) {
    container.innerHTML = `<div class="empty">Rien à traiter pour le moment.<br>Les brouillons apparaissent ici automatiquement 14 jours avant chaque anniversaire.</div>`;
    return;
  }
  container.innerHTML = reminders.map(renderReminderCard).join("");
}

function messageOf(id) {
  const ta = document.querySelector(`#reminder-${id} textarea`);
  return ta ? ta.value.trim() : "";
}

async function validate(id, silent = false) {
  const final_message = messageOf(id);
  if (!final_message) {
    toast("Le message est vide.");
    return false;
  }
  try {
    await api(`/api/reminders/${id}/validate`, { method: "POST", body: JSON.stringify({ final_message }) });
    if (!silent) {
      await loadReminders();
      toast("Message validé.");
    }
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

async function sendVia(id) {
  const r = remindersById.get(id);
  const message = messageOf(id);
  if (!r || !message) {
    toast("Le message est vide.");
    return;
  }
  const link = buildSendLink(r.channel, r.contact, message);

  // Telegram et Messenger n'acceptent pas de texte pré-rempli : on copie le message d'abord.
  if (!r.channel_prefills || !link) {
    const ok = await copyText(message);
    toast(ok ? "Message copié. Colle-le dans la conversation." : "Copie impossible : sélectionne le texte et copie-le à la main.", 4000);
  }
  if (link) {
    if (/^https?:/i.test(link)) window.open(link, "_blank", "noopener");
    else window.location.href = link; // sms: et mailto: sont gérés par le téléphone ou l'ordinateur
  }

  await validate(id, true);
  setTimeout(async () => {
    if (confirm(`Message envoyé à ${r.name} ? (OK = marquer ce rappel comme envoyé)`)) {
      try {
        await api(`/api/reminders/${id}/mark-sent`, { method: "POST" });
        toast("Marqué comme envoyé.");
      } catch (e) {
        toast(e.message);
      }
    }
    loadReminders();
  }, 1200);
}

document.getElementById("remindersList").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  btn.disabled = true;
  try {
    switch (btn.dataset.act) {
      case "regenerate":
        toast("Génération en cours…");
        await api(`/api/reminders/${id}/regenerate`, { method: "POST" });
        await loadReminders();
        toast("Nouveau brouillon généré. Relis-le puis valide-le.");
        break;
      case "validate":
        await validate(id);
        break;
      case "send":
        await sendVia(id);
        break;
      case "send-now":
        if (!(await validate(id, true))) break;
        await api(`/api/reminders/${id}/send-now`, { method: "POST" });
        await loadReminders();
        toast("Message envoyé par email.");
        break;
      case "copy": {
        const ok = await copyText(messageOf(id));
        toast(ok ? "Message copié." : "Copie impossible sur ce navigateur.");
        break;
      }
      case "ignore":
        if (confirm("Ignorer cet anniversaire pour cette année ?")) {
          await api(`/api/reminders/${id}/ignore`, { method: "POST" });
          await loadReminders();
          toast("Rappel ignoré pour cette année.");
        }
        break;
    }
  } catch (e) {
    toast(e.message, 5000);
    loadReminders();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("showAll").addEventListener("change", loadReminders);

document.getElementById("refreshBtn").addEventListener("click", async () => {
  toast("Vérification des anniversaires…");
  try {
    const r = await api("/api/run-check", { method: "POST" });
    toast(`${r.drafted} brouillon(s), ${r.notified} alerte(s), ${r.autoSent} envoi(s) automatique(s), ${r.failed} échec(s).`, 4000);
  } catch (e) {
    toast(e.message);
  }
  loadReminders();
});

// ---------- Formulaire des proches ----------

const form = document.getElementById("personForm");
const channelSelect = document.getElementById("f_channel");
const contactInput = document.getElementById("f_contact");
const contactHint = document.getElementById("contactHint");
const autoWrap = document.getElementById("autoSendWrap");
const autoInput = document.getElementById("f_auto");
const hourSelect = document.getElementById("f_hour");
let editingId = null;

for (let h = 0; h < 24; h++) {
  const o = document.createElement("option");
  o.value = String(h);
  o.textContent = `${h} h`;
  hourSelect.appendChild(o);
}
hourSelect.value = "9";

function syncChannelUi() {
  const info = appStatus.channels.find((c) => c.id === channelSelect.value);
  contactHint.textContent = info ? info.contactHint : "";
  const isEmail = channelSelect.value === "email";
  autoWrap.hidden = !isEmail;
  if (!isEmail) autoInput.checked = false;
  if (isEmail && !appStatus.smtp) {
    autoInput.disabled = true;
    autoWrap.querySelector("label").textContent =
      "Envoi automatique par email : pas encore disponible (l'email n'est pas configuré sur le serveur, voir le README).";
  }
}
channelSelect.addEventListener("change", syncChannelUi);

function resetForm() {
  form.reset();
  hourSelect.value = "9";
  editingId = null;
  document.getElementById("formTitle").textContent = "Ajouter un proche";
  document.getElementById("submitBtn").textContent = "Ajouter";
  document.getElementById("cancelEdit").hidden = true;
  syncChannelUi();
}

document.getElementById("cancelEdit").addEventListener("click", resetForm);

function startEdit(p) {
  editingId = p.id;
  form.name.value = p.name;
  form.birth_day.value = p.birth_day;
  form.birth_month.value = String(p.birth_month);
  form.relation.value = p.relation;
  form.tone.value = p.tone;
  form.channel.value = p.channel;
  form.contact.value = p.contact || "";
  form.timezone.value = p.timezone || "";
  form.send_hour.value = String(p.send_hour);
  form.context.value = p.context || "";
  autoInput.checked = !!p.auto_send;
  syncChannelUi();
  document.getElementById("formTitle").textContent = `Modifier ${p.name}`;
  document.getElementById("submitBtn").textContent = "Enregistrer";
  document.getElementById("cancelEdit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const payload = {
    name: fd.get("name"),
    birth_day: fd.get("birth_day"),
    birth_month: fd.get("birth_month"),
    relation: fd.get("relation"),
    tone: fd.get("tone"),
    channel: fd.get("channel"),
    contact: fd.get("contact"),
    timezone: fd.get("timezone"),
    send_hour: fd.get("send_hour"),
    context: fd.get("context"),
    auto_send: autoInput.checked && !autoWrap.hidden,
  };
  const submit = document.getElementById("submitBtn");
  submit.disabled = true;
  try {
    toast(editingId ? "Enregistrement…" : "Ajout en cours…");
    await api(editingId ? `/api/people/${editingId}` : "/api/people", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    toast(editingId ? "Modifications enregistrées." : "Proche ajouté.");
    resetForm();
    loadPeople();
  } catch (err) {
    toast(err.message, 5000);
  } finally {
    submit.disabled = false;
  }
});

// ---------- Liste des proches ----------

const peopleById = new Map();
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

async function loadPeople() {
  let people;
  try {
    people = await api("/api/people");
  } catch (e) {
    toast(e.message);
    return;
  }
  peopleById.clear();
  people.forEach((p) => peopleById.set(p.id, p));
  const container = document.getElementById("peopleList");

  if (people.length === 0) {
    container.innerHTML = `<div class="empty">Aucun proche enregistré pour l'instant.</div>`;
    return;
  }

  container.innerHTML = people
    .map((p) => {
      const info = appStatus.channels.find((c) => c.id === p.channel);
      const tz = p.timezone ? ` · ${escapeHtml(p.timezone)}` : "";
      return `
      <div class="person-row">
        <div class="info">
          <b>${escapeHtml(p.name)}</b>
          <span>${p.birth_day} ${MONTHS[p.birth_month - 1]} · ${escapeHtml(p.relation)} · ${escapeHtml(info ? info.label : p.channel)}${tz}</span>
        </div>
        <div class="row-actions">
          <button data-act="edit" data-id="${p.id}">Modifier</button>
          <button data-act="delete" data-id="${p.id}">Supprimer</button>
        </div>
      </div>`;
    })
    .join("");
}

document.getElementById("peopleList").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.act === "edit") {
    const p = peopleById.get(id);
    if (p) startEdit(p);
  } else if (btn.dataset.act === "delete") {
    if (!confirm("Supprimer ce proche ? Ses rappels ne seront plus générés.")) return;
    try {
      await api(`/api/people/${id}`, { method: "DELETE" });
      loadPeople();
    } catch (e) {
      toast(e.message);
    }
  }
});

// ---------- Démarrage ----------

(async function init() {
  try {
    appStatus = await api("/api/status");
  } catch (e) {
    toast(e.message);
  }
  channelSelect.innerHTML = appStatus.channels.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join("");
  syncChannelUi();
  renderBanners();
  loadReminders();
})();
