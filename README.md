# ConnectionQuest

Teacher ranking app with a browser UI and a minimal Node.js server for deployment on platforms like Render.

The app now stores its matchup state in PostgreSQL through the Node.js backend instead of browser localStorage.

## Local start

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
set DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
npm start
```

3. Open:

```text
http://localhost:3000
```

## Render settings

- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variable: `DATABASE_URL=<your Render Postgres internal database URL>`
