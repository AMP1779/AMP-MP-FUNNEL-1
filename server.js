require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn(
    'WARNING: DATABASE_URL is not set. API requests will return 503 until it is configured.'
  );
}

/*
 * Railway private networking does not require SSL.
 * Public PostgreSQL providers may require SSL.
 */
const needsSSL = DATABASE_URL
  ? !/railway\.internal/.test(DATABASE_URL) &&
    /railway\.app|amazonaws|render\.com|supabase\.co/.test(DATABASE_URL)
  : false;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: needsSSL
        ? { rejectUnauthorized: false }
        : false,
    })
  : null;


/* ==================================================
   DATABASE
================================================== */

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

  CONSTRAINT applications_email_normalized_unique
    UNIQUE (email_normalized),

  CONSTRAINT applications_status_check
    CHECK (status IN ('draft', 'submitted'))
);

CREATE INDEX IF NOT EXISTS idx_applications_status
ON applications(status);
`;

async function runMigration() {
  if (!pool) return;

  await pool.query(MIGRATION_SQL);
}


/* ==================================================
   EXPRESS
================================================== */

app.use(express.json({
  limit: '2mb'
}));

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


/* ==================================================
   VALIDATION
================================================== */

const EMAIL_REGEX =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function validateRegistration(body) {

  const errors = [];

  const fullName =
    String(body.fullName || '').trim();

  const email =
    String(body.email || '').trim();

  const role =
    String(body.role || '').trim();


  if (fullName.length < 2) {
    errors.push('Full name is required.');
  }

  if (!EMAIL_REGEX.test(email)) {
    errors.push('A valid email is required.');
  }

  if (role.length < 2) {
    errors.push('Producer role/genre is required.');
  }

  if (body.consent !== true) {
    errors.push(
      'Consent to AMP terms and communications is required.'
    );
  }


  return {
    errors,
    fullName,
    email,
    role
  };
}


/* ==================================================
   HEALTH
================================================== */

app.get(
  '/api/health',

  async (req, res) => {

    if (!pool) {

      return res.status(503).json({
        status: 'degraded',
        database: 'not configured'
      });

    }


    try {

      await pool.query('SELECT 1');

      return res.json({
        status: 'ok',
        database: 'connected',
        time: new Date().toISOString()
      });

    } catch (err) {

      console.error('health check error', err);

      return res.status(503).json({
        status: 'degraded',
        database: 'unreachable'
      });

    }

  }
);


/* ==================================================
   REGISTRATION
================================================== */

/*
 * Creates an application.
 *
 * Idempotent behavior:
 *
 * Same email + draft
 * → returns existing application
 *
 * Same email + submitted
 * → rejects duplicate application
 */

app.post(
  '/api/register',

  async (req, res) => {

    if (!pool) {

      return res.status(503).json({
        success: false,
        errors: [
          'Database is not configured.'
        ]
      });

    }


    const {
      errors,
      fullName,
      email,
      role
    } = validateRegistration(req.body || {});


    if (errors.length > 0) {

      return res.status(400).json({
        success: false,
        errors
      });

    }


    const emailNormalized =
      email.toLowerCase();


    const phone =
      req.body.phone
        ? String(req.body.phone).trim()
        : null;


    const portfolioUrl =
      req.body.portfolioUrl
        ? String(req.body.portfolioUrl).trim()
        : null;


    const message =
      req.body.message
        ? String(req.body.message).trim()
        : null;


    const client =
      await pool.connect();


    try {

      const existing =
        await client.query(

          `SELECT
            id,
            status
           FROM applications
           WHERE email_normalized = $1`,

          [emailNormalized]

        );


      if (existing.rows.length > 0) {

        const row =
          existing.rows[0];


        if (row.status === 'submitted') {

          return res.status(409).json({

            success: false,

            errors: [
              'This email has already submitted an application.'
            ]

          });

        }


        return res.status(200).json({

          success: true,

          id: row.id,

          resumed: true

        });

      }


      const id =
        crypto.randomUUID();


      await client.query(

        `INSERT INTO applications (

          id,

          email,

          email_normalized,

          full_name,

          phone,

          role,

          portfolio_url,

          message,

          consent,

          status

        )

        VALUES (

          $1,

          $2,

          $3,

          $4,

          $5,

          $6,

          $7,

          $8,

          true,

          'draft'

        )`,

        [

          id,

          email,

          emailNormalized,

          fullName,

          phone,

          role,

          portfolioUrl,

          message

        ]

      );


      return res.status(201).json({

        success: true,

        id

      });


    } catch (err) {

      if (err.code === '23505') {

        return res.status(409).json({

          success: false,

          errors: [
            'This email is already registered.'
          ]

        });

      }


      console.error(
        'register error',
        err
      );


      return res.status(500).json({

        success: false,

        errors: [
          'Something went wrong. Please try again.'
        ]

      });


    } finally {

      client.release();

    }

  }
);


/* ==================================================
   UPDATE APPLICATION DRAFT
================================================== */

/*
 * Saves application data while the application
 * remains in draft status.
 */

app.patch(
  '/api/applications/:id',

  async (req, res) => {

    if (!pool) {

      return res.status(503).json({

        success: false,

        errors: [
          'Database is not configured.'
        ]

      });

    }


    const { id } =
      req.params;


    const {

      producerDna,

      portfolio,

      interview,

      phone,

      portfolioUrl,

      message

    } = req.body || {};


    try {

      const result =
        await pool.query(

          `UPDATE applications

           SET

             producer_dna =
               COALESCE($2, producer_dna),

             portfolio =
               COALESCE($3, portfolio),

             interview =
               COALESCE($4, interview),

             phone =
               COALESCE($5, phone),

             portfolio_url =
               COALESCE($6, portfolio_url),

             message =
               COALESCE($7, message),

             updated_at =
               now()

           WHERE

             id = $1

             AND status = 'draft'

           RETURNING
             id,
             updated_at`,

          [

            id,

            producerDna
              ? JSON.stringify(producerDna)
              : null,

            portfolio
              ? JSON.stringify(portfolio)
              : null,

            interview
              ? JSON.stringify(interview)
              : null,

            phone || null,

            portfolioUrl || null,

            message || null

          ]

        );


      if (result.rows.length === 0) {

        return res.status(404).json({

          success: false,

          errors: [
            'Application not found, or already submitted.'
          ]

        });

      }


      return res.json({

        success: true,

        id: result.rows[0].id,

        updatedAt:
          result.rows[0].updated_at

      });


    } catch (err) {

      console.error(
        'update error',
        err
      );


      return res.status(500).json({

        success: false,

        errors: [
          'Something went wrong. Please try again.'
        ]

      });

    }

  }
);


/* ==================================================
   RETRIEVE / RESUME APPLICATION
================================================== */

app.get(
  '/api/applications/:id',

  async (req, res) => {

    if (!pool) {

      return res.status(503).json({

        success: false,

        errors: [
          'Database is not configured.'
        ]

      });

    }


    try {

      const result =
        await pool.query(

          `SELECT *
           FROM applications
           WHERE id = $1`,

          [req.params.id]

        );


      if (result.rows.length === 0) {

        return res.status(404).json({

          success: false,

          errors: [
            'Application not found.'
          ]

        });

      }


      return res.json({

        success: true,

        application:
          result.rows[0]

      });


    } catch (err) {

      console.error(
        'fetch error',
        err
      );


      return res.status(500).json({

        success: false,

        errors: [
          'Something went wrong. Please try again.'
        ]

      });

    }

  }
);


/* ==================================================
   FINAL SUBMISSION
================================================== */

/*
 * Server-side validation is mandatory.
 *
 * The frontend may perform user-friendly checks,
 * but the server independently verifies that the
 * application is complete before submission.
 *
 * Submission is idempotent:
 *
 * submitted application
 * → returns existing confirmation
 *
 * no duplicate application is created.
 */

app.post(
  '/api/applications/:id/submit',

  async (req, res) => {

    if (!pool) {

      return res.status(503).json({

        success: false,

        errors: [
          'Database is not configured.'
        ]

      });

    }


    try {

      const existing =
        await pool.query(

          `SELECT

            id,

            status,

            submitted_at,

            full_name,

            email,

            role,

            consent,

            producer_dna,

            portfolio,

            interview

           FROM applications

           WHERE id = $1`,

          [req.params.id]

        );


      if (existing.rows.length === 0) {

        return res.status(404).json({

          success: false,

          errors: [
            'Application not found.'
          ]

        });

      }


      const application =
        existing.rows[0];


      /*
       * IDEMPOTENT SUCCESS
       */

      if (application.status === 'submitted') {

        return res.status(200).json({

          success: true,

          id:
            application.id,

          submittedAt:
            application.submitted_at,

          alreadySubmitted:
            true

        });

      }


      const errors = [];


      /*
       * CORE IDENTITY
       */

      if (
        !application.full_name ||
        application.full_name.trim().length < 2
      ) {

        errors.push(
          'Full name is required.'
        );

      }


      if (
        !EMAIL_REGEX.test(
          application.email || ''
        )
      ) {

        errors.push(
          'A valid email is required.'
        );

      }


      if (
        !application.role ||
        application.role.trim().length < 2
      ) {

        errors.push(
          'Producer genre/role is required.'
        );

      }


      /*
       * CONSENT
       */

      if (
        application.consent !== true
      ) {

        errors.push(
          'Consent is required.'
        );

      }


      /*
       * PRODUCER DNA
       */

      const dna =
        application.producer_dna || {};


      if (

        !dna.sound ||

        !dna.influences ||

        !dna.strength ||

        !dna.mission

      ) {

        errors.push(
          'Producer DNA must be completed.'
        );

      }


      /*
       * PORTFOLIO / TOP 3
       */

      const portfolio =
        application.portfolio || {};


      if (

        !portfolio.top1 ||

        !portfolio.top2 ||

        !portfolio.top3

      ) {

        errors.push(
          'Three portfolio entries are required.'
        );

      }


      /*
       * INTERVIEW
       */

      const interview =
        application.interview || {};


      if (
        interview.completed !== true
      ) {

        errors.push(
          'A completed interview is required.'
        );

      }


      /*
       * BLOCK INVALID SUBMISSION
       */

      if (errors.length > 0) {

        return res.status(400).json({

          success: false,

          errors

        });

      }


      /*
       * ATOMIC SUBMISSION
       */

      const result =
        await pool.query(

          `UPDATE applications

           SET

             status = 'submitted',

             submitted_at = now(),

             updated_at = now()

           WHERE

             id = $1

             AND status = 'draft'

           RETURNING
             id,
             submitted_at`,

          [req.params.id]

        );


      /*
       * Protect against concurrent submit requests.
       */

      if (result.rows.length === 0) {

        const latest =
          await pool.query(

            `SELECT
              id,
              status,
              submitted_at
             FROM applications
             WHERE id = $1`,

            [req.params.id]

          );


        if (

          latest.rows.length > 0 &&

          latest.rows[0].status === 'submitted'

        ) {

          return res.status(200).json({

            success: true,

            id:
              latest.rows[0].id,

            submittedAt:
              latest.rows[0].submitted_at,

            alreadySubmitted:
              true

          });

        }


        return res.status(409).json({

          success: false,

          errors: [
            'Application could not be submitted. Please retry.'
          ]

        });

      }


      /*
       * SERVER-CONFIRMED SUCCESS
       */

      return res.status(200).json({

        success: true,

        id:
          result.rows[0].id,

        submittedAt:
          result.rows[0].submitted_at

      });


    } catch (err) {

      console.error(
        'submit error',
        err
      );


      return res.status(500).json({

        success: false,

        errors: [
          'Something went wrong. Please try again.'
        ]

      });

    }

  }
);


/* ==================================================
   FRONTEND FALLBACK
================================================== */

app.get(
  '*',

  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );

  }
);


/* ==================================================
   START
================================================== */

async function start() {

  try {

    await runMigration();

    console.log(

      pool

        ? 'Database migration applied.'

        : 'DATABASE_URL not set — skipping migration.'

    );

  } catch (err) {

    console.error(
      'Migration failed:',
      err.message
    );

  }


  app.listen(
    PORT,

    () => {

      console.log(

        `AMP Producer Registration Funnel running on port ${PORT}`

      );

    }
  );

}


start();
