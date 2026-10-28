# Birthday Reminder

Pour chaque proche : app habituelle (WhatsApp, SMS, Telegram, email, Messenger), fuseau horaire et heure d'envoi.

## Fonctionnement
1. **J-14** : brouillon généré + alerte (Telegram/email).
2. **J-7** : relance si le message n'est pas validé.
3. **Jour J**, à l'heure locale du proche : alerte avec le message validé et un lien qui ouvre la conversation. Envoi 100 % automatique uniquement par email (SMTP).
4. **Après** : l'app te demande de confirmer l'envoi ; un échec d'envoi automatique déclenche une alerte.

## Mise en ligne (Railway)
- Variables : voir `.env.example` (minimum : APP_PASSWORD, CRON_SECRET, APP_URL, MY_NAME, DEFAULT_TZ, DATA_DIR).
- Volume monté sur `/app/data`.
- cron-job.org : appeler **toutes les heures** `https://TON-APP/api/run-check?key=TA_CLE` (CRON_SECRET).

## Commandes
`npm install` · `npm run build` · `npm start` · `npm run check`
