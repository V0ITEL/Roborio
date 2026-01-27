/**
 * Safe Supabase wrappers
 * Unwrap Supabase responses and throw on errors with user-friendly messages
 */

/**
 * Unwrap Supabase response - throws if error, returns data otherwise
 *
 * @template T
 * @param {{ data: T, error: any }} response - Supabase response
 * @param {string} contextMsg - Context message for error (e.g., "Failed to load robots")
 * @returns {T} - Data from response
 * @throws {Error} With user-friendly message on error
 */
export function unwrap({ data, error }, contextMsg = 'Database operation failed') {
    if (error) {
        // Log technical details for debugging
        console.error(`[Supabase] ${contextMsg}:`, error);
        // Throw user-friendly message
        throw new Error(contextMsg);
    }
    return data;
}

/**
 * Assert that Supabase client is initialized
 *
 * @param {any} supabase - Supabase client instance
 * @throws {Error} If supabase is not initialized
 */
export function assertSupabase(supabase) {
    if (!supabase) {
        throw new Error('Database not available. Running in demo mode.');
    }
}

/**
 * Safe SELECT query
 *
 * @template T
 * @param {Promise<{ data: T[], error: any }>} queryPromise - Supabase query promise
 * @param {string} contextMsg - Context message for error
 * @returns {Promise<T[]>} - Array of rows
 */
export async function safeSelect(queryPromise, contextMsg = 'Failed to load data') {
    try {
        const response = await queryPromise;
        return unwrap(response, contextMsg) || [];
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error(contextMsg);
    }
}

/**
 * Safe INSERT query
 *
 * @template T
 * @param {Promise<{ data: T, error: any }>} queryPromise - Supabase query promise
 * @param {string} contextMsg - Context message for error
 * @returns {Promise<T>} - Inserted row
 */
export async function safeInsert(queryPromise, contextMsg = 'Failed to save data') {
    try {
        const response = await queryPromise;
        return unwrap(response, contextMsg);
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error(contextMsg);
    }
}

/**
 * Safe UPDATE query
 *
 * @template T
 * @param {Promise<{ data: T, error: any }>} queryPromise - Supabase query promise
 * @param {string} contextMsg - Context message for error
 * @returns {Promise<T>} - Updated row
 */
export async function safeUpdate(queryPromise, contextMsg = 'Failed to update data') {
    try {
        const response = await queryPromise;
        return unwrap(response, contextMsg);
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error(contextMsg);
    }
}

/**
 * Safe DELETE query
 *
 * @param {Promise<{ data: any, error: any }>} queryPromise - Supabase query promise
 * @param {string} contextMsg - Context message for error
 * @returns {Promise<void>}
 */
export async function safeDelete(queryPromise, contextMsg = 'Failed to delete data') {
    try {
        const response = await queryPromise;
        unwrap(response, contextMsg);
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error(contextMsg);
    }
}

/**
 * Safe Storage upload
 *
 * @param {Promise<{ data: any, error: any }>} uploadPromise - Supabase storage upload promise
 * @param {string} contextMsg - Context message for error
 * @returns {Promise<any>} - Upload result
 */
export async function safeUpload(uploadPromise, contextMsg = 'Failed to upload file') {
    try {
        const response = await uploadPromise;
        return unwrap(response, contextMsg);
    } catch (error) {
        if (error instanceof Error) throw error;
        throw new Error(contextMsg);
    }
}

/**
 * Safe Storage delete
 *
 * @param {Promise<{ data: any, error: any }>} deletePromise - Supabase storage delete promise
 * @returns {Promise<void>}
 */
export async function safeStorageDelete(deletePromise) {
    try {
        const response = await deletePromise;
        // Storage delete may have partial failures, check for errors array
        if (response.error) {
            throw new Error(response.error.message || 'Failed to delete file');
        }
    } catch (error) {
        // Log but don't throw for storage cleanup - it's not critical
        console.warn('Storage cleanup warning:', error.message);
    }
}

export default {
    unwrap,
    assertSupabase,
    safeSelect,
    safeInsert,
    safeUpdate,
    safeDelete,
    safeUpload,
    safeStorageDelete,
};
