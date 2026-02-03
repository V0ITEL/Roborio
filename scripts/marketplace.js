'use strict';

        import { getFullWalletAddress, getConnectedWalletProvider } from './wallet.js';
        import notify from './ui/notify.js';
        import { withLoading } from './ui/withLoading.js';
        import { normalizeRobot } from './models/robot.js';
        import { safeSelect } from './utils/safeSupabase.js';
        import { log } from './utils/logger.js';
        import * as solanaWeb3 from '@solana/web3.js';
        import { initSupabase, getSupabase, saveRobotToDB, updateRobotInDB, deleteRobotFromDB, upsertEscrowToDB, fetchEscrowsForWallet } from './marketplace/api/supabase.js';
        import { validateRobotData } from './marketplace/utils/validation.js';
        import { createCardRenderer } from './marketplace/ui/cards.js';
        import { openModal, closeModal, closeAllModals } from './marketplace/ui/modals.js';
        import { initRobotForm } from './marketplace/ui/forms.js';

        /** @type {Map<string, import('./models/robot.js').Robot>} */
        const robotsMap = new Map();

        let isLoading = false;
        let loadError = false;

        // ============ SOLANA ESCROW CONFIG ============
        const ESCROW_PLACEHOLDER_ID = 'RoboEscrowXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
        const DEFAULT_ESCROW_CONFIG = {
            programId: import.meta.env.VITE_ESCROW_PROGRAM_ID || ESCROW_PLACEHOLDER_ID,
            network: import.meta.env.VITE_SOLANA_NETWORK || 'devnet',
            rpcEndpoint: import.meta.env.VITE_SOLANA_RPC_ENDPOINT || '',
            solPriceUsd: Number(import.meta.env.VITE_SOL_PRICE_USD) || 100,
            platformFeeWallet: import.meta.env.VITE_ESCROW_PLATFORM_WALLET || ''
        };
        const AUTO_CLOSE_ESCROW_AFTER_COMPLETE = true;

        function getEscrowConfig() {
            const override = window.ROBORIO_ESCROW_CONFIG || {};
            return {
                ...DEFAULT_ESCROW_CONFIG,
                ...override
            };
        }

        const ESCROW_CONFIG = getEscrowConfig();
        const ESCROW_PROGRAM_ID = ESCROW_CONFIG.programId;
        const SOLANA_NETWORK = ESCROW_CONFIG.network;
        const SOLANA_CLUSTER = SOLANA_NETWORK === 'mainnet' ? 'mainnet-beta' : SOLANA_NETWORK;
        const SOL_PRICE_USD = ESCROW_CONFIG.solPriceUsd;

        // Get Solana connection
        function getSolanaConnection() {
            if (ESCROW_CONFIG.rpcEndpoint) {
                return new solanaWeb3.Connection(ESCROW_CONFIG.rpcEndpoint, 'confirmed');
            }
            const endpoint = SOLANA_CLUSTER === 'mainnet-beta'
                ? 'https://api.mainnet-beta.solana.com'
                : SOLANA_CLUSTER === 'testnet'
                    ? 'https://api.testnet.solana.com'
                    : 'https://api.devnet.solana.com';
            return new solanaWeb3.Connection(endpoint, 'confirmed');
        }

        // Convert USD to lamports (1 SOL = 1e9 lamports)
        function usdToLamports(usdAmount) {
            const solAmount = usdAmount / SOL_PRICE_USD;
            return Math.floor(solAmount * solanaWeb3.LAMPORTS_PER_SOL);
        }

        function hasValidEscrowProgram() {
            return ESCROW_PROGRAM_ID && ESCROW_PROGRAM_ID !== ESCROW_PLACEHOLDER_ID;
        }

        async function getConnectedProvider() {
            const provider = getConnectedWalletProvider?.();
            if (!provider) return null;
            if (!provider.publicKey && provider.connect) {
                try {
                    await provider.connect();
                } catch (error) {
                    return null;
                }
            }
            if (!provider.publicKey) return null;
            const expected = getFullWalletAddress();
            const actual = provider.publicKey?.toBase58?.();
            if (expected && actual && expected !== actual) {
                notify.error('Wallet mismatch. Open the wallet menu and reconnect the correct wallet.');
                return null;
            }
            return provider;
        }

        const MIN_FEE_LAMPORTS = 10000;
        const CREATE_ESCROW_BUFFER_LAMPORTS = Math.floor(0.01 * solanaWeb3.LAMPORTS_PER_SOL);

        function normalizeCluster(value) {
            if (!value) return null;
            const text = String(value).toLowerCase();
            if (text.includes('devnet')) return 'devnet';
            if (text.includes('testnet')) return 'testnet';
            if (text.includes('mainnet')) return 'mainnet';
            return text;
        }

        const GENESIS_HASH_CACHE = {
            devnet: null,
            testnet: null,
            mainnet: null,
            promise: null
        };

        function getClusterEndpoint(cluster) {
            if (cluster === 'mainnet') return 'https://api.mainnet-beta.solana.com';
            if (cluster === 'testnet') return 'https://api.testnet.solana.com';
            return 'https://api.devnet.solana.com';
        }

        async function loadGenesisHashMap() {
            if (GENESIS_HASH_CACHE.promise) return GENESIS_HASH_CACHE.promise;
            GENESIS_HASH_CACHE.promise = (async () => {
                const clusters = ['devnet', 'testnet', 'mainnet'];
                await Promise.all(clusters.map(async (cluster) => {
                    try {
                        const connection = new solanaWeb3.Connection(getClusterEndpoint(cluster), 'confirmed');
                        const hash = await connection.getGenesisHash();
                        GENESIS_HASH_CACHE[cluster] = hash;
                    } catch (error) {
                        log.warn('[Marketplace]', 'Failed to load genesis hash for', cluster, error);
                    }
                }));
                return GENESIS_HASH_CACHE;
            })();
            return GENESIS_HASH_CACHE.promise;
        }

        function getProviderEndpoint(provider) {
            const safeGet = (getter) => {
                try {
                    return getter();
                } catch (error) {
                    return null;
                }
            };
            return safeGet(() => provider?.connection?.rpcEndpoint)
                || safeGet(() => provider?.connection?._rpcEndpoint)
                || safeGet(() => provider?._connection?.rpcEndpoint)
                || safeGet(() => provider?._connection?._rpcEndpoint)
                || safeGet(() => provider?.adapter?.connection?.rpcEndpoint)
                || safeGet(() => provider?.adapter?.connection?._rpcEndpoint)
                || safeGet(() => provider?.wallet?.adapter?.connection?.rpcEndpoint)
                || safeGet(() => provider?.wallet?.adapter?.connection?._rpcEndpoint)
                || safeGet(() => provider?.rpcEndpoint)
                || safeGet(() => provider?.endpoint)
                || safeGet(() => provider?.rpc?.endpoint)
                || safeGet(() => provider?.rpc?.rpcEndpoint)
                || null;
        }

        async function detectWalletNetwork(provider) {
            const cached = localStorage.getItem('wallet_active_network');
            const cachedWallet = localStorage.getItem('wallet_active_network_wallet');
            const providerKey = provider?.publicKey?.toString?.() || null;
            if (cached && cachedWallet && providerKey && cachedWallet === providerKey) return cached;
            const safeGet = (getter) => {
                try {
                    return getter();
                } catch (error) {
                    return null;
                }
            };
            const direct = safeGet(() => provider?.network)
                || safeGet(() => provider?.connection?.network)
                || safeGet(() => provider?._connection?.network)
                || safeGet(() => provider?.adapter?.connection?.network)
                || null;
            const endpoint = getProviderEndpoint(provider);
            const normalized = normalizeCluster(direct || endpoint);
            if (normalized) return normalized;

            if (endpoint) {
                try {
                    const connection = new solanaWeb3.Connection(endpoint, 'confirmed');
                    const walletGenesis = await connection.getGenesisHash();
                    if (walletGenesis) {
                        const map = await loadGenesisHashMap();
                        const match = ['devnet', 'testnet', 'mainnet']
                            .find((cluster) => map[cluster] === walletGenesis);
                        if (match) return match;
                    }
                } catch (error) {
                    log.debug('[Marketplace]', 'Wallet network detect via endpoint failed:', error?.message || error);
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
                        log.debug('[Marketplace]', 'Wallet network request not available:', fallbackError?.message || fallbackError);
                    }
                }
            }
            return null;
        }

        function formatNetworkLabel(value) {
            const normalized = normalizeCluster(value);
            if (normalized === 'mainnet') return 'mainnet';
            if (normalized === 'testnet') return 'testnet';
            if (normalized === 'devnet') return 'devnet';
            return normalized || 'unknown';
        }

        async function ensureWalletCanFundEscrow(provider, amountLamports) {
            const walletNetwork = await detectWalletNetwork(provider);
            const targetNetwork = formatNetworkLabel(SOLANA_CLUSTER);
            if (!walletNetwork) {
                throw new Error(`Wallet network not detected. Switch your wallet to ${targetNetwork} and try again.`);
            }
            if (normalizeCluster(walletNetwork) !== normalizeCluster(SOLANA_CLUSTER)) {
                throw new Error(`Network mismatch. Switch your wallet to ${targetNetwork}.`);
            }

            const connection = getSolanaConnection();
            const signerKey = provider.publicKey;
            const accountInfo = await connection.getAccountInfo(signerKey);
            if (!accountInfo) {
                throw new Error(`Wallet has no SOL on ${targetNetwork}. Add SOL and try again.`);
            }

            const balance = await connection.getBalance(signerKey);
            const requiredLamports = Number(amountLamports || 0) + CREATE_ESCROW_BUFFER_LAMPORTS + MIN_FEE_LAMPORTS;
            if (balance < requiredLamports) {
                const requiredSol = requiredLamports / solanaWeb3.LAMPORTS_PER_SOL;
                throw new Error(`Insufficient SOL. Need about ${requiredSol.toFixed(4)} SOL to cover escrow and fees.`);
            }
        }

        async function ensurePlatformWalletReady() {
            if (!ESCROW_CONFIG.platformFeeWallet) return;
            const targetNetwork = formatNetworkLabel(SOLANA_CLUSTER);
            let platformKey;
            try {
                platformKey = new solanaWeb3.PublicKey(ESCROW_CONFIG.platformFeeWallet);
            } catch (error) {
                throw new Error('Invalid platform wallet address. Update VITE_ESCROW_PLATFORM_WALLET.');
            }
            const connection = getSolanaConnection();
            const info = await connection.getAccountInfo(platformKey);
            if (!info) {
                throw new Error(`Platform wallet has no SOL on ${targetNetwork}. Fund it before completing.`);
            }
        }

        function compactRobotIdForEscrow(robotId) {
            const raw = String(robotId || '').trim();
            if (!raw) {
                throw new Error('Robot ID is missing for escrow.');
            }
            const compact = raw.replace(/[^a-zA-Z0-9]/g, '');
            const candidate = compact.length ? compact : raw;
            if (candidate.length <= 32) {
                return candidate;
            }
            return candidate.slice(0, 32);
        }

        function resolvePlatformKey(renterPubkey) {
            try {
                if (ESCROW_CONFIG.platformFeeWallet) {
                    return new solanaWeb3.PublicKey(ESCROW_CONFIG.platformFeeWallet);
                }
            } catch (error) {
                log.warn('[Marketplace]', 'Invalid platform wallet. Falling back to renter.', error);
            }
            return renterPubkey;
        }

        const DISCRIMINATOR_CACHE = new Map();

        async function getAnchorDiscriminator(ixName) {
            if (DISCRIMINATOR_CACHE.has(ixName)) {
                return DISCRIMINATOR_CACHE.get(ixName);
            }
            const preimage = new TextEncoder().encode(`global:${ixName}`);
            const hashBuffer = await crypto.subtle.digest('SHA-256', preimage);
            const discriminator = Buffer.from(hashBuffer).subarray(0, 8);
            DISCRIMINATOR_CACHE.set(ixName, discriminator);
            return discriminator;
        }

        function encodeU64LE(value) {
            const buffer = Buffer.alloc(8);
            const bigValue = typeof value === 'bigint' ? value : BigInt(value);
            buffer.writeBigUInt64LE(bigValue, 0);
            return buffer;
        }

        function encodeString(value) {
            const encoded = new TextEncoder().encode(value);
            const length = Buffer.alloc(4);
            length.writeUInt32LE(encoded.length, 0);
            return Buffer.concat([length, Buffer.from(encoded)]);
        }

        async function buildInstructionData(ixName, args = []) {
            const discriminator = await getAnchorDiscriminator(ixName);
            if (!args.length) {
                return discriminator;
            }
            return Buffer.concat([discriminator, ...args]);
        }

        async function sendEscrowTransaction(instruction, provider) {
            const connection = getSolanaConnection();
            const transaction = new solanaWeb3.Transaction().add(instruction);
            transaction.feePayer = provider.publicKey;
            const latest = await connection.getLatestBlockhash();
            transaction.recentBlockhash = latest.blockhash;
            const signed = await provider.signTransaction(transaction);
            const signature = await connection.sendRawTransaction(signed.serialize());
            await confirmSignature(connection, signature, {
                commitment: 'confirmed',
                timeoutMs: 60000
            });
            return signature;
        }

        async function confirmSignature(connection, signature, { commitment = 'confirmed', timeoutMs = 30000 } = {}) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
                const status = value?.[0];
                if (status?.err) {
                    throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
                }
                const confirmation = status?.confirmationStatus || (status?.confirmations ? 'confirmed' : null);
                if (confirmation === 'confirmed' || confirmation === 'finalized') {
                    return status;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            throw new Error('Transaction confirmation timed out.');
        }

        function getSolscanTxUrl(signature) {
            const baseUrl = 'https://solscan.io/tx/' + signature;
            if (SOLANA_CLUSTER === 'devnet') {
                return `${baseUrl}?cluster=devnet`;
            }
            if (SOLANA_CLUSTER === 'testnet') {
                return `${baseUrl}?cluster=testnet`;
            }
            return baseUrl;
        }

        function getSolscanAddressUrl(address) {
            const baseUrl = 'https://solscan.io/account/' + address;
            if (SOLANA_CLUSTER === 'devnet') {
                return `${baseUrl}?cluster=devnet`;
            }
            if (SOLANA_CLUSTER === 'testnet') {
                return `${baseUrl}?cluster=testnet`;
            }
            return baseUrl;
        }

        // Find Escrow PDA
        async function findEscrowPDA(renter, operator, robotId) {
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);
            const [pda] = await solanaWeb3.PublicKey.findProgramAddress(
                [
                    Buffer.from('escrow'),
                    renter.toBuffer(),
                    operator.toBuffer(),
                    Buffer.from(robotId)
                ],
                programId
            );
            return pda;
        }

        async function buildCreateRentalInstruction({ renter, operator, escrowPda, robotId, amountLamports, durationHours }) {
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);
            const data = await buildInstructionData('create_rental', [
                encodeString(robotId),
                encodeU64LE(amountLamports),
                encodeU64LE(durationHours)
            ]);
            const keys = [
                { pubkey: renter, isSigner: true, isWritable: true },
                { pubkey: operator, isSigner: false, isWritable: false },
                { pubkey: escrowPda, isSigner: false, isWritable: true },
                { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false }
            ];
            return new solanaWeb3.TransactionInstruction({ programId, keys, data });
        }

        async function buildCompleteRentalInstruction({ renter, operator, escrowPda, platform }) {
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);
            const data = await buildInstructionData('complete_rental');
            const keys = [
                { pubkey: renter, isSigner: true, isWritable: true },
                { pubkey: operator, isSigner: false, isWritable: true },
                { pubkey: escrowPda, isSigner: false, isWritable: true }
            ];
            keys.push({ pubkey: platform, isSigner: false, isWritable: true });
            return new solanaWeb3.TransactionInstruction({ programId, keys, data });
        }

        async function buildCancelRentalInstruction({ signer, renter, escrowPda }) {
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);
            const data = await buildInstructionData('cancel_rental');
            const keys = [
                { pubkey: signer, isSigner: true, isWritable: true },
                { pubkey: renter, isSigner: false, isWritable: true },
                { pubkey: escrowPda, isSigner: false, isWritable: true }
            ];
            return new solanaWeb3.TransactionInstruction({ programId, keys, data });
        }

        async function buildClaimExpiredInstruction({ operator, escrowPda }) {
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);
            const data = await buildInstructionData('claim_expired');
            const keys = [
                { pubkey: operator, isSigner: true, isWritable: true },
                { pubkey: escrowPda, isSigner: false, isWritable: true }
            ];
            return new solanaWeb3.TransactionInstruction({ programId, keys, data });
        }

        async function buildCloseEscrowInstruction({ renter, escrowPda }) {
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);
            const data = await buildInstructionData('close_escrow');
            const keys = [
                { pubkey: renter, isSigner: true, isWritable: true },
                { pubkey: escrowPda, isSigner: false, isWritable: true }
            ];
            return new solanaWeb3.TransactionInstruction({ programId, keys, data });
        }

        async function createRentalEscrow(operatorWallet, robotId, amountUsd, durationHours = 24) {
            if (!hasValidEscrowProgram()) {
                throw new Error('Escrow program is not configured. Set VITE_ESCROW_PROGRAM_ID.');
            }

            const provider = await getConnectedProvider();
            if (!provider) {
                throw new Error('No Solana wallet found. Please install Phantom or Solflare.');
            }

            const renter = provider.publicKey;
            const operator = new solanaWeb3.PublicKey(operatorWallet);
            const escrowRobotId = compactRobotIdForEscrow(robotId);
            const escrowPda = await findEscrowPDA(renter, operator, escrowRobotId);
            const connection = getSolanaConnection();
            const existingInfo = await connection.getAccountInfo(escrowPda);
            if (existingInfo?.data) {
                const state = parseEscrowAccount(Buffer.from(existingInfo.data));
                const amountLamports = state.amount ? Number(state.amount) : 0;
                return {
                    success: true,
                    existing: true,
                    signature: null,
                    escrowPda: escrowPda.toBase58(),
                    amount: amountLamports,
                    amountSol: amountLamports ? amountLamports / solanaWeb3.LAMPORTS_PER_SOL : 0,
                    robotId: escrowRobotId,
                    renter: renter.toBase58(),
                    operator: operator.toBase58(),
                    status: state.status,
                    statusLabel: ESCROW_STATUS_LABELS[state.status] || 'Unknown',
                    expiresAt: state.expiresAt ? Number(state.expiresAt) * 1000 : null
                };
            }
            const lamports = usdToLamports(amountUsd);
            await ensureWalletCanFundEscrow(provider, lamports);

            const instruction = await buildCreateRentalInstruction({
                renter,
                operator,
                escrowPda,
                robotId: escrowRobotId,
                amountLamports: lamports,
                durationHours
            });

            const signature = await sendEscrowTransaction(instruction, provider);

            return {
                success: true,
                signature,
                escrowPda: escrowPda.toBase58(),
                amount: lamports,
                amountSol: lamports / solanaWeb3.LAMPORTS_PER_SOL,
                robotId: escrowRobotId,
                renter: renter.toBase58(),
                operator: operator.toBase58(),
                expiresAt: Date.now() + durationHours * 3600 * 1000
            };
        }

        const ESCROW_STATUS_LABELS = ['Active', 'Completed', 'Cancelled', 'Expired'];
        const FINAL_ESCROW_STATUS = new Set([1, 2, 3]);

        function isFinalEscrowStatus(status, statusLabel) {
            if (Number.isInteger(status)) {
                return FINAL_ESCROW_STATUS.has(status);
            }
            const normalized = (statusLabel || '').toLowerCase();
            return normalized === 'completed' || normalized === 'cancelled' || normalized === 'expired';
        }

        function isActiveEscrowStatus(status, statusLabel) {
            return !isFinalEscrowStatus(status, statusLabel);
        }

        function getEscrowStatusKey(status, statusLabel) {
            if (Number.isInteger(status)) {
                if (status === 0) return 'active';
                if (status === 1) return 'completed';
                if (status === 2) return 'cancelled';
                if (status === 3) return 'expired';
            }
            const label = (statusLabel || '').toLowerCase();
            if (label.includes('complete')) return 'completed';
            if (label.includes('cancel')) return 'cancelled';
            if (label.includes('expire')) return 'expired';
            if (label.includes('active')) return 'active';
            return 'active';
        }

        function readBigUInt64LE(buffer, offset) {
            const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
            return view.getBigUint64(0, true);
        }

        function readBigInt64LE(buffer, offset) {
            const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
            return view.getBigInt64(0, true);
        }

        function parseEscrowAccount(data) {
            let offset = 8; // discriminator
            const renter = new solanaWeb3.PublicKey(data.subarray(offset, offset + 32)).toBase58();
            offset += 32;
            const operator = new solanaWeb3.PublicKey(data.subarray(offset, offset + 32)).toBase58();
            offset += 32;
            const robotIdLength = data.readUInt32LE(offset);
            offset += 4;
            const robotId = new TextDecoder().decode(data.subarray(offset, offset + robotIdLength));
            offset += robotIdLength;
            const amount = readBigUInt64LE(data, offset);
            offset += 8;
            const createdAt = readBigInt64LE(data, offset);
            offset += 8;
            const expiresAt = readBigInt64LE(data, offset);
            offset += 8;
            const status = data[offset];
            offset += 1;
            const bump = data[offset];
            return { renter, operator, robotId, amount, createdAt, expiresAt, status, bump };
        }

        async function fetchEscrowState(escrowAddress) {
            const connection = getSolanaConnection();
            const info = await connection.getAccountInfo(new solanaWeb3.PublicKey(escrowAddress));
            if (!info?.data) return null;
            return parseEscrowAccount(Buffer.from(info.data));
        }

        // ============ MARKETPLACE UI & LOGIC ============
        // Variables will be set in initMarketplace
        let currentRobot = null;
        let currentEscrowContext = null;
        const escrowsByRobotId = new Map();
        const escrowsByPda = new Map();
        let escrowAutoRefreshTimer = null;
        let addRobotBtn, addRobotToolbarBtn, addRobotEmptyBtn, addRobotModal, addRobotForm;
        let seedRobotsBtn;
        let gridToggleBtns;
        let rentRobotModal, successModal, robotsGrid, marketplaceEmpty, marketplaceNoResults, marketplaceSentinel;
        let filterBtns, walletModal, walletModalOverlay;
        let searchInput, sortSelect;
        let viewAllBtn, viewMineBtn, viewEscrowsBtn, syncEscrowsBtn, historyToggleBtn;
        let escrowStatusFilterEl, escrowStatusButtons;
        let robotAddedModal, robotErrorModal;
        let escrowDetails, escrowStatusValue, escrowAddressValue, escrowExpiresValue, escrowTxLink, escrowNetworkValue;
        let escrowRenterValue, escrowOperatorValue;
        let escrowRoleValue, escrowAmountValue, escrowRobotValue, escrowOpenDashboardBtn;
        let escrowClosedBadge, escrowCancelLabel, escrowCancelHelp, escrowDisputeBtn;
        let escrowPrimaryRow, escrowPrimaryActionBtn, escrowPrimaryHint, escrowActionSummary, escrowMoreToggle, escrowActionsGroup;
        let escrowCompleteBtn, escrowCancelBtn, escrowClaimBtn, escrowCloseBtn, escrowRefreshBtn;
        let escrowNetworkAlert, escrowNetworkAlertText, escrowBalanceAlert, escrowBalanceAlertText;
        let escrowActionBlocked = false;
        let escrowActionBlockReason = '';
        let cardRenderer = null;
        let resetAddRobotForm = null;
        let activeCategory = 'all';
        let searchTerm = '';
        let sortMode = 'newest';
        let viewMode = 'all';
        let includeEscrowHistory = false;
        let escrowStatusFilter = 'active';
        const PAGE_SIZE = 12;
        let nextOffset = 0;
        let hasMore = true;
        let isLoadingMore = false;
        let infiniteObserver = null;

        // Check if wallet connected
        function isWalletConnected() {
            return !!getFullWalletAddress();
        }

        // Get connected wallet address (full address for ownership/RLS)
        function getConnectedWallet() {
            return getFullWalletAddress() || null;
        }

        function openExistingWalletModal() {
            if (walletModal && walletModalOverlay) {
                walletModal.classList.add('active');
                walletModalOverlay.classList.add('active');
            }
        }

        /**
         * Require wallet connection or prompt user to connect
         * @returns {string|null} wallet address if connected, null if not
         */
        function requireWalletOrPrompt() {
            const wallet = getConnectedWallet();
            if (wallet) return wallet;

            notify.info('Connect your wallet to continue');
            openExistingWalletModal();
            return null;
        }

        function formatDateTime(timestampMs) {
            if (!timestampMs) return '--';
            return new Date(timestampMs).toLocaleString();
        }

        function formatShortAddress(address) {
            if (!address) return '--';
            const value = String(address);
            if (value.length <= 10) return value;
            return `${value.slice(0, 4)}...${value.slice(-4)}`;
        }

        function formatSolAmount(amountSol, amountLamports) {
            let amount = null;
            if (amountSol !== null && amountSol !== undefined) {
                const parsed = Number(amountSol);
                if (Number.isFinite(parsed)) {
                    amount = parsed;
                }
            }
            if (amount === null) {
                if (typeof amountLamports === 'bigint') {
                    amount = Number(amountLamports) / solanaWeb3.LAMPORTS_PER_SOL;
                } else if (amountLamports !== null && amountLamports !== undefined) {
                    const parsedLamports = Number(amountLamports);
                    if (Number.isFinite(parsedLamports)) {
                        amount = parsedLamports / solanaWeb3.LAMPORTS_PER_SOL;
                    }
                }
            }
            if (amount === null || Number.isNaN(amount)) return '--';
            return `${amount.toFixed(4)} SOL`;
        }

        function getEscrowRole(context) {
            const wallet = getConnectedWallet();
            if (!wallet) {
                return { role: 'disconnected', label: 'Connect wallet' };
            }
            if (!context) {
                return { role: 'viewer', label: 'Access: Viewer' };
            }
            if (wallet === context.renter && wallet === context.operator) {
                return { role: 'both', label: 'Access: Client/Operator' };
            }
            if (wallet === context.renter) {
                return { role: 'client', label: 'Access: Client' };
            }
            if (wallet === context.operator) {
                return { role: 'operator', label: 'Access: Operator' };
            }
            return { role: 'viewer', label: 'Access: Viewer' };
        }

        const ESCROW_AUTO_REFRESH_MS = 20000;
        let hasShownEscrowHistoryToast = false;

        function getEscrowRobotKey(context) {
            return context?.robotDbId || context?.robotId || null;
        }

        function startEscrowAutoRefresh() {
            if (escrowAutoRefreshTimer) {
                clearInterval(escrowAutoRefreshTimer);
            }
            escrowAutoRefreshTimer = setInterval(() => {
                if (successModal?.classList.contains('active')) {
                    refreshEscrowState();
                }
            }, ESCROW_AUTO_REFRESH_MS);
        }

        function stopEscrowAutoRefresh() {
            if (!escrowAutoRefreshTimer) return;
            clearInterval(escrowAutoRefreshTimer);
            escrowAutoRefreshTimer = null;
        }

        async function persistEscrowContext(context, state = null) {
            const supabase = getSupabase();
            if (!supabase) return;

            const status = state ? state.status : context.status;
            const statusLabel = Number.isInteger(status) ? ESCROW_STATUS_LABELS[status] : context.statusLabel;
            const expiresAt = state?.expiresAt
                ? new Date(Number(state.expiresAt) * 1000).toISOString()
                : context.expiresAt
                    ? new Date(context.expiresAt).toISOString()
                    : null;

            const payload = {
                escrow_pda: context.escrowPda,
                network: SOLANA_NETWORK,
                renter_wallet: context.renter,
                operator_wallet: context.operator,
                robot_id: context.robotDbId || context.robotId,
                robot_seed: context.robotId,
                robot_name: context.robotName || null,
                amount_lamports: context.amount ?? null,
                amount_sol: context.amountSol ?? null,
                status: Number.isInteger(status) ? status : null,
                status_label: statusLabel || null,
                expires_at: expiresAt,
                last_signature: context.lastSignature || context.signature || null,
                cancel_status: context.cancelStatus || null,
                cancel_requested_by: context.cancelRequestedBy || null,
                cancel_requested_at: context.cancelRequestedAt
                    ? new Date(context.cancelRequestedAt).toISOString()
                    : null,
                cancel_resolved_by: context.cancelResolvedBy || null,
                cancel_resolved_at: context.cancelResolvedAt
                    ? new Date(context.cancelResolvedAt).toISOString()
                    : null,
                closed_at: context.closedAt ? new Date(context.closedAt).toISOString() : null,
                closed_by: context.closedBy || null,
                close_signature: context.closeSignature || null,
                updated_at: new Date().toISOString()
            };

            await upsertEscrowToDB(payload);
        }

        async function registerEscrowContext(context, state = null) {
            if (!context?.escrowPda) return;
            const key = getEscrowRobotKey(context);
            const status = state ? state.status : context.status;
            const statusLabel = Number.isInteger(status) ? ESCROW_STATUS_LABELS[status] : context.statusLabel;
            const expiresAt = state?.expiresAt
                ? Number(state.expiresAt) * 1000
                : context.expiresAt || null;
            const merged = {
                ...context,
                status: Number.isInteger(status) ? status : context.status,
                statusLabel,
                expiresAt
            };

            if (key) {
                escrowsByRobotId.set(String(key), merged);
                cardRenderer?.updateEscrowAction?.(String(key), true);
            }
            escrowsByPda.set(context.escrowPda, merged);
            if (currentEscrowContext?.escrowPda === context.escrowPda) {
                currentEscrowContext = merged;
            }
            await persistEscrowContext(merged, state);
        }

        function clearEscrows() {
            escrowsByRobotId.clear();
            escrowsByPda.clear();
            if (!robotsGrid || !cardRenderer?.updateEscrowAction) return;
            robotsGrid.querySelectorAll('[data-robot-id]').forEach((card) => {
                const robotId = card.dataset.robotId;
                cardRenderer.updateEscrowAction(robotId, false);
            });
        }

        async function loadEscrowsForWallet(wallet, { showToast = false } = {}) {
            if (!wallet) return;
            const { success, data } = await fetchEscrowsForWallet(wallet, SOLANA_NETWORK);
            if (!success || !Array.isArray(data)) return;

            data.forEach((row) => {
                if (!row?.escrow_pda) return;
                const context = {
                    escrowPda: row.escrow_pda,
                    renter: row.renter_wallet,
                    operator: row.operator_wallet,
                    robotId: row.robot_seed || row.robot_id,
                    robotDbId: row.robot_id,
                    robotName: row.robot_name,
                    amount: row.amount_lamports,
                    amountSol: row.amount_sol,
                    status: row.status,
                    statusLabel: row.status_label,
                    expiresAt: row.expires_at ? Date.parse(row.expires_at) : null,
                    lastSignature: row.last_signature,
                    cancelStatus: row.cancel_status,
                    cancelRequestedBy: row.cancel_requested_by,
                    cancelRequestedAt: row.cancel_requested_at ? Date.parse(row.cancel_requested_at) : null,
                    cancelResolvedBy: row.cancel_resolved_by,
                    cancelResolvedAt: row.cancel_resolved_at ? Date.parse(row.cancel_resolved_at) : null,
                    closedAt: row.closed_at ? Date.parse(row.closed_at) : null,
                    closedBy: row.closed_by,
                    closeSignature: row.close_signature
                };
                if (context.robotDbId) {
                    escrowsByRobotId.set(String(context.robotDbId), context);
                    cardRenderer?.updateEscrowAction?.(String(context.robotDbId), true);
                }
                escrowsByPda.set(context.escrowPda, context);
            });

            if (data.length > 0 && !hasShownEscrowHistoryToast) {
                notify.info('Escrow loaded from history.');
                hasShownEscrowHistoryToast = true;
            }

            if (showToast) {
                notify.success(`Escrow sync complete (${data.length}).`);
            }
        }

        function applyEscrowActionBlock(blocked, reason) {
            escrowActionBlocked = blocked;
            escrowActionBlockReason = reason || '';
            if (!blocked) return;
            if (escrowPrimaryHint && reason) {
                escrowPrimaryHint.textContent = reason;
            }
            if (escrowActionSummary && reason) {
                escrowActionSummary.textContent = reason;
            }
            const primaryAction = escrowPrimaryActionBtn?.dataset?.action || '';
            [escrowPrimaryActionBtn, escrowCompleteBtn, escrowCancelBtn, escrowDisputeBtn, escrowClaimBtn, escrowCloseBtn]
                .filter(Boolean)
                .forEach((btn) => {
                    if (btn === escrowPrimaryActionBtn && primaryAction === 'refresh') {
                        return;
                    }
                    btn.disabled = true;
                });
        }

        function resetEscrowAlerts() {
            if (escrowNetworkAlert) {
                escrowNetworkAlert.classList.add('is-hidden');
            }
            if (escrowBalanceAlert) {
                escrowBalanceAlert.classList.add('is-hidden');
            }
            escrowActionBlocked = false;
            escrowActionBlockReason = '';
        }

        async function updateEscrowWarnings(context) {
            resetEscrowAlerts();
            if (!context || !escrowDetails) return;
            const provider = await getConnectedProvider();
            if (!provider) return;

            const walletNetwork = await detectWalletNetwork(provider);
            const targetNetwork = formatNetworkLabel(SOLANA_CLUSTER);
            const walletNetworkLabel = formatNetworkLabel(walletNetwork);
            let blocked = false;
            let blockReason = '';

            if (walletNetwork && normalizeCluster(walletNetwork) !== normalizeCluster(SOLANA_CLUSTER)) {
                if (escrowNetworkAlert && escrowNetworkAlertText) {
                    escrowNetworkAlertText.textContent = `Switch your wallet to ${targetNetwork} to continue.`;
                    escrowNetworkAlert.classList.remove('is-hidden');
                }
                blocked = true;
                blockReason = `Network mismatch: wallet is ${walletNetworkLabel}, escrow is ${targetNetwork}.`;
            } else if (!walletNetwork && escrowNetworkAlert && escrowNetworkAlertText) {
                escrowNetworkAlertText.textContent = `Wallet network not detected. Make sure it's set to ${targetNetwork}.`;
                escrowNetworkAlert.classList.remove('is-hidden');
                blocked = true;
                blockReason = `Wallet network not detected. Switch to ${targetNetwork}.`;
            }

            const connection = getSolanaConnection();
            const signerKey = provider.publicKey;
            let balanceWarning = '';
            let balanceBlocks = false;
            try {
                const signerInfo = await connection.getAccountInfo(signerKey);
                if (!signerInfo) {
                    balanceWarning = `Fund this wallet on ${targetNetwork} to cover network fees.`;
                    balanceBlocks = true;
                } else {
                    const balance = await connection.getBalance(signerKey);
                    if (balance < MIN_FEE_LAMPORTS) {
                        balanceWarning = `Low balance. Add SOL on ${targetNetwork} for fees.`;
                        balanceBlocks = true;
                    }
                }
            } catch (error) {
                log.warn('[Marketplace]', 'Failed to load wallet balance:', error);
            }

            const connectedWallet = getConnectedWallet();
            const isClient = !!connectedWallet && connectedWallet === context.renter;
            if (isClient && ESCROW_CONFIG.platformFeeWallet) {
                try {
                    const platformKey = new solanaWeb3.PublicKey(ESCROW_CONFIG.platformFeeWallet);
                    const platformInfo = await connection.getAccountInfo(platformKey);
                    if (!platformInfo) {
                        balanceWarning = balanceWarning
                            ? `${balanceWarning} Platform wallet needs SOL on ${targetNetwork} to receive fees.`
                            : `Platform wallet needs SOL on ${targetNetwork} to receive fees.`;
                    }
                } catch (error) {
                    log.warn('[Marketplace]', 'Invalid platform wallet when checking balance.', error);
                }
            }

            if (balanceWarning && escrowBalanceAlert && escrowBalanceAlertText) {
                escrowBalanceAlertText.textContent = balanceWarning;
                escrowBalanceAlert.classList.remove('is-hidden');
            }

            if (!blocked && balanceBlocks) {
                blocked = true;
                blockReason = balanceWarning || 'Insufficient SOL for network fees.';
            }

            if (blocked) {
                applyEscrowActionBlock(true, blockReason);
            }
        }

        function updateEscrowUI(context, state = null) {
            if (!escrowDetails) return;
            if (!context) {
                escrowDetails.classList.add('is-hidden');
                [escrowPrimaryActionBtn, escrowCompleteBtn, escrowCancelBtn, escrowDisputeBtn, escrowClaimBtn, escrowCloseBtn, escrowRefreshBtn]
                    .filter(Boolean)
                    .forEach((btn) => {
                        btn.disabled = true;
                    });
                resetEscrowAlerts();
                return;
            }
            escrowDetails.classList.remove('is-hidden');
            [escrowPrimaryActionBtn, escrowCompleteBtn, escrowCancelBtn, escrowDisputeBtn, escrowClaimBtn, escrowCloseBtn, escrowRefreshBtn]
                .filter(Boolean)
                .forEach((btn) => {
                    btn.disabled = false;
                });

            if (escrowNetworkValue) {
                escrowNetworkValue.textContent = SOLANA_NETWORK;
            }

            const roleInfo = getEscrowRole(context);
            if (escrowRoleValue) {
                escrowRoleValue.textContent = roleInfo.label;
                escrowRoleValue.dataset.role = roleInfo.role;
            }

            if (escrowClosedBadge) {
                escrowClosedBadge.classList.toggle('is-hidden', !context.closedAt);
            }

            if (escrowStatusValue) {
                if (state) {
                    const label = ESCROW_STATUS_LABELS[state.status] || 'Unknown';
                    escrowStatusValue.textContent = label;
                    escrowStatusValue.dataset.status = label.toLowerCase();
                } else if (context.statusLabel) {
                    escrowStatusValue.textContent = context.statusLabel;
                    escrowStatusValue.dataset.status = context.statusLabel.toLowerCase();
                } else {
                    escrowStatusValue.textContent = 'Pending';
                    escrowStatusValue.dataset.status = 'pending';
                }
            }

            if (escrowRobotValue) {
                escrowRobotValue.textContent = context.robotName || state?.robotId || context.robotId || context.robotDbId || '--';
            }

            if (escrowAmountValue) {
                const amountLamports = state?.amount ?? context.amount;
                const contextAmountSol = context.amountSol !== null && context.amountSol !== undefined
                    ? Number(context.amountSol)
                    : null;
                const amountSol = Number.isFinite(contextAmountSol)
                    ? contextAmountSol
                    : typeof state?.amount === 'bigint'
                        ? Number(state.amount) / solanaWeb3.LAMPORTS_PER_SOL
                        : amountLamports !== null && amountLamports !== undefined
                            ? Number(amountLamports) / solanaWeb3.LAMPORTS_PER_SOL
                            : null;
                escrowAmountValue.textContent = formatSolAmount(amountSol, amountLamports);
            }

            if (escrowAddressValue) {
                escrowAddressValue.textContent = context.escrowPda || '--';
                escrowAddressValue.href = context.escrowPda ? getSolscanAddressUrl(context.escrowPda) : '#';
            }

            if (escrowRenterValue) {
                escrowRenterValue.textContent = formatShortAddress(context.renter);
                escrowRenterValue.href = context.renter ? getSolscanAddressUrl(context.renter) : '#';
            }
            if (escrowOperatorValue) {
                escrowOperatorValue.textContent = formatShortAddress(context.operator);
                escrowOperatorValue.href = context.operator ? getSolscanAddressUrl(context.operator) : '#';
            }

            if (escrowExpiresValue) {
                if (state?.expiresAt) {
                    escrowExpiresValue.textContent = formatDateTime(Number(state.expiresAt) * 1000);
                } else if (context.expiresAt) {
                    escrowExpiresValue.textContent = formatDateTime(context.expiresAt);
                } else {
                    escrowExpiresValue.textContent = '--';
                }
            }

            const txSignature = context.lastSignature || context.signature;
            if (escrowTxLink) {
                escrowTxLink.href = txSignature ? getSolscanTxUrl(txSignature) : '#';
                escrowTxLink.textContent = txSignature ? 'View on Solscan' : '--';
            }

            const statusValue = Number.isInteger(state?.status)
                ? state.status
                : Number.isInteger(context.status)
                    ? context.status
                    : null;
            const statusLabelHint = state
                ? ESCROW_STATUS_LABELS[state.status] || ''
                : context.statusLabel || escrowStatusValue?.textContent || '';
            const statusKey = getEscrowStatusKey(statusValue, statusLabelHint);
            const isActive = statusKey === 'active';
            const isFinal = statusKey === 'completed' || statusKey === 'cancelled' || statusKey === 'expired';
            const expiresAtSeconds = typeof state?.expiresAt === 'bigint'
                ? Number(state.expiresAt)
                : Number.isFinite(state?.expiresAt)
                    ? Number(state.expiresAt)
                    : Number.isFinite(context.expiresAt)
                        ? Math.floor(context.expiresAt / 1000)
                        : null;
            const nowSeconds = Math.floor(Date.now() / 1000);
            const isExpired = expiresAtSeconds ? expiresAtSeconds < nowSeconds : false;
            const connectedWallet = getConnectedWallet();
            const isClient = !!connectedWallet && connectedWallet === context.renter;
            const isOperator = !!connectedWallet && connectedWallet === context.operator;
            const hasOnChainState = !!state;
            const cancelStatus = context.cancelStatus || null;
            const cancelRequestedBy = context.cancelRequestedBy || null;
            const isCancelRequested = cancelStatus === 'requested';
            const isCancelDisputed = cancelStatus === 'disputed';
            const isCancelApproved = cancelStatus === 'approved';

            if (escrowCompleteBtn) {
                escrowCompleteBtn.classList.toggle('is-hidden', !isClient);
                escrowCompleteBtn.disabled = !(hasOnChainState && isActive && isClient);
            }
            if (escrowCancelBtn) {
                if (isClient) {
                    escrowCancelBtn.classList.remove('is-hidden');
                    escrowCancelBtn.disabled = !hasOnChainState || !isActive || isCancelRequested || isCancelDisputed || isCancelApproved;
                } else if (isOperator) {
                    escrowCancelBtn.classList.toggle('is-hidden', !isCancelRequested || cancelRequestedBy !== context.renter);
                    escrowCancelBtn.disabled = !hasOnChainState || !isActive || !isCancelRequested || cancelRequestedBy !== context.renter;
                } else {
                    escrowCancelBtn.classList.add('is-hidden');
                    escrowCancelBtn.disabled = true;
                }
            }
            if (escrowCancelLabel && escrowCancelHelp) {
                if (isCancelDisputed) {
                    escrowCancelLabel.textContent = 'Cancel disputed';
                    escrowCancelHelp.textContent = 'A dispute has been opened for this escrow.';
                } else if (isCancelRequested) {
                    if (isOperator) {
                        escrowCancelLabel.textContent = 'Approve cancel';
                        escrowCancelHelp.textContent = 'Client requested cancellation.';
                    } else {
                        escrowCancelLabel.textContent = 'Cancel requested';
                        escrowCancelHelp.textContent = 'Waiting for operator approval.';
                    }
                } else {
                    escrowCancelLabel.textContent = isClient ? 'Request cancel' : 'Cancel';
                    escrowCancelHelp.textContent = 'Request cancellation (requires operator approval).';
                }
            }
            if (escrowDisputeBtn) {
                const showDispute = isOperator && isCancelRequested && cancelRequestedBy === context.renter && !isCancelDisputed;
                escrowDisputeBtn.classList.toggle('is-hidden', !showDispute);
                escrowDisputeBtn.disabled = !showDispute;
            }
            if (escrowClaimBtn) {
                escrowClaimBtn.classList.toggle('is-hidden', !isOperator);
                escrowClaimBtn.disabled = !(hasOnChainState && isActive && isExpired && isOperator);
            }
            if (escrowCloseBtn) {
                escrowCloseBtn.classList.toggle('is-hidden', !isClient);
                escrowCloseBtn.disabled = !(hasOnChainState && isFinal && isClient);
            }
            if (escrowRefreshBtn) escrowRefreshBtn.disabled = false;

            if (escrowActionSummary) {
                const statusLabel = escrowStatusValue?.textContent || 'Status';
                const roleLabel = roleInfo.label.replace('Access: ', '');
                const cancelSuffix = isCancelRequested
                    ? ' · Cancel requested'
                    : isCancelDisputed
                        ? ' · Dispute opened'
                        : '';
                escrowActionSummary.textContent = hasOnChainState
                    ? `${statusLabel} · ${roleLabel}${cancelSuffix}`
                    : `No on-chain data · ${roleLabel}${cancelSuffix}`;
            }

            const hideOtherActions = isFinal || !!context.closedAt;
            if (escrowMoreToggle) {
                escrowMoreToggle.classList.toggle('is-hidden', hideOtherActions);
            }
            if (escrowActionsGroup) {
                escrowActionsGroup.classList.toggle('is-hidden', hideOtherActions);
            }
            if (escrowPrimaryRow) {
                escrowPrimaryRow.classList.toggle('is-hidden', !!context.closedAt);
            }

            if (escrowPrimaryActionBtn && escrowPrimaryHint) {
                let primary = { label: 'Refresh', hint: 'Pull the latest escrow status.', action: 'refresh', disabled: false };

                if (roleInfo.role === 'disconnected') {
                    primary = { label: 'Connect wallet', hint: 'Connect to manage this escrow.', action: null, disabled: true };
                } else if (roleInfo.role === 'viewer') {
                    primary = { label: 'No actions', hint: 'This escrow belongs to another wallet.', action: null, disabled: true };
                } else if (!hasOnChainState) {
                    primary = { label: 'Refresh', hint: 'Escrow not found on-chain yet. Refresh to sync.', action: 'refresh', disabled: false };
                } else if (context.closedAt) {
                    primary = { label: 'Escrow closed', hint: 'This escrow account is closed on-chain.', action: null, disabled: true };
                } else if (isCancelDisputed) {
                    primary = { label: 'Dispute opened', hint: 'This cancellation is in dispute.', action: null, disabled: true };
                } else if (isCancelRequested) {
                    if (isOperator) {
                        primary = { label: 'Approve cancel', hint: 'Client requested cancellation.', action: 'cancel', disabled: false };
                    } else {
                        primary = { label: 'Cancel requested', hint: 'Waiting for operator approval.', action: null, disabled: true };
                    }
                } else if (isActive && isClient) {
                    primary = { label: 'Complete', hint: 'Release funds after the job is done.', action: 'complete', disabled: false };
                } else if (isActive && isOperator) {
                    if (isExpired) {
                        primary = { label: 'Claim expired', hint: 'Claim funds after expiry.', action: 'claim', disabled: false };
                    } else {
                        primary = { label: 'Awaiting client', hint: 'Client completes to release funds.', action: null, disabled: true };
                    }
                } else if (isFinal && isClient) {
                    primary = { label: 'Close escrow', hint: 'Close the escrow account after completion.', action: 'close', disabled: false };
                } else if (isFinal) {
                    primary = { label: 'Escrow closed', hint: 'No further actions required.', action: null, disabled: true };
                }

                escrowPrimaryActionBtn.textContent = primary.label;
                escrowPrimaryActionBtn.dataset.action = primary.action || '';
                escrowPrimaryActionBtn.disabled = primary.disabled;
                escrowPrimaryHint.textContent = primary.hint;
            }

            if (escrowActionsGroup && escrowMoreToggle) {
                const visibleActions = [escrowCompleteBtn, escrowCancelBtn, escrowClaimBtn, escrowCloseBtn, escrowDisputeBtn]
                    .filter(Boolean)
                    .filter((btn) => !btn.classList.contains('is-hidden'));
                if (visibleActions.length === 0) {
                    escrowActionsGroup.classList.add('is-collapsed');
                    escrowMoreToggle.textContent = 'Other actions';
                    escrowMoreToggle.disabled = true;
                } else {
                    escrowMoreToggle.disabled = false;
                }
            }

            void updateEscrowWarnings(context);
        }

        async function refreshEscrowState() {
            if (!currentEscrowContext?.escrowPda) return null;
            try {
                const state = await fetchEscrowState(currentEscrowContext.escrowPda);
                if (state) {
                    updateEscrowUI(currentEscrowContext, state);
                    await registerEscrowContext(currentEscrowContext, state);
                }
                return state;
            } catch (error) {
                log.warn('[Marketplace]', 'Failed to refresh escrow state:', error);
                return null;
            }
        }

        async function handleEscrowAction(action) {
            if (!currentEscrowContext) {
                notify.error('No active escrow to manage.');
                return;
            }
            if (!hasValidEscrowProgram()) {
                notify.error('Escrow program is not configured.');
                return;
            }

            const provider = await getConnectedProvider();
            if (!provider) {
                notify.error('Connect a Solana wallet to continue.');
                return;
            }
            await updateEscrowWarnings(currentEscrowContext);
            if (escrowActionBlocked) {
                notify.error(escrowActionBlockReason || 'Escrow action is blocked.');
                return;
            }

            const signer = provider.publicKey.toBase58();
            const { renter, operator, escrowPda } = currentEscrowContext;
            let latestState = null;
            try {
                latestState = await fetchEscrowState(escrowPda);
            } catch (error) {
                log.warn('[Marketplace]', 'Failed to fetch escrow state before action:', error);
            }
            if (!latestState) {
                notify.error('Escrow not found on-chain. Click Refresh to sync.');
                return;
            }
            const latestLabel = ESCROW_STATUS_LABELS[latestState.status] || '';
            currentEscrowContext.status = latestState.status;
            currentEscrowContext.statusLabel = latestLabel || currentEscrowContext.statusLabel;
            updateEscrowUI(currentEscrowContext, latestState);

            const statusKey = getEscrowStatusKey(latestState.status, latestLabel);
            const expiresAtSeconds = typeof latestState.expiresAt === 'bigint'
                ? Number(latestState.expiresAt)
                : Number.isFinite(latestState.expiresAt)
                    ? Number(latestState.expiresAt)
                    : null;
            const isExpired = expiresAtSeconds ? expiresAtSeconds < Math.floor(Date.now() / 1000) : false;

            if (action === 'complete' && signer !== renter) {
                notify.error('Only the renter can complete this escrow.');
                return;
            }
            if (action === 'cancel' && signer !== renter && signer !== operator) {
                notify.error('Only the renter or operator can cancel this escrow.');
                return;
            }
            if (action === 'claim' && signer !== operator) {
                notify.error('Only the operator can claim an expired escrow.');
                return;
            }
            if (action === 'close' && signer !== renter) {
                notify.error('Only the renter can close this escrow.');
                return;
            }
            if (action === 'dispute' && signer !== operator) {
                notify.error('Only the operator can dispute a cancellation.');
                return;
            }
            if ((action === 'complete' || action === 'cancel' || action === 'claim') && statusKey && statusKey !== 'active') {
                notify.error('Escrow is no longer active.');
                return;
            }
            if (action === 'close' && statusKey && statusKey === 'active') {
                notify.error('Close is only available after completion or cancellation.');
                return;
            }
            if (action === 'claim' && !isExpired) {
                notify.error('Escrow has not expired yet.');
                return;
            }

            const cancelStatus = currentEscrowContext.cancelStatus || null;
            const cancelRequestedBy = currentEscrowContext.cancelRequestedBy || null;
            const isCancelRequested = cancelStatus === 'requested';
            const isCancelDisputed = cancelStatus === 'disputed';

            let instruction = null;
            if (action === 'complete') {
                await ensurePlatformWalletReady();
                const platform = resolvePlatformKey(new solanaWeb3.PublicKey(renter));
                instruction = await buildCompleteRentalInstruction({
                    renter: new solanaWeb3.PublicKey(renter),
                    operator: new solanaWeb3.PublicKey(operator),
                    escrowPda: new solanaWeb3.PublicKey(escrowPda),
                    platform
                });
            } else if (action === 'cancel') {
                if (signer === renter && signer === operator) {
                    instruction = await buildCancelRentalInstruction({
                        signer: new solanaWeb3.PublicKey(signer),
                        renter: new solanaWeb3.PublicKey(renter),
                        escrowPda: new solanaWeb3.PublicKey(escrowPda)
                    });
                } else if (signer === renter) {
                    if (isCancelDisputed) {
                        notify.error('This escrow is in dispute.');
                        return;
                    }
                    if (isCancelRequested) {
                        if (operator && operator !== signer) {
                            notify.info('Cancellation already requested. Switch to the operator wallet to approve.');
                        } else {
                            notify.info('Cancellation already requested. Waiting for operator approval.');
                        }
                        return;
                    }
                    currentEscrowContext.cancelStatus = 'requested';
                    currentEscrowContext.cancelRequestedBy = signer;
                    currentEscrowContext.cancelRequestedAt = Date.now();
                    await registerEscrowContext(currentEscrowContext);
                    updateEscrowUI(currentEscrowContext);
                    notify.success('Cancellation request sent to operator.');
                    return;
                } else if (signer === operator) {
                    if (!isCancelRequested || cancelRequestedBy !== renter) {
                        notify.error('No cancellation request to approve.');
                        return;
                    }
                    instruction = await buildCancelRentalInstruction({
                        signer: new solanaWeb3.PublicKey(signer),
                        renter: new solanaWeb3.PublicKey(renter),
                        escrowPda: new solanaWeb3.PublicKey(escrowPda)
                    });
                }
            } else if (action === 'claim') {
                instruction = await buildClaimExpiredInstruction({
                    operator: new solanaWeb3.PublicKey(operator),
                    escrowPda: new solanaWeb3.PublicKey(escrowPda)
                });
            } else if (action === 'close') {
                instruction = await buildCloseEscrowInstruction({
                    renter: new solanaWeb3.PublicKey(renter),
                    escrowPda: new solanaWeb3.PublicKey(escrowPda)
                });
            } else if (action === 'dispute') {
                if (!isCancelRequested || cancelRequestedBy !== renter) {
                    notify.error('No cancellation request to dispute.');
                    return;
                }
                currentEscrowContext.cancelStatus = 'disputed';
                currentEscrowContext.cancelResolvedBy = signer;
                currentEscrowContext.cancelResolvedAt = Date.now();
                await registerEscrowContext(currentEscrowContext);
                updateEscrowUI(currentEscrowContext);
                notify.info('Dispute opened for this escrow.');
                return;
            }

            if (!instruction) {
                notify.error('Unsupported escrow action.');
                return;
            }

            try {
                const signature = await sendEscrowTransaction(instruction, provider);
                currentEscrowContext.lastSignature = signature;
                if (action === 'complete') {
                    currentEscrowContext.status = 1;
                    currentEscrowContext.statusLabel = 'Completed';
                    if (AUTO_CLOSE_ESCROW_AFTER_COMPLETE) {
                        try {
                            notify.info('Closing escrow account...');
                            const closeInstruction = await buildCloseEscrowInstruction({
                                renter: new solanaWeb3.PublicKey(renter),
                                escrowPda: new solanaWeb3.PublicKey(escrowPda)
                            });
                            const closeSignature = await sendEscrowTransaction(closeInstruction, provider);
                            currentEscrowContext.closedAt = Date.now();
                            currentEscrowContext.closedBy = signer;
                            currentEscrowContext.closeSignature = closeSignature;
                        } catch (closeError) {
                            log.warn('[Marketplace]', 'Auto-close failed:', closeError);
                            notify.info('Escrow completed. Close skipped.');
                        }
                    }
                }
                if (action === 'cancel' && signer === operator) {
                    currentEscrowContext.status = 2;
                    currentEscrowContext.statusLabel = 'Cancelled';
                    currentEscrowContext.cancelStatus = 'approved';
                    currentEscrowContext.cancelResolvedBy = signer;
                    currentEscrowContext.cancelResolvedAt = Date.now();
                }
                if (action === 'claim') {
                    currentEscrowContext.status = 3;
                    currentEscrowContext.statusLabel = 'Expired';
                }
                if (action === 'close') {
                    currentEscrowContext.closedAt = Date.now();
                    currentEscrowContext.closedBy = signer;
                    currentEscrowContext.closeSignature = signature;
                }
                updateEscrowUI(currentEscrowContext);
                await registerEscrowContext(currentEscrowContext);
                await refreshEscrowState();
                notify.success('Escrow updated on-chain.');
            } catch (error) {
                log.error('[Marketplace]', 'Escrow action failed:', error);
                const message = (error?.message || '').toString();
                if (message.includes('AccountNotInitialized') || message.includes('3012') || message.includes('0xbc4')) {
                    notify.error('Escrow account is not initialized on-chain. Click Refresh or check that you are on the correct network and wallet.');
                    return;
                }
                notify.error(message || 'Escrow action failed.');
            }
        }

        async function maybeSeedRobots({ force = false } = {}) {
            if (!import.meta.env.DEV) return;
            const params = new URLSearchParams(window.location.search);
            if (!force && !params.has('seed')) return;
            if (!force && localStorage.getItem('marketplaceSeeded') === 'true') return;

            const wallet = requireWalletOrPrompt();
            if (!wallet) return;

            const supabase = getSupabase();
            if (!supabase) {
                notify.error('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
                return;
            }

            if (!force && robotsMap.size > 0) {
                notify.error('Marketplace already has robots. Clear it or use a fresh project to seed.');
                return;
            }

            const imageMap = {
                delivery: '/images/usecases/delivery.svg',
                cleaning: '/images/usecases/cleaning.svg',
                security: '/images/usecases/security.svg',
                inspection: '/images/usecases/inspection.svg',
                warehouse: '/images/usecases/warehouse.svg',
                agriculture: '/images/usecases/agriculture.svg',
                healthcare: '/images/usecases/healthcare.svg'
            };

            const seedRobots = [
                {
                    name: 'SpeedBot X1',
                    category: 'delivery',
                    description: 'Last-mile courier bot for dense urban routes with fast turnaround.',
                    price: 28,
                    priceUnit: 'hour',
                    speed: '18 km/h',
                    payload: '15 kg',
                    battery: '6 hours',
                    location: 'San Francisco, USA'
                },
                {
                    name: 'CleanSweep Pro',
                    category: 'cleaning',
                    description: 'Autonomous floor cleaning for offices, retail, and airports.',
                    price: 19,
                    priceUnit: 'hour',
                    speed: '6 km/h',
                    payload: '10 L',
                    battery: '8 hours',
                    location: 'Austin, USA'
                },
                {
                    name: 'Sentinel Guard',
                    category: 'security',
                    description: 'Patrol unit with night vision and incident reporting.',
                    price: 45,
                    priceUnit: 'hour',
                    speed: '10 km/h',
                    payload: 'N/A',
                    battery: '12 hours',
                    location: 'Miami, USA'
                },
                {
                    name: 'Inspectra Mini',
                    category: 'inspection',
                    description: 'Compact inspection rover for warehouse aisles and lines.',
                    price: 24,
                    priceUnit: 'hour',
                    speed: '8 km/h',
                    payload: '5 kg',
                    battery: '7 hours',
                    location: 'Chicago, USA'
                },
                {
                    name: 'Warehouse Runner',
                    category: 'warehouse',
                    description: 'High-volume pick/pack helper with RFID scanning.',
                    price: 32,
                    priceUnit: 'hour',
                    speed: '12 km/h',
                    payload: '40 kg',
                    battery: '9 hours',
                    location: 'Dallas, USA'
                },
                {
                    name: 'FieldSprout A2',
                    category: 'agriculture',
                    description: 'Precision crop monitoring and micro-spray automation.',
                    price: 35,
                    priceUnit: 'hour',
                    speed: '7 km/h',
                    payload: '20 L',
                    battery: '10 hours',
                    location: 'Fresno, USA'
                },
                {
                    name: 'CareMate 3',
                    category: 'healthcare',
                    description: 'Hospital assistance bot for supplies and patient transport.',
                    price: 50,
                    priceUnit: 'hour',
                    speed: '5 km/h',
                    payload: '25 kg',
                    battery: '8 hours',
                    location: 'Boston, USA'
                },
                {
                    name: 'Hospy Concierge',
                    category: 'hospitality',
                    description: 'Guest assistance bot for hotels and venues.',
                    price: 22,
                    priceUnit: 'hour',
                    speed: '6 km/h',
                    payload: '8 kg',
                    battery: '7 hours',
                    location: 'Las Vegas, USA'
                }
            ];

            const rows = seedRobots.map((robot) => ({
                owner_wallet: wallet,
                name: robot.name,
                category: robot.category,
                description: robot.description,
                image_url: imageMap[robot.category] || imageMap.delivery,
                price: robot.price,
                price_unit: robot.priceUnit,
                speed: robot.speed || null,
                payload: robot.payload || null,
                battery: robot.battery || null,
                location: robot.location || null,
                contact: 'ops@roborio.com',
                is_available: true
            }));

            const { data, error } = await supabase
                .from('robots')
                .insert(rows)
                .select();

            if (error) {
                log.error('[Marketplace]', 'Seed error:', error);
                notify.error(`Seeding failed: ${error.message}`);
                return;
            }

            localStorage.setItem('marketplaceSeeded', 'true');
            notify.success(`Seeded ${data?.length || rows.length} robots`);
            await loadRobotsFromDB({ reset: true });
        }

        // Modal helpers are in ./marketplace/ui/modals.js

        // Update empty state visibility
        // Shows only when: supabase initialized (or demo mode), loading done, no error, robots empty
        function updateEmptyState() {
            if (!marketplaceEmpty) return;

            // Hide during loading or on error
            if (isLoading || loadError) {
                marketplaceEmpty.classList.add('hidden');
                return;
            }

            const hasRobots = robotsGrid?.querySelectorAll('.market-card').length > 0;
            marketplaceEmpty.classList.toggle('hidden', hasRobots);
        }

        function updateFilteredState(totalCount, visibleCount) {
            if (!marketplaceNoResults) return;
            const show = totalCount > 0 && visibleCount === 0 && !isLoading && !loadError;
            marketplaceNoResults.classList.toggle('hidden', !show);
        }

        // Set loading state on grid
        function setGridLoading(loading) {
            isLoading = loading;
            if (robotsGrid) {
                robotsGrid.classList.toggle('is-loading', loading);
            }
            // Hide empty state during loading
            if (loading && marketplaceEmpty) {
                marketplaceEmpty.classList.add('hidden');
            }
            // Show/hide loading notice
            updateLoadingNotice(loading);
        }

        // Loading notice (injected once, toggled via hidden class)
        let loadingNotice = null;

        function createNoticeIcon(text) {
            const span = document.createElement('span');
            span.className = 'notice-icon';
            span.textContent = text;
            return span;
        }

        function updateLoadingNotice(show) {
            if (!robotsGrid) return;

            // Create notice element once
            if (!loadingNotice) {
                loadingNotice = document.createElement('div');
                loadingNotice.className = 'marketplace-notice hidden';
                loadingNotice.id = 'marketplaceLoading';
                loadingNotice.appendChild(createNoticeIcon('...'));
                const text = document.createElement('span');
                text.className = 'notice-text';
                text.textContent = 'Loading robots...';
                loadingNotice.appendChild(text);
                robotsGrid.parentNode.insertBefore(loadingNotice, robotsGrid);
            }

            loadingNotice.classList.toggle('hidden', !show);
        }

        // Error notice (injected once, toggled via hidden class)
        let errorNotice = null;

        function showErrorNotice(message) {
            if (!robotsGrid) return;

            // Create error element once
            if (!errorNotice) {
                errorNotice = document.createElement('div');
                errorNotice.className = 'marketplace-notice marketplace-notice--error hidden';
                errorNotice.id = 'marketplaceError';
                errorNotice.appendChild(createNoticeIcon('!'));

                const text = document.createElement('span');
                text.className = 'notice-text';
                errorNotice.appendChild(text);

                const retryBtn = document.createElement('button');
                retryBtn.className = 'notice-retry';
                retryBtn.type = 'button';
                retryBtn.textContent = 'Retry';
                retryBtn.addEventListener('click', () => {
                    hideErrorNotice();
                    loadRobotsFromDB({ reset: robotsMap.size === 0 });
                });
                errorNotice.appendChild(retryBtn);
                robotsGrid.parentNode.insertBefore(errorNotice, robotsGrid);
            }

            errorNotice.querySelector('.notice-text').textContent = message;
            errorNotice.classList.remove('hidden');
        }

        function hideErrorNotice() {
            if (errorNotice) {
                errorNotice.classList.add('hidden');
            }
        }

        // ============ SUPABASE FUNCTIONS ============

        // Load robots from Supabase
        async function loadRobotsFromDB({ reset = false } = {}) {
            const supabase = getSupabase();
            log.debug('[Marketplace]', 'loadRobotsFromDB called, supabase:', !!supabase);

            // Demo mode - no loading needed
            if (!supabase) {
                log.info('[Marketplace]', 'Demo mode: No robots loaded from DB');
                loadError = false;
                hideErrorNotice();
                updateEmptyState();
                applyFiltersAndSort();
                return;
            }

            if (isLoadingMore) return;
            if (!hasMore && !reset) return;

            // Start loading, clear previous error
            if (reset) {
                setGridLoading(true);
                loadError = false;
                hideErrorNotice();
                robotsGrid.innerHTML = '';
                robotsMap.clear();
                nextOffset = 0;
                hasMore = true;
            }

            isLoadingMore = true;

            try {
                const from = nextOffset;
                const to = nextOffset + PAGE_SIZE - 1;

                const data = await safeSelect(
                    supabase
                        .from('robots')
                        .select('*')
                        .eq('is_available', true)
                        .order('created_at', { ascending: false })
                        .range(from, to),
                    'Failed to load robots'
                );

                if (data && data.length > 0) {
                    log.info('[Marketplace]', 'Loaded', data.length, 'robots from database');
                    // Normalize and store robots
                    const robots = data.map(normalizeRobot);
                    robots.forEach(robot => {
                        if (robotsMap.has(robot.id)) return;
                        robotsMap.set(robot.id, robot);
                        cardRenderer.addRobotCardFromRobot(robot);
                    });
                } else {
                    if (reset) {
                        log.info('[Marketplace]', 'No robots found in database');
                    }
                }

                // Success - clear loading, show empty state if needed
                nextOffset += (data?.length || 0);
                if (!data || data.length < PAGE_SIZE) {
                    hasMore = false;
                }

                if (reset) {
                    setGridLoading(false);
                }
                updateEmptyState();
                applyFiltersAndSort();
            } catch (err) {
                log.error('[Marketplace]', 'Error loading robots:', err);
                loadError = true;
                if (reset) {
                    setGridLoading(false);
                }
                // Show inline error with retry button
                showErrorNotice('Failed to load robots');
            } finally {
                isLoadingMore = false;
            }
        }

        // Category Filter
        function setupFilters() {
            if (!filterBtns || !filterBtns.length) return;

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Guard: don't filter during loading
                    if (isLoading) return;

                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    activeCategory = btn.dataset.category || 'all';
                    applyFiltersAndSort();
                });
            });
        }

        function setupSearchAndSort() {
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    searchTerm = (e.target.value || '').toString();
                    applyFiltersAndSort();
                });
            }

            if (sortSelect) {
                sortSelect.addEventListener('change', (e) => {
                    sortMode = (e.target.value || 'newest').toString();
                    applyFiltersAndSort();
                });
            }
        }

        function setViewMode(mode) {
            const target = mode === 'mine' ? 'mine' : mode === 'escrows' ? 'escrows' : 'all';
            if ((target === 'mine' || target === 'escrows') && !requireWalletOrPrompt()) {
                return;
            }
            viewMode = target;
            if (viewAllBtn) viewAllBtn.classList.toggle('active', viewMode === 'all');
            if (viewMineBtn) viewMineBtn.classList.toggle('active', viewMode === 'mine');
            if (viewEscrowsBtn) viewEscrowsBtn.classList.toggle('active', viewMode === 'escrows');
            updateHistoryToggleUI();
            updateEscrowStatusFilterUI();
            applyFiltersAndSort();
        }

        function setupViewToggle() {
            if (viewAllBtn) {
                viewAllBtn.addEventListener('click', () => setViewMode('all'));
            }
            if (viewMineBtn) {
                viewMineBtn.addEventListener('click', () => setViewMode('mine'));
            }
            if (viewEscrowsBtn) {
                viewEscrowsBtn.addEventListener('click', () => setViewMode('escrows'));
            }
            setViewMode('all');
        }

        function setupEscrowStatusFilter() {
            if (!escrowStatusFilterEl) return;
            escrowStatusButtons = Array.from(escrowStatusFilterEl.querySelectorAll('.escrow-status-btn'));
            if (!escrowStatusButtons.length) return;
            escrowStatusButtons.forEach((btn) => {
                btn.addEventListener('click', () => {
                    const status = btn.dataset.status || 'active';
                    escrowStatusFilter = status;
                    updateEscrowStatusFilterUI();
                    applyFiltersAndSort();
                });
            });
            updateEscrowStatusFilterUI();
        }

        function updateHistoryToggleUI() {
            if (!historyToggleBtn) return;
            const isEscrows = viewMode === 'escrows';
            historyToggleBtn.classList.toggle('is-hidden', !isEscrows);
            historyToggleBtn.disabled = !isEscrows;
            historyToggleBtn.textContent = includeEscrowHistory ? 'History: On' : 'History: Off';
        }

        function updateEscrowStatusFilterUI() {
            if (!escrowStatusFilterEl) return;
            const isEscrows = viewMode === 'escrows';
            escrowStatusFilterEl.classList.toggle('is-hidden', !isEscrows);
            if (!escrowStatusButtons || !escrowStatusButtons.length) return;
            const allowHistory = includeEscrowHistory;
            if (!allowHistory && escrowStatusFilter !== 'active') {
                escrowStatusFilter = 'active';
            }
            escrowStatusButtons.forEach((btn) => {
                const status = btn.dataset.status;
                const isActive = status === escrowStatusFilter;
                btn.classList.toggle('active', isActive);
                if (!allowHistory && status !== 'active') {
                    btn.disabled = true;
                } else {
                    btn.disabled = false;
                }
            });
        }

        function ensureInfiniteSentinel() {
            if (marketplaceSentinel || !robotsGrid) return;
            marketplaceSentinel = document.getElementById('marketplaceSentinel');
            if (!marketplaceSentinel) {
                marketplaceSentinel = document.createElement('div');
                marketplaceSentinel.id = 'marketplaceSentinel';
                marketplaceSentinel.className = 'marketplace-sentinel';
                const parent = robotsGrid.parentNode;
                if (parent) {
                    parent.insertBefore(marketplaceSentinel, marketplaceEmpty || null);
                }
            }
        }

        function setupInfiniteScroll() {
            if (!robotsGrid) return;
            ensureInfiniteSentinel();

            if (!marketplaceSentinel) return;

            if (infiniteObserver) {
                infiniteObserver.disconnect();
            }

            infiniteObserver = new IntersectionObserver((entries) => {
                const hit = entries.some(entry => entry.isIntersecting);
                if (hit) {
                    loadRobotsFromDB();
                }
            }, { root: null, rootMargin: '600px 0px', threshold: 0 });

            infiniteObserver.observe(marketplaceSentinel);
        }

        function getCardSearchText(card) {
            const name = card.dataset.name || '';
            const category = card.dataset.category || '';
            const desc = card.querySelector('.market-card-desc')?.textContent || '';
            const contact = card.dataset.contact || '';
            return `${name} ${category} ${desc} ${contact}`.toLowerCase();
        }

        function sortCards(cards) {
            const mode = sortMode;
            const getPrice = (card) => parseFloat(card.dataset.price || '0') || 0;
            const getName = (card) => (card.dataset.name || '').toLowerCase();
            const getCreated = (card) => parseFloat(card.dataset.createdAt || '0') || 0;

            if (mode === 'price-asc') {
                cards.sort((a, b) => getPrice(a) - getPrice(b));
            } else if (mode === 'price-desc') {
                cards.sort((a, b) => getPrice(b) - getPrice(a));
            } else if (mode === 'name-asc') {
                cards.sort((a, b) => getName(a).localeCompare(getName(b)));
            } else {
                cards.sort((a, b) => getCreated(b) - getCreated(a));
            }
        }

        function applyFiltersAndSort() {
            if (!robotsGrid) return;

            const cards = Array.from(robotsGrid.querySelectorAll('.market-card'));
            if (!cards.length) {
                updateFilteredState(0, 0);
                return;
            }

            const term = searchTerm.trim().toLowerCase();
            const wallet = getConnectedWallet();
            let visibleCount = 0;

            cards.forEach((card) => {
                const category = card.dataset.category || '';
                const matchesCategory = activeCategory === 'all' || category === activeCategory;
                const matchesSearch = !term || getCardSearchText(card).includes(term);
                const ownerWallet = card.dataset.ownerWallet || '';
                const robotId = card.dataset.robotId || '';
                const matchesOwner = viewMode !== 'mine' || (wallet && ownerWallet === wallet);
                let matchesEscrow = viewMode !== 'escrows';
                if (!matchesEscrow) {
                    const escrow = robotId ? escrowsByRobotId.get(robotId) : null;
                    if (!escrow) {
                        matchesEscrow = false;
                    } else if (!includeEscrowHistory) {
                        matchesEscrow = isActiveEscrowStatus(escrow.status, escrow.statusLabel);
                    } else {
                        const statusKey = getEscrowStatusKey(escrow.status, escrow.statusLabel);
                        matchesEscrow = statusKey === escrowStatusFilter;
                    }
                }
                const matches = matchesCategory && matchesSearch && matchesOwner && matchesEscrow;
                card.classList.toggle('is-hidden', !matches);
                if (matches) visibleCount += 1;
            });

            const visibleCards = cards.filter(card => !card.classList.contains('is-hidden'));
            const hiddenCards = cards.filter(card => card.classList.contains('is-hidden'));

            sortCards(visibleCards);
            visibleCards.forEach(card => robotsGrid.appendChild(card));
            hiddenCards.forEach(card => robotsGrid.appendChild(card));

            updateFilteredState(cards.length, visibleCount);
        }

        /**
         * Open rent modal by robot ID (uses robotsMap)
         * @param {string} robotId
         */
        function openRentModalById(robotId) {
            if (!requireWalletOrPrompt()) return;

            const robot = robotsMap.get(robotId);
            if (!robot) {
                log.error('[Marketplace]', 'Robot not found in robotsMap:', robotId);
                notify.error('Robot not found');
                return;
            }

            // Set currentRobot from normalized Robot object
            currentRobot = robot;

            document.getElementById('rentRobotName').textContent = robot.name;
            cardRenderer.renderRobotImage(document.getElementById('rentRobotImage'), robot.imageUrl, robot.category, robot.name);
            document.getElementById('rentCategory').textContent = cardRenderer.formatCategory(robot.category);
            document.getElementById('rentDescription').textContent = robot.description;
            document.getElementById('rentPrice').textContent = `$${robot.price}/${robot.priceUnit}`;
            document.getElementById('rentTotal').textContent = `$${robot.price}`;

            openModal(rentRobotModal);
        }

        /**
         * Open existing escrow details by robot ID
         * @param {string} robotId
         */
        async function openEscrowModalById(robotId) {
            if (!requireWalletOrPrompt()) return;
            const escrow = escrowsByRobotId.get(String(robotId));
            if (!escrow) {
                notify.info('No escrow found for this robot yet.');
                return;
            }

            currentEscrowContext = escrow;
            const robot = robotsMap.get(robotId);
            if (robot) {
                document.getElementById('operatorContactValue').textContent = robot.contact || 'Contact not provided';
            }

            updateEscrowUI(currentEscrowContext);
            const state = await refreshEscrowState();
            if (!state) {
                notify.info('Showing last known escrow status. Click Refresh to sync.');
            }
            openModal(successModal);
            startEscrowAutoRefresh();
        }

        /**
         * Legacy openRentModal for backward compatibility with card elements
         * @deprecated Use openRentModalById instead
         */
        function openRentModal(card) {
            const robotId = card.dataset.robotId || card.dataset.id;
            if (robotId && robotsMap.has(robotId)) {
                openRentModalById(robotId);
            } else {
                // Fallback for demo mode cards without robotsMap entry
                if (!requireWalletOrPrompt()) return;
                currentRobot = {
                    id: card.dataset.id || '',
                    ownerWallet: card.dataset.ownerWallet || '',
                    name: card.dataset.name || '',
                    category: card.dataset.category || '',
                    description: card.querySelector('.market-card-desc')?.textContent || '',
                    price: parseFloat(card.dataset.price) || 0,
                    priceUnit: card.dataset.unit || 'hour',
                    imageUrl: card.dataset.imageUrl || null,
                    contact: card.dataset.contact || null,
                };
                document.getElementById('rentRobotName').textContent = currentRobot.name;
                cardRenderer.renderRobotImage(document.getElementById('rentRobotImage'), currentRobot.imageUrl, currentRobot.category, currentRobot.name);
                document.getElementById('rentCategory').textContent = cardRenderer.formatCategory(currentRobot.category);
                document.getElementById('rentDescription').textContent = currentRobot.description;
                document.getElementById('rentPrice').textContent = `$${currentRobot.price}/${currentRobot.priceUnit}`;
                document.getElementById('rentTotal').textContent = `$${currentRobot.price}`;
                openModal(rentRobotModal);
            }
        }

        function setupRentModal() {
            const confirmBtn = document.getElementById('confirmRent');
            const cancelBtn = document.getElementById('cancelRent');

            confirmBtn?.addEventListener('click', async () => {
                if (!currentRobot) {
                    notify.error('Select a robot first');
                    return;
                }

                // Offline guard
                if (!navigator.onLine) {
                    notify.error('No internet connection');
                    return;
                }

                // Wallet guard for payment
                if (!requireWalletOrPrompt()) return;

                await withLoading(confirmBtn, async () => {
                    if (!hasValidEscrowProgram()) {
                        notify.error('Escrow program is not configured.');
                        return;
                    }

                    if (!currentRobot.ownerWallet) {
                        notify.error('Operator wallet is missing for this robot.');
                        return;
                    }

                    try {
                        log.info('[Marketplace]', 'Creating Solana escrow transaction...');

                        const result = await createRentalEscrow(
                            currentRobot.ownerWallet,
                            currentRobot.id || currentRobot.name,
                            currentRobot.price,
                            24 // 24 hour rental duration
                        );

                        if (result.existing) {
                            log.warn('[Marketplace]', 'Escrow already exists for this rental. Showing existing escrow.');
                        } else {
                            log.info('[Marketplace]', 'Transaction successful:', result.signature);
                            log.info('[Marketplace]', 'Amount paid:', result.amountSol, 'SOL');
                        }

                        currentEscrowContext = {
                            ...result,
                            robotName: currentRobot.name,
                            robotDbId: currentRobot.id || null,
                            priceUsd: currentRobot.price,
                            priceUnit: currentRobot.priceUnit
                        };

                        const contactEl = document.getElementById('operatorContactValue');
                        contactEl.textContent = currentRobot.contact || 'Contact not provided';
                        updateEscrowUI(currentEscrowContext);
                        await registerEscrowContext(currentEscrowContext);
                        await refreshEscrowState();

                        closeModal(rentRobotModal);
                        openModal(successModal);
                        startEscrowAutoRefresh();
                        notify.success('Rental confirmed');
                    } catch (error) {
                        log.error('[Marketplace]', 'Escrow transaction failed:', error);
                        notify.error(error?.message || 'Escrow transaction failed.');
                    }
                }, { loadingText: 'Processing...' });
            });

            cancelBtn?.addEventListener('click', () => closeModal(rentRobotModal));
        }

         // ============ DELETE ROBOT FUNCTIONS ============
        /** @type {import('./models/robot.js').Robot|null} */
        let robotToDelete = null;
        let deleteRobotModal;

        /**
         * Open delete modal by robot ID
         * @param {string} robotId
         */
        function openDeleteModalById(robotId) {
            // Defensive wallet check
            if (!requireWalletOrPrompt()) return;

            const robot = robotsMap.get(robotId);
            if (!robot) {
                log.error('[Marketplace]', 'Robot not found in robotsMap:', robotId);
                notify.error('Robot not found');
                return;
            }

            robotToDelete = robot;
            deleteRobotModal = document.getElementById('deleteRobotModal');
            document.getElementById('deleteRobotName').textContent = robot.name;
            openModal(deleteRobotModal);
        }

        /**
         * Legacy openDeleteModal for backward compatibility
         * @deprecated Use openDeleteModalById instead
         */
        function openDeleteModal(card) {
            const robotId = card.dataset.robotId || card.dataset.id;
            if (robotId && robotsMap.has(robotId)) {
                openDeleteModalById(robotId);
            } else {
                // Fallback for demo mode
                robotToDelete = {
                    id: card.dataset.id || '',
                    ownerWallet: card.dataset.ownerWallet || '',
                    name: card.dataset.name || '',
                    category: card.dataset.category || '',
                    description: card.dataset.description || '',
                    price: parseFloat(card.dataset.price) || 0,
                    priceUnit: card.dataset.unit || 'hour',
                    imageUrl: card.dataset.imageUrl || null,
                    contact: card.dataset.contact || null,
                };
                deleteRobotModal = document.getElementById('deleteRobotModal');
                document.getElementById('deleteRobotName').textContent = robotToDelete.name;
                openModal(deleteRobotModal);
            }
        }

        function setupDeleteModal() {
            const confirmBtn = document.getElementById('confirmDelete');
            const cancelBtn = document.getElementById('cancelDelete');

            confirmBtn?.addEventListener('click', async () => {
                if (!robotToDelete) return;

                // Offline guard
                if (!navigator.onLine) {
                    notify.error('No internet connection');
                    return;
                }

                // Defensive wallet check
                if (!requireWalletOrPrompt()) return;

                await withLoading(confirmBtn, async () => {
                    // Use robot.id from Robot object (not from dataset)
                    const result = await deleteRobotFromDB(robotToDelete.id);

                    if (result.success) {
                        // Remove card from DOM by robotId
                        const card = robotsGrid.querySelector(`[data-robot-id="${robotToDelete.id}"]`);
                        if (card) card.remove();

                        // Remove from robotsMap
                        robotsMap.delete(robotToDelete.id);

                        closeModal(deleteRobotModal);
                        updateEmptyState();
                        notify.success('Robot deleted');
                        robotToDelete = null;
                    } else {
                        notify.error('Could not delete robot. Please try again.');
                    }
                }, { loadingText: 'Deleting...' });
            });

            cancelBtn?.addEventListener('click', () => {
                closeModal(deleteRobotModal);
                robotToDelete = null;
            });
        }

        // ============ EDIT ROBOT FUNCTIONS ============
        /** @type {import('./models/robot.js').Robot|null} */
        let robotToEdit = null;

        /**
         * Open edit modal by robot ID
         * @param {string} robotId
         */
        function openEditModalById(robotId) {
            // Defensive wallet check
            if (!requireWalletOrPrompt()) return;

            const robot = robotsMap.get(robotId);
            if (!robot) {
                log.error('[Marketplace]', 'Robot not found in robotsMap:', robotId);
                notify.error('Robot not found');
                return;
            }

            robotToEdit = robot;
            const form = document.getElementById('addRobotForm');

            // Fill form with current values from Robot object
            form.querySelector('[name="name"]').value = robot.name;
            form.querySelector('[name="category"]').value = robot.category;
            form.querySelector('[name="description"]').value = robot.description || '';
            form.querySelector('[name="price"]').value = robot.price;
            form.querySelector('[name="priceUnit"]').value = robot.priceUnit;
            form.querySelector('[name="contact"]').value = robot.contact || '';

            // Show current image in preview if exists
            const uploadPlaceholder = document.getElementById('uploadPlaceholder');
            const uploadPreview = document.getElementById('uploadPreview');
            const previewImg = document.getElementById('previewImg');

            if (robot.imageUrl && previewImg) {
                previewImg.src = robot.imageUrl;
                if (uploadPlaceholder) uploadPlaceholder.hidden = true;
                if (uploadPreview) uploadPreview.hidden = false;
            } else {
                if (uploadPlaceholder) uploadPlaceholder.hidden = false;
                if (uploadPreview) uploadPreview.hidden = true;
            }

            // Change modal title and button text
            document.querySelector('#addRobotModal .mp-modal-title').textContent = 'Edit Robot';
            document.querySelector('#addRobotModal .btn-primary .btn-text').textContent = 'Save Changes';

            openModal(addRobotModal);
        }

        /**
         * Legacy openEditModal for backward compatibility
         * @deprecated Use openEditModalById instead
         */
        function openEditModal(card) {
            const robotId = card.dataset.robotId || card.dataset.id;
            if (robotId && robotsMap.has(robotId)) {
                openEditModalById(robotId);
            } else {
                // Fallback for demo mode
                robotToEdit = {
                    id: card.dataset.id || '',
                    ownerWallet: card.dataset.ownerWallet || '',
                    name: card.dataset.name || '',
                    category: card.dataset.category || '',
                    description: card.dataset.description || '',
                    price: parseFloat(card.dataset.price) || 0,
                    priceUnit: card.dataset.unit || 'hour',
                    imageUrl: card.dataset.imageUrl || null,
                    contact: card.dataset.contact || null,
                };
                const form = document.getElementById('addRobotForm');
                form.querySelector('[name="name"]').value = robotToEdit.name;
                form.querySelector('[name="category"]').value = robotToEdit.category;
                form.querySelector('[name="description"]').value = robotToEdit.description || '';
                form.querySelector('[name="price"]').value = robotToEdit.price;
                form.querySelector('[name="priceUnit"]').value = robotToEdit.priceUnit;
                form.querySelector('[name="contact"]').value = robotToEdit.contact || '';

                const uploadPlaceholder = document.getElementById('uploadPlaceholder');
                const uploadPreview = document.getElementById('uploadPreview');
                const previewImg = document.getElementById('previewImg');
                if (robotToEdit.imageUrl && previewImg) {
                    previewImg.src = robotToEdit.imageUrl;
                    if (uploadPlaceholder) uploadPlaceholder.hidden = true;
                    if (uploadPreview) uploadPreview.hidden = false;
                } else {
                    if (uploadPlaceholder) uploadPlaceholder.hidden = false;
                    if (uploadPreview) uploadPreview.hidden = true;
                }

                document.querySelector('#addRobotModal .mp-modal-title').textContent = 'Edit Robot';
                document.querySelector('#addRobotModal .btn-primary .btn-text').textContent = 'Save Changes';
                openModal(addRobotModal);
            }
        }

        // Setup Event Listeners
        function setupEventListeners() {
            // Add Robot button (header)
            addRobotBtn?.addEventListener('click', () => {
                if (!requireWalletOrPrompt()) return;
                resetAddRobotForm();
                openModal(addRobotModal);
            });

            // Add Robot button (toolbar, mobile)
            addRobotToolbarBtn?.addEventListener('click', () => {
                if (!requireWalletOrPrompt()) return;
                resetAddRobotForm();
                openModal(addRobotModal);
            });

            // Add Robot button (empty state)
            addRobotEmptyBtn?.addEventListener('click', () => {
                if (!requireWalletOrPrompt()) return;
                resetAddRobotForm();
                openModal(addRobotModal);
            });

            seedRobotsBtn?.addEventListener('click', async () => {
                await maybeSeedRobots({ force: true });
            });

            // Cancel Add Robot
            document.getElementById('cancelAddRobot')?.addEventListener('click', () => {
                closeModal(addRobotModal);
                resetAddRobotForm();
            });

            // Close success modal (rent)
            document.getElementById('closeSuccess')?.addEventListener('click', () => {
                closeModal(successModal);
                stopEscrowAutoRefresh();
            });

            escrowCompleteBtn?.addEventListener('click', () => {
                withLoading(escrowCompleteBtn, () => handleEscrowAction('complete'), { loadingText: 'Completing...' });
            });
            escrowCancelBtn?.addEventListener('click', () => {
                withLoading(escrowCancelBtn, () => handleEscrowAction('cancel'), { loadingText: 'Cancelling...' });
            });
            escrowDisputeBtn?.addEventListener('click', () => {
                withLoading(escrowDisputeBtn, () => handleEscrowAction('dispute'), { loadingText: 'Opening dispute...' });
            });
            escrowClaimBtn?.addEventListener('click', () => {
                withLoading(escrowClaimBtn, () => handleEscrowAction('claim'), { loadingText: 'Claiming...' });
            });
            escrowCloseBtn?.addEventListener('click', () => {
                withLoading(escrowCloseBtn, () => handleEscrowAction('close'), { loadingText: 'Closing...' });
            });
            escrowPrimaryActionBtn?.addEventListener('click', () => {
                const action = escrowPrimaryActionBtn.dataset.action || '';
                if (!action) return;
                if (action === 'refresh') {
                    withLoading(escrowPrimaryActionBtn, () => refreshEscrowState(), { loadingText: 'Refreshing...' });
                    return;
                }
                withLoading(escrowPrimaryActionBtn, () => handleEscrowAction(action), { loadingText: 'Processing...' });
            });
            escrowRefreshBtn?.addEventListener('click', () => {
                withLoading(escrowRefreshBtn, () => refreshEscrowState(), { loadingText: 'Refreshing...' });
            });
            escrowMoreToggle?.addEventListener('click', () => {
                if (!escrowActionsGroup) return;
                const isCollapsed = escrowActionsGroup.classList.toggle('is-collapsed');
                escrowMoreToggle.textContent = isCollapsed ? 'Other actions' : 'Hide actions';
            });
            escrowOpenDashboardBtn?.addEventListener('click', () => {
                setViewMode('escrows');
                closeModal(successModal);
                stopEscrowAutoRefresh();
                document.getElementById('marketplace-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });

            syncEscrowsBtn?.addEventListener('click', () => {
                const wallet = requireWalletOrPrompt();
                if (!wallet) return;
                withLoading(syncEscrowsBtn, async () => {
                    await loadEscrowsForWallet(wallet, { showToast: true });
                    applyFiltersAndSort();
                }, { loadingText: 'Syncing...' });
            });

            historyToggleBtn?.addEventListener('click', () => {
                includeEscrowHistory = !includeEscrowHistory;
                updateHistoryToggleUI();
                updateEscrowStatusFilterUI();
                applyFiltersAndSort();
            });

            // Close robot added success modal
            document.getElementById('closeRobotAdded')?.addEventListener('click', () => {
                closeModal(robotAddedModal);
            });

            // Close robot error modal
            document.getElementById('closeRobotError')?.addEventListener('click', () => {
                closeModal(robotErrorModal);
                openModal(addRobotModal); // Reopen form to try again
            });

            // Modal close buttons (for marketplace modals)
            document.querySelectorAll('.marketplace-modal .mp-modal-close').forEach(btn => {
                btn.addEventListener('click', () => {
                    closeAllModals();
                    stopEscrowAutoRefresh();
                });
            });

            // Modal overlay click (for marketplace modals)
            document.querySelectorAll('.marketplace-modal .mp-modal-overlay').forEach(overlay => {
                overlay.addEventListener('click', () => {
                    closeAllModals();
                    stopEscrowAutoRefresh();
                });
            });

            // Rent buttons on existing cards
            document.querySelectorAll('.market-card .btn-rent').forEach(btn => {
                btn.addEventListener('click', () => {
                    const card = btn.closest('.market-card');
                    openRentModal(card);
                });
            });

            document.querySelectorAll('.market-card .btn-escrow').forEach(btn => {
                btn.addEventListener('click', () => {
                    const card = btn.closest('.market-card');
                    const robotId = card?.dataset?.robotId;
                    if (robotId) {
                        openEscrowModalById(robotId);
                    }
                });
            });

            // Grid layout toggle (2x1 / 1x1)
            if (gridToggleBtns?.length && robotsGrid) {
                const setGridLayout = (layout) => {
                    const isMobile = window.matchMedia('(max-width: 640px)').matches;
                    if (!isMobile && layout === '1') {
                        layout = '2';
                    }
                    if (isMobile && layout === '4') {
                        layout = '2';
                    }
                    robotsGrid.classList.remove('grid-1', 'grid-2', 'grid-4');
                    if (layout === '1') robotsGrid.classList.add('grid-1');
                    if (layout === '2') robotsGrid.classList.add('grid-2');
                    if (layout === '4') robotsGrid.classList.add('grid-4');
                    gridToggleBtns.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.grid === layout);
                    });
                };

                gridToggleBtns.forEach(btn => {
                    btn.addEventListener('click', () => setGridLayout(btn.dataset.grid));
                });

                const defaultLayout = window.matchMedia('(max-width: 640px)').matches ? '1' : '2';
                setGridLayout(defaultLayout);
            }

            // ESC to close modals
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeAllModals();
                    stopEscrowAutoRefresh();
                }
            });
        }

        // Initialize Marketplace
        export async function initMarketplace() {
            // Get DOM elements now that page is loaded
            addRobotBtn = document.getElementById('addRobotBtn');
            addRobotToolbarBtn = document.getElementById('addRobotToolbarBtn');
            addRobotEmptyBtn = document.getElementById('addRobotEmptyBtn');
            seedRobotsBtn = document.getElementById('seedRobotsBtn');
            addRobotModal = document.getElementById('addRobotModal');
            addRobotForm = document.getElementById('addRobotForm');
            rentRobotModal = document.getElementById('rentRobotModal');
            successModal = document.getElementById('successModal');
            escrowDetails = document.getElementById('escrowDetails');
            escrowStatusValue = document.getElementById('escrowStatusValue');
            escrowAddressValue = document.getElementById('escrowAddressLink');
            escrowRenterValue = document.getElementById('escrowRenterLink');
            escrowOperatorValue = document.getElementById('escrowOperatorLink');
            escrowExpiresValue = document.getElementById('escrowExpiresValue');
            escrowTxLink = document.getElementById('escrowTxLink');
            escrowNetworkValue = document.getElementById('escrowNetworkValue');
            escrowClosedBadge = document.getElementById('escrowClosedBadge');
            escrowRoleValue = document.getElementById('escrowRoleValue');
            escrowAmountValue = document.getElementById('escrowAmountValue');
            escrowRobotValue = document.getElementById('escrowRobotValue');
            escrowPrimaryRow = document.getElementById('escrowPrimaryRow');
            escrowPrimaryActionBtn = document.getElementById('escrowPrimaryActionBtn');
            escrowPrimaryHint = document.getElementById('escrowPrimaryHint');
            escrowActionSummary = document.getElementById('escrowActionSummary');
            escrowMoreToggle = document.getElementById('escrowMoreToggle');
            escrowActionsGroup = document.getElementById('escrowActionsGroup');
            escrowCompleteBtn = document.getElementById('escrowCompleteBtn');
            escrowCancelBtn = document.getElementById('escrowCancelBtn');
            escrowCancelLabel = document.getElementById('escrowCancelLabel');
            escrowCancelHelp = document.getElementById('escrowCancelHelp');
            escrowDisputeBtn = document.getElementById('escrowDisputeBtn');
            escrowClaimBtn = document.getElementById('escrowClaimBtn');
            escrowCloseBtn = document.getElementById('escrowCloseBtn');
            escrowRefreshBtn = document.getElementById('escrowRefreshBtn');
            escrowOpenDashboardBtn = document.getElementById('escrowOpenDashboard');
            escrowNetworkAlert = document.getElementById('escrowNetworkAlert');
            escrowNetworkAlertText = document.getElementById('escrowNetworkAlertText');
            escrowBalanceAlert = document.getElementById('escrowBalanceAlert');
            escrowBalanceAlertText = document.getElementById('escrowBalanceAlertText');
            historyToggleBtn = document.getElementById('marketplaceHistoryToggle');
            escrowStatusFilterEl = document.getElementById('marketplaceEscrowStatus');
            robotsGrid = document.getElementById('robotsGrid');
            gridToggleBtns = document.querySelectorAll('.marketplace-grid-btn');
            marketplaceEmpty = document.getElementById('marketplaceEmpty');
            filterBtns = document.querySelectorAll('.filter-btn');
            marketplaceNoResults = document.getElementById('marketplaceNoResults');
            searchInput = document.getElementById('marketplaceSearch');
            sortSelect = document.getElementById('marketplaceSort');
            viewAllBtn = document.getElementById('marketplaceViewAll');
            viewMineBtn = document.getElementById('marketplaceViewMine');
            viewEscrowsBtn = document.getElementById('marketplaceViewEscrows');
            marketplaceSentinel = document.getElementById('marketplaceSentinel');
            walletModal = document.getElementById('walletModal');
            walletModalOverlay = document.getElementById('walletModalOverlay');
            robotAddedModal = document.getElementById('robotAddedModal');
            robotErrorModal = document.getElementById('robotErrorModal');
            syncEscrowsBtn = document.getElementById('marketplaceSyncEscrows');

            const params = new URLSearchParams(window.location.search);
            if (seedRobotsBtn && import.meta.env.DEV && (params.has('seed') || params.has('admin'))) {
                seedRobotsBtn.classList.add('is-visible');
            }

            cardRenderer = createCardRenderer({
                robotsMap,
                robotsGrid,
                isWalletConnected,
                getConnectedWallet,
                openEditModalById,
                openDeleteModalById,
                openRentModalById,
                openRentModal,
                openEscrowModalById,
                getEscrowForRobot: (robotId) => escrowsByRobotId.get(String(robotId)),
                updateEmptyState,
                log
            });

            // Initialize Supabase
            await initSupabase();

            // Load robots from DB (async, will call refreshOwnershipUI when done)
            setupInfiniteScroll();
            loadRobotsFromDB({ reset: true }).then(async () => {
                // Refresh ownership UI after robots are loaded
                cardRenderer.refreshOwnershipUI();
                const wallet = getConnectedWallet();
                if (wallet) {
                    await loadEscrowsForWallet(wallet);
                }
                await maybeSeedRobots();
            });

            setupFilters();
            setupSearchAndSort();
            setupViewToggle();
            setupEscrowStatusFilter();
            const { resetAddRobotForm: resetForm } = initRobotForm({
                addRobotForm,
                addRobotModal,
                robotAddedModal,
                robotErrorModal,
                robotsGrid,
                robotsMap,
                openModal,
                closeModal,
                updateEmptyState,
                withLoading,
                notify,
                validateRobotData,
                saveRobotToDB,
                updateRobotInDB,
                normalizeRobot,
                cardRenderer,
                getConnectedWallet,
                requireWalletOrPrompt,
                getRobotToEdit: () => robotToEdit,
                setRobotToEdit: (value) => { robotToEdit = value; },
                refreshMarketplaceView: applyFiltersAndSort
            });
            resetAddRobotForm = resetForm;
            setupRentModal();
            setupDeleteModal();
            setupEventListeners();
            // Note: updateEmptyState() is called after loadRobotsFromDB() completes

            // Listen for wallet connect/disconnect events from wallet.js
            window.addEventListener('wallet-connected', () => {
                log.debug('[Marketplace]', 'wallet-connected event received');
                cardRenderer.refreshOwnershipUI();
                clearEscrows();
                if (currentEscrowContext) {
                    updateEscrowUI(currentEscrowContext);
                    void updateEscrowWarnings(currentEscrowContext);
                }
                const wallet = getConnectedWallet();
                if (wallet) {
                    loadEscrowsForWallet(wallet).then(() => {
                        applyFiltersAndSort();
                    });
                } else {
                    applyFiltersAndSort();
                }
            });

            window.addEventListener('wallet-disconnected', () => {
                log.debug('[Marketplace]', 'wallet-disconnected event received');
                cardRenderer.refreshOwnershipUI();
                clearEscrows();
                stopEscrowAutoRefresh();
                if (currentEscrowContext) {
                    updateEscrowUI(currentEscrowContext);
                    resetEscrowAlerts();
                }
                if (viewMode === 'mine' || viewMode === 'escrows') {
                    setViewMode('all');
                } else {
                    applyFiltersAndSort();
                }
            });
        }


