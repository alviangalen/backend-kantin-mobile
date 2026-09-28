const path = require('path');
const supabase = require('../config/database');

const BUCKET_NAME = 'menu-images';

/**
 * Ekstrak nama file dari URL publik Supabase Storage
 * @param {string} url
 * @returns {string|null}
 */
const extractFileNameFromUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    try {
        const parsedUrl = new URL(url);
        const segments = parsedUrl.pathname.split('/');
        const bucketIndex = segments.indexOf(BUCKET_NAME);
        if (bucketIndex !== -1 && bucketIndex < segments.length - 1) {
            return decodeURIComponent(segments.slice(bucketIndex + 1).join('/'));
        }
        return path.basename(parsedUrl.pathname);
    } catch {
        const parts = url.split('/');
        return parts[parts.length - 1] || null;
    }
};

/**
 * Upload buffer gambar ke Supabase Storage
 * @param {Express.Multer.File} file
 * @returns {Promise<{imageUrl: string, fileName: string}>}
 */
const uploadMenuImage = async (file) => {
    if (!file || !file.buffer) {
        throw new Error('File buffer tidak ditemukan');
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const fileName = `menu-${uniqueSuffix}${cleanExt}`;

    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, file.buffer, {
            contentType: file.mimetype,
            upsert: true
        });

    if (error) {
        throw new Error(`Gagal mengunggah foto ke storage: ${error.message}`);
    }

    const { data: publicData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

    return {
        imageUrl: publicData.publicUrl,
        fileName: fileName
    };
};

/**
 * Hapus gambar dari Supabase Storage berdasarkan URL atau nama file
 * @param {string} imageUrlOrFileName
 * @returns {Promise<boolean>}
 */
const deleteMenuImage = async (imageUrlOrFileName) => {
    if (!imageUrlOrFileName) return false;

    const fileName = extractFileNameFromUrl(imageUrlOrFileName);
    if (!fileName) return false;

    try {
        const { error } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([fileName]);

        if (error) {
            console.warn(`[STORAGE] Gagal menghapus file '${fileName}':`, error.message);
            return false;
        }
        return true;
    } catch (err) {
        console.warn(`[STORAGE] Error saat menghapus file '${fileName}':`, err.message);
        return false;
    }
};

module.exports = {
    BUCKET_NAME,
    extractFileNameFromUrl,
    uploadMenuImage,
    deleteMenuImage
};
