'use strict';

        import { getFullWalletAddress } from './wallet.js';
        import notify from './ui/notify.js';
        import { withLoading } from './ui/withLoading.js';
        import { normalizeRobot } from './models/robot.js';
        import { safeSelect, safeInsert, safeUpdate, safeDelete, safeUpload, safeStorageDelete } from './utils/safeSupabase.js';
        import { log } from './utils/logger.js';

        /** @type {Map<string, import('./models/robot.js').Robot>} */
        const robotsMap = new Map();
   
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

        let supabase = null;

        // Initialize Supabase client
        function initSupabase() {
            if (window.supabase && SUPABASE_URL !== 'https://your-project.supabase.co') {
                supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                log.info('[Marketplace]', 'Supabase initialized');
                return true;
            }
            log.warn('[Marketplace]', 'Supabase not configured. Running in demo mode.');
            return false;
        }

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
        let addRobotBtn, addRobotEmptyBtn, addRobotModal, addRobotForm;
        let rentRobotModal, successModal, robotsGrid, marketplaceEmpty;
        let filterBtns, walletModal, walletModalOverlay;
        let robotAddedModal, robotErrorModal;

        // Get current wallet address
        function getWalletAddress() {
            const addrEl = document.getElementById('walletAddress');
            if (addrEl && addrEl.textContent !== '...') {
                return addrEl.textContent;
            }
            return null;
        }

        // Check if wallet connected via existing system
        function isWalletConnected() {
            return window.walletConnected || getWalletAddress() !== null;
        }

          // Get connected wallet address (full address for ownership checks)
        function getConnectedWallet() {
            // Try to get full address from wallet.js first
            const fullAddress = getFullWalletAddress();
            if (fullAddress) return fullAddress;
            // Fallback to DOM (shortened) - should not happen
            return getWalletAddress();
        }

        function openExistingWalletModal() {
            if (walletModal && walletModalOverlay) {
                walletModal.classList.add('active');
                walletModalOverlay.classList.add('active');
            }
        }

        // Modal Functions for our new modals
        function openModal(modal) {
            if (!modal) return;
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';

            // Focus first focusable element
            const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusable) focusable.focus();
        }

        function closeModal(modal) {
            if (!modal) return;
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }

        function closeAllModals() {
            document.querySelectorAll('.marketplace-modal.active').forEach(m => closeModal(m));
        }

                // Reset add robot form to default state
        function resetAddRobotForm() {
            const form = document.getElementById('addRobotForm');
            if (form) form.reset();

            const uploadPlaceholder = document.getElementById('uploadPlaceholder');
            const uploadPreview = document.getElementById('uploadPreview');
            if (uploadPlaceholder) uploadPlaceholder.hidden = false;
            if (uploadPreview) uploadPreview.hidden = true;

            // Reset modal title and button text
            const modalTitle = document.querySelector('#addRobotModal .mp-modal-title');
            const btnText = document.querySelector('#addRobotModal .btn-primary .btn-text');
            if (modalTitle) modalTitle.textContent = 'Add Your Robot';
            if (btnText) btnText.textContent = 'List Robot';

            robotToEdit = null;
        }


        // Show success modal for robot added
        function showRobotAddedSuccess() {
            closeModal(addRobotModal);
            resetAddRobotForm();
            openModal(robotAddedModal);
        }

        // Show error modal
        function showRobotAddedError(message) {
            const msgEl = document.getElementById('robotErrorMessage');
            if (msgEl) msgEl.textContent = message || 'Something went wrong. Please try again.';
            closeModal(addRobotModal);
            openModal(robotErrorModal);
        }

        // Update empty state visibility
        function updateEmptyState() {
            const hasRobots = robotsGrid?.querySelectorAll('.market-card').length > 0;
            if (marketplaceEmpty) {
                marketplaceEmpty.classList.toggle('hidden', hasRobots);
            }
        }

        // ============ SUPABASE FUNCTIONS ============

        // Load robots from Supabase
        async function loadRobotsFromDB() {
            log.debug('[Marketplace]', 'loadRobotsFromDB called, supabase:', !!supabase);
            if (!supabase) {
                log.info('[Marketplace]', 'Demo mode: No robots loaded from DB');
                return;
            }

            try {
                const data = await safeSelect(
                    supabase
                        .from('robots')
                        .select('*')
                        .eq('is_available', true)
                        .order('created_at', { ascending: false }),
                    'Failed to load robots'
                );

                if (data && data.length > 0) {
                    log.info('[Marketplace]', 'Loaded', data.length, 'robots from database');
                    // Clear existing cards and robotsMap
                    robotsGrid.innerHTML = '';
                    robotsMap.clear();

                    // Normalize and store robots
                    const robots = data.map(normalizeRobot);
                    robots.forEach(robot => {
                        robotsMap.set(robot.id, robot);
                        addRobotCardFromRobot(robot);
                    });
                } else {
                    log.info('[Marketplace]', 'No robots found in database');
                }

                updateEmptyState();
            } catch (err) {
                log.error('[Marketplace]', 'Error loading robots:', err);
                notify.error('Failed to load robots. Please refresh the page.');
            }
        }

        // Save robot to Supabase
        async function saveRobotToDB(robotData, imageFile) {
            if (!supabase) {
                log.info('[Marketplace]', 'Demo mode: Robot not saved to DB');
                return { success: true, data: robotData };
            }

            try {
                let imageUrl = null;
                let uploadedFileName = null;

                // Upload image if provided (do this first, before DB insert)
                if (imageFile) {
                    const fileExt = imageFile.name.split('.').pop();
                    uploadedFileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                    await safeUpload(
                        supabase.storage
                            .from('robot-images')
                            .upload(uploadedFileName, imageFile),
                        'Failed to upload image'
                    );

                    const { data: urlData } = supabase.storage
                        .from('robot-images')
                        .getPublicUrl(uploadedFileName);

                    imageUrl = urlData.publicUrl;
                }

                // Insert robot into DB
                try {
                    const data = await safeInsert(
                        supabase
                            .from('robots')
                            .insert([{
                                owner_wallet: robotData.ownerWallet,
                                name: robotData.name,
                                category: robotData.category,
                                description: robotData.description,
                                image_url: imageUrl,
                                price: parseFloat(robotData.price),
                                price_unit: robotData.priceUnit,
                                speed: robotData.speed || null,
                                payload: robotData.payload || null,
                                battery: robotData.battery || null,
                                location: robotData.location || null,
                                contact: robotData.contact || null
                            }])
                            .select()
                            .single(),
                        'Failed to save robot'
                    );

                    return { success: true, data: data };
                } catch (dbError) {
                    // DB insert failed - cleanup uploaded image
                    if (uploadedFileName) {
                        await safeStorageDelete(
                            supabase.storage.from('robot-images').remove([uploadedFileName])
                        );
                    }
                    throw dbError;
                }
            } catch (err) {
                log.error('[Marketplace]', 'Error saving robot:', err);
                return { success: false, error: err.message };
            }
        }

        /**
         * Add card from normalized Robot object
         * @param {import('./models/robot.js').Robot} robot
         */
        function addRobotCardFromRobot(robot) {

            const categoryEmojis = {
                delivery: '🚚', cleaning: '🧹', security: '🛡️', inspection: '🔍',
                warehouse: '🤖', agriculture: '🌾', healthcare: '🏥', hospitality: '🍽️'
            };

            const card = document.createElement('article');
            card.className = 'market-card';
            // Only store id for DOM lookup, all data comes from robotsMap
            card.dataset.robotId = robot.id;
            // Keep category for filtering
            card.dataset.category = robot.category;

            const imageContent = robot.imageUrl
                ? `<img src="${robot.imageUrl}" alt="${robot.name}" style="width:100%;height:100%;object-fit:cover;">`
                : categoryEmojis[robot.category] || '🤖';

            // Check if current user is owner (using full wallet address from Robot object)
            const isOwner = isWalletConnected() && getConnectedWallet() === robot.ownerWallet;

            card.innerHTML = `
                <div class="market-card-top">
                    <span class="market-category">${robot.category.charAt(0).toUpperCase() + robot.category.slice(1)}</span>
                    ${isOwner ? `<div class="owner-actions">
                        <button class="btn-owner btn-edit" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="btn-owner btn-delete" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg></button>
                    </div>` : ''}
                </div>
                <div class="market-card-image">${imageContent}</div>
                <div class="market-card-body">
                    <h4 class="market-card-title">${robot.name}</h4>
                    <p class="market-card-desc">${robot.description}</p>
                    <div class="market-card-footer">
                        <span class="market-price">$${robot.price}/${robot.priceUnit}</span>
                    </div>
                </div>
                <div class="market-card-actions"><button class="btn-rent">Rent Now</button></div>
            `;

            // Use robot.id from robotsMap for all operations
            card.querySelector('.btn-rent').addEventListener('click', () => openRentModalById(robot.id));

            // Add owner action listeners if owner
            const editBtn = card.querySelector('.btn-edit');
            const deleteBtn = card.querySelector('.btn-delete');
            if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModalById(robot.id); });
            if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModalById(robot.id); });

            robotsGrid.appendChild(card);

            // Add animate-in class for visibility (with small delay for animation effect)
            setTimeout(() => card.classList.add('animate-in'), 50);
        }

        /**
         * Legacy function for backward compatibility with raw DB data
         * @deprecated Use addRobotCardFromRobot with normalizeRobot instead
         */
        function addRobotCardFromDB(rawRobot) {
            const robot = normalizeRobot(rawRobot);
            robotsMap.set(robot.id, robot);
            addRobotCardFromRobot(robot);
        }

        /**
         * Refresh ownership UI for all robot cards
         * Called after wallet connect/disconnect or robots load
         */
        function refreshOwnershipUI() {
            const connectedWallet = getConnectedWallet();
            const cards = robotsGrid?.querySelectorAll('[data-robot-id]');

            if (!cards) return;

            cards.forEach(card => {
                const robotId = card.dataset.robotId;
                const robot = robotsMap.get(robotId);

                if (!robot) return;

                const isOwner = connectedWallet && robot.ownerWallet === connectedWallet;
                const existingActions = card.querySelector('.owner-actions');

                if (isOwner && !existingActions) {
                    // Add owner actions if owner and not already present
                    const topDiv = card.querySelector('.market-card-top');
                    if (topDiv) {
                        const actionsDiv = document.createElement('div');
                        actionsDiv.className = 'owner-actions';
                        actionsDiv.innerHTML = `
                            <button class="btn-owner btn-edit" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                            <button class="btn-owner btn-delete" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg></button>
                        `;

                        // Add event listeners
                        const editBtn = actionsDiv.querySelector('.btn-edit');
                        const deleteBtn = actionsDiv.querySelector('.btn-delete');
                        editBtn?.addEventListener('click', (e) => { e.stopPropagation(); openEditModalById(robotId); });
                        deleteBtn?.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModalById(robotId); });

                        topDiv.appendChild(actionsDiv);
                    }
                } else if (!isOwner && existingActions) {
                    // Remove owner actions if not owner anymore
                    existingActions.remove();
                }
            });

            log.debug('[Marketplace]', 'refreshOwnershipUI completed, connected wallet:', connectedWallet ? connectedWallet.slice(0, 8) + '...' : 'none');
        }

        // Category Filter
        function setupFilters() {
            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const category = btn.dataset.category;
                    const cards = robotsGrid.querySelectorAll('.market-card');

                    cards.forEach(card => {
                        if (category === 'all' || card.dataset.category === category) {
                            card.style.display = '';
                        } else {
                            card.style.display = 'none';
                        }
                    });
                });
            });
        }

        // Add Robot Form
        function setupAddRobotForm() {
            const imageInput = document.getElementById('robotImage');
            const uploadPlaceholder = document.getElementById('uploadPlaceholder');
            const uploadPreview = document.getElementById('uploadPreview');
            const previewImg = document.getElementById('previewImg');
            const removeImageBtn = document.getElementById('removeImage');

            // Click to upload
            uploadPlaceholder?.addEventListener('click', () => imageInput.click());

            // Handle file selection
            imageInput?.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                        notify.error('File too large. Max 5MB allowed.');
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        previewImg.src = ev.target.result;
                        uploadPlaceholder.hidden = true;
                        uploadPreview.hidden = false;
                    };
                    reader.readAsDataURL(file);
                }
            });

            // Remove image
            removeImageBtn?.addEventListener('click', () => {
                imageInput.value = '';
                previewImg.src = '';
                uploadPlaceholder.hidden = false;
                uploadPreview.hidden = true;
            });

            // Form submission
            addRobotForm?.addEventListener('submit', async (e) => {
                e.preventDefault();

                // Offline guard
                if (!navigator.onLine) {
                    notify.error("You're offline. Please go online and try again.");
                    return;
                }

                if (!isWalletConnected()) {
                    openExistingWalletModal();
                    return;
                }

                const submitBtn = document.getElementById('submitRobot');
                const loadingText = robotToEdit ? 'Saving...' : 'Listing...';

                await withLoading(submitBtn, async () => {
                    // Get form data
                    const formData = new FormData(addRobotForm);
                    const imageFile = imageInput.files[0] || null;

                    const robotData = {
                        ownerWallet: getConnectedWallet() || 'demo-wallet',
                        name: formData.get('name'),
                        category: formData.get('category'),
                        description: formData.get('description'),
                        price: formData.get('price'),
                        priceUnit: formData.get('priceUnit'),
                        speed: formData.get('speed'),
                        payload: formData.get('payload'),
                        battery: formData.get('battery'),
                        location: formData.get('location'),
                        contact: formData.get('contact')
                    };

                    let result;

                    // Check if we're editing or adding
                    if (robotToEdit) {
                        // Use robot.id from Robot object (not from dataset)
                        result = await updateRobotInDB(robotToEdit.id, robotData, imageFile);

                        if (result.success) {
                            // Update robotsMap with normalized data
                            const updatedRobot = normalizeRobot(result.data);
                            robotsMap.set(updatedRobot.id, updatedRobot);

                            // Update card in DOM by robotId
                            const card = robotsGrid.querySelector(`[data-robot-id="${robotToEdit.id}"]`);
                            if (card) {
                                card.dataset.category = updatedRobot.category;
                                card.querySelector('.market-card-title').textContent = updatedRobot.name;
                                card.querySelector('.market-card-desc').textContent = updatedRobot.description;
                                card.querySelector('.market-category').textContent = updatedRobot.category.charAt(0).toUpperCase() + updatedRobot.category.slice(1);
                                card.querySelector('.market-price').textContent = `$${updatedRobot.price}/${updatedRobot.priceUnit}`;

                                // Update image in DOM if new image was uploaded
                                if (updatedRobot.imageUrl) {
                                    const imageEl = card.querySelector('.market-card-image');
                                    // Add cache-buster to force reload
                                    const imgUrl = updatedRobot.imageUrl + '?v=' + Date.now();
                                    imageEl.innerHTML = `<img src="${imgUrl}" alt="${updatedRobot.name}" style="width:100%;height:100%;object-fit:cover;">`;
                                }
                            }

                            closeModal(addRobotModal);
                            resetAddRobotForm();
                            notify.success('Robot updated successfully');
                            robotToEdit = null;
                        } else {
                            notify.error('Failed to update robot. Please try again.');
                        }

                    } else {
                        // Add new robot
                        result = await saveRobotToDB(robotData, imageFile);

                        if (result.success) {
                            // Add card to grid
                            if (result.data.id) {
                                addRobotCardFromDB(result.data);
                            } else {
                                addRobotCard(robotData);
                            }

                            addRobotForm.reset();
                            uploadPlaceholder.hidden = false;
                            uploadPreview.hidden = true;
                            updateEmptyState();

                            // Show success modal
                            showRobotAddedSuccess();
                        } else {
                            showRobotAddedError(result.error);
                        }
                    }
                }, { loadingText });
            });
        }

        function addRobotCard(data) {
            const categoryEmojis = {
                delivery: '🚚', cleaning: '🧹', security: '🛡️', inspection: '🔍',
                warehouse: '🤖', agriculture: '🌾', healthcare: '🏥', hospitality: '🍽️'
            };

            const card = document.createElement('article');
            card.className = 'market-card';
            card.dataset.category = data.category;
            card.dataset.name = data.name;
            card.dataset.price = data.price;
            card.dataset.unit = data.priceUnit;
            card.dataset.contact = data.contact;

            card.innerHTML = `
                <div class="market-card-top"><span class="market-category">${data.category.charAt(0).toUpperCase() + data.category.slice(1)}</span></div>
                <div class="market-card-image">${categoryEmojis[data.category] || '🤖'}</div>
                <div class="market-card-body">
                    <h4 class="market-card-title">${data.name}</h4>
                    <p class="market-card-desc">${data.description}</p>
                    <div class="market-card-footer">
                        <span class="market-price">$${data.price}/${data.priceUnit}</span>
                    </div>
                </div>
                <div class="market-card-actions"><button class="btn-rent">Rent Now</button></div>
            `;

            // Add click handler for new card
            card.querySelector('.btn-rent').addEventListener('click', () => openRentModal(card));

            robotsGrid.insertBefore(card, robotsGrid.firstChild);

             // Add animate-in class for visibility
            setTimeout(() => card.classList.add('animate-in'), 50);


            // Update empty state
            updateEmptyState();
        }

        /**
         * Open rent modal by robot ID (uses robotsMap)
         * @param {string} robotId
         */
        function openRentModalById(robotId) {
            if (!isWalletConnected()) {
                openExistingWalletModal();
                return;
            }

            const robot = robotsMap.get(robotId);
            if (!robot) {
                log.error('[Marketplace]', 'Robot not found in robotsMap:', robotId);
                notify.error('Robot not found');
                return;
            }

            // Set currentRobot from normalized Robot object
            currentRobot = robot;

            const categoryEmojis = {
                delivery: '🚚', cleaning: '🧹', security: '🛡️', inspection: '🔍',
                warehouse: '🤖', agriculture: '🌾', healthcare: '🏥', hospitality: '🍽️'
            };

            const imageHtml = robot.imageUrl
                ? `<img src="${robot.imageUrl}" alt="${robot.name}" style="width:100%;height:100%;object-fit:cover;">`
                : categoryEmojis[robot.category] || '🤖';

            document.getElementById('rentRobotName').textContent = robot.name;
            document.getElementById('rentRobotImage').innerHTML = imageHtml;
            document.getElementById('rentCategory').textContent = robot.category.charAt(0).toUpperCase() + robot.category.slice(1);
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
                if (!isWalletConnected()) {
                    openExistingWalletModal();
                    return;
                }
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
                document.getElementById('rentRobotImage').innerHTML = card.querySelector('.market-card-image')?.innerHTML || '🤖';
                document.getElementById('rentCategory').textContent = currentRobot.category.charAt(0).toUpperCase() + currentRobot.category.slice(1);
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
                    notify.error('No robot selected');
                    return;
                }

                // Offline guard
                if (!navigator.onLine) {
                    notify.error("You're offline. Please go online and try again.");
                    return;
                }

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
                        contactEl.innerHTML = `
                            ${currentRobot.contact || 'Contact not provided'}
                            <div style="margin-top: 10px; font-size: 12px; color: var(--text-muted);">
                                <a href="https://solscan.io/tx/${result.signature}?cluster=${SOLANA_NETWORK}"
                                   target="_blank"
                                   style="color: var(--accent);">
                                    View transaction on Solscan
                                </a>
                            </div>
                        `;
                    } else {
                        // Demo mode - simulate transaction
                        log.info('[Marketplace]', 'Demo mode: Simulating escrow transaction...');
                        await new Promise(r => setTimeout(r, 2000));
                        document.getElementById('operatorContactValue').textContent = currentRobot.contact || 'Contact not provided';
                    }

                    closeModal(rentRobotModal);
                    openModal(successModal);
                    notify.success('Rental confirmed successfully!');
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

        async function deleteRobotFromDB(robotId) {
            if (!supabase) {
                log.info('[Marketplace]', 'Demo mode: Robot not deleted from DB');
                return { success: true };
            }

            try {
                // First, get the image URL to delete from storage
                const robotData = await safeSelect(
                    supabase
                        .from('robots')
                        .select('image_url')
                        .eq('id', robotId),
                    'Failed to fetch robot data'
                );

                const robot = robotData?.[0];

                // Delete from database
                await safeDelete(
                    supabase
                        .from('robots')
                        .delete()
                        .eq('id', robotId),
                    'Failed to delete robot'
                );

                // Delete image from storage if exists (non-critical, use safeStorageDelete)
                if (robot?.image_url) {
                    const fileName = robot.image_url.split('/').pop();
                    await safeStorageDelete(
                        supabase.storage.from('robot-images').remove([fileName])
                    );
                }

                return { success: true };
            } catch (err) {
                log.error('[Marketplace]', 'Error deleting robot:', err);
                return { success: false, error: err.message };
            }
        }

        function setupDeleteModal() {
            const confirmBtn = document.getElementById('confirmDelete');
            const cancelBtn = document.getElementById('cancelDelete');

            confirmBtn?.addEventListener('click', async () => {
                if (!robotToDelete) return;

                // Offline guard
                if (!navigator.onLine) {
                    notify.error("You're offline. Please go online and try again.");
                    return;
                }

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
                        notify.success('Robot deleted successfully');
                        robotToDelete = null;
                    } else {
                        notify.error('Failed to delete robot. Please try again.');
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

        async function updateRobotInDB(robotId, robotData, imageFile = null) {
            if (!supabase) {
                log.info('[Marketplace]', 'Demo mode: Robot not updated in DB');
                return { success: true, data: robotData };
            }

            try {
                let imageUrl = null;
                let uploadedFileName = null;
                let oldImageFileName = null;

                // Upload new image if provided (do this first, before DB update)
                if (imageFile) {
                    // Get old image URL to delete later (non-critical - if fails, just skip deletion)
                    try {
                        const oldRobotData = await safeSelect(
                            supabase
                                .from('robots')
                                .select('image_url')
                                .eq('id', robotId),
                            'Failed to fetch robot data'
                        );

                        const oldRobot = oldRobotData?.[0];
                        if (oldRobot?.image_url) {
                            oldImageFileName = oldRobot.image_url.split('/robot-images/')[1];
                        }
                    } catch (e) {
                        // Non-critical: if we can't get old image URL, just skip deletion later
                        log.warn('[Marketplace]', 'Could not fetch old image URL:', e.message);
                    }

                    // Upload new image with unique path
                    const fileExt = imageFile.name.split('.').pop();
                    uploadedFileName = `${robotId}/${Date.now()}.${fileExt}`;

                    await safeUpload(
                        supabase.storage
                            .from('robot-images')
                            .upload(uploadedFileName, imageFile),
                        'Failed to upload image'
                    );

                    const { data: urlData } = supabase.storage
                        .from('robot-images')
                        .getPublicUrl(uploadedFileName);

                    imageUrl = urlData.publicUrl;
                }

                // Build update object
                const updateData = {
                    name: robotData.name,
                    category: robotData.category,
                    description: robotData.description,
                    price: robotData.price,
                    price_unit: robotData.priceUnit,
                    contact: robotData.contact
                };

                // Add image_url only if new image was uploaded
                if (imageUrl) {
                    updateData.image_url = imageUrl;
                }

                // Update DB
                try {
                    const data = await safeUpdate(
                        supabase
                            .from('robots')
                            .update(updateData)
                            .eq('id', robotId)
                            .select()
                            .single(),
                        'Failed to update robot'
                    );

                    // DB update succeeded - now safe to delete old image
                    if (oldImageFileName) {
                        await safeStorageDelete(
                            supabase.storage.from('robot-images').remove([oldImageFileName])
                        );
                    }

                    return { success: true, data: data };
                } catch (dbError) {
                    // DB update failed - cleanup newly uploaded image
                    if (uploadedFileName) {
                        await safeStorageDelete(
                            supabase.storage.from('robot-images').remove([uploadedFileName])
                        );
                    }
                    throw dbError;
                }
            } catch (err) {
                log.error('[Marketplace]', 'Error updating robot:', err);
                return { success: false, error: err.message };
            }
        }

        // Setup Event Listeners
        function setupEventListeners() {
            // Add Robot button (header)
            addRobotBtn?.addEventListener('click', () => {
                if (!isWalletConnected()) {
                    openExistingWalletModal();
                } else {
                    resetAddRobotForm();
                    openModal(addRobotModal);
                }
            });

            // Add Robot button (empty state)
            addRobotEmptyBtn?.addEventListener('click', () => {
                if (!isWalletConnected()) {
                    openExistingWalletModal();
                } else {
                    resetAddRobotForm();
                    openModal(addRobotModal);
                }
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

            // ESC to close modals
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeAllModals();
                }
            });
        }

        // Initialize Marketplace
        export function initMarketplace() {
            // Get DOM elements now that page is loaded
            addRobotBtn = document.getElementById('addRobotBtn');
            addRobotEmptyBtn = document.getElementById('addRobotEmptyBtn');
            addRobotModal = document.getElementById('addRobotModal');
            addRobotForm = document.getElementById('addRobotForm');
            rentRobotModal = document.getElementById('rentRobotModal');
            successModal = document.getElementById('successModal');
            robotsGrid = document.getElementById('robotsGrid');
            marketplaceEmpty = document.getElementById('marketplaceEmpty');
            filterBtns = document.querySelectorAll('.filter-btn');
            walletModal = document.getElementById('walletModal');
            walletModalOverlay = document.getElementById('walletModalOverlay');
            robotAddedModal = document.getElementById('robotAddedModal');
            robotErrorModal = document.getElementById('robotErrorModal');

            // Initialize Supabase
            initSupabase();

            // Load robots from DB (async, will call refreshOwnershipUI when done)
            loadRobotsFromDB().then(() => {
                // Refresh ownership UI after robots are loaded
                refreshOwnershipUI();
            });

            setupFilters();
            setupAddRobotForm();
            setupRentModal();
            setupDeleteModal();
            setupEventListeners();
            updateEmptyState();

            // Listen for wallet connect/disconnect events from wallet.js
            window.addEventListener('wallet-connected', () => {
                log.debug('[Marketplace]', 'wallet-connected event received');
                refreshOwnershipUI();
            });

            window.addEventListener('wallet-disconnected', () => {
                log.debug('[Marketplace]', 'wallet-disconnected event received');
                refreshOwnershipUI();
            });
        }