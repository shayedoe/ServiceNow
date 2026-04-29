const express = require('express');
const sn = require('./servicenow');
const client = require('./servicenow/client');

// Routes
const healthRouter = require('./routes/health.routes');
const sessionsRouter = require('./routes/sessions.routes');
const ticketsRouter = require('./routes/tickets.routes');
const scenariosRouter = require('./routes/scenarios.routes');
const servicenowRouter = require('./routes/servicenow.routes');

function startServer(port = 3017) {
  const app = express();

  // ── Restricted CORS: allow only Electron (origin: null) and localhost ──
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed =
      !origin ||
      origin === 'null' ||
      /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin || 'null');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json());

  // Wire SN client config provider
  try {
    client.setConfigProvider(() => sn.loadConfig());
  } catch (err) {
    console.warn('SN client config provider could not be wired:', err.message);
  }

  // Mount route modules
  app.use('/api', healthRouter);
  app.use('/api', sessionsRouter);
  app.use('/api', ticketsRouter);
  app.use('/api', scenariosRouter);
  app.use('/api', servicenowRouter);

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Help Desk API listening on http://127.0.0.1:${port}`);
  });
  return server;
}

module.exports = startServer;

if (require.main === module) {
  startServer(Number(process.env.PORT) || 3017);
}
