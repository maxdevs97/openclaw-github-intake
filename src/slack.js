/**
 * Slack notifications
 * Supports both Bot Token (chat.postMessage) and Webhook URL
 */
const axios = require('axios');

const DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL || 'D0ADEL2FRCM'; // Max's DM fallback

/**
 * Send a Slack message to a specific channel (or default if not provided)
 */
async function sendSlackMessage(text, blocks = null, targetChannel = null) {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const channel = targetChannel || DEFAULT_CHANNEL;

  if (!botToken && !webhookUrl) {
    console.log('[slack] No Slack credentials configured, skipping notification');
    return;
  }

  try {
    if (botToken) {
      // Auto-join channel before posting (required for public channels)
      try {
        await axios.post('https://slack.com/api/conversations.join', { channel }, {
          headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' }
        });
      } catch (_) { /* ignore join errors — might already be in channel or it's a DM */ }

      const payload = {
        channel,
        text,
        ...(blocks ? { blocks } : {})
      };
      const response = await axios.post('https://slack.com/api/chat.postMessage', payload, {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.data.ok) {
        console.error('[slack] API error:', response.data.error);
        throw new Error(`Slack API error: ${response.data.error}`);
      }
    } else {
      // Use incoming webhook (no channel targeting)
      const payload = { text };
      if (blocks) payload.blocks = blocks;
      await axios.post(webhookUrl, payload);
    }
    console.log(`[slack] Notification sent to ${channel}`);
  } catch (err) {
    console.error('[slack] Failed to send notification:', err.message);
  }
}

/**
 * Notify about a new repo registration
 * @param {object} opts
 * @param {string} opts.repoName
 * @param {string} opts.repoUrl
 * @param {string} opts.orgName
 * @param {string} [opts.creatorLogin]
 * @param {string} [opts.clientName]
 * @param {string} [opts.sheetUrl]
 * @param {string} [opts.targetChannelId] — channel to post to (falls back to default)
 */
async function notifyNewRepo({ repoName, repoUrl, orgName, creatorLogin, clientName, sheetUrl, branchProtection, targetChannelId }) {
  // Build status line dynamically based on what actually succeeded
  const statusParts = [];
  if (branchProtection) statusParts.push('Branch protection on `main`');
  statusParts.push('Private');
  if (sheetUrl) statusParts.push(`<${sheetUrl}|View Project Registry>`);

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🚀 New Project Registered'
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Repo:*\n<${repoUrl}|${orgName}/${repoName}>`
        },
        {
          type: 'mrkdwn',
          text: `*Client:*\n${clientName || creatorLogin || 'Unknown'}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: statusParts.join(' • ')
      }
    }
  ];

  await sendSlackMessage(`New project registered: ${orgName}/${repoName}`, blocks, targetChannelId);
}

/**
 * Notify about PR activity
 * @param {object} opts
 * @param {string} [opts.targetChannelId] — if provided, posts there; otherwise uses default
 */
async function notifyPRActivity({ action, repoName, prTitle, prUrl, prNumber, author, orgName, targetChannelId }) {
  const emoji = action === 'closed' ? '✅' : '🔔';
  const actionLabel = action === 'closed' ? 'PR Merged' : 'PR Opened';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${actionLabel}* in <https://github.com/${orgName}/${repoName}|${orgName}/${repoName}>\n<${prUrl}|#${prNumber}: ${prTitle}> by *${author}*`
      }
    }
  ];

  // Add action buttons for opened PRs (not for merged/closed)
  if (action === 'opened') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 Review Changes', emoji: true },
          url: `${prUrl}/files`,
          action_id: 'github:review_pr'
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔀 Merge with Main', emoji: true },
          style: 'primary',
          action_id: 'github:merge_pr',
          value: JSON.stringify({ orgName, repoName, prNumber }),
          confirm: {
            title: { type: 'plain_text', text: 'Merge PR?' },
            text: { type: 'mrkdwn', text: `Merge *#${prNumber}: ${prTitle}* into \`main\`?` },
            confirm: { type: 'plain_text', text: 'Merge' },
            deny: { type: 'plain_text', text: 'Cancel' }
          }
        }
      ]
    });
  }

  await sendSlackMessage(`${actionLabel}: ${repoName} #${prNumber}`, blocks, targetChannelId);
}

/**
 * Get list of Slack channels via conversations.list API
 * Returns array of { id, name }
 */
async function getSlackChannels() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error('SLACK_BOT_TOKEN is required');
  }

  const channels = [];
  let cursor = null;

  do {
    const params = new URLSearchParams({
      limit: '1000',
      exclude_archived: 'true',
      types: 'public_channel'
    });
    if (cursor) params.append('cursor', cursor);

    const response = await axios.get(`https://slack.com/api/conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${botToken}` }
    });

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    for (const ch of response.data.channels || []) {
      channels.push({ id: ch.id, name: ch.name });
    }

    cursor = response.data.response_metadata?.next_cursor || null;
  } while (cursor);

  channels.sort((a, b) => a.name.localeCompare(b.name));
  return channels;
}

module.exports = { sendSlackMessage, notifyNewRepo, notifyPRActivity, getSlackChannels };
