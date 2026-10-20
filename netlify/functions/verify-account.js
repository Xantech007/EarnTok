const axios = require('axios');

/**
 * verify-account  (Netlify function)
 *
 * One endpoint for every account lookup on the withdraw page.
 *
 *   GET /.netlify/functions/verify-account?type=bank&country=NG&account_number=0123456789
 *   GET /.netlify/functions/verify-account?type=bank&country=GH&account_number=1234567890123
 *   GET /.netlify/functions/verify-account?type=momo&country=GH&phone=0241234567
 *
 * Query params
 *   type            "bank" (default) | "momo"
 *   country         "NG" (default) | "GH"          (momo is GH only)
 *   account_number  bank account number            (bank)
 *   phone           mobile money number            (momo, local 0XXXXXXXXX or +233 / 233 format)
 *   bank_name       optional - only check this one bank / network (exact name from the dropdown)
 *
 * Success (200)
 *   { status: true, count: n, data: [{ bankName, provider, bankCode, accountName, accountNumber }] }
 *   `bankName` and `provider` are the same value and always equal an option in the page dropdowns,
 *   so the page can select it directly. Several entries means the same number exists at several
 *   banks (e.g. Opay, PalmPay, Moniepoint) and the user picks the right one.
 *
 * Errors
 *   400 bad input | 404 nothing found | 405 wrong method | 500 not configured | 502 Paystack unreachable
 *
 * Environment variables
 *   PAYSTACK_SECRET_KEY      required
 *   PAYSTACK_SECRET_KEY_GH   optional - Ghana-registered Paystack key, used for country=GH.
 *                            Falls back to PAYSTACK_SECRET_KEY.
 */

const PAYSTACK_API = 'https://api.paystack.co';
const CONCURRENCY = 32;            // parallel Paystack calls per lookup
const REQUEST_TIMEOUT = 4000;      // ms per Paystack call
const BANK_LIST_TTL = 6 * 60 * 60 * 1000; // cache the Ghana bank list for 6 hours

