/**
 * Safe fetch wrapper with timeout and error handling
 * Never throws uncaught errors - always returns structured result or throws with message
 */

/**
 * @typedef {Object} SafeFetchResult
 * @property {any} data - Parsed JSON data (or null if not JSON)
 * @property {string} rawText - Raw response text
 * @property {number} status - HTTP status code
 */

/**
 * Safe fetch with timeout and structured error handling
 *
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {Object} config - Additional config
 * @param {number} config.timeoutMs - Timeout in milliseconds (default: 15000)
 * @returns {Promise<SafeFetchResult>}
 * @throws {Error} With user-friendly message on failure
 */
export async function safeFetch(url, options = {}, { timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Read response text first
        let rawText = '';
        try {
            rawText = await response.text();
        } catch (e) {
            rawText = '';
        }

        // Try to parse as JSON
        let data = null;
        try {
            if (rawText) {
                data = JSON.parse(rawText);
            }
        } catch (e) {
            // Not JSON, that's ok
            data = null;
        }

        // Check if response is ok
        if (!response.ok) {
            // Build error message
            let errorMessage = '';

            if (data && (data.error || data.message)) {
                // Use error from JSON response
                errorMessage = data.error || data.message;
            } else if (rawText) {
                // Use first 200 chars of response
                const truncated = rawText.length > 200 ? rawText.slice(0, 200) + '...' : rawText;
                errorMessage = `HTTP ${response.status}: ${truncated}`;
            } else {
                // Empty response
                errorMessage = `HTTP ${response.status} (empty response)`;
            }

            throw new Error(errorMessage);
        }

        return { data, rawText, status: response.status };

    } catch (error) {
        clearTimeout(timeoutId);

        // Handle specific error types
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please check your connection and try again.');
        }

        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error('Network error. Please check your internet connection.');
        }

        // Re-throw our own errors or wrap unknown ones
        if (error instanceof Error) {
            throw error;
        }

        throw new Error('An unexpected error occurred. Please try again.');
    }
}

/**
 * Convenience wrapper that returns just data (throws on error)
 *
 * @param {string} url
 * @param {RequestInit} options
 * @param {Object} config
 * @returns {Promise<any>} Parsed JSON data
 */
export async function safeFetchJson(url, options = {}, config = {}) {
    const result = await safeFetch(url, options, config);
    return result.data;
}

export default safeFetch;
