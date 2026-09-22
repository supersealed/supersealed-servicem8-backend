const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { kv } = require('@vercel/kv');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' })); // dashboard enquiry history can grow past the 100kb default

// Configuration
const SERVICEM8_API_KEY = process.env.SERVICEM8_API_KEY || '';
const SERVICEM8_BASE_URL = 'https://api.servicem8.com/api_1.0';

// Create axios instance for ServiceM8 API
const servicem8Client = axios.create({
    baseURL: SERVICEM8_BASE_URL,
    headers: {
          'X-API-Key': SERVICEM8_API_KEY,
          'Content-Type': 'application/json'
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Verify API connection
app.get('/api/verify', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    const response = await servicem8Client.get('/job.json');
          res.json({
                  status: 'verified',
                  message: 'Successfully connected to ServiceM8 API',
                  apiVersion: '1.0'
          });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to verify ServiceM8 API connection',
                  error: error.message
          });
    }
});

// Get all jobs (optional ?filter= for ServiceM8 $filter query syntax)
app.get('/api/jobs', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    let endpoint = '/job.json';
          if (req.query.filter) {
                  endpoint += `?$filter=${encodeURIComponent(req.query.filter)}`;
          }

    const response = await servicem8Client.get(endpoint);

    res.json({
          status: 'success',
          count: response.data.length,
          jobs: response.data
    });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to retrieve jobs from ServiceM8 API',
                  error: error.message
          });
    }
});

// Get specific job by ID
app.get('/api/jobs/:jobId', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    const { jobId } = req.params;
          const response = await servicem8Client.get(`/job/${jobId}.json`);

    res.json({
          status: 'success',
          job: response.data
    });
    } catch (error) {
          if (error.response?.status === 404) {
                  return res.status(404).json({
                            status: 'error',
                            message: 'Job not found'
                  });
          }

    res.status(500).json({
          status: 'error',
          message: 'Failed to retrieve job from ServiceM8 API',
          error: error.message
    });
    }
});

// Get all companies (optional ?filter=)
app.get('/api/companies', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    let endpoint = '/company.json';
          if (req.query.filter) {
                  endpoint += `?$filter=${encodeURIComponent(req.query.filter)}`;
          }

    const response = await servicem8Client.get(endpoint);

    res.json({
          status: 'success',
          count: response.data.length,
          companies: response.data
    });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to retrieve companies from ServiceM8 API',
                  error: error.message
          });
    }
});

// Get specific company by ID
app.get('/api/companies/:companyId', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    const { companyId } = req.params;
          const response = await servicem8Client.get(`/company/${companyId}.json`);

    res.json({
          status: 'success',
          company: response.data
    });
    } catch (error) {
          if (error.response?.status === 404) {
                  return res.status(404).json({
                            status: 'error',
                            message: 'Company not found'
                  });
          }

    res.status(500).json({
          status: 'error',
          message: 'Failed to retrieve company from ServiceM8 API',
          error: error.message
    });
    }
});

// Get all badges (read-only) - used to resolve the UUIDs in a job's
// "badges" field to their names (e.g. lead-source badges like "Google Ads").
app.get('/api/badges', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    const response = await servicem8Client.get('/badge.json');

    res.json({
          status: 'success',
          count: response.data.length,
          badges: response.data
    });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to retrieve badges from ServiceM8 API',
                  error: error.message
          });
    }
});

// Get all job contacts (optional ?filter=) - bulk fetch, used to join name/phone/email onto jobs
app.get('/api/jobcontacts', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    let endpoint = '/jobcontact.json';
          if (req.query.filter) {
                  endpoint += `?$filter=${encodeURIComponent(req.query.filter)}`;
          }

    const response = await servicem8Client.get(endpoint);

    res.json({
          status: 'success',
          count: response.data.length,
          contacts: response.data
    });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to retrieve job contacts from ServiceM8 API',
                  error: error.message
          });
    }
});

// Get job contacts for one specific job
app.get('/api/jobcontacts/:jobId', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    const { jobId } = req.params;
          const filterVal = `job_uuid eq '${jobId}'`;
          const endpoint = `/jobcontact.json?$filter=${encodeURIComponent(filterVal)}`;
          const response = await servicem8Client.get(endpoint);

    res.json({
          status: 'success',
          count: response.data.length,
          contacts: response.data
    });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to retrieve job contacts from ServiceM8 API',
                  error: error.message
          });
    }
});

