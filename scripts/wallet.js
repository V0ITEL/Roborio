'use strict';

import { getCurrentLang } from './i18n.js';
import { log } from './utils/logger.js';
import notify from './ui/notify.js';
import { withLoading } from './ui/withLoading.js';
import * as solanaWeb3 from '@solana/web3.js';





const ROBORIO_TOKEN_MINT = 'null';

// Jupiter Terminal Integration (commented out for now)
/*
function initJupiterTerminal() {
    if (!window.Jupiter || !walletState.connected) return;

    window.Jupiter.init({
        displayMode: 'integrated',
        integratedTargetId: 'jupiterTerminal',
        endpoint: 'https://api.mainnet-beta.solana.com',
        formProps: {
            initialInputMint: 'So11111111111111111111111111111111111111112', // SOL
            initialOutputMint: ROBORIO_TOKEN_MINT, // $ROBORIO
            fixedOutputMint: true, // Только покупка ROBORIO
            initialSlippageBps: 50, // 0.5% slippage
        },
        enableWalletPassthrough: true,
        passthroughWalletContextState: {
            publicKey: walletState.provider?.publicKey,
            signTransaction: walletState.provider?.signTransaction?.bind(walletState.provider),
            signAllTransactions: walletState.provider?.signAllTransactions?.bind(walletState.provider),
        },
        onSuccess: ({ txid }) => {
            console.log('Swap successful:', txid);
            // Можно показать уведомление об успехе
        },
        onError: (error) => {
            console.error('Swap failed:', error);
        }
    });
}
*/

let walletState = {
    connected: false,
    publicKey: null,
    balance: 0,
    provider: null,
    jwt: null, // JWT token for authenticated requests
    network: null,
    networkSource: null
};

// LocalStorage keys for JWT persistence
const LS_JWT_KEY = 'wallet_jwt';
const LS_WALLET_KEY = 'wallet_authed_wallet';
const LS_EXPIRES_KEY = 'wallet_jwt_expires_at';
const LS_PREFERRED_WALLET_KEY = 'wallet_preferred_wallet';
const LS_WALLET_NETWORK_KEY = 'wallet_active_network';
const LS_WALLET_NETWORK_SOURCE_KEY = 'wallet_active_network_source';
const LS_WALLET_NETWORK_WALLET_KEY = 'wallet_active_network_wallet';

// Supabase Edge Function URL for wallet auth
const WALLET_AUTH_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/wallet-auth';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const WALLET_NETWORK = import.meta.env.VITE_SOLANA_NETWORK || 'devnet';
const WALLET_RPC_ENDPOINT = import.meta.env.VITE_SOLANA_RPC_ENDPOINT || '';

function getWalletRpcEndpoint() {
    const override = window.ROBORIO_ESCROW_CONFIG || {};
    const network = override.network || WALLET_NETWORK;
    const rpcEndpoint = override.rpcEndpoint || WALLET_RPC_ENDPOINT;
    if (rpcEndpoint) return rpcEndpoint;
    const cluster = network === 'mainnet' ? 'mainnet-beta' : network;
    if (cluster === 'mainnet-beta') return 'https://api.mainnet-beta.solana.com';
    if (cluster === 'testnet') return 'https://api.testnet.solana.com';
    return 'https://api.devnet.solana.com';
}

function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function getPhantomDeepLink(targetUrl) {
    const url = targetUrl || window.location.href;
    return `https://phantom.app/ul/browse/${encodeURIComponent(url)}`;
}

/**
 * Save JWT to localStorage and memory
 *
 * SECURITY NOTE: JWT tokens are stored in localStorage, which is accessible to any
 * JavaScript code on the page. This creates an XSS risk if malicious code is injected.
 *
 * Current mitigations:
 * - Strict Content Security Policy (CSP) prevents inline scripts
 * - Token expiration with automatic cleanup
 * - No sensitive operations without wallet signature verification
 *
 * TODO: Migrate to httpOnly cookies via Supabase Edge Functions for stronger security.
 * See: https://supabase.com/docs/guides/auth/server-side/nextjs
 */
function saveJWT(token, wallet, expiresIn) {
    // Validate inputs
    if (!token || typeof token !== 'string' || token.length < 20) {
        log.error('[Wallet]', 'Invalid JWT token provided');
        return;
    }

    if (!wallet || typeof wallet !== 'string') {
        log.error('[Wallet]', 'Invalid wallet address provided');
        return;
    }

    const expiresAt = Date.now() + (expiresIn * 1000);

    // Save to memory
    walletState.jwt = token;

    // Save to localStorage
    localStorage.setItem(LS_JWT_KEY, token);
    localStorage.setItem(LS_WALLET_KEY, wallet);
    localStorage.setItem(LS_EXPIRES_KEY, expiresAt.toString());

    log.debug('[Wallet]', 'JWT stored, expires at:', new Date(expiresAt).toISOString());
    log.debug('[Wallet]', 'JWT prefix:', token.substring(0, 20) + '...');
}

/**
 * Clear JWT from localStorage and memory
 */
