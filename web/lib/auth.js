// One password, one signed cookie. Checked inside every page and every server action, so there is
// no single gate (such as a middleware) whose bypass would open the site.

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const COOKIE = 'cate_session';
const THIRTY_DAYS = 30 * 24 * 3600;

const digest = (text) => createHash('sha256').update(String(text)).digest();
const signingKey = () => digest(`cate:cookie:${process.env.SITE_PASSWORD}`);
const sign = (payload) => createHmac('sha256', signingKey()).update(payload).digest('hex');

// No SITE_PASSWORD set = the site is open to anyone with the link (fine only for a local preview).
// Setting SITE_PASSWORD in the host's environment variables turns the login back on, no code change.
export function openForLocalPreview() {
  // Open only for a local preview; on the real site a missing password must never mean "no login".
  return !process.env.SITE_PASSWORD && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
}

export function isOpenSite() {
  return openForLocalPreview();
}

export function passwordIsSet() {
  return Boolean(process.env.SITE_PASSWORD);
}

export function passwordMatches(given) {
  if (!passwordIsSet()) return false;
  return timingSafeEqual(digest(given), digest(process.env.SITE_PASSWORD));
}

export async function startSession() {
  const expires = Math.floor(Date.now() / 1000) + THIRTY_DAYS;
  (await cookies()).set(COOKIE, `${expires}.${sign(String(expires))}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: THIRTY_DAYS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function isSignedIn() {
  if (openForLocalPreview()) return true;
  if (!passwordIsSet()) return false;
  const value = (await cookies()).get(COOKIE)?.value || '';
  const [expires, signature] = value.split('.');
  if (!expires || !signature || Number(expires) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(expires), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// For pages: send a stranger to the login screen.
export async function requireSignIn() {
  if (!(await isSignedIn())) redirect('/login');
}

// For server actions: refuse outright.
export async function assertSignedIn() {
  if (!(await isSignedIn())) throw new Error('Not signed in.');
}
