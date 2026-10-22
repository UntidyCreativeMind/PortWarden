import crypto from 'crypto';

// --- Password hashing ---
// Stored format: "iterations:salt:hash". Legacy v0.1 hashes are "salt:hash" at 1000 iterations.
const PBKDF2_ITERATIONS = 310000;
const LEGACY_ITERATIONS = 1000;

export const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
    return `${PBKDF2_ITERATIONS}:${salt}:${hash}`;
};

export const verifyPassword = (password, stored) => {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    const parts = stored.split(':');
    let iterations, salt, hash;
    if (parts.length === 3) {
        [iterations, salt, hash] = [parseInt(parts[0]), parts[1], parts[2]];
    } else if (parts.length === 2) {
        [iterations, salt, hash] = [LEGACY_ITERATIONS, parts[0], parts[1]];
    } else {
        return false;
    }
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, 'sha512');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

// True when the stored hash should be upgraded to the current iteration count
export const needsRehash = (stored) => !stored.startsWith(`${PBKDF2_ITERATIONS}:`);

export const MIN_PASSWORD_LENGTH = 8;

// --- Input validation (everything that reaches a shell command goes through these) ---

export const parsePort = (value) => {
    const str = String(value ?? '').trim();
    if (!/^\d{1,5}$/.test(str)) return null;
    const port = parseInt(str, 10);
    return port >= 1 && port <= 65535 ? port : null;
};

export const parseRuleId = (value) => {
    const str = String(value ?? '').trim();
    if (!/^\d{1,6}$/.test(str)) return null;
    const id = parseInt(str, 10);
    return id >= 1 ? id : null;
};

export const PROTOCOLS = ['tcp', 'udp'];

// --- Login rate limiting (in-memory, per client IP) ---
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

export const loginRateLimit = {
    isBlocked(ip) {
        const entry = failures.get(ip);
        if (!entry) return false;
        if (Date.now() - entry.first > WINDOW_MS) {
            failures.delete(ip);
            return false;
        }
        return entry.count >= MAX_FAILURES;
    },
    recordFailure(ip) {
        const entry = failures.get(ip);
        if (!entry || Date.now() - entry.first > WINDOW_MS) {
            failures.set(ip, { count: 1, first: Date.now() });
        } else {
            entry.count++;
        }
    },
    reset(ip) {
        failures.delete(ip);
    }
};
