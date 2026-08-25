require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set. API requests will return 503 until it is configured.');
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('railway') || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    })
  : null;

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL,
  portfolio_url TEXT,
  message TEXT,
  producer_dna JSONB NOT NULL DEFAULT '{}'::jsonb,
  portfolio JSONB NOT NULL DEFAULT '{}'::jsonb,
  interview JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  CONSTRAINT applications_email_normalized_unique UNIQUE (email_normalized),
  CONSTRAINT applications_status_check CHECK (status IN ('draft','submitted'))
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
`;

async function runMigration() {
  if (!pool) return;
  await pool.query(MIGRATION_SQL);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegistration(body) {
  const errors = [];
  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim();
  const role = (body.role || '').trim();

  if (fullName.length < 2) errors.push('Full name is required.');
  if (!EMAIL_REGEX.test(email)) errors.push('A valid email is required.');
  if (role.length < 2) errors.push('Producer role/genre is required.');
  if (body.consent !== true) errors.push('Consent to AMP terms and communications is required.');

  return { errors, fullName, email, role };
}

app.get('/api/health', async (req, res) => {
  if (!pool) {
    return res.status(503).json({ status: 'degraded', database: 'not configured' });
  }
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});

// Create application (registration). Idempotent on email: returns the existing
// draft if one exists for this email (treated as resume); rejects only if that
// email already has a submitted application.
app.post('/api/register', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, errors: ['Database is not configured.'] });

  const { errors, fullName, email, role } = validateRegistration(req.body || {});
  if (errors.length > 0) return res.status(400).json({ success: false, errors });

  const emailNormalized = email.toLowerCase();
  const phone = req.body.phone ? String(req.body.phone).trim() : null;
  const portfolioUrl = req.body.portfolioUrl ? String(req.body.portfolioUrl).trim() : null;
  const message = req.body.message ? String(req.body.message).trim() : null;

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT id, status FROM applications WHERE email_normalized = $1', [emailNormalized]);

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'submitted') {
        return res.status(409).json({ success: false, errors: ['This email has already submitted an application.'] });
      }
      return res.status(200).json({ success: true, id: row.id, resumed: true });
    }

    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO applications (id, email, email_normalized, full_name, phone, role, portfolio_url, message, consent, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'draft')`,
      [id, email, emailNormalized, fullName, phone, role, portfolioUrl, message]
    );

    return res.status(201).json({ success: true, id });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, errors: ['This email is already registered.'] });
    }
    console.error('register error', err);
    return res.status(500).json({ success: false, errors: ['Something went wrong. Please try again.'] });
  } finally {
    client.release();
  }
});

// Save/update a draft application: profile, producer DNA, portfolio, interview metadata.
app.patch('/api/applications/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, errors: ['Database is not configured.'] });
  const { id } = req.params;
  const { producerDna, portfolio, interview, phone, portfolioUrl, message } = req.body || {};

  try {
    const result = await pool.query(
      `UPDATE applications
       SET producer_dna = COALESCE($2, producer_dna),
           portfolio = COALESCE($3, portfolio),
           interview = COALESCE($4, interview),
           phone = COALESCE($5, phone),
           portfolio_url = COALESCE($6, portfolio_url),
           message = COALESCE($7, message),
           updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING id, updated_at`,
      [id, producerDna ? JSON.stringify(producerDna) : null, portfolio ? JSON.stringify(portfolio) : null, interview ? JSON.stringify(interview) : null, phone || null, portfolioUrl || null, message || null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, errors: ['Application not found, or already submitted.'] });
    }

    return res.json({ success: true, id: result.rows[0].id, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    console.error('update error', err);
    return res.status(500).json({ success: false, errors: ['Something went wrong. Please try again.'] });
  }
});

// Resume: retrieve current application state by id.
app.get('/api/applications/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, errors: ['Database is not configured.'] });
  try {
    const result = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, errors: ['Application not found.'] });
    return res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    console.error('fetch error', err);
    return res.status(500).json({ success: false, errors: ['Something went wrong. Please try again.'] });
  }
});

// Final submission. Idempotent: re-submitting an already-submitted application
// returns success without creating a duplicate or overwriting submitted_at.
app.post('/api/applications/:id/submit', async (req, res) => {
  if (!pool) return res.status(503).json({ success: false, errors: ['Database is not configured.'] });
  try {
    const existing = await pool.query('SELECT id, status, submitted_at FROM applications WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, errors: ['Application not found.'] });

    if (existing.rows[0].status === 'submitted') {
      return res.status(200).json({ success: true, id: existing.rows[0].id, submittedAt: existing.rows[0].submitted_at, alreadySubmitted: true });
    }

    const result = await pool.query(
      `UPDATE applications SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = $1 RETURNING id, submitted_at`,
      [req.params.id]
    );

    return res.status(200).json({ success: true, id: result.rows[0].id, submittedAt: result.rows[0].submitted_at });
  } catch (err) {
    console.error('submit error', err);
    return res.status(500).json({ success: false, errors: ['Something went wrong. Please try again.'] });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    await runMigration();
    console.log(pool ? 'Database migration applied.' : 'DATABASE_URL not set — skipping migration.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
  app.listen(PORT, () => {
    console.log(`AMP Producer Registration Funnel running on port ${PORT}`);
  });
}

start();
