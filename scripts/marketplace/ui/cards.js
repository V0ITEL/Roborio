'use strict';

const CATEGORY_EMOJIS = {
    delivery: '\u{1F69A}',
    cleaning: '\u{1F9F9}',
    security: '\u{1F6E1}\u{FE0F}',
    inspection: '\u{1F50D}',
    warehouse: '\u{1F916}',
    agriculture: '\u{1F33E}',
    healthcare: '\u{1F3E5}',
    hospitality: '\u{1F37D}\u{FE0F}'
};

function getCategoryEmoji(category) {
    return CATEGORY_EMOJIS[category] || '\u{1F916}';
}

function formatCategory(category) {
    if (!category) return '';
    return category.charAt(0).toUpperCase() + category.slice(1);
}

function getSafeImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const parsed = new URL(url, window.location.origin);
        const protocol = parsed.protocol.toLowerCase();
        if (protocol === 'http:' || protocol === 'https:' || protocol === 'blob:') {
            return parsed.toString();
        }
        if (protocol === 'data:' && /^data:image\//i.test(parsed.href)) {
            return parsed.href;
        }
    } catch (e) {
        return null;
    }
    return null;
}

function getRobotStatusBadge(statusValue) {
    const normalized = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : '';
    const label = normalized === 'pilot' ? 'Pilot' : 'Live';
    const className = normalized === 'pilot' ? 'market-status market-status--pilot' : 'market-status market-status--live';
    return { label, className };
}

function renderRobotImage(container, imageUrl, category, name) {
    if (!container) return;
    container.replaceChildren();

    const safeUrl = getSafeImageUrl(imageUrl);
    if (safeUrl) {
        const img = document.createElement('img');
        img.src = safeUrl;
        img.alt = name || 'Robot image';
        container.appendChild(img);
        return;
    }

    container.textContent = getCategoryEmoji(category);
}

function createIconSvg(paths) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');

    paths.forEach((d) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    });

    return svg;
}