// Update job
app.put('/api/jobs/:jobId', async (req, res) => {
    try {
          if (!SERVICEM8_API_KEY) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'SERVICEM8_API_KEY environment variable is not set'
                  });
          }

    const { jobId } = req.params;
          const jobData = req.body;

    const response = await servicem8Client.put(`/job/${jobId}.json`, jobData);

    res.json({
          status: 'success',
          message: 'Job updated successfully',
          job: response.data
    });
    } catch (error) {
          if (error.response?.status === 404) {
                  return res.status(404).json({
                            status: 'error',
                            message: 'Job not found'
                  });
          }

    res.status(500).json({
          status: 'error',
          message: 'Failed to update job in ServiceM8 API',
          error: error.message
    });
    }
});

// ===== ADMIN DASHBOARD (SuperSealed staff tool) =====
// Everything below this line is new: a shared login gate plus a small
// store for the dashboard's own data (enquiries/notes/follow-ups). It
// does not touch or change any of the routes above.

// Simple shared-password gate (staff don't have individual accounts).
// Set DASHBOARD_USER / DASHBOARD_PASSWORD in Vercel's env vars.
function requireDashboardAuth(req, res, next) {
    const expectedUser = process.env.DASHBOARD_USER || '';
    const expectedPass = process.env.DASHBOARD_PASSWORD || '';

  if (!expectedUser || !expectedPass) {
        return res.status(500).send('Dashboard login is not configured yet (DASHBOARD_USER / DASHBOARD_PASSWORD missing).');
  }

  const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const sepIndex = decoded.indexOf(':');
        const user = decoded.slice(0, sepIndex);
        const pass = decoded.slice(sepIndex + 1);
        if (user === expectedUser && pass === expectedPass) {
                return next();
        }
  }

  res.set('WWW-Authenticate', 'Basic realm="SuperSealed Dashboard"');
    return res.status(401).send('Login required.');
}

// Get the shared enquiries list (the dashboard's own tracked data - not
// ServiceM8 data itself, which still comes live from /api/jobs etc.)
app.get('/api/enquiries', requireDashboardAuth, async (req, res) => {
    try {
          const enquiries = await kv.get('supersealed_enquiries');
          res.json({ status: 'success', enquiries: enquiries || [] });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to load enquiries from the shared store',
                  error: error.message
          });
    }
});

// Overwrite the shared enquiries list. The dashboard always sends the
// whole current list (matches how it worked with localStorage before).
app.put('/api/enquiries', requireDashboardAuth, async (req, res) => {
    try {
          const { enquiries } = req.body;
          if (!Array.isArray(enquiries)) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'Request body must include an "enquiries" array'
                  });
          }
          await kv.set('supersealed_enquiries', enquiries);
          res.json({ status: 'success', count: enquiries.length });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to save enquiries to the shared store',
                  error: error.message
          });
    }
});

// Get the shared daily checklists (morning/evening, keyed by date then by
// whatever name the staff member typed in - no fixed staff list, so it
// keeps working as people join or leave).
app.get('/api/checklists', requireDashboardAuth, async (req, res) => {
    try {
          const checklists = await kv.get('supersealed_checklists');
          res.json({ status: 'success', checklists: checklists || {} });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to load checklists from the shared store',
                  error: error.message
          });
    }
});

// Overwrite the shared checklists object. Same whole-object-every-time
// pattern as /api/enquiries.
app.put('/api/checklists', requireDashboardAuth, async (req, res) => {
    try {
          const { checklists } = req.body;
          if (!checklists || typeof checklists !== 'object' || Array.isArray(checklists)) {
                  return res.status(400).json({
                            status: 'error',
                            message: 'Request body must include a "checklists" object'
                  });
          }
          await kv.set('supersealed_checklists', checklists);
          res.json({ status: 'success' });
    } catch (error) {
          res.status(500).json({
                  status: 'error',
                  message: 'Failed to save checklists to the shared store',
                  error: error.message
          });
    }
});

// Serve the dashboard page itself
app.get('/dashboard', requireDashboardAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ===== END ADMIN DASHBOARD =====

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
          status: 'error',
          message: 'Internal server error',
          error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
    });
});

module.exports = app;
