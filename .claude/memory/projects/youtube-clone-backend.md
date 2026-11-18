---
name: youtube-clone-backend
description: Backend server for YouTube clone with Google login and personalized feed
metadata:
  type: project
---

# YouTube Clone Backend

A Node.js HTTP server for the YouTube Clone app with:
- Dynamic home feed served from YouTube API
- Google OAuth login endpoint (optional)
- User preferences and watch history (SQLite)
- CORS support for API access

## Endpoints

| Endpoint | Description |
|----------|-------------|
| GET /api/config | Get app configuration |
| GET /api/feed/home | Get personalized home feed |
| GET /api/auth/google | Get Google OAuth URL |

## Environment Variables

- `GOOGLE_CLIENT_ID` - Google OAuth client ID (optional)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret (optional)
- `PORT` - Server port (default: 8080)
- `HOST` - Server host (default: 0.0.0.0)
- `BASE_URL` - External URL for OAuth callbacks

## Deployment

Deploy via GitHub Actions to Railway using secrets:
- `RAILWAY_SERVICE_ID`
- `RAILWAY_TOKEN`