export function createCardRenderer({
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
}) {
    function addRobotCardFromRobot(robot) {
        const card = document.createElement('article');
        card.className = 'market-card';
        card.dataset.robotId = robot.id;
        card.dataset.category = robot.category;
        card.dataset.name = robot.name;
        card.dataset.price = robot.price;
        card.dataset.unit = robot.priceUnit;
        card.dataset.ownerWallet = robot.ownerWallet;
        const createdAt = robot.createdAt ? Date.parse(robot.createdAt) : Date.now();
        card.dataset.createdAt = Number.isFinite(createdAt) ? String(createdAt) : String(Date.now());

        const isOwner = isWalletConnected() && getConnectedWallet() === robot.ownerWallet;

        const top = document.createElement('div');
        top.className = 'market-card-top';

        const categorySpan = document.createElement('span');
        categorySpan.className = 'market-category';
        categorySpan.textContent = formatCategory(robot.category);
        top.appendChild(categorySpan);

        if (isOwner) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'owner-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-owner btn-edit';
            editBtn.type = 'button';
            editBtn.title = 'Edit';
            editBtn.appendChild(createIconSvg([
                'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7',
                'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z'
            ]));

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-owner btn-delete';
            deleteBtn.type = 'button';
            deleteBtn.title = 'Delete';
            deleteBtn.appendChild(createIconSvg([
                'M3 6h18',
                'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6'
            ]));

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);
            top.appendChild(actionsDiv);
        }

        const imageDiv = document.createElement('div');
        imageDiv.className = 'market-card-image';
        renderRobotImage(imageDiv, robot.imageUrl, robot.category, robot.name);

        const status = getRobotStatusBadge(robot.status);
        const statusBadge = document.createElement('span');
        statusBadge.className = status.className;
        statusBadge.textContent = status.label;
        imageDiv.appendChild(statusBadge);

        const body = document.createElement('div');
        body.className = 'market-card-body';

        const title = document.createElement('h4');
        title.className = 'market-card-title';
        title.textContent = robot.name;

        const desc = document.createElement('p');
        desc.className = 'market-card-desc';
        desc.textContent = robot.description;

        const footer = document.createElement('div');
        footer.className = 'market-card-footer';

        const price = document.createElement('span');
        price.className = 'market-price';
        price.textContent = `$${robot.price}/${robot.priceUnit}`;

        footer.appendChild(price);
        body.appendChild(title);
        body.appendChild(desc);
        body.appendChild(footer);

        const actions = document.createElement('div');
        actions.className = 'market-card-actions';
        const rentBtn = document.createElement('button');
        rentBtn.className = 'btn-rent';
        rentBtn.type = 'button';
        rentBtn.textContent = 'Rent Now';
        actions.appendChild(rentBtn);

        card.appendChild(top);
        card.appendChild(imageDiv);
        card.appendChild(body);
        card.appendChild(actions);

        rentBtn.addEventListener('click', () => openRentModalById(robot.id));

        const editBtn = card.querySelector('.btn-edit');
        const deleteBtn = card.querySelector('.btn-delete');
        if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModalById(robot.id); });
        if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModalById(robot.id); });

        robotsGrid.appendChild(card);
        setTimeout(() => card.classList.add('animate-in'), 50);
    }

    function addRobotCardFromDB(rawRobot, normalizeRobot) {
        const robot = normalizeRobot(rawRobot);
        robotsMap.set(robot.id, robot);
        addRobotCardFromRobot(robot);
    }

    function addRobotCard(data) {
        const card = document.createElement('article');
        card.className = 'market-card';
        card.dataset.category = data.category;
        card.dataset.name = data.name;
        card.dataset.price = data.price;
        card.dataset.unit = data.priceUnit;
        card.dataset.contact = data.contact;
        card.dataset.ownerWallet = data.ownerWallet || '';
        card.dataset.createdAt = String(Date.now());

        const top = document.createElement('div');
        top.className = 'market-card-top';

        const categorySpan = document.createElement('span');
        categorySpan.className = 'market-category';
        categorySpan.textContent = formatCategory(data.category);
        top.appendChild(categorySpan);

        const imageDiv = document.createElement('div');
        imageDiv.className = 'market-card-image';
        renderRobotImage(imageDiv, null, data.category, data.name);

        const status = getRobotStatusBadge(data.status);
        const statusBadge = document.createElement('span');
        statusBadge.className = status.className;
        statusBadge.textContent = status.label;
        imageDiv.appendChild(statusBadge);

        const body = document.createElement('div');
        body.className = 'market-card-body';

        const title = document.createElement('h4');
        title.className = 'market-card-title';
        title.textContent = data.name;

        const desc = document.createElement('p');
        desc.className = 'market-card-desc';
        desc.textContent = data.description;

        const footer = document.createElement('div');
        footer.className = 'market-card-footer';

        const price = document.createElement('span');
        price.className = 'market-price';
        price.textContent = `$${data.price}/${data.priceUnit}`;

        footer.appendChild(price);
        body.appendChild(title);
        body.appendChild(desc);
        body.appendChild(footer);

        const actions = document.createElement('div');
        actions.className = 'market-card-actions';
        const rentBtn = document.createElement('button');
        rentBtn.className = 'btn-rent';
        rentBtn.type = 'button';
        rentBtn.textContent = 'Rent Now';
        actions.appendChild(rentBtn);

        card.appendChild(top);
        card.appendChild(imageDiv);
        card.appendChild(body);
        card.appendChild(actions);

        rentBtn.addEventListener('click', () => openRentModal(card));

        robotsGrid.insertBefore(card, robotsGrid.firstChild);
        setTimeout(() => card.classList.add('animate-in'), 50);
        updateEmptyState();
    }

    function refreshOwnershipUI() {
        const connectedWallet = getConnectedWallet();
        const cards = robotsGrid?.querySelectorAll('[data-robot-id]');

        if (!cards) return;

        cards.forEach((card) => {
            const robotId = card.dataset.robotId;
            const robot = robotsMap.get(robotId);

            if (!robot) return;

            const isOwner = connectedWallet && robot.ownerWallet === connectedWallet;
            const existingActions = card.querySelector('.owner-actions');

            if (isOwner && !existingActions) {
                const topDiv = card.querySelector('.market-card-top');
                if (topDiv) {
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'owner-actions';

                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn-owner btn-edit';
                    editBtn.type = 'button';
                    editBtn.title = 'Edit';
                    editBtn.appendChild(createIconSvg([
                        'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7',
                        'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z'
                    ]));

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn-owner btn-delete';
                    deleteBtn.type = 'button';
                    deleteBtn.title = 'Delete';
                    deleteBtn.appendChild(createIconSvg([
                        'M3 6h18',
                        'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6'
                    ]));

                    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditModalById(robotId); });
                    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteModalById(robotId); });

                    actionsDiv.appendChild(editBtn);
                    actionsDiv.appendChild(deleteBtn);
                    topDiv.appendChild(actionsDiv);
                }
            } else if (!isOwner && existingActions) {
                existingActions.remove();
            }
        });

        log.debug('[Marketplace]', 'refreshOwnershipUI completed, connected wallet:', connectedWallet ? connectedWallet.slice(0, 8) + '...' : 'none');
    }

    return {
        addRobotCardFromRobot,
        addRobotCardFromDB,
        addRobotCard,
        refreshOwnershipUI,
        renderRobotImage,
        formatCategory
    };
}
