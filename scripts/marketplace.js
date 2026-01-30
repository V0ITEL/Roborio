'use strict';

        import { getFullWalletAddress } from './wallet.js';
        import notify from './ui/notify.js';
        import { withLoading } from './ui/withLoading.js';
        import { normalizeRobot } from './models/robot.js';
        import { safeSelect } from './utils/safeSupabase.js';
        import { log } from './utils/logger.js';
        import * as solanaWeb3 from '@solana/web3.js';
        import { initSupabase, getSupabase, saveRobotToDB, updateRobotInDB, deleteRobotFromDB } from './marketplace/api/supabase.js';
        import { validateRobotData } from './marketplace/utils/validation.js';
        import { createCardRenderer } from './marketplace/ui/cards.js';
        import { openModal, closeModal, closeAllModals } from './marketplace/ui/modals.js';
        import { initRobotForm } from './marketplace/ui/forms.js';

        /** @type {Map<string, import('./models/robot.js').Robot>} */
        const robotsMap = new Map();

        let isLoading = false;
        let loadError = false;

        // ============ SOLANA ESCROW CONFIG ============
        // Program ID will be updated after deployment
        const ESCROW_PROGRAM_ID = 'RoboEscrowXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
        const SOLANA_NETWORK = 'devnet'; 
        const SOL_PRICE_USD = 100; 

        // Get Solana connection
        function getSolanaConnection() {
            const endpoint = SOLANA_NETWORK === 'mainnet-beta'
                ? 'https://api.mainnet-beta.solana.com'
                : 'https://api.devnet.solana.com';
            return new solanaWeb3.Connection(endpoint, 'confirmed');
        }

        // Get wallet provider (Phantom, Solflare, etc.)
        function getWalletProvider() {
            if (window.phantom?.solana?.isPhantom) {
                return window.phantom.solana;
            }
            if (window.solflare?.isSolflare) {
                return window.solflare;
            }
            if (window.backpack) {
                return window.backpack;
            }
            return null;
        }

        // Convert USD to lamports (1 SOL = 1e9 lamports)
        function usdToLamports(usdAmount) {
            const solAmount = usdAmount / SOL_PRICE_USD;
            return Math.floor(solAmount * solanaWeb3.LAMPORTS_PER_SOL);
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

        // Create rental escrow transaction
        async function createRentalEscrow(operatorWallet, robotId, amountUsd, durationHours = 24) {
            const provider = getWalletProvider();
            if (!provider) {
                throw new Error('No Solana wallet found. Please install Phantom or Solflare.');
            }

            const connection = getSolanaConnection();
            const renter = provider.publicKey;
            const operator = new solanaWeb3.PublicKey(operatorWallet);
            const programId = new solanaWeb3.PublicKey(ESCROW_PROGRAM_ID);

            // For MVP, we'll do a simple transfer to operator
            // Full escrow program integration can be added after deployment
            const lamports = usdToLamports(amountUsd);

            // Create transfer instruction
            const transaction = new solanaWeb3.Transaction().add(
                solanaWeb3.SystemProgram.transfer({
                    fromPubkey: renter,
                    toPubkey: operator,
                    lamports: lamports
                })
            );

            // Get recent blockhash
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = renter;

            // Sign and send transaction
            const signed = await provider.signTransaction(transaction);
            const signature = await connection.sendRawTransaction(signed.serialize());

            // Wait for confirmation
            await connection.confirmTransaction(signature, 'confirmed');

            return {
                success: true,
                signature: signature,
                amount: lamports,
                amountSol: lamports / solanaWeb3.LAMPORTS_PER_SOL
            };
        }

        // ============ MARKETPLACE UI & LOGIC ============
        // Variables will be set in initMarketplace
        let currentRobot = null;
        let addRobotBtn, addRobotToolbarBtn, addRobotEmptyBtn, addRobotModal, addRobotForm;
        let seedRobotsBtn;
        let gridToggleBtns;
        let rentRobotModal, successModal, robotsGrid, marketplaceEmpty, marketplaceNoResults, marketplaceSentinel;
        let filterBtns, walletModal, walletModalOverlay;
        let searchInput, sortSelect;
        let viewAllBtn, viewMineBtn;
        let robotAddedModal, robotErrorModal;
        let cardRenderer = null;
        let resetAddRobotForm = null;
        let activeCategory = 'all';
        let searchTerm = '';
        let sortMode = 'newest';
        let viewMode = 'all';
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
            const target = mode === 'mine' ? 'mine' : 'all';
            if (target === 'mine' && !requireWalletOrPrompt()) {
                return;
            }
            viewMode = target;
            if (viewAllBtn) viewAllBtn.classList.toggle('active', viewMode === 'all');
            if (viewMineBtn) viewMineBtn.classList.toggle('active', viewMode === 'mine');
            applyFiltersAndSort();
        }

        function setupViewToggle() {
            if (viewAllBtn) {
                viewAllBtn.addEventListener('click', () => setViewMode('all'));
            }
            if (viewMineBtn) {
                viewMineBtn.addEventListener('click', () => setViewMode('mine'));
            }
            setViewMode('all');
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
                const matchesOwner = viewMode !== 'mine' || (wallet && ownerWallet === wallet);
                const matches = matchesCategory && matchesSearch && matchesOwner;
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
                    const provider = getWalletProvider();

                    // Use Robot object properties (already normalized)
                    if (provider && currentRobot.ownerWallet && ESCROW_PROGRAM_ID !== 'RoboEscrowXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') {
                        // Real Solana transaction
                        log.info('[Marketplace]', 'Creating Solana escrow transaction...');

                        const result = await createRentalEscrow(
                            currentRobot.ownerWallet,
                            currentRobot.id || currentRobot.name,
                            currentRobot.price,
                            24 // 24 hour rental duration
                        );

                        log.info('[Marketplace]', 'Transaction successful:', result.signature);
                        log.info('[Marketplace]', 'Amount paid:', result.amountSol, 'SOL');

                        // Update success modal with transaction info
                        const contactEl = document.getElementById('operatorContactValue');
                        contactEl.textContent = currentRobot.contact || 'Contact not provided';

                        const linkWrap = document.createElement('div');
                        linkWrap.style.marginTop = '10px';
                        linkWrap.style.fontSize = '12px';
                        linkWrap.style.color = 'var(--text-muted)';

                        const link = document.createElement('a');
                        link.href = `https://solscan.io/tx/${result.signature}?cluster=${SOLANA_NETWORK}`;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        link.style.color = 'var(--accent)';
                        link.textContent = 'View transaction on Solscan';

                        linkWrap.appendChild(link);
                        contactEl.appendChild(linkWrap);
                    } else {
                        // Demo mode - simulate transaction
                        log.info('[Marketplace]', 'Demo mode: Simulating escrow transaction...');
                        await new Promise(r => setTimeout(r, 2000));
                        document.getElementById('operatorContactValue').textContent = currentRobot.contact || 'Contact not provided';
                    }

                    closeModal(rentRobotModal);
                    openModal(successModal);
                    notify.success('Rental confirmed');
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
                });
            });

            // Modal overlay click (for marketplace modals)
            document.querySelectorAll('.marketplace-modal .mp-modal-overlay').forEach(overlay => {
                overlay.addEventListener('click', () => {
                    closeAllModals();
                });
            });

            // Rent buttons on existing cards
            document.querySelectorAll('.market-card .btn-rent').forEach(btn => {
                btn.addEventListener('click', () => {
                    const card = btn.closest('.market-card');
                    openRentModal(card);
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
            robotsGrid = document.getElementById('robotsGrid');
            gridToggleBtns = document.querySelectorAll('.marketplace-grid-btn');
            marketplaceEmpty = document.getElementById('marketplaceEmpty');
            filterBtns = document.querySelectorAll('.filter-btn');
            marketplaceNoResults = document.getElementById('marketplaceNoResults');
            searchInput = document.getElementById('marketplaceSearch');
            sortSelect = document.getElementById('marketplaceSort');
            viewAllBtn = document.getElementById('marketplaceViewAll');
            viewMineBtn = document.getElementById('marketplaceViewMine');
            marketplaceSentinel = document.getElementById('marketplaceSentinel');
            walletModal = document.getElementById('walletModal');
            walletModalOverlay = document.getElementById('walletModalOverlay');
            robotAddedModal = document.getElementById('robotAddedModal');
            robotErrorModal = document.getElementById('robotErrorModal');

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
                await maybeSeedRobots();
            });

            setupFilters();
            setupSearchAndSort();
            setupViewToggle();
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
                applyFiltersAndSort();
            });

            window.addEventListener('wallet-disconnected', () => {
                log.debug('[Marketplace]', 'wallet-disconnected event received');
                cardRenderer.refreshOwnershipUI();
                if (viewMode === 'mine') {
                    setViewMode('all');
                } else {
                    applyFiltersAndSort();
                }
            });
        }


