/**
 * GitHub App Intake Service
 * Receives webhooks from The-Sher-Agency GitHub org
 */
require('dotenv').config();

const express = require('express');
const { verifySignature, handleRepoCreated, handlePullRequest, handlePush } = require('./webhook-handler');

const app = express();
const PORT = process.env.PORT || 8080;

// Capture raw body for HMAC signature verification
app.use((req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
});

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'openclaw-github-intake',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GitHub webhook endpoint
app.post('/webhook', async (req, res) => {
  // Verify signature
  if (!verifySignature(req)) {
    console.warn('[webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  const deliveryId = req.headers['x-github-delivery'];
  const payload = req.body;

  console.log(`[webhook] Received: ${event} (delivery: ${deliveryId})`);

  // Respond quickly to avoid GitHub timeout
  res.status(200).json({ status: 'processing', event, deliveryId });

  // Process async
  try {
    if (event === 'repository' && payload.action === 'created') {
      await handleRepoCreated(payload);
    } else if (event === 'pull_request') {
      await handlePullRequest(payload);
    } else if (event === 'push') {
      await handlePush(payload);
    } else {
      console.log(`[webhook] Unhandled event: ${event}/${payload.action}`);
    }
  } catch (err) {
    console.error(`[webhook] Error processing ${event}:`, err);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[server] GitHub Intake Service running on port ${PORT}`);
  console.log(`[server] Webhook endpoint: POST /webhook`);
  console.log(`[server] App ID: ${process.env.GITHUB_APP_ID}`);
  console.log(`[server] Installation ID: ${process.env.GITHUB_INSTALLATION_ID}`);
  console.log(`[server] Webhook secret configured: ${!!(process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET)}`);
  console.log(`[server] Slack configured: ${!!(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL)}`);
  console.log(`[server] Google Sheets configured: ${!!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT_PATH)}`);
  console.log(`[server] Sheet ID: ${process.env.GOOGLE_SHEET_ID || 'will create on first use'}`);
});
