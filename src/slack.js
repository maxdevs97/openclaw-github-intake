/**
 * Slack notifications
 * Supports both Bot Token (chat.postMessage) and Webhook URL
 */
const axios = require('axios');

async function sendSlackMessage(text, blocks = null) {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const channel = process.env.SLACK_DEFAULT_CHANNEL || 'D0ADEL2FRCM'; // Max's DM

  if (!botToken && !webhookUrl) {
    console.log('[slack] No Slack credentials configured, skipping notification');
    return;
  }

  try {
    if (botToken) {
      // Use Slack Web API
      const payload = {
        channel,
        text,
        ...(blocks ? { blocks } : {})
      };
      await axios.post('https://slack.com/api/chat.postMessage', payload, {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      // Use incoming webhook
      const payload = { text };
      if (blocks) payload.blocks = blocks;
      await axios.post(webhookUrl, payload);
    }
    console.log('[slack] Notification sent');
  } catch (err) {
    console.error('[slack] Failed to send notification:', err.message);
  }
}

async function notifyNewRepo({ repoName, repoUrl, orgName, creatorLogin, sheetUrl }) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🚀 New Repository Created'
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
          text: `*Created by:*\n${creatorLogin || 'Unknown'}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Branch protection enabled on \`main\` • Private • <${sheetUrl}|View Project Registry>`
      }
    }
  ];

  await sendSlackMessage(`New repo created: ${orgName}/${repoName}`, blocks);
}

async function notifyPRActivity({ action, repoName, prTitle, prUrl, prNumber, author, orgName }) {
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

  await sendSlackMessage(`${actionLabel}: ${repoName} #${prNumber}`, blocks);
}

module.exports = { sendSlackMessage, notifyNewRepo, notifyPRActivity };
