require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readRegistrations() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function writeRegistrations(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/register', (req, res) => {
  const { fullName, email, phone, role, portfolioUrl, message, consent } = req.body || {};

  const errors = [];
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
    errors.push('Full name is required.');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(String(email))) {
    errors.push('A valid email is required.');
  }
  if (!role || typeof role !== 'string' || role.trim().length < 2) {
    errors.push('Producer role/genre is required.');
  }
  if (consent !== true) {
    errors.push('Consent to AMP terms and communications is required.');
  }

  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const registrations = readRegistrations();

  const normalizedEmail = String(email).trim().toLowerCase();
  const duplicate = registrations.find((r) => r.email === normalizedEmail);
  if (duplicate) {
    return res.status(409).json({ success: false, errors: ['This email is already registered.'] });
  }

  const record = {
    id: crypto.randomUUID(),
    fullName: String(fullName).trim(),
    email: normalizedEmail,
    phone: phone ? String(phone).trim() : null,
    role: String(role).trim(),
    portfolioUrl: portfolioUrl ? String(portfolioUrl).trim() : null,
    message: message ? String(message).trim() : null,
    consent: true,
    createdAt: new Date().toISOString(),
  };

  registrations.push(record);
  writeRegistrations(registrations);

  return res.status(201).json({ success: true, id: record.id });
});

app.get('/api/registrations/count', (req, res) => {
  res.json({ count: readRegistrations().length });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AMP Producer Registration Funnel running on port ${PORT}`);
});
