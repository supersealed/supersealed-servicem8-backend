# SuperSealed ServiceM8 Backend

Express.js backend for ServiceM8 API integration with SuperSealed Admin Dashboard.

## Endpoints

- `GET /api/health` - Health check
- `GET /api/verify` - Verify ServiceM8 API connection
- `GET /api/jobs` - Get all jobs
- `GET /api/jobs/:jobId` - Get specific job
- `PUT /api/jobs/:jobId` - Update job

## Environment Variables

- `SERVICEM8_API_KEY` - ServiceM8 API key for authentication

## Deployment

Deployed on Vercel. Configure `SERVICEM8_API_KEY` in Vercel project settings.
