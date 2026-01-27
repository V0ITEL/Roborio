/**
 * Robot data model and normalization
 */

/**
 * @typedef {Object} Robot
 * @property {string} id
 * @property {string} ownerWallet - Full wallet address (never shortened)
 * @property {string} name
 * @property {string} category
 * @property {string} description
 * @property {number} price
 * @property {string} priceUnit
 * @property {string|null} imageUrl
 * @property {string|null} speed
 * @property {string|null} payload
 * @property {string|null} battery
 * @property {string|null} location
 * @property {string|null} contact
 * @property {string|null} createdAt
 * @property {boolean} isAvailable
 */

/**
 * Normalize a database row to Robot object
 * Maps snake_case to camelCase and ensures consistent types
 *
 * @param {Object} row - Raw database row
 * @returns {Robot}
 */
export function normalizeRobot(row) {
    if (!row) return null;

    return {
        id: String(row.id ?? ''),
        ownerWallet: row.owner_wallet ?? row.ownerWallet ?? '',
        name: row.name ?? '',
        category: row.category ?? 'other',
        description: row.description ?? '',
        price: parseFloat(row.price) || 0,
        priceUnit: row.price_unit ?? row.priceUnit ?? 'hour',
        imageUrl: row.image_url ?? row.imageUrl ?? null,
        speed: row.speed ?? null,
        payload: row.payload ?? null,
        battery: row.battery ?? null,
        location: row.location ?? null,
        contact: row.contact ?? null,
        createdAt: row.created_at ?? row.createdAt ?? null,
        isAvailable: row.is_available ?? row.isAvailable ?? true,
    };
}

/**
 * Convert Robot object back to database format (camelCase → snake_case)
 *
 * @param {Robot} robot
 * @returns {Object}
 */
export function toDbFormat(robot) {
    return {
        owner_wallet: robot.ownerWallet,
        name: robot.name,
        category: robot.category,
        description: robot.description,
        price: robot.price,
        price_unit: robot.priceUnit,
        image_url: robot.imageUrl,
        speed: robot.speed,
        payload: robot.payload,
        battery: robot.battery,
        location: robot.location,
        contact: robot.contact,
        is_available: robot.isAvailable,
    };
}

export default { normalizeRobot, toDbFormat };
