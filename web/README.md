# Frontend Contour

Канонический frontend-контур проекта состоит только из активных страниц:

- `/login`
- `/`
- `/logs`
- `/incidents`
- `/incidents/details`
- `/analytics`
- `/inventory`
- `/compliance`

Канонический runtime-слой в `web/static`:

- `style.css`
- `auth-client.js`
- `app-shell.js`
- `data-client.js`
- `remote-audit.js`
- `logs.js`
- `incidents.js`
- `incident-details.js`
- `reports.js`
- `compliance.js`
- `remote-pcs.js`

Архив исторического фронтенда лежит в `web/static/legacy` и не считается частью рабочего UI.
Он не должен подключаться активными HTML-страницами и не должен попадать в `deploy/server-pack/web`.