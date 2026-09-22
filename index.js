const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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

    // Make a simple API call to verify the connection
    const response = await servicem8Client.get('/client');
    
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

// Get all jobs
app.get('/api/jobs', async (req, res) => {
  try {
    if (!SERVICEM8_API_KEY) {
      return res.status(400).json({
        status: 'error',
        message: 'SERVICEM8_API_KEY environment variable is not set'
      });
    }

    const response = await servicem8Client.get('/job.json');
    
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SuperSealed ServiceM8 Backend running on port ${PORT}`);
  console.log(`API Base URL: ${SERVICEM8_BASE_URL}`);
});
