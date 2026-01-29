'use strict';

import { getWalletJWT } from '../../wallet.js';
import { safeInsert, safeUpdate, safeDelete, safeUpload, safeStorageDelete } from '../../utils/safeSupabase.js';
import { log } from '../../utils/logger.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

export function getSupabase() {
    return supabase;
}

export async function initSupabase() {
    if (window.supabase && SUPABASE_URL !== 'https://your-project.supabase.co') {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: {
                fetch: (url, options = {}) => {
                    const jwt = getWalletJWT();
                    const headers = new Headers(options.headers || {});
                    if (jwt) headers.set('Authorization', `Bearer ${jwt}`);
                    return fetch(url, { ...options, headers });
                }
            }
        });

        log.info('[Marketplace]', 'Supabase initialized (JWT via global.fetch)');
        return supabase;
    }

    log.warn('[Marketplace]', 'Supabase not configured. Running in demo mode.');
    supabase = null;
    return null;
}

export async function saveRobotToDB(robotData, imageFile) {
    if (!supabase) {
        log.info('[Marketplace]', 'Demo mode: Robot not saved to DB');
        return { success: true, data: robotData };
    }

    const jwt = getWalletJWT();
    if (!jwt) {
        return { success: false, error: 'Not authenticated. Please reconnect wallet.' };
    }

    try {
        let imageUrl = null;
        let uploadedFileName = null;

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
                        contact: robotData.contact || null,
                    }])
                    .select()
                    .single(),
                'Failed to save robot'
            );

            return { success: true, data: data };
        } catch (dbError) {
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

export async function updateRobotInDB(robotId, robotData, imageFile = null) {
    if (!supabase) {
        log.info('[Marketplace]', 'Demo mode: Robot not updated in DB');
        return { success: true, data: robotData };
    }

    const jwt = getWalletJWT();
    if (!jwt) {
        return { success: false, error: 'Not authenticated. Please reconnect wallet.' };
    }

    try {
        let imageUrl = null;
        let uploadedFileName = null;
        let oldImageFileName = null;

        if (imageFile) {
            try {
                const oldRobotData = await supabase
                    .from('robots')
                    .select('image_url')
                    .eq('id', robotId);

                const oldRobot = oldRobotData?.data?.[0];
                if (oldRobot?.image_url) {
                    oldImageFileName = oldRobot.image_url.split('/robot-images/')[1];
                }
            } catch (e) {
                log.warn('[Marketplace]', 'Could not fetch old image URL:', e.message);
            }

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

        const updateData = {
            name: robotData.name,
            category: robotData.category,
            description: robotData.description,
            price: robotData.price,
            price_unit: robotData.priceUnit,
            contact: robotData.contact
        };

        if (imageUrl) {
            updateData.image_url = imageUrl;
        }

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

            if (oldImageFileName) {
                await safeStorageDelete(
                    supabase.storage.from('robot-images').remove([oldImageFileName])
                );
            }

            return { success: true, data: data };
        } catch (dbError) {
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

export async function deleteRobotFromDB(robotId) {
    if (!supabase) {
        log.info('[Marketplace]', 'Demo mode: Robot not deleted from DB');
        return { success: true };
    }

    const jwt = getWalletJWT();
    if (!jwt) {
        return { success: false, error: 'Not authenticated. Please reconnect wallet.' };
    }

    try {
        const robotData = await supabase
            .from('robots')
            .select('image_url')
            .eq('id', robotId);

        const robot = robotData?.data?.[0];

        await safeDelete(
            supabase
                .from('robots')
                .delete()
                .eq('id', robotId),
            'Failed to delete robot'
        );

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
