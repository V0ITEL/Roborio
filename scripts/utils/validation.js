'use strict';

/**
 * Validate Solana wallet address format
 * Solana addresses are Base58-encoded, typically 32-44 characters
 * @param {string} wallet - Wallet address to validate
 * @returns {boolean} - True if valid format
 */
export function isValidSolanaAddress(wallet) {
    if (!wallet || typeof wallet !== 'string') return false;
    // Base58 alphabet (no 0, O, I, l)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(wallet);
}

/**
 * Validate email format and check against disposable domains
 * @param {string} email - Email to validate
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
export function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return { valid: false, error: 'Email is required' };
    }

    const normalized = email.trim().toLowerCase();

    // Basic format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalized)) {
        return { valid: false, error: 'Invalid email format' };
    }

    // Check length
    if (normalized.length > 254) {
        return { valid: false, error: 'Email too long' };
    }

    // Block common disposable email domains
    const disposableDomains = [
        'tempmail.com', 'throwaway.email', 'guerrillamail.com',
        'mailinator.com', '10minutemail.com', 'temp-mail.org',
        'fakeinbox.com', 'trashmail.com', 'yopmail.com'
    ];

    const domain = normalized.split('@')[1];
    if (disposableDomains.includes(domain)) {
        return { valid: false, error: 'Disposable email addresses are not allowed' };
    }

    return { valid: true, normalized };
}

/**
 * Compact robot ID for use as Solana PDA seed (max 32 bytes)
 * @param {string} robotId - Raw robot ID (e.g. UUID)
 * @returns {string} - Compacted ID safe for PDA seed
 */
export function compactRobotIdForSeed(robotId) {
    const raw = String(robotId || '').trim();
    if (!raw) {
        throw new Error('Robot ID is missing');
    }
    // Remove non-alphanumeric characters (dashes from UUID)
    const compact = raw.replace(/[^a-zA-Z0-9]/g, '');
    const candidate = compact.length ? compact : raw;
    // Solana PDA seed limit is 32 bytes
    if (candidate.length <= 32) {
        return candidate;
    }
    return candidate.slice(0, 32);
}

/**
 * Check if origin is in CORS whitelist
 * @param {string} origin - Request origin
 * @param {Array<string|RegExp>} allowedOrigins - Whitelist
 * @returns {boolean}
 */
export function isOriginAllowed(origin, allowedOrigins) {
    if (!origin) return false;
    return allowedOrigins.some(allowed => {
        if (allowed instanceof RegExp) {
            return allowed.test(origin);
        }
        return allowed === origin;
    });
}
