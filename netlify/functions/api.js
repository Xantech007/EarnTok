// netlify/functions/api.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const serverless = require('serverless-http');

const app = express();
app.use(cors());
app.use(express.json());

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  timeout: 6000
});

const COUNTRY_NAMES = { NG: 'nigeria', GH: 'ghana' };
const BANK_CACHE_TTL = 6 * 60 * 60 * 1000; // bank lists rarely change
const LOOKUP_BUDGET_MS = 8000;             // stay under Netlify's 10s default timeout
const bankCache = new Map();

// Used if Paystack's mobile-money list can't be fetched
const FALLBACK_MOMO = [
  { name: 'MTN Mobile Money', code: 'MTN', type: 'mobile_money' },
  { name: 'Vodafone Cash', code: 'VOD', type: 'mobile_money' },
  { name: 'AirtelTigo Money', code: 'ATL', type: 'mobile_money' }
];

// Nigerian fintech/MFB banks use non-standard Paystack codes, so the NUBAN
// checksum can't narrow them down. We try these by name as a fallback.
const NG_FINTECH_PATTERN = /opay|paycom|palmpay|kuda|moniepoint|carbon|vfd|sparkle|rubies|fairmoney|eyowo|9 ?payment|9psb|paga/i;

// ---------- helpers ----------

async function fetchBanks(countryCode, type) {
  const key = `${countryCode}:${type || 'all'}`;
  const cached = bankCache.get(key);
  if (cached && Date.now() - cached.at < BANK_CACHE_TTL) return cached.data;

  const rows = [];
  let next = null;
  for (let page = 0; page < 10; page++) {
    const params = { country: COUNTRY_NAMES[countryCode], use_cursor: true, perPage: 100 };
    if (type) params.type = type;
    if (next) params.next = next;
    const response = await paystack.get('/bank', { params });
    const batch = Array.isArray(response.data?.data) ? response.data.data : [];
    rows.push(...batch);
    next = response.data?.meta?.next;
    if (!next || !batch.length) break;
  }

  const seen = new Set();
  const data = rows
    .filter(b => b && b.code && b.name && b.active !== false && !b.is_deleted)
    .map(b => ({ name: b.name, code: String(b.code), type: b.type }))
    .filter(b => (seen.has(b.code) ? false : seen.add(b.code)));

  bankCache.set(key, { at: Date.now(), data });
  return data;
}

