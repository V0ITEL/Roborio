'use strict';

const TEXT_LIMITS = {
    name: 60,
    description: 500,
    speed: 30,
    payload: 30,
    battery: 30,
    location: 100,
    contact: 120
};

/**
 * Normalize text: trim, collapse multiple spaces to single
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * Validate and normalize robot form data
 * @param {Object} data - Raw form data
 * @returns {{ valid: boolean, data?: Object, error?: string }}
 */
export function validateRobotData(data) {
    // Normalize all text fields
    const normalized = {
        ...data,
        name: normalizeText(data.name),
        description: normalizeText(data.description),
        speed: normalizeText(data.speed),
        payload: normalizeText(data.payload),
        battery: normalizeText(data.battery),
        location: normalizeText(data.location),
        contact: normalizeText(data.contact)
    };

    // Validate required fields
    if (!normalized.name) {
        return { valid: false, error: 'Robot name is required' };
    }
    if (!normalized.description) {
        return { valid: false, error: 'Description is required' };
    }
    if (!normalized.contact) {
        return { valid: false, error: 'Contact info is required' };
    }

    // Validate length limits
    if (normalized.name.length > TEXT_LIMITS.name) {
        return { valid: false, error: `Name must be ${TEXT_LIMITS.name} characters or less` };
    }
    if (normalized.description.length > TEXT_LIMITS.description) {
        return { valid: false, error: `Description must be ${TEXT_LIMITS.description} characters or less` };
    }
    if (normalized.contact.length > TEXT_LIMITS.contact) {
        return { valid: false, error: `Contact must be ${TEXT_LIMITS.contact} characters or less` };
    }

    return { valid: true, data: normalized };
}
