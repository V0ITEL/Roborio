"use strict";

export function initRobotForm({
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
    getRobotToEdit,
    setRobotToEdit,
    refreshMarketplaceView
}) {
    function resetAddRobotForm() {
        if (addRobotForm) addRobotForm.reset();

        const uploadPlaceholder = document.getElementById('uploadPlaceholder');
        const uploadPreview = document.getElementById('uploadPreview');
        if (uploadPlaceholder) uploadPlaceholder.hidden = false;
        if (uploadPreview) uploadPreview.hidden = true;

        const modalTitle = document.querySelector('#addRobotModal .mp-modal-title');
        const btnText = document.querySelector('#addRobotModal .btn-primary .btn-text');
        if (modalTitle) modalTitle.textContent = 'Add Your Robot';
        if (btnText) btnText.textContent = 'List Robot';

        setRobotToEdit(null);
    }

    function showRobotAddedSuccess() {
        closeModal(addRobotModal);
        resetAddRobotForm();
        openModal(robotAddedModal);
    }

    function showRobotAddedError(message) {
        const msgEl = document.getElementById('robotErrorMessage');
        if (msgEl) msgEl.textContent = message || 'Something went wrong. Please try again.';
        closeModal(addRobotModal);
        openModal(robotErrorModal);
    }

    function setupAddRobotForm() {
        const imageInput = document.getElementById('robotImage');
        const uploadPlaceholder = document.getElementById('uploadPlaceholder');
        const uploadPreview = document.getElementById('uploadPreview');
        const previewImg = document.getElementById('previewImg');
        const removeImageBtn = document.getElementById('removeImage');
        const changeImageBtn = document.getElementById('changeImage');

        uploadPlaceholder?.addEventListener('click', () => imageInput.click());
        uploadPreview?.addEventListener('click', () => imageInput.click());
        changeImageBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            imageInput.click();
        });

        imageInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 5 * 1024 * 1024) {
                    notify.error('Image must be under 5MB');
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

        removeImageBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            imageInput.value = '';
            previewImg.src = '';
            uploadPlaceholder.hidden = false;
            uploadPreview.hidden = true;
        });

        addRobotForm?.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!navigator.onLine) {
                notify.error('No internet connection');
                return;
            }

            if (!requireWalletOrPrompt()) return;

            const submitBtn = document.getElementById('submitRobot');
            const loadingText = getRobotToEdit() ? 'Saving...' : 'Listing...';

            await withLoading(submitBtn, async () => {
                const formData = new FormData(addRobotForm);
                const imageFile = imageInput.files[0] || null;

                const walletAddress = getConnectedWallet();
                if (!walletAddress) {
                    notify.error('Wallet disconnected. Please reconnect.');
                    return;
                }

                const rawData = {
                    ownerWallet: walletAddress,
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

                const validation = validateRobotData(rawData);
                if (!validation.valid) {
                    notify.error(validation.error);
                    return;
                }

                const robotData = validation.data;
                let result;

                if (getRobotToEdit()) {
                    const robotToEdit = getRobotToEdit();
                    result = await updateRobotInDB(robotToEdit.id, robotData, imageFile);

                    if (result.success) {
                        const updatedRobot = normalizeRobot(result.data);
                        robotsMap.set(updatedRobot.id, updatedRobot);

                        const card = robotsGrid.querySelector(`[data-robot-id="${robotToEdit.id}"]`);
                        if (card) {
                            card.dataset.category = updatedRobot.category;
                            card.dataset.name = updatedRobot.name;
                            card.dataset.price = updatedRobot.price;
                            card.dataset.unit = updatedRobot.priceUnit;
                            card.querySelector('.market-card-title').textContent = updatedRobot.name;
                            card.querySelector('.market-card-desc').textContent = updatedRobot.description;
                            card.querySelector('.market-category').textContent = cardRenderer.formatCategory(updatedRobot.category);
                            card.querySelector('.market-price').textContent = `$${updatedRobot.price}/${updatedRobot.priceUnit}`;

                            if (updatedRobot.imageUrl) {
                                const imageEl = card.querySelector('.market-card-image');
                                const imgUrl = `${updatedRobot.imageUrl}?v=${Date.now()}`;
                                cardRenderer.renderRobotImage(imageEl, imgUrl, updatedRobot.category, updatedRobot.name);
                            }
                        }

                        closeModal(addRobotModal);
                        resetAddRobotForm();
                        notify.success('Robot updated');
                        setRobotToEdit(null);
                        if (typeof refreshMarketplaceView === 'function') {
                            refreshMarketplaceView();
                        }
                    } else {
                        notify.error('Could not update robot. Please try again.');
                    }
                } else {
                    result = await saveRobotToDB(robotData, imageFile);

                    if (result.success) {
                        if (result.data.id) {
                            cardRenderer.addRobotCardFromDB(result.data, normalizeRobot);
                        } else {
                            cardRenderer.addRobotCard(robotData);
                        }

                        addRobotForm.reset();
                        uploadPlaceholder.hidden = false;
                        uploadPreview.hidden = true;
                        updateEmptyState();

                        showRobotAddedSuccess();
                        if (typeof refreshMarketplaceView === 'function') {
                            refreshMarketplaceView();
                        }
                    } else {
                        showRobotAddedError(result.error);
                    }
                }
            }, { loadingText });
        });
    }

    setupAddRobotForm();

    return { resetAddRobotForm };
}