// ---------------------------------------------------------------------------
// Nigeria: banks mapped directly to Paystack bank codes (names match the page dropdown exactly)
// ---------------------------------------------------------------------------
const NG_BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'Access Bank (Diamond)', code: '063' },
  { name: 'ALAT by Wema', code: '035A' },
  { name: 'ASO Savings and Loans', code: '401' },
  { name: 'Bowen Microfinance Bank', code: '50931' },
  { name: 'CEMCS Microfinance Bank', code: '50823' },
  { name: 'Citibank Nigeria', code: '023' },
  { name: 'Coronation Merchant Bank', code: '559' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Ekondo Microfinance Bank', code: '562' },
  { name: 'Eyowo', code: '50126' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'Firmus MFB', code: '51314' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank', code: '214' },
  { name: 'FSDH Merchant Bank', code: '501' },
  { name: 'Globus Bank', code: '00103' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Hackman Microfinance Bank', code: '51251' },
  { name: 'Hasal Microfinance Bank', code: '50383' },
  { name: 'Heritage Bank', code: '030' },
  { name: 'Ibile Microfinance Bank', code: '51240' },
  { name: 'Infinity Microfinance Bank', code: '50457' },
  { name: 'Jaiz Bank', code: '301' },
  { name: 'Kadpoly Microfinance Bank', code: '50502' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Microfinance Bank', code: '50211' },
  { name: 'Lagos Building Investment Company', code: '90052' },
  { name: 'Links MFB', code: '50549' },
  { name: 'Lotus Bank', code: '303' },
  { name: 'Mayfair MFB', code: '50563' },
  { name: 'Mint MFB', code: '50304' },
  { name: 'Moniepoint', code: '50515' },
  { name: 'NPF Microfinance Bank', code: '50629' },
  { name: 'Opay', code: '999992' },
  { name: 'Paga', code: '100002' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Parallex Bank', code: '526' },
  { name: 'Parkway - ReadyCash', code: '311' },
  { name: 'Paycom', code: '305' },
  { name: 'Petra Microfinance Bank', code: '50746' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'PremiumTrust Bank', code: '000031' },
  { name: 'Providus Bank', code: '101' },
  { name: 'QuickFund MFB', code: '51293' },
  { name: 'Rand Merchant Bank', code: '502' },
  { name: 'Rubies Bank', code: '125' },
  { name: 'Signature Bank', code: '000034' },
  { name: 'Sparkle Bank', code: '51310' },
  { name: 'Stanbic IBTC Bank', code: '221' },
  { name: 'Standard Chartered Bank', code: '068' },
  { name: 'Sterling Bank', code: '232' },
  { name: 'SunTrust Bank', code: '100' },
  { name: 'TAJBank', code: '302' },
  { name: 'Tanadi Microfinance Bank', code: '51269' },
  { name: 'Titan Trust Bank', code: '102' },
  { name: 'U&C Microfinance Bank', code: '50840' },
  { name: 'Union Bank of Nigeria', code: '032' },
  { name: 'United Bank for Africa', code: '033' },
  { name: 'Unity Bank', code: '215' },
  { name: 'VFD Microfinance Bank', code: '566' },
  { name: 'Wema Bank', code: '035' },
  { name: 'Zenith Bank', code: '057' },
  { name: '9 Payment Service Bank', code: '120001' }
];

// ---------------------------------------------------------------------------
// Ghana banks. Paystack advises against hardcoding Ghana codes, so the bank list is fetched from
// Paystack (GET /bank?country=ghana) and each dropdown name below is matched to Paystack's entry
// by pattern. `name` MUST stay identical to the option text on the withdraw page.
// ---------------------------------------------------------------------------
const GH_BANK_MATCHERS = [
  { name: 'Absa Bank Ghana', pattern: /absa|barclays/ },
  { name: 'Access Bank Ghana', pattern: /access/ },
  { name: 'Agricultural Development Bank (ADB)', pattern: /agricultural|\badb\b/ },
  { name: 'Bank of Africa Ghana', pattern: /bank of africa|\bboa\b/ },
  { name: 'CalBank', pattern: /cal ?bank|\bcal\b/ },
  { name: 'Consolidated Bank Ghana (CBG)', pattern: /consolidated|\bcbg\b/ },
  { name: 'Ecobank Ghana', pattern: /ecobank/ },
  { name: 'Fidelity Bank Ghana', pattern: /fidelity/ },
  { name: 'First Atlantic Bank', pattern: /first atlantic/ },
  { name: 'First National Bank Ghana', pattern: /first national|\bfnb\b/ },
  { name: 'GCB Bank', pattern: /gcb|ghana commercial/ },
  { name: 'GTBank Ghana', pattern: /gtbank|guaranty trust|\bgtb\b/ },
  { name: 'National Investment Bank (NIB)', pattern: /national investment|\bnib\b/ },
  { name: 'OmniBSIC Bank', pattern: /omni/ },
  { name: 'Prudential Bank', pattern: /prudential/ },
  { name: 'Republic Bank Ghana', pattern: /republic/ },
  { name: 'Societe Generale Ghana', pattern: /societe generale|\bsg\b/ },
  { name: 'Stanbic Bank Ghana', pattern: /stanbic/ },
  { name: 'Standard Chartered Bank Ghana', pattern: /standard chartered/ },
  { name: 'United Bank for Africa (UBA) Ghana', pattern: /united bank for africa|\buba\b/ },
  { name: 'Universal Merchant Bank (UMB)', pattern: /universal merchant|\bumb\b/ },
  { name: 'Zenith Bank Ghana', pattern: /zenith/ }
];

// ---------------------------------------------------------------------------
// Ghana mobile money networks (Paystack mobile money codes). `name` matches the page's Network dropdown.
// ---------------------------------------------------------------------------
const GH_MOMO_NETWORKS = [
  { name: 'MTN MoMo', code: 'MTN' },
  { name: 'Telecel Cash', code: 'VOD' },
  { name: 'AirtelTigo Money', code: 'ATL' }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const respond = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const plain = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

// Run `fn` over `items` with at most `limit` calls in flight. Result order matches `items`.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Ask Paystack who owns `accountNumber` at `bankCode`.
// Returns { accountName } on success, otherwise { serviceError } (true = Paystack/network problem,
// false = the account simply doesn't exist at that bank).
async function resolveAccount(secret, accountNumber, bankCode) {
  try {
    const res = await axios.get(`${PAYSTACK_API}/bank/resolve`, {
      params: { account_number: accountNumber, bank_code: bankCode },
      headers: { Authorization: `Bearer ${secret}` },
      timeout: REQUEST_TIMEOUT
    });
    const accountName = res.data && res.data.status && res.data.data && res.data.data.account_name;
    return accountName ? { accountName: String(accountName).trim() } : { serviceError: false };
  } catch (error) {
    const status = error.response && error.response.status;
    return { serviceError: !status || status === 401 || status === 403 || status === 429 || status >= 500 };
  }
}

// Ghana bank list from Paystack, cached while the function instance stays warm.
let ghanaBankCache = { at: 0, banks: null };
async function getGhanaBanks(secret) {
  if (ghanaBankCache.banks && Date.now() - ghanaBankCache.at < BANK_LIST_TTL) return ghanaBankCache.banks;
  const res = await axios.get(`${PAYSTACK_API}/bank`, {
    params: { country: 'ghana', currency: 'GHS', perPage: 100 },
    headers: { Authorization: `Bearer ${secret}` },
    timeout: REQUEST_TIMEOUT
  });
  const banks = ((res.data && res.data.data) || []).filter((bank) => bank && bank.code && bank.type !== 'mobile_money');
  if (!banks.length) throw new Error('Empty Ghana bank list');
  ghanaBankCache = { at: Date.now(), banks };
  return banks;
}

function matchGhanaBanks(paystackBanks) {
  const targets = [];
  for (const matcher of GH_BANK_MATCHERS) {
    const found = paystackBanks.find((bank) => matcher.pattern.test(plain(bank.name)));
    if (found) targets.push({ name: matcher.name, code: String(found.code) });
    else console.warn(`verify-account: no Paystack Ghana bank matched "${matcher.name}"`);
  }
  return targets;
}

// 0XXXXXXXXX, +233XXXXXXXXX and 233XXXXXXXXX -> 0XXXXXXXXX
function normalizeGhanaPhone(raw) {
  let value = String(raw || '').replace(/[\s-]/g, '');
  if (value.startsWith('+233')) value = `0${value.slice(4)}`;
  else if (value.startsWith('233') && value.length === 12) value = `0${value.slice(3)}`;
  return /^0\d{9}$/.test(value) ? value : '';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return respond(405, { status: false, message: 'Method not allowed' });
  }

  const query = event.queryStringParameters || {};
  const country = String(query.country || 'NG').trim().toUpperCase();
  const type = String(query.type || 'bank').trim().toLowerCase() === 'momo' ? 'momo' : 'bank';
  const onlyProvider = String(query.bank_name || '').trim().toLowerCase();

  if (!['NG', 'GH'].includes(country)) {
    return respond(400, { status: false, message: 'Unsupported country' });
  }

  // ----- validate the number -----
  let accountNumber;
  if (type === 'momo') {
    if (country !== 'GH') {
      return respond(400, { status: false, message: 'Mobile money lookup is only available for Ghana' });
    }
    accountNumber = normalizeGhanaPhone(query.phone || query.account_number);
    if (!accountNumber) {
      return respond(400, { status: false, message: 'Valid Ghana mobile money number required' });
    }
  } else {
    accountNumber = String(query.account_number || '').replace(/[\s-]/g, '');
    const validLength = country === 'NG' ? accountNumber.length === 10 : accountNumber.length >= 10 && accountNumber.length <= 16;
    if (!/^\d+$/.test(accountNumber) || !validLength) {
      return respond(400, {
        status: false,
        message: country === 'NG' ? 'Valid 10-digit account number required' : 'Valid account number (10-16 digits) required'
      });
    }
  }

  const secret = (country === 'GH' && process.env.PAYSTACK_SECRET_KEY_GH) || process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return respond(500, { status: false, message: 'Verification service is not configured' });
  }

  try {
    // ----- work out which banks / networks to check -----
    let targets;
    if (type === 'momo') {
      targets = GH_MOMO_NETWORKS;
    } else if (country === 'NG') {
      targets = NG_BANKS;
    } else {
      targets = matchGhanaBanks(await getGhanaBanks(secret));
    }
    if (onlyProvider) targets = targets.filter((target) => target.name.toLowerCase() === onlyProvider);

    // ----- check them all -----
    const results = await mapLimit(targets, CONCURRENCY, async (target) => {
      const outcome = await resolveAccount(secret, accountNumber, target.code);
      return { target, ...outcome };
    });

    const matches = results
      .filter((result) => result.accountName)
      .map(({ target, accountName }) => ({
        bankName: target.name,
        provider: target.name,
        bankCode: target.code,
        accountName,
        accountNumber
      }));

    if (matches.length === 0) {
      // Every call failed for a service reason (bad key, rate limit, timeout...): not "account not found"
      if (results.length > 0 && results.every((result) => result.serviceError)) {
        return respond(502, { status: false, message: 'Verification service error' });
      }
      return respond(404, {
        status: false,
        message: type === 'momo'
          ? 'No active mobile money account found for this number'
          : 'No active account found across supported banks'
      });
    }

    return respond(200, { status: true, count: matches.length, data: matches });
  } catch (error) {
    console.error('verify-account failed:', error.message);
    return respond(502, { status: false, message: 'Verification service error' });
  }
};
