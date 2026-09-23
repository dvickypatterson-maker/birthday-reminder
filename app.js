const toastEl = document.getElementById("toast");
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("main section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "people") loadPeople();
  });
});

// ---------- Reminders ----------

async function loadReminders() {
  const res = await fetch("/api/reminders");
  const reminders = await res.json();
  const container = document.getElementById("remindersList");

  if (reminders.length === 0) {
    container.innerHTML = `<div class="empty">Rien à valider pour le moment.<br>Les brouillons apparaissent ici automatiquement à J-14.</div>`;
    return;
  }

  container.innerHTML = reminders.map(renderReminderCard).join("");

  reminders.forEach((r) => {
    const card = document.getElementById(`reminder-${r.id}`);
    if (!card) return;

    card.querySelector(".btn-regenerate")?.addEventListener("click", () => regenerate(r.id));
    card.querySelector(".btn-validate")?.addEventListener("click", () => validate(r.id));
    card.querySelector(".btn-whatsapp")?.addEventListener("click", () => sendWhatsapp(r));
    card.querySelector(".btn-ignore")?.addEventListener("click", () => ignoreReminder(r.id));
  });
}

function badgeClass(days) {
  if (days <= 1) return "j-ok";
  if (days <= 14) return "j-soon";
  return "j-far";
}

function badgeLabel(days) {
  if (days === 0) return "Aujourd'hui !";
  if (days === 1) return "Demain";
  if (days < 0) return `Il y a ${Math.abs(days)} j`;
  return `Dans ${days} j`;
}

function renderReminderCard(r) {
  const message = r.final_message || r.draft_message || "";
  const statusLabel = {
    a_venir: "En attente de génération",
    brouillon_genere: "Brouillon prêt — à relire",
    valide: "Validé — prêt à envoyer",
    envoye: "Envoyé",
    ignore: "Ignoré",
  }[r.status] || r.status;

  return `
    <div class="card" id="reminder-${r.id}">
      <div class="reminder-head">
        <h3>${escapeHtml(r.name)}</h3>
        <span class="badge ${badgeClass(r.days_until)}">${badgeLabel(r.days_until)} · ${r.target_date_fr}</span>
      </div>
      <div class="meta">${escapeHtml(r.relation)} · ${statusLabel}</div>
      <textarea data-id="${r.id}">${escapeHtml(message)}</textarea>
      <div class="actions">
        <button class="btn btn-secondary btn-regenerate">Régénérer</button>
        <button class="btn btn-primary btn-validate">Valider</button>
        <button class="btn btn-whatsapp">Envoyer sur WhatsApp</button>
        <button class="btn btn-ghost btn-ignore">Ignorer cette année</button>
      </div>
    </div>
  `;
}

async function regenerate(id) {
  toast("Génération en cours…");
  const res = await fetch(`/api/reminders/${id}/regenerate`, { method: "POST" });
  if (!res.ok) {
    toast("Échec de la génération.");
    return;
  }
  await loadReminders();
  toast("Nouveau brouillon généré.");
}

async function validate(id) {
  const textarea = document.querySelector(`#reminder-${id} textarea`);
  const final_message = textarea.value;
  const res = await fetch(`/api/reminders/${id}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ final_message }),
  });
  if (!res.ok) {
    toast("Échec de la validation.");
    return;
  }
  await loadReminders();
  toast("Message validé.");
}

async function ignoreReminder(id) {
  const res = await fetch(`/api/reminders/${id}/ignore`, { method: "POST" });
  if (!res.ok) {
    toast("Échec.");
    return;
  }
  await loadReminders();
  toast("Rappel ignoré pour cette année.");
}

async function sendWhatsapp(r) {
  const textarea = document.querySelector(`#reminder-${r.id} textarea`);
  const message = textarea.value;

  // Marque comme validé si ce n'est pas déjà fait, puis ouvre WhatsApp.
  await fetch(`/api/reminders/${r.id}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ final_message: message }),
  });

  const phoneDigits = (r.phone || "").replace(/[^\d+]/g, "");
  const base = phoneDigits ? `https://wa.me/${phoneDigits.replace("+", "")}` : `https://wa.me/`;
  const url = `${base}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");

  // Propose de marquer comme envoyé après coup.
  setTimeout(async () => {
    if (confirm("Message envoyé sur WhatsApp ? (Marquer ce rappel comme envoyé)")) {
      await fetch(`/api/reminders/${r.id}/mark-sent`, { method: "POST" });
      loadReminders();
    }
  }, 800);
}

document.getElementById("refreshBtn").addEventListener("click", async () => {
  toast("Vérification des anniversaires…");
  const res = await fetch("/api/run-check", { method: "POST" });
  const result = await res.json();
  toast(`${result.drafted} brouillon(s) généré(s), ${result.created} nouveau(x) rappel(s).`);
  loadReminders();
});

// ---------- Personnes ----------

async function loadPeople() {
  const res = await fetch("/api/people");
  const people = await res.json();
  const container = document.getElementById("peopleList");

  if (people.length === 0) {
    container.innerHTML = `<div class="empty">Aucun proche enregistré pour l'instant.</div>`;
    return;
  }

  const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  container.innerHTML = people
    .map(
      (p) => `
    <div class="person-row" id="person-${p.id}">
      <div class="info">
        <b>${escapeHtml(p.name)}</b>
        <span>${p.birth_day} ${months[p.birth_month - 1]} · ${escapeHtml(p.relation)}</span>
      </div>
      <div class="row-actions">
        <button class="btn-delete-person" data-id="${p.id}">Supprimer</button>
      </div>
    </div>
  `
    )
    .join("");

  container.querySelectorAll(".btn-delete-person").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer ce proche ? Ses rappels ne seront plus générés.")) return;
      await fetch(`/api/people/${btn.dataset.id}`, { method: "DELETE" });
      loadPeople();
    });
  });
}

document.getElementById("personForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());

  const res = await fetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    toast("Échec de l'ajout.");
    return;
  }

  form.reset();
  toast("Proche ajouté.");
  loadPeople();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- Démarrage ----------
loadReminders();
