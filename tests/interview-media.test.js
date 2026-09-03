// Integration tests for DEF-TECH-001 (interview media persistence).
//
// These run against a REAL server process and a REAL Postgres database
// (no mocks). They spawn `node server.js`, wait for /api/health, drive
// the actual HTTP API, and — for the restart test — kill and respawn
// the process to prove persistence survives a process restart.
//
// Requires: DATABASE_URL pointing at a reachable, empty-or-reusable
// Postgres database. Run with:
//   DATABASE_URL=postgres://user:pass@host:5432/db node --test tests/

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.TEST_PORT || 4501;
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to run these integration tests.');
}

let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, DATABASE_URL, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;

    serverProcess.stdout.on('data', (chunk) => {
      if (!settled && chunk.toString().includes('running on port')) {
        settled = true;
        resolve();
      }
    });

    serverProcess.on('error', reject);

    setTimeout(() => {
      if (!settled) reject(new Error('Server did not start within timeout.'));
    }, 8000);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) return resolve();
    serverProcess.once('exit', () => resolve());
    serverProcess.kill('SIGTERM');
  });
}

async function waitForHealth() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      const data = await res.json();
      if (data.status === 'ok') return;
    } catch (e) {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server never reported healthy database.');
}

function randomBytes(n) {
  return crypto.randomBytes(n);
}

test.before(async () => {
  await startServer();
  await waitForHealth();
});

test.after(async () => {
  await stopServer();
});

test('registration: creates an application', async () => {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Automated Test Producer',
      email: `auto-${Date.now()}@example.com`,
      role: 'Test Genre',
      consent: true,
    }),
  });
  const data = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.success, true);
  assert.ok(data.id);
});

test('interview-media: rejects empty upload', async () => {
  const reg = await (
    await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Empty Upload Test',
        email: `empty-${Date.now()}@example.com`,
        role: 'Rock',
        consent: true,
      }),
    })
  ).json();

  const res = await fetch(`${BASE_URL}/api/applications/${reg.id}/interview-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: Buffer.alloc(0),
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.success, false);
});

test('interview-media: rejects unsupported mime type', async () => {
  const reg = await (
    await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Bad Mime Test',
        email: `badmime-${Date.now()}@example.com`,
        role: 'Rock',
        consent: true,
      }),
    })
  ).json();

  const res = await fetch(`${BASE_URL}/api/applications/${reg.id}/interview-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: randomBytes(1000),
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.success, false);
});

