import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};
const GEMINI_MODEL = 'gemini-3.6-flash';
const PASSKEY_CHALLENGE_TTL_SECONDS = 300;
const firebaseJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

function json(body, status = 200, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    });
  return origin && allowed.includes(origin) ? origin : null;
}

function assistantPrompt(question, snapshot) {
  return `You are the Wealth Assistant inside WealthRoute, a personal finance app.
Use only the supplied JSON snapshot. Do not invent figures or assume data that is absent.
This is general educational information, not personalised financial advice. Never promise investment returns.
Give a concise, concrete answer with practical next steps when the data supports them.

Financial snapshot:
${JSON.stringify(snapshot)}

Question: ${question}`;
}

function passkeyError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 100_000) throw passkeyError('Request is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw passkeyError('Request body must be valid JSON.');
  }
}

async function getSignedInUser(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw passkeyError('Sign in before managing passkeys.', 401);
  try {
    const { payload } = await jwtVerify(token, firebaseJwks, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Missing Firebase user ID.');
    return { uid: payload.sub };
  } catch {
    throw passkeyError('Your sign-in expired. Sign in again and retry.', 401);
  }
}

async function saveChallenge(env, challenge, uid, purpose) {
  const now = Math.floor(Date.now() / 1000);
  const challengeId = crypto.randomUUID();
  await env.PASSKEY_DB.prepare('DELETE FROM passkey_challenges WHERE expires_at <= ?').bind(now).run();
  await env.PASSKEY_DB.prepare(
    'INSERT INTO passkey_challenges (challenge_id, challenge, uid, purpose, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(challengeId, challenge, uid || null, purpose, now + PASSKEY_CHALLENGE_TTL_SECONDS).run();
  return challengeId;
}

async function consumeChallenge(env, challengeId, purpose) {
  if (typeof challengeId !== 'string' || !challengeId) throw passkeyError('Passkey challenge is missing or expired.');
  const now = Math.floor(Date.now() / 1000);
  const challenge = await env.PASSKEY_DB.prepare(
    'DELETE FROM passkey_challenges WHERE challenge_id = ? AND purpose = ? AND expires_at > ? RETURNING challenge, uid, purpose',
  ).bind(challengeId, purpose, now).first();
  if (!challenge) throw passkeyError('Passkey challenge is missing or expired.');
  return challenge;
}

async function firebaseCustomToken(uid, env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw passkeyError('Passkey sign-in is not configured yet.', 503);
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw passkeyError('Passkey sign-in is not configured yet.', 503);
  }
  if (serviceAccount.project_id !== env.FIREBASE_PROJECT_ID || !serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.private_key_id) {
    throw passkeyError('Passkey sign-in is not configured yet.', 503);
  }
  const privateKey = await importPKCS8(serviceAccount.private_key.replace(/\\n/g, '\n'), 'RS256');
  const customToken = await new SignJWT({ uid })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  return customToken;
}

async function handlePasskeyRequest(request, env, url, origin) {
  if (!env.PASSKEY_DB || !env.FIREBASE_PROJECT_ID || !env.PASSKEY_RP_ID || !env.PASSKEY_ORIGIN) {
    return json({ error: 'Passkey service is not configured.' }, 503, origin);
  }
  try {
    if (request.method === 'GET' && url.pathname === '/passkeys') {
      const user = await getSignedInUser(request, env);
      const result = await env.PASSKEY_DB.prepare(
        'SELECT credential_id, created_at, last_used_at FROM passkeys WHERE uid = ? ORDER BY created_at',
      ).bind(user.uid).all();
      return json({ passkeys: result.results || [] }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/passkeys/register/options') {
      const user = await getSignedInUser(request, env);
      const existing = await env.PASSKEY_DB.prepare(
        'SELECT credential_id, transports FROM passkeys WHERE uid = ?',
      ).bind(user.uid).all();
      if ((existing.results || []).length >= 10) throw passkeyError('This account already has the maximum number of passkeys.');
      const options = await generateRegistrationOptions({
        rpName: env.PASSKEY_RP_NAME || 'WealthRoute',
        rpID: env.PASSKEY_RP_ID,
        userID: new TextEncoder().encode(user.uid),
        userName: user.uid,
        userDisplayName: 'WealthRoute account',
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: (existing.results || []).map((item) => ({ id: item.credential_id, transports: JSON.parse(item.transports || '[]') })),
      });
      const challengeId = await saveChallenge(env, options.challenge, user.uid, 'register');
      return json({ challengeId, options }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/passkeys/register/verify') {
      const user = await getSignedInUser(request, env);
      const body = await readJson(request);
      const challenge = await consumeChallenge(env, body.challengeId, 'register');
      if (challenge.uid !== user.uid || !body.credential) throw passkeyError('Passkey registration could not be verified.', 403);
      const verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: env.PASSKEY_ORIGIN,
        expectedRPID: env.PASSKEY_RP_ID,
        requireUserVerification: true,
      });
      if (!verification.verified) throw passkeyError('Passkey registration could not be verified.', 403);
      const credential = verification.registrationInfo.credential;
      const transports = body.credential.response.transports || [];
      await env.PASSKEY_DB.prepare(
        'INSERT INTO passkeys (credential_id, uid, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(credential.id, user.uid, encodeBase64Url(credential.publicKey), credential.counter, JSON.stringify(transports), Math.floor(Date.now() / 1000)).run();
      return json({ registered: true }, 201, origin);
    }

    if (request.method === 'POST' && url.pathname === '/passkeys/auth/options') {
      const body = await readJson(request);
      const purpose = body.purpose;
      if (purpose !== 'login') throw passkeyError('Unsupported passkey action.');
      const anyPasskey = await env.PASSKEY_DB.prepare('SELECT credential_id FROM passkeys LIMIT 1').first();
      if (!anyPasskey) throw passkeyError('No passkeys have been registered yet.', 404);
      const options = await generateAuthenticationOptions({
        rpID: env.PASSKEY_RP_ID,
        userVerification: 'required',
      });
      const challengeId = await saveChallenge(env, options.challenge, null, purpose);
      return json({ challengeId, options }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/passkeys/auth/verify') {
      const body = await readJson(request);
      if (body.purpose !== 'login') throw passkeyError('Unsupported passkey action.');
      const challenge = await consumeChallenge(env, body.challengeId, 'login');
      if (!body.credential?.id) throw passkeyError('Passkey response is missing.');
      const credential = await env.PASSKEY_DB.prepare(
        'SELECT credential_id, uid, public_key, counter, transports FROM passkeys WHERE credential_id = ?',
      ).bind(body.credential.id).first();
      if (!credential) throw passkeyError('Passkey could not be verified.', 403);
      const verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: env.PASSKEY_ORIGIN,
        expectedRPID: env.PASSKEY_RP_ID,
        requireUserVerification: true,
        credential: {
          id: credential.credential_id,
          publicKey: decodeBase64Url(credential.public_key),
          counter: credential.counter,
          transports: JSON.parse(credential.transports || '[]'),
        },
      });
      if (!verification.verified) throw passkeyError('Passkey could not be verified.', 403);
      await env.PASSKEY_DB.prepare(
        'UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?',
      ).bind(verification.authenticationInfo.newCounter, Math.floor(Date.now() / 1000), credential.credential_id).run();
      return json({ customToken: await firebaseCustomToken(credential.uid, env) }, 200, origin);
    }

    const deleteMatch = url.pathname.match(/^\/passkeys\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteMatch) {
      const user = await getSignedInUser(request, env);
      const credentialId = decodeURIComponent(deleteMatch[1]);
      await env.PASSKEY_DB.prepare('DELETE FROM passkeys WHERE credential_id = ? AND uid = ?').bind(credentialId, user.uid).run();
      return json({ removed: true }, 200, origin);
    }

    return json({ error: 'Not found.' }, 404, origin);
  } catch (error) {
    if ((error.status || 500) >= 500) console.error('Passkey request failed', error);
    return json({ error: error.status ? error.message : 'Passkey request failed.' }, error.status || 500, origin);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ status: 'WealthRoute API is running.' }, 200, '*');
    }

    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: 'Origin is not allowed.' }, 403, 'null');
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': origin } });

    if (url.pathname.startsWith('/passkeys')) return handlePasskeyRequest(request, env, url, origin);

    if (url.pathname === '/rates' && request.method === 'GET') {
      const from = (url.searchParams.get('from') || '').toUpperCase();
      const to = (url.searchParams.get('to') || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
        return json({ error: 'Use valid three-letter currency codes.' }, 400, origin);
      }
      const response = await fetch(`https://api.frankfurter.app/latest?amount=1&from=${from}&to=${to}`);
      if (!response.ok) return json({ error: 'Rate provider is unavailable.' }, 502, origin);
      return json(await response.json(), 200, origin);
    }

    if (url.pathname === '/assistant' && request.method === 'POST') {
      if (!env.GEMINI_API_KEY) return json({ error: 'Worker has no Gemini API key configured.' }, 500, origin);
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'Request body must be JSON.' }, 400, origin);
      }
      const question = typeof payload.question === 'string' ? payload.question.trim() : '';
      if (!question || question.length > 1_000 || !payload.snapshot || typeof payload.snapshot !== 'object') {
        return json({ error: 'Provide a question up to 1,000 characters and a financial snapshot.' }, 400, origin);
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: assistantPrompt(question, payload.snapshot) }] }],
            generationConfig: { maxOutputTokens: 700, temperature: 0.3 },
          }),
        },
      );
      if (!response.ok) {
        console.error('Gemini error', response.status, await response.text());
        return json({ error: 'Assistant provider is unavailable.' }, 502, origin);
      }
      const result = await response.json();
      const answer = result.candidates?.[0]?.content?.parts
        ?.filter((part) => typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();
      if (!answer) return json({ error: 'Assistant provider returned no text.' }, 502, origin);
      return json({ answer }, 200, origin);
    }

    return json({ error: 'Not found.' }, 404, origin);
  },
};