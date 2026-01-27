'use strict';

import { getCurrentLang } from './i18n.js';
import { log } from './utils/logger.js';
import notify from './ui/notify.js';
import { withLoading } from './ui/withLoading.js';




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
    provider: null
};

export function initWallet() {
    const connectBtn = document.getElementById('connectWallet');
    const connectBtnMobile = document.getElementById('connectWalletMobile');
    const walletModal = document.getElementById('walletModal');
    const walletModalOverlay = document.getElementById('walletModalOverlay');
    const walletModalClose = document.getElementById('walletModalClose');
    const walletDropdown = document.getElementById('walletDropdown');
    const walletOptions = document.querySelectorAll('.wallet-option');
    const disconnectBtn = document.getElementById('disconnectWallet');
    const openBuyModalBtn = document.getElementById('openBuyModal');
    const buyRoborioHeroBtn = document.getElementById('buyRoborioHero');
    const buyModal = document.getElementById('buyModal');
    const buyModalOverlay = document.getElementById('buyModalOverlay');
    const buyModalClose = document.getElementById('buyModalClose');
    const buyWaitlistBtn = document.getElementById('buyWaitlistBtn');

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
                span.textContent = getCurrentLang() === 'ru' ? 'Сначала подключите кошелёк' : 'Connect Wallet First';
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
                textSpan.textContent = getCurrentLang() === 'ru' ? 'Подключить' : 'Connect Wallet';

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
            balanceUsdEl.textContent = '≈ $' + usdValue.toFixed(2);
        }
    }

    // Connect to Phantom
    async function connectPhantom() {
        try {
            const provider = window.phantom?.solana;

            if (!provider?.isPhantom) {
                window.open('https://phantom.app/', '_blank');
                return;
            }

            const response = await provider.connect();
            walletState.publicKey = response.publicKey.toString();
            walletState.connected = true;
            walletState.provider = provider;

            // Get balance
            try {
                const connection = new (window.solanaWeb3?.Connection || class{})(
                    'https://api.mainnet-beta.solana.com',
                    'confirmed'
                );
                const balance = await connection.getBalance(response.publicKey);
                walletState.balance = balance / 1e9; // Convert lamports to SOL
            } catch (e) {
                walletState.balance = 0;
            }

            closeWalletModal();
            updateWalletUI();
            notify.success('Wallet connected');

            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey }
            }));

            provider.on('disconnect', () => {
                disconnectWallet();
                window.dispatchEvent(new CustomEvent('wallet-disconnected'));
            });

            // Listen for account change
            provider.on('accountChanged', (publicKey) => {
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
            walletState.connected = true;
            walletState.provider = provider;

            closeWalletModal();
            updateWalletUI();
            notify.success('Wallet connected');

            // Dispatch event for marketplace to refresh ownership UI
            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey }
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
            walletState.connected = true;
            walletState.provider = provider;

            closeWalletModal();
            updateWalletUI();
            notify.success('Wallet connected');

            // Dispatch event for marketplace to refresh ownership UI
            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey }
            }));

        } catch (error) {
            log.error('[Wallet]', 'Backpack connection failed:', error);
            notify.error('Could not connect to Backpack. Please try again.');
        }
    }

    // Disconnect wallet
    function disconnectWallet() {
        try {
            walletState.provider?.disconnect?.();
        } catch (e) {}

        walletState = {
            connected: false,
            publicKey: null,
            balance: 0,
            provider: null
        };

        closeWalletDropdown();
        updateWalletUI();
    }

    // Event listeners
    connectBtn?.addEventListener('click', openWalletModal);
    connectBtnMobile?.addEventListener('click', openWalletModal);
    walletModalClose?.addEventListener('click', closeWalletModal);
    walletModalOverlay?.addEventListener('click', closeWalletModal);

    walletOptions?.forEach(option => {
        option.addEventListener('click', async () => {
            const wallet = option.dataset.wallet;

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

    // Auto-connect if previously trusted (silent reconnect on page refresh)
    const autoConnectWallet = async () => {
        try {
            const phantom = window.phantom?.solana;
            if (!phantom?.isPhantom) return;

            // Try silent connect - only works if user previously approved
            const response = await phantom.connect({ onlyIfTrusted: true });
            walletState.publicKey = response.publicKey.toString();
            walletState.connected = true;
            walletState.provider = phantom;

            // Get balance
            try {
                const connection = new (window.solanaWeb3?.Connection || class{})(
                    'https://api.mainnet-beta.solana.com',
                    'confirmed'
                );
                const balance = await connection.getBalance(response.publicKey);
                walletState.balance = balance / 1e9;
            } catch (e) {
                walletState.balance = 0;
            }

            updateWalletUI();

            // Dispatch event for marketplace to refresh ownership UI
            window.dispatchEvent(new CustomEvent('wallet-connected', {
                detail: { publicKey: walletState.publicKey }
            }));

            // Listen for disconnect
            phantom.on('disconnect', () => {
                disconnectWallet();
                window.dispatchEvent(new CustomEvent('wallet-disconnected'));
            });

            // Listen for account change
            phantom.on('accountChanged', (publicKey) => {
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