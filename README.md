# openclaw-github-intake

GitHub App webhook intake service for The-Sher-Agency org.

## What it does

- **New repo created:** Makes it private, enables branch protection on `main`, registers in Google Sheets, notifies Slack
- **PR opened/merged:** Updates Google Sheets last activity, notifies Slack
- **Push events:** Updates Google Sheets last activity

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_APP_ID` | GitHub App ID (3109474) |
| `GITHUB_APP_PRIVATE_KEY` | RSA private key content (newlines as `\n`) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | Path to PEM file (alternative to inline key) |
| `GITHUB_INSTALLATION_ID` | Installation ID (116907903) |
| `WEBHOOK_SECRET` | Secret for validating webhook signatures |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON content of service account credentials |
| `GOOGLE_SERVICE_ACCOUNT_PATH` | Path to service account JSON (alternative) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `PROJECT_REGISTRY_SHEET_ID` | Google Sheets ID (auto-set on first run) |
| `PORT` | HTTP port (default: 3000) |

## Local Development

```bash
npm install
cp .env.example .env  # fill in values
npm start
```

## Webhook Configuration

Configure the GitHub App webhook to point to:
- URL: `https://your-app.ondigitalocean.app/webhook`
- Secret: value of `WEBHOOK_SECRET`
- Events: Repository (created), Pull Request, Push

## Deployment

Deployed on DigitalOcean App Platform. Auto-deploys on push to `main`.