test('interview-media: uploads real binary and persists it durably, byte-identical, across a real process restart; PATCH/submit security enforced', async () => {
  const email = `full-${Date.now()}@example.com`;
  const reg = await (
    await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Full Flow Test', email, role: 'Hip-hop', consent: true }),
    })
  ).json();
  const appId = reg.id;

  const originalBytes = randomBytes(250000);

  // Upload
  const uploadRes = await fetch(`${BASE_URL}/api/applications/${appId}/interview-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: originalBytes,
  });
  const uploadData = await uploadRes.json();
  assert.equal(uploadRes.status, 201);
  assert.equal(uploadData.success, true);
  assert.equal(uploadData.mediaStatus, 'complete');
  assert.equal(uploadData.deduplicated, false);
  const mediaId = uploadData.mediaId;

  // Idempotency: identical re-upload must not create a duplicate row
  const reupload = await fetch(`${BASE_URL}/api/applications/${appId}/interview-media`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/webm' },
    body: originalBytes,
  });
  const reuploadData = await reupload.json();
  assert.equal(reuploadData.mediaId, mediaId);
  assert.equal(reuploadData.deduplicated, true);

  const listRes = await fetch(`${BASE_URL}/api/applications/${appId}/interview-media`);
  const listData = await listRes.json();
  assert.equal(listData.media.length, 1, 'exactly one media row must exist after duplicate upload');

  // PATCH SECURITY: completed:true with no mediaId -> rejected
  const patchNoMedia = await fetch(`${BASE_URL}/api/applications/${appId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interview: { completed: true } }),
  });
  assert.equal(patchNoMedia.status, 400);

  // PATCH SECURITY: completed:true with a fake/nonexistent mediaId -> rejected
  const patchFakeMedia = await fetch(`${BASE_URL}/api/applications/${appId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interview: { completed: true, mediaId: crypto.randomUUID() } }),
  });
  assert.equal(patchFakeMedia.status, 400);

  // PATCH with the REAL mediaId -> accepted
  const patchReal = await fetch(`${BASE_URL}/api/applications/${appId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interview: { completed: true, mediaId, mimeType: 'video/webm' } }),
  });
  assert.equal(patchReal.status, 200);

  // Submit should fail: DNA/portfolio not yet filled in
  const submitTooEarly = await fetch(`${BASE_URL}/api/applications/${appId}/submit`, { method: 'POST' });
  const submitTooEarlyData = await submitTooEarly.json();
  assert.equal(submitTooEarly.status, 400);
  assert.ok(!submitTooEarlyData.success);

  await fetch(`${BASE_URL}/api/applications/${appId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      producerDna: { sound: 's', influences: 'i', strength: 'st', mission: 'm' },
      portfolio: { top1: '1', top2: '2', top3: '3' },
    }),
  });

  // Submit should now succeed
  const submitRes = await fetch(`${BASE_URL}/api/applications/${appId}/submit`, { method: 'POST' });
  const submitData = await submitRes.json();
  assert.equal(submitRes.status, 200);
  assert.equal(submitData.success, true);

  // Idempotent resubmit
  const resubmit = await fetch(`${BASE_URL}/api/applications/${appId}/submit`, { method: 'POST' });
  const resubmitData = await resubmit.json();
  assert.equal(resubmitData.alreadySubmitted, true);

  // --- REAL PROCESS RESTART ---
  await stopServer();
  await startServer();
  await waitForHealth();

  // Recovery: interview state still shows complete, from server state, after restart
  const afterRestart = await fetch(`${BASE_URL}/api/applications/${appId}`);
  const afterRestartData = await afterRestart.json();
  assert.equal(afterRestartData.application.status, 'submitted');
  assert.equal(afterRestartData.application.interview.completed, true);
  assert.equal(afterRestartData.application.interview.mediaId, mediaId);

  // Byte-identical durable retrieval after restart
  const contentRes = await fetch(`${BASE_URL}/api/applications/${appId}/interview-media/content`);
  const retrievedBuffer = Buffer.from(await contentRes.arrayBuffer());
  assert.equal(
    crypto.createHash('sha256').update(retrievedBuffer).digest('hex'),
    crypto.createHash('sha256').update(originalBytes).digest('hex'),
    'retrieved media must be byte-identical to what was uploaded'
  );
});

test('submit: rejected when no durable interview media exists', async () => {
  const reg = await (
    await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'No Media Test',
        email: `nomedia-${Date.now()}@example.com`,
        role: 'Pop',
        consent: true,
      }),
    })
  ).json();

  await fetch(`${BASE_URL}/api/applications/${reg.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      producerDna: { sound: 's', influences: 'i', strength: 'st', mission: 'm' },
      portfolio: { top1: '1', top2: '2', top3: '3' },
    }),
  });

  const res = await fetch(`${BASE_URL}/api/applications/${reg.id}/submit`, { method: 'POST' });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.success, false);
});

test('regression: duplicate email returns resumed draft, not an error', async () => {
  const email = `dup-${Date.now()}@example.com`;
  const payload = { fullName: 'Dup Test', email, role: 'Rock', consent: true };

  const first = await (
    await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  ).json();

  const secondRes = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const second = await secondRes.json();

  assert.equal(secondRes.status, 200);
  assert.equal(second.resumed, true);
  assert.equal(second.id, first.id);
});

test('regression: invalid registration input is rejected', async () => {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: '', email: 'not-an-email', role: '', consent: false }),
  });
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.success, false);
  assert.ok(data.errors.length >= 3);
});