function clearJWT() {
    walletState.jwt = null;
    localStorage.removeItem(LS_JWT_KEY);
    localStorage.removeItem(LS_WALLET_KEY);
    localStorage.removeItem(LS_EXPIRES_KEY);
    log.debug('[Wallet]', 'JWT cleared');
}

/**
 * Load JWT from localStorage if valid
 */
function loadJWT() {
    const token = localStorage.getItem(LS_JWT_KEY);
    const expiresAt = parseInt(localStorage.getItem(LS_EXPIRES_KEY) || '0', 10);

    if (token && expiresAt > Date.now()) {
        walletState.jwt = token;
        log.debug('[Wallet]', 'JWT loaded from storage, valid until:', new Date(expiresAt).toISOString());
        return token;
    }

    // Token expired or missing - clear it
    if (token) {
        log.debug('[Wallet]', 'JWT expired, clearing');
        clearJWT();
    }
    return null;
}

/**
 * Sign message with wallet and get JWT token
 * @param {Object} provider - Wallet provider (Phantom, Solflare, etc.)
 * @param {string} publicKey - Wallet public key
 * @returns {Promise<string|null>} JWT token or null on failure
 */
async function authenticateWallet(provider, publicKey) {
    try {
        // Generate nonce for replay protection
        const nonce = crypto.randomUUID();
        const timestamp = Date.now();
        const origin = window.location.origin;
        const message = `Sign in to Roborio\n\nOrigin: ${origin}\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

        // Request signature from wallet (compat for different wallets)
        const encodedMessage = new TextEncoder().encode(message);
        let signedMessage = null;
        try {
            signedMessage = await provider.signMessage(encodedMessage, 'utf8');
        } catch (error) {
            try {
                signedMessage = await provider.signMessage(encodedMessage);
            } catch (fallbackError) {
                signedMessage = await provider.signMessage(message);
            }
        }

        // Convert signature to base64
        const signatureBytes = signedMessage?.signature || signedMessage;
        const signature = btoa(String.fromCharCode(...signatureBytes));

        // Send to edge function for verification
        const response = await fetch(WALLET_AUTH_URL, {
            method: 'POST',
            headers: {
             'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
            body: JSON.stringify({
                wallet: publicKey,
                signature: signature,
                message: message,
                nonce: nonce,
                timestamp: timestamp,
                origin: origin
            })
        });

        if (!response.ok) {
            const error = await response.json();
            log.error('[Wallet]', 'Auth failed:', error);
            return null;
        }

        const { token, wallet, expiresIn } = await response.json();

        // Save JWT to localStorage and memory
        saveJWT(token, wallet, expiresIn);

        log.info('[Wallet]', 'Authenticated successfully');
        log.debug('[Wallet]', 'JWT stored?', !!localStorage.getItem(LS_JWT_KEY));

        return token;
    } catch (error) {
        log.error('[Wallet]', 'Authentication error:', error);
        return null;
    }
}

/**
 * Get current JWT token for authenticated requests
 * Checks memory first, then localStorage (with expiry check)
 * @returns {string|null}
 */
export function getWalletJWT() {
    // Check memory first
    if (walletState.jwt) {
        return walletState.jwt;
    }

    // Try to load from localStorage
    return loadJWT();
}

const WALLET_PROVIDER_GETTERS = {
    phantom: () => {
        const provider = window.phantom?.solana;
        return provider?.isPhantom ? provider : null;
    },
    solflare: () => {
        const provider = window.solflare;
        return provider?.isSolflare ? provider : null;
    },
    backpack: () => {
        const provider = window.backpack;
        return provider || null;
    }
};

export function getWalletProvider(preferredWallet) {
    const orderedWallets = ['phantom', 'solflare', 'backpack'];

    if (preferredWallet && WALLET_PROVIDER_GETTERS[preferredWallet]) {
        const preferredProvider = WALLET_PROVIDER_GETTERS[preferredWallet]();
        if (preferredProvider) {
            return { wallet: preferredWallet, provider: preferredProvider };
        }
    }

    for (const wallet of orderedWallets) {
        const provider = WALLET_PROVIDER_GETTERS[wallet]();
        if (provider) {
            return { wallet, provider };
        }
    }

    return { wallet: null, provider: null };
}

function setPreferredWallet(wallet) {
    if (wallet) {
        localStorage.setItem(LS_PREFERRED_WALLET_KEY, wallet);
        return;
    }

    localStorage.removeItem(LS_PREFERRED_WALLET_KEY);
}

function getPreferredWallet() {
    return localStorage.getItem(LS_PREFERRED_WALLET_KEY);
}

function normalizeNetwork(value) {
    if (!value) return null;
    const text = String(value).toLowerCase();
    if (text.includes('devnet')) return 'devnet';
    if (text.includes('testnet')) return 'testnet';
    if (text.includes('mainnet')) return 'mainnet';
    return text;
}

function formatNetworkLabel(value) {
    const normalized = normalizeNetwork(value);
    if (normalized === 'mainnet') return 'mainnet';
    if (normalized === 'testnet') return 'testnet';
    if (normalized === 'devnet') return 'devnet';
    return normalized || 'unknown';
}

function getSiteNetwork() {
    const override = window.ROBORIO_ESCROW_CONFIG || {};
    const network = override.network || WALLET_NETWORK;
    return formatNetworkLabel(network);
}

function getClusterEndpoint(cluster) {
    if (cluster === 'mainnet') return 'https://api.mainnet-beta.solana.com';
    if (cluster === 'testnet') return 'https://api.testnet.solana.com';
    return 'https://api.devnet.solana.com';
}

const GENESIS_HASH_CACHE = {
    devnet: null,
    testnet: null,
    mainnet: null,
    promise: null
};
const NETWORK_INFER_CACHE = {
    value: null,
    publicKey: null,
    expiresAt: 0
};
const SITE_INFER_CACHE = {
    value: null,
    publicKey: null,
    site: null,
    expiresAt: 0
};
const SAFE_GET_LOGGED = new Set();

async function loadGenesisHashMap() {
    if (GENESIS_HASH_CACHE.promise) return GENESIS_HASH_CACHE.promise;
    GENESIS_HASH_CACHE.promise = (async () => {
        const clusters = ['devnet', 'testnet', 'mainnet'];
        const web3 = getWeb3();
        if (!web3?.Connection) return GENESIS_HASH_CACHE;
        await Promise.all(clusters.map(async (cluster) => {
            try {
                const connection = new web3.Connection(getClusterEndpoint(cluster), 'confirmed');
                const hash = await connection.getGenesisHash();
                GENESIS_HASH_CACHE[cluster] = hash;
            } catch (error) {
                log.warn('[Wallet]', 'Failed to load genesis hash for', cluster, error);
            }
        }));
        return GENESIS_HASH_CACHE;
    })();
    return GENESIS_HASH_CACHE.promise;
}

async function inferNetworkFromBalances(publicKey) {
    const web3 = getWeb3();
    if (!publicKey || !web3?.Connection) return null;
    const keyStr = publicKey?.toString ? publicKey.toString() : String(publicKey);
    if (!keyStr) return null;
    if (NETWORK_INFER_CACHE.value
        && NETWORK_INFER_CACHE.publicKey === keyStr
        && NETWORK_INFER_CACHE.expiresAt > Date.now()) {
        return NETWORK_INFER_CACHE.value;
    }
    let key;
    try {
        key = publicKey?.toBytes ? publicKey : new web3.PublicKey(keyStr);
    } catch (error) {
        return null;
    }
    const clusters = ['devnet', 'testnet', 'mainnet'];
    const results = await Promise.all(clusters.map(async (cluster) => {
        try {
            const connection = new web3.Connection(getClusterEndpoint(cluster), 'confirmed');
            const balance = await connection.getBalance(key);
            return { cluster, balance };
        } catch (error) {
            return { cluster, balance: 0 };
        }
    }));
    const best = results.reduce((acc, entry) => {
        if (!acc || entry.balance > acc.balance) return entry;
        return acc;
    }, null);
    if (best && best.balance > 0) {
        NETWORK_INFER_CACHE.value = best.cluster;
        NETWORK_INFER_CACHE.publicKey = keyStr;
        NETWORK_INFER_CACHE.expiresAt = Date.now() + 60000;
        return best.cluster;
    }
    return null;
}

function getWeb3() {
    return window.solanaWeb3 || solanaWeb3;
}

async function inferNetworkFromSiteBalance(publicKey) {
    const web3 = getWeb3();
    if (!publicKey || !web3?.Connection) return null;
    const site = getSiteNetwork();
    if (!site) return null;
    const keyStr = publicKey?.toString ? publicKey.toString() : String(publicKey);
    if (SITE_INFER_CACHE.value
        && SITE_INFER_CACHE.publicKey === keyStr
        && SITE_INFER_CACHE.site === site
        && SITE_INFER_CACHE.expiresAt > Date.now()) {
        return SITE_INFER_CACHE.value;
    }
    let key;
    try {
        key = publicKey?.toBytes ? publicKey : new web3.PublicKey(publicKey.toString());
    } catch (error) {
        return null;
    }
    try {
        const connection = new web3.Connection(getClusterEndpoint(site), 'confirmed');
        const balance = await connection.getBalance(key);
        const result = balance > 0 ? site : null;
        SITE_INFER_CACHE.value = result;
        SITE_INFER_CACHE.publicKey = keyStr;
        SITE_INFER_CACHE.site = site;
        SITE_INFER_CACHE.expiresAt = Date.now() + 60000;
        return result;
    } catch (error) {
        return null;
    }
}

function getCachedNetworkForWallet(publicKey) {
    if (!publicKey) return null;
    const cached = localStorage.getItem(LS_WALLET_NETWORK_KEY);
    const cachedWallet = localStorage.getItem(LS_WALLET_NETWORK_WALLET_KEY);
    const keyStr = publicKey?.toString ? publicKey.toString() : String(publicKey);
    if (cached && cachedWallet && cachedWallet === keyStr) {
        return cached;
    }
    return null;
}

function safeGet(label, getter) {
    try {
        return getter();
    } catch (error) {
        if (!SAFE_GET_LOGGED.has(label)) {
            SAFE_GET_LOGGED.add(label);
            log.debug('[Wallet]', `safeGet failed for ${label}:`, error?.message || error);
        }
        return null;
    }
}

function getProviderEndpoint(provider) {
    return safeGet('connection.rpcEndpoint', () => provider?.connection?.rpcEndpoint)
        || safeGet('connection._rpcEndpoint', () => provider?.connection?._rpcEndpoint)
        || safeGet('_connection.rpcEndpoint', () => provider?._connection?.rpcEndpoint)
        || safeGet('_connection._rpcEndpoint', () => provider?._connection?._rpcEndpoint)
        || safeGet('adapter.connection.rpcEndpoint', () => provider?.adapter?.connection?.rpcEndpoint)
        || safeGet('adapter.connection._rpcEndpoint', () => provider?.adapter?.connection?._rpcEndpoint)
        || safeGet('wallet.adapter.connection.rpcEndpoint', () => provider?.wallet?.adapter?.connection?.rpcEndpoint)
        || safeGet('wallet.adapter.connection._rpcEndpoint', () => provider?.wallet?.adapter?.connection?._rpcEndpoint)
        || safeGet('rpcEndpoint', () => provider?.rpcEndpoint)
        || safeGet('endpoint', () => provider?.endpoint)
        || safeGet('rpc.endpoint', () => provider?.rpc?.endpoint)
        || safeGet('rpc.rpcEndpoint', () => provider?.rpc?.rpcEndpoint)
        || null;
}

async function detectWalletNetwork(provider) {
    const direct = safeGet('network', () => provider?.network)
        || safeGet('connection.network', () => provider?.connection?.network)
        || safeGet('_connection.network', () => provider?._connection?.network)
        || safeGet('adapter.connection.network', () => provider?.adapter?.connection?.network)
        || null;
    const endpoint = getProviderEndpoint(provider);
    const normalized = normalizeNetwork(direct || endpoint);
    if (normalized) return normalized;

    const web3 = getWeb3();
    if (endpoint && web3?.Connection) {
        try {
            const connection = new web3.Connection(endpoint, 'confirmed');
            const walletGenesis = await connection.getGenesisHash();
            if (walletGenesis) {
                const map = await loadGenesisHashMap();
                const match = ['devnet', 'testnet', 'mainnet']
                    .find((cluster) => map[cluster] === walletGenesis);
                if (match) return match;
            }
        } catch (error) {
            log.debug('[Wallet]', 'Network detect via endpoint failed:', error?.message || error);
        }
    }

    if (provider?.request) {
        try {
            const walletGenesis = await provider.request({ method: 'getGenesisHash' });
            if (walletGenesis) {
                const map = await loadGenesisHashMap();
                const match = ['devnet', 'testnet', 'mainnet']
                    .find((cluster) => map[cluster] === walletGenesis);
                if (match) return match;
            }
        } catch (error) {
            try {
                const walletGenesis = await provider.request({ method: 'getGenesisHash', params: [] });
                if (walletGenesis) {
                    const map = await loadGenesisHashMap();
                    const match = ['devnet', 'testnet', 'mainnet']
                        .find((cluster) => map[cluster] === walletGenesis);
                    if (match) return match;
                }
            } catch (fallbackError) {
                log.debug('[Wallet]', 'Network request not available:', fallbackError?.message || fallbackError);
            }
        }
    }
    return null;
}

function updateNetworkBadge() {
    const badge = document.getElementById('activeNetworkBadge');
    const badgeMobile = document.getElementById('activeNetworkBadgeMobile');
    const site = getSiteNetwork();
    const walletNetwork = walletState.network || getCachedNetworkForWallet(walletState.publicKey);
    const walletSource = walletState.networkSource || localStorage.getItem(LS_WALLET_NETWORK_SOURCE_KEY);
    const assumed = walletSource === 'inferred';
    let text = `Network: ${site}`;
    let state = 'unknown';

    if (walletState.connected && walletNetwork) {
        const walletLabel = formatNetworkLabel(walletNetwork);
        if (walletLabel === site) {
            text = `Network: ${site}${assumed ? ' (assumed)' : ''}`;
            state = 'match';
        } else {
            text = `Wallet: ${walletLabel}${assumed ? ' (assumed)' : ''} | Site: ${site}`;
            state = 'mismatch';
        }
    } else {
        text = `Site: ${site}`;
        state = 'unknown';
    }

    [badge, badgeMobile].forEach((el) => {
        if (!el) return;
        el.textContent = text;
        el.dataset.state = state;
    });
}

async function refreshWalletNetwork(provider) {
    if (!provider) {
        walletState.network = null;
        walletState.networkSource = null;
        localStorage.removeItem(LS_WALLET_NETWORK_KEY);
        localStorage.removeItem(LS_WALLET_NETWORK_SOURCE_KEY);
        localStorage.removeItem(LS_WALLET_NETWORK_WALLET_KEY);
        updateNetworkBadge();
        return;
    }
    let detected = await detectWalletNetwork(provider);
    let source = detected ? 'detected' : null;
    if (!detected && walletState.publicKey) {
        const siteGuess = await inferNetworkFromSiteBalance(walletState.publicKey);
        if (siteGuess) {
            detected = siteGuess;
            source = 'inferred';
        }
    }
    if (!detected && walletState.publicKey) {
        const inferred = await inferNetworkFromBalances(walletState.publicKey);
        if (inferred) {
            detected = inferred;
            source = 'inferred';
        }
    }
    walletState.network = detected;
    walletState.networkSource = source;
    if (detected) {
        localStorage.setItem(LS_WALLET_NETWORK_KEY, detected);
        localStorage.setItem(LS_WALLET_NETWORK_WALLET_KEY, walletState.publicKey?.toString?.() || '');
        if (source) {
            localStorage.setItem(LS_WALLET_NETWORK_SOURCE_KEY, source);
        } else {
            localStorage.removeItem(LS_WALLET_NETWORK_SOURCE_KEY);
        }
    } else {
        localStorage.removeItem(LS_WALLET_NETWORK_KEY);
        localStorage.removeItem(LS_WALLET_NETWORK_SOURCE_KEY);
        localStorage.removeItem(LS_WALLET_NETWORK_WALLET_KEY);
    }
    updateNetworkBadge();
}

export function initWallet() {
    const connectBtn = document.getElementById('connectWallet');
    const connectBtnMobile = document.getElementById('connectWalletMobile');
    const walletModal = document.getElementById('walletModal');
    const walletModalOverlay = document.getElementById('walletModalOverlay');
    const walletModalClose = document.getElementById('walletModalClose');
    const walletDropdown = document.getElementById('walletDropdown');
    const walletOptions = document.querySelectorAll('.wallet-option');
    const disconnectBtn = document.getElementById('disconnectWallet');
    const walletDeeplink = document.getElementById('walletDeeplink');
    const phantomDeeplink = document.getElementById('phantomDeeplink');
    const openBuyModalBtn = document.getElementById('openBuyModal');
    const buyRoborioHeroBtn = document.getElementById('buyRoborioHero');
    const buyModal = document.getElementById('buyModal');
    const buyModalOverlay = document.getElementById('buyModalOverlay');
    const buyModalClose = document.getElementById('buyModalClose');
    const buyWaitlistBtn = document.getElementById('buyWaitlistBtn');

    updateNetworkBadge();

    const refreshNetworkStatus = async () => {
        if (walletState.provider) {
            await refreshWalletNetwork(walletState.provider);
        } else {
            updateNetworkBadge();
        }
    };

    function updateWalletDeeplink() {
        if (!walletDeeplink || !phantomDeeplink) return;
        const hasProvider = !!window.phantom?.solana;
        if (!isIOSDevice() || hasProvider) {
            walletDeeplink.hidden = true;
            return;
        }
        phantomDeeplink.href = getPhantomDeepLink(window.location.href);
        walletDeeplink.hidden = false;
    }

    // Open wallet modal
    function openWalletModal() {
        if (walletState.connected) {
            toggleWalletDropdown();
        } else {
            walletModal?.classList.add('active');
            walletModalOverlay?.classList.add('active');
            walletModal?.setAttribute('aria-hidden', 'false');
            walletModalOverlay?.setAttribute('aria-hidden', 'false');
            // Focus first wallet option
            walletModal?.querySelector('.wallet-option')?.focus();
            updateWalletDeeplink();
        }
    }

    // Close wallet modal
    function closeWalletModal() {
        walletModal?.classList.remove('active');
        walletModalOverlay?.classList.remove('active');
        walletModal?.setAttribute('aria-hidden', 'true');
        walletModalOverlay?.setAttribute('aria-hidden', 'true');
    }

    // Toggle wallet dropdown
    function toggleWalletDropdown() {
        const overlay = document.getElementById('walletDropdownOverlay');
        const isActive = walletDropdown?.classList.contains('active');

        if (isActive) {
            const triggerBtn = (connectBtnMobile?.offsetParent ? connectBtnMobile : connectBtn) || connectBtnMobile || connectBtn;
            if (walletDropdown?.contains(document.activeElement)) {
                triggerBtn?.focus?.();
                if (walletDropdown?.contains(document.activeElement)) {
                    document.body.focus?.();
                }
            }
            walletDropdown?.classList.remove('active');
            overlay?.classList.remove('active');
            walletDropdown?.setAttribute('aria-hidden', 'true');
            overlay?.setAttribute('aria-hidden', 'true');
        } else {
            walletDropdown?.classList.add('active');
            overlay?.classList.add('active');
            walletDropdown?.setAttribute('aria-hidden', 'false');
            overlay?.setAttribute('aria-hidden', 'false');
        }
    }

    // Close wallet dropdown
    function closeWalletDropdown() {
        const overlay = document.getElementById('walletDropdownOverlay');
        const triggerBtn = (connectBtnMobile?.offsetParent ? connectBtnMobile : connectBtn) || connectBtnMobile || connectBtn;
        if (walletDropdown?.contains(document.activeElement)) {
            triggerBtn?.focus?.();
            if (walletDropdown?.contains(document.activeElement)) {
                document.body.focus?.();
            }
        }
        walletDropdown?.classList.remove('active');
        overlay?.classList.remove('active');
        walletDropdown?.setAttribute('aria-hidden', 'true');
        overlay?.setAttribute('aria-hidden', 'true');
    }

    // Open buy modal
    function openBuyModal() {
        closeWalletDropdown();
        buyModal?.classList.add('active');
        buyModalOverlay?.classList.add('active');
        buyModal?.setAttribute('aria-hidden', 'false');
        buyModalOverlay?.setAttribute('aria-hidden', 'false');

        // Update Jupiter Preview based on wallet state
        updateJupiterPreview();
    }

    // Close buy modal
    function closeBuyModal() {
        buyModal?.classList.remove('active');
        buyModalOverlay?.classList.remove('active');
        buyModal?.setAttribute('aria-hidden', 'true');
        buyModalOverlay?.setAttribute('aria-hidden', 'true');
    }

    // Jupiter Terminal Preview Logic
    function updateJupiterPreview() {
        const placeholder = document.getElementById('buyPlaceholder');
        const jupiterPreview = document.getElementById('jupiterPreview');
        const jupiterSwapBtn = document.getElementById('jupiterSwapBtn');
        const jupiterFromBalance = document.getElementById('jupiterFromBalance');

        // Check if token is launched (placeholder variable)
        const TOKEN_LAUNCHED = false; // Change to true when token launches

        if (!TOKEN_LAUNCHED) {
            // Show placeholder, hide Jupiter
            if (placeholder) placeholder.style.display = 'flex';
            if (jupiterPreview) jupiterPreview.style.display = 'none';
            return;
        }

        // Token is launched - show Jupiter Preview
        if (placeholder) placeholder.style.display = 'none';
        if (jupiterPreview) jupiterPreview.style.display = 'block';

        // Update based on wallet connection
        if (walletState.connected) {
            if (jupiterFromBalance) {
                jupiterFromBalance.textContent = walletState.balance.toFixed(4);
            }
            if (jupiterSwapBtn) {
                jupiterSwapBtn.disabled = false;
                jupiterSwapBtn.classList.add('ready');
                const span = document.createElement('span');
                span.textContent = 'Swap';
                jupiterSwapBtn.replaceChildren(span);
            }
        } else {
            if (jupiterFromBalance) {
                jupiterFromBalance.textContent = '0.00';
            }
            if (jupiterSwapBtn) {
                jupiterSwapBtn.disabled = true;
                jupiterSwapBtn.classList.remove('ready');
                const span = document.createElement('span');
                span.setAttribute('data-i18n', 'connectWalletFirst');
                span.textContent = 'Connect Wallet First';
                jupiterSwapBtn.replaceChildren(span);
            }
        }
    }

    function initJupiterInputs() {
        const fromAmount = document.getElementById('jupiterFromAmount');
        const toAmount = document.getElementById('jupiterToAmount');
        const rateEl = document.getElementById('jupiterRate');
        const exchangeRateEl = document.getElementById('jupiterExchangeRate');
        const minReceivedEl = document.getElementById('jupiterMinReceived');

        
        const RATE = 1250000; // 

        if (fromAmount) {
            fromAmount.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                const output = value * RATE;

                if (toAmount) {
                    toAmount.value = output > 0 ? output.toLocaleString() : '';
                }
                if (rateEl) {
                    rateEl.textContent = RATE.toLocaleString();
                }
                if (exchangeRateEl) {
                    exchangeRateEl.textContent = value > 0 ? `1 SOL = ${RATE.toLocaleString()} ROBORIO` : '-';
                }
                if (minReceivedEl) {
                    const minOut = output * 0.995; 
                    minReceivedEl.textContent = output > 0 ? `${minOut.toLocaleString()} ROBORIO` : '-';
                }
            });
        }
    }

    initJupiterInputs();

    // Update UI after wallet connection
    function updateWalletUI() {
        const btns = [connectBtn, connectBtnMobile];

        btns.forEach(btn => {
            if (!btn) return;

            if (walletState.connected) {
                const shortAddress = walletState.publicKey.slice(0, 4) + '...' + walletState.publicKey.slice(-4);
                btn.classList.add('connected');

                // Create elements safely without innerHTML
                const iconSpan = document.createElement('span');
                iconSpan.className = 'wallet-icon-connected';
                const addressSpan = document.createElement('span');
                addressSpan.textContent = shortAddress;
                btn.replaceChildren(iconSpan, addressSpan);
            } else {
                btn.classList.remove('connected');

                // Create SVG element safely
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('width', '18');
                svg.setAttribute('height', '18');

                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', '2');
                rect.setAttribute('y', '6');
                rect.setAttribute('width', '20');
                rect.setAttribute('height', '14');
                rect.setAttribute('rx', '2');

                const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path1.setAttribute('d', 'M16 14h.01');

                const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path2.setAttribute('d', 'M2 10h20');

                svg.appendChild(rect);
                svg.appendChild(path1);
                svg.appendChild(path2);

                const textSpan = document.createElement('span');
                textSpan.setAttribute('data-i18n', 'connectWallet');
                textSpan.textContent = 'Connect Wallet';

                btn.replaceChildren(svg, textSpan);
            }
        });

        // Update dropdown info
        const addressEl = document.getElementById('walletAddress');
        const balanceEl = document.getElementById('walletBalance');
        const balanceUsdEl = document.getElementById('walletBalanceUsd');

        if (addressEl && walletState.publicKey) {
            addressEl.textContent = walletState.publicKey.slice(0, 4) + '...' + walletState.publicKey.slice(-4);
        }
        if (balanceEl) {
            balanceEl.textContent = walletState.balance.toFixed(4) + ' SOL';
        }
        if (balanceUsdEl) {
            
            const usdValue = walletState.balance * 180;
            balanceUsdEl.textContent = '~ $' + usdValue.toFixed(2);
        }
        updateNetworkBadge();
    }

    // Connect to Phantom
    async function connectPhantom() {
        try {
            const provider = window.phantom?.solana;

            if (!provider?.isPhantom) {
                if (isIOSDevice()) {
                    window.location.href = getPhantomDeepLink(window.location.href);
                } else {
                    window.open('https://phantom.app/', '_blank');
                }
                return;
            }

            const response = await provider.connect();
            walletState.publicKey = response.publicKey.toString();
            walletState.provider = provider;

            // Authenticate and get JWT (required)
            const jwt = await authenticateWallet(provider, walletState.publicKey);
            if (!jwt) {
                notify.error('Signature required to connect. Please try again.');
                disconnectWallet({ clearPreferred: true });
                return;
            }
            walletState.jwt = jwt;
            walletState.connected = true;

            // Get balance
            try {
                const connection = new (getWeb3()?.Connection || class{})(
                    getWalletRpcEndpoint(),
                    'confirmed'
                );
                const balance = await connection.getBalance(response.publicKey);
                walletState.balance = balance / 1e9; // Convert lamports to SOL
            } catch (e) {
                walletState.balance = 0;
            }

            await refreshWalletNetwork(provider);

            closeWalletModal();
            updateWalletUI();
            notify.success('Wallet connected');

            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey, jwt: walletState.jwt }
            }));

            provider.on('disconnect', () => {
                disconnectWallet();
                window.dispatchEvent(new CustomEvent('wallet-disconnected'));
            });

            // Listen for account change
            provider.on('accountChanged', async (publicKey) => {
                if (publicKey) {
                    walletState.publicKey = publicKey.toString();
                    // Re-authenticate with new account
                    const jwt = await authenticateWallet(provider, walletState.publicKey);
                    walletState.jwt = jwt;
                    updateWalletUI();
                    window.dispatchEvent(new CustomEvent('wallet-connected', {
                        detail: { publicKey: walletState.publicKey, jwt: walletState.jwt }
                    }));
                } else {
                    disconnectWallet();
                    window.dispatchEvent(new CustomEvent('wallet-disconnected'));
                }
            });

        } catch (error) {
            log.error('[Wallet]', 'Phantom connection failed:', error);
            notify.error('Could not connect to Phantom. Please try again.');
        }
    }

    // Connect to Solflare
    async function connectSolflare() {
        try {
            const provider = window.solflare;

            if (!provider?.isSolflare) {
                window.open('https://solflare.com/', '_blank');
                return;
            }

            await provider.connect();
            walletState.publicKey = provider.publicKey.toString();
            walletState.provider = provider;

            // Authenticate and get JWT (required)
            const jwt = await authenticateWallet(provider, walletState.publicKey);
            if (!jwt) {
                notify.error('Signature required to connect. Please try again.');
                disconnectWallet({ clearPreferred: true });
                return;
            }
            walletState.jwt = jwt;
            walletState.connected = true;

            try {
                const connection = new (getWeb3()?.Connection || class{})(
                    getWalletRpcEndpoint(),
                    'confirmed'
                );
                const balance = await connection.getBalance(provider.publicKey);
                walletState.balance = balance / 1e9;
            } catch (e) {
                walletState.balance = 0;
            }

            await refreshWalletNetwork(provider);

            closeWalletModal();
            updateWalletUI();
            notify.success('Wallet connected');

            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey, jwt: walletState.jwt }
            }));

        } catch (error) {
            log.error('[Wallet]', 'Solflare connection failed:', error);
            notify.error('Could not connect to Solflare. Please try again.');
        }
    }

    // Connect to Backpack
    async function connectBackpack() {
        try {
            const provider = window.backpack;

            if (!provider) {
                window.open('https://backpack.app/', '_blank');
                return;
            }

            await provider.connect();
            walletState.publicKey = provider.publicKey.toString();
            walletState.provider = provider;

            // Authenticate and get JWT (required)
            const jwt = await authenticateWallet(provider, walletState.publicKey);
            if (!jwt) {
                notify.error('Signature required to connect. Please try again.');
                disconnectWallet({ clearPreferred: true });
                return;
            }
            walletState.jwt = jwt;
            walletState.connected = true;

            try {
                const connection = new (getWeb3()?.Connection || class{})(
                    getWalletRpcEndpoint(),
                    'confirmed'
                );
                const balance = await connection.getBalance(provider.publicKey);
                walletState.balance = balance / 1e9;
            } catch (e) {
                walletState.balance = 0;
            }

            await refreshWalletNetwork(provider);

            closeWalletModal();
            updateWalletUI();
            notify.success('Wallet connected');

            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey, jwt: walletState.jwt }
            }));

        } catch (error) {
            log.error('[Wallet]', 'Backpack connection failed:', error);
            notify.error('Could not connect to Backpack. Please try again.');
        }
    }

    // Disconnect wallet
    function disconnectWallet({ clearPreferred = false } = {}) {
        try {
            walletState.provider?.disconnect?.();
        } catch (e) {}

        // Clear JWT from localStorage
        clearJWT();
         if (clearPreferred) {
            setPreferredWallet(null);
        }
        
        walletState = {
            connected: false,
            publicKey: null,
            balance: 0,
            provider: null,
            jwt: null,
            network: null,
            networkSource: null
        };
        localStorage.removeItem(LS_WALLET_NETWORK_KEY);
        localStorage.removeItem(LS_WALLET_NETWORK_SOURCE_KEY);
        localStorage.removeItem(LS_WALLET_NETWORK_WALLET_KEY);

        closeWalletDropdown();
        updateWalletUI();
        window.dispatchEvent(new CustomEvent('wallet-disconnected'));
    }

    // Event listeners
    connectBtn?.addEventListener('click', openWalletModal);
    connectBtnMobile?.addEventListener('click', openWalletModal);
    walletModalClose?.addEventListener('click', closeWalletModal);
    walletModalOverlay?.addEventListener('click', closeWalletModal);

    updateWalletDeeplink();

    walletOptions?.forEach(option => {
        option.addEventListener('click', async () => {
            const wallet = option.dataset.wallet;
            setPreferredWallet(wallet);

            await withLoading(option, async () => {
                switch (wallet) {
                    case 'phantom': await connectPhantom(); break;
                    case 'solflare': await connectSolflare(); break;
                    case 'backpack': await connectBackpack(); break;
                }
            }, { loadingText: 'Connecting...' });
        });
    });

    disconnectBtn?.addEventListener('click', disconnectWallet);
    openBuyModalBtn?.addEventListener('click', openBuyModal);
    buyRoborioHeroBtn?.addEventListener('click', openBuyModal);
    buyModalClose?.addEventListener('click', closeBuyModal);
    buyModalOverlay?.addEventListener('click', closeBuyModal);

    // Close wallet dropdown when clicking overlay
    const walletDropdownOverlay = document.getElementById('walletDropdownOverlay');
    walletDropdownOverlay?.addEventListener('click', closeWalletDropdown);

    buyWaitlistBtn?.addEventListener('click', () => {
        closeBuyModal();
    });

    // ESC to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (walletModal?.classList.contains('active')) {
                closeWalletModal();
            }
            if (buyModal?.classList.contains('active')) {
                closeBuyModal();
            }
            if (walletDropdown?.classList.contains('active')) {
                closeWalletDropdown();
            }
        }
    });

    // Refresh network badge periodically and on focus
    setInterval(() => {
        if (walletState.connected) {
            refreshNetworkStatus();
        }
    }, 15000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshNetworkStatus();
        }
    });

    // Auto-connect if previously trusted (silent reconnect on page refresh)
    const autoConnectWallet = async () => {
        try {
            const preferredWallet = getPreferredWallet();
            const { provider } = getWalletProvider(preferredWallet);
            if (!provider?.connect) return;

            // Try silent connect - only works if user previously approved
            const response = await provider.connect({ onlyIfTrusted: true });
            const publicKey = response?.publicKey || provider.publicKey;
            if (!publicKey) return;
            walletState.publicKey = publicKey.toString();
            walletState.connected = true;
            walletState.provider = provider;

            // Get balance
            try {
                const connection = new (getWeb3()?.Connection || class{})(
                    getWalletRpcEndpoint(),
                    'confirmed'
                );
                const balance = await connection.getBalance(publicKey);
                walletState.balance = balance / 1e9;
            } catch (e) {
                walletState.balance = 0;
            }

            await refreshWalletNetwork(provider);

            updateWalletUI();

            // Dispatch event for marketplace to refresh ownership UI
            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey }
            }));

            // Listen for disconnect
            provider.on?.('disconnect', () => {
                disconnectWallet();
                window.dispatchEvent(new CustomEvent('wallet-disconnected'));
            });

            // Listen for account change
            provider.on?.('accountChanged', (publicKey) => {
                if (publicKey) {
                    walletState.publicKey = publicKey.toString();
                    updateWalletUI();
                    window.dispatchEvent(new CustomEvent('wallet-connected', {
                        detail: { publicKey: walletState.publicKey }
                    }));
                } else {
                    disconnectWallet();
                    window.dispatchEvent(new CustomEvent('wallet-disconnected'));
                }
            });

        } catch (e) {
            // User has not previously approved, or wallet not available - silent fail
            log.debug('[Wallet]', 'Auto-connect not available:', e.message);
        }
    };

    // Wait for wallet extension to load, then try auto-connect
    setTimeout(autoConnectWallet, 500);
}

// Export function to get full wallet address (for ownership checks)
export function getFullWalletAddress() {
    return walletState.publicKey;
}

export function getConnectedWalletProvider() {
    if (!walletState.connected) {
        return null;
    }
    return walletState.provider || null;
}
