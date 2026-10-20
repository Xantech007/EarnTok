import { getStore, connectLambda } from '@netlify/blobs';
import nodemailer from 'nodemailer';
import { createWelcomeEmail } from './welcome-email-template.js';

const FIREBASE_API_KEY = 'AIzaSyD-gMS-7WsLUNT8avQjQ4TTw0JN8uUtZVk';
const FIREBASE_PROJECT_ID = 'earntok-c08e3';
const MAX_NEW_ACCOUNT_AGE_MS = 15 * 60 * 1000;
const SITE_URL = 'https://earntok.online';

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        },
        body: JSON.stringify(body)
    };
}

function getBearerToken(event) {
    const authorization = event.headers?.authorization || event.headers?.Authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1] || '';
}

async function getFirebaseAccount(idToken) {
    const result = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
    });
    const data = await result.json();
    if (!result.ok || !data.users?.[0]) throw new Error('The Firebase sign-in token is invalid or expired.');
    const account = data.users[0];
    const createdAt = Number(account.createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_NEW_ACCOUNT_AGE_MS || createdAt > Date.now()) {
        throw new Error('Welcome email requests are only available immediately after registration.');
    }
    if (!account.localId || !account.email) throw new Error('The Firebase account does not have an email address.');
    return account;
}

async function getRegistrationDetails(idToken, uid) {
    const documentUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
    const result = await fetch(documentUrl, {
        headers: { 'Authorization': `Bearer ${idToken}` }
    });
    if (!result.ok) throw new Error('Could not verify the new user registration details.');
    const document = await result.json();
    const fields = document.fields || {};
    const value = fields.welcomeBonus;
    const rawBonus = value?.integerValue ?? value?.doubleValue;
    const bonus = Number(rawBonus);
    if (rawBonus === undefined) throw new Error('The saved welcome bonus is missing.');
    if (!Number.isSafeInteger(bonus) || bonus < 0) throw new Error('The saved welcome bonus is invalid.');
    return {
        welcomeBonus: bonus,
        name: fields.fullName?.stringValue || '',
        username: fields.username?.stringValue || ''
    };
}

function getSiteUrl() {
    return SITE_URL;
}

function createTransport() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT || 465);
    if (!host || !user || !pass || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Configure SMTP_USER and SMTP_PASS; SMTP_PORT must be a valid port if set.');
    }
    return {
        transport: nodemailer.createTransport({
            host,
            port,
            secure: process.env.SMTP_SECURE === undefined
                ? port === 465
                : process.env.SMTP_SECURE === 'true',
            auth: { user, pass }
        }),
        from: process.env.SMTP_FROM || user
    };
}

export const handler = async event => {
    connectLambda(event);

    if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed.' });
    // ...rest unchanged

    let requestBody;
    try {
        requestBody = JSON.parse(event.body || '{}');
    } catch {
        return response(400, { error: 'The request body must be valid JSON.' });
    }

    const idToken = getBearerToken(event);
    if (!idToken) return response(401, { error: 'Sign in before requesting a welcome email.' });

    let store;
    let deliveryKey;
    let reserved = false;
    try {
        const account = await getFirebaseAccount(idToken);
        const registration = await getRegistrationDetails(idToken, account.localId);
        const welcomeBonus = registration.welcomeBonus;
        const providedBonus = Number(requestBody.welcomeBonus);
        if (!Number.isSafeInteger(providedBonus) || providedBonus !== welcomeBonus) {
            return response(400, { error: 'The welcome bonus does not match the saved registration.' });
        }

        store = getStore('welcome-email-deliveries');
        deliveryKey = account.localId;
        const existing = await store.get(deliveryKey, { type: 'json' });
        if (existing) return response(200, { sent: true, alreadySent: true });

        await store.setJSON(deliveryKey, { status: 'sending', startedAt: new Date().toISOString() });
        reserved = true;

        const siteUrl = getSiteUrl();
        const email = createWelcomeEmail({
            name: registration.name || account.displayName || '',
            username: registration.username,
            welcomeBonus,
            siteUrl
        });
        const { transport, from } = createTransport();
        await transport.sendMail({
            from: { name: 'EarnTok', address: from },
            to: account.email,
            subject: email.subject,
            text: email.text,
            html: email.html
        });
        await store.setJSON(deliveryKey, { status: 'sent', sentAt: new Date().toISOString() });
        return response(200, { sent: true });
    } catch (error) {
        console.error('Unable to send registration welcome email:', error);
        if (reserved && store && deliveryKey) {
            try {
                await store.delete(deliveryKey);
            } catch (cleanupError) {
                console.error('Unable to release failed welcome email reservation:', cleanupError);
            }
        }
        const message = error instanceof Error ? error.message : 'Welcome email delivery failed.';
        return response(500, { error: message });
    }
};