// Try each candidate against Paystack's resolve endpoint; first match wins.
async function resolveFirst(candidates, accountNumber, { concurrency, deadline }) {
  let index = 0;
  let found = null;

  async function worker() {
    while (!found && index < candidates.length && Date.now() < deadline) {
      const bank = candidates[index++];
      try {
        const response = await paystack.get('/bank/resolve', {
          params: { account_number: accountNumber, bank_code: bank.code }
        });
        const name = response.data?.data?.account_name;
        if (response.data?.status && name && !found) {
          found = { bank, account_name: name, account_number: response.data.data.account_number || accountNumber };
        }
      } catch (error) {
        // Not an account at this bank (or transient error) - try the next one
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return found;
}

// NUBAN check digit: validates a 10-digit Nigerian account number against a 3-digit bank code
function nubanValid(bankCode, accountNumber) {
  const digits = bankCode + accountNumber.slice(0, 9);
  const weights = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * weights[i];
  let check = 10 - (sum % 10);
  if (check === 10) check = 0;
  return check === Number(accountNumber[9]);
}

function nigerianCandidates(banks, accountNumber) {
  const standard = banks.filter(b => /^\d{3}$/.test(b.code) && nubanValid(b.code, accountNumber));
  const fintech = banks.filter(b => !/^\d{3}$/.test(b.code) && NG_FINTECH_PATTERN.test(b.name)).slice(0, 12);
  return [...standard, ...fintech];
}

// Accepts 0XXXXXXXXX, 233XXXXXXXXX or +233XXXXXXXXX and returns 0XXXXXXXXX
function normalizeGhanaPhone(raw) {
  let value = String(raw || '').replace(/[\s\-()]/g, '');
  if (value.startsWith('+233')) value = `0${value.slice(4)}`;
  else if (value.startsWith('233') && value.length === 12) value = `0${value.slice(3)}`;
  return /^0\d{9}$/.test(value) ? value : '';
}

// ---------- routes ----------

const router = express.Router();

// Optional ?country=NG|GH and ?type=mobile_money. Defaults to Nigeria like before.
router.get('/banks', async (req, res) => {
  const country = String(req.query.country || 'NG').toUpperCase();
  if (!COUNTRY_NAMES[country]) {
    return res.status(400).json({ status: false, message: 'Unsupported country' });
  }
  try {
    const banks = await fetchBanks(country, req.query.type ? String(req.query.type) : undefined);
    res.json({ status: true, data: banks.map(b => ({ name: b.name, code: b.code })) });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to retrieve bank list' });
  }
});

router.get('/verify-account', async (req, res) => {
  const { account_number, bank_code } = req.query;
  if (!account_number || !bank_code) {
    return res.status(400).json({ status: false, message: 'Missing parameters' });
  }

  try {
    const response = await paystack.get('/bank/resolve', { params: { account_number, bank_code } });
    res.json({
      status: true,
      data: {
        account_number: response.data.data.account_number,
        account_name: response.data.data.account_name
      }
    });
  } catch (error) {
    res.status(422).json({
      status: false,
      message: error.response?.data?.message || 'Could not resolve account details'
    });
  }
});

// Ghana mobile money: phone number -> provider + account holder name
router.get('/resolve-momo', async (req, res) => {
  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  const country = String(req.query.country || 'GH').toUpperCase();
  if (country !== 'GH') {
    return res.status(400).json({ status: false, message: 'Mobile money lookup is only available for Ghana' });
  }
  const phone = normalizeGhanaPhone(req.query.phone);
  if (!phone) {
    return res.status(400).json({ status: false, message: 'Enter a valid Ghana mobile money number' });
  }

  try {
    let providers = [];
    try { providers = await fetchBanks('GH', 'mobile_money'); } catch (error) { /* use fallback */ }
    if (!providers.length) providers = FALLBACK_MOMO;

    const found = await resolveFirst(providers, phone, { concurrency: providers.length, deadline });
    if (!found) {
      return res.status(404).json({ status: false, message: 'Could not find a mobile money account for this number' });
    }
    res.json({
      status: true,
      data: {
        provider: found.bank.name,
        provider_code: found.bank.code,
        account_name: found.account_name,
        account_number: phone
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Mobile money lookup failed' });
  }
});

// Bank account number -> bank name + account holder name (NG and GH)
router.get('/resolve-bank', async (req, res) => {
  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  const country = String(req.query.country || '').toUpperCase();
  const accountNumber = String(req.query.account_number || '').replace(/\s/g, '');

  if (!COUNTRY_NAMES[country]) {
    return res.status(400).json({ status: false, message: 'Bank lookup is only available for Nigeria and Ghana' });
  }
  if (!/^\d{10,16}$/.test(accountNumber) || (country === 'NG' && accountNumber.length !== 10)) {
    return res.status(400).json({ status: false, message: 'Invalid account number' });
  }

  try {
    const banks = (await fetchBanks(country)).filter(b => b.type !== 'mobile_money');
    const candidates = country === 'NG' ? nigerianCandidates(banks, accountNumber) : banks;
    const found = await resolveFirst(candidates, accountNumber, { concurrency: 4, deadline });
    if (!found) {
      return res.status(404).json({ status: false, message: 'Could not find a bank account for this number' });
    }
    res.json({
      status: true,
      data: {
        bank_name: found.bank.name,
        bank_code: found.bank.code,
        account_name: found.account_name,
        account_number: found.account_number
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Bank lookup failed' });
  }
});

// Works whether called directly or through an /api/* redirect
app.use('/.netlify/functions/api', router);
app.use('/api', router);

module.exports.handler = serverless(app);
