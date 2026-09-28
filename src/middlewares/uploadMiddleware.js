const multer = require('multer');
const path = require('path');

// Simpan file sementara di memory buffer untuk diteruskan ke Supabase Storage
const storage = multer.memoryStorage();

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();

    if (ALLOWED_EXTENSIONS.includes(ext) && ALLOWED_MIME_TYPES.includes(mime)) {
        cb(null, true);
    } else {
        const error = new Error('Format file tidak didukung. Hanya file berformat JPG, JPEG, PNG, atau WEBP yang diperbolehkan.');
        error.code = 'INVALID_FILE_TYPE';
        cb(error, false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: fileFilter
});

/**
 * Middleware untuk upload satu file gambar (field 'image' atau 'file')
 * Menangani error format dan limit ukuran file secara elegan.
 */
const uploadSingleImage = (req, res, next) => {
    const uploader = upload.single('image');

    uploader(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Ukuran file terlalu besar. Maksimal ukuran file adalah 5MB.'
                });
            }
            if (err.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({
                    status: 'error',
                    message: err.message
                });
            }
            return res.status(400).json({
                status: 'error',
                message: `Gagal memproses file upload: ${err.message}`
            });
        }
        next();
    });
};

/**
 * Middleware upload opsional untuk form menu (bisa ada foto atau tidak, atau kirim JSON biasa)
 */
const uploadOptionalImage = (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
        return next();
    }

    const uploader = upload.single('image');
    uploader(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Ukuran file terlalu besar. Maksimal ukuran file adalah 5MB.'
                });
            }
            if (err.code === 'INVALID_FILE_TYPE') {
                return res.status(400).json({
                    status: 'error',
                    message: err.message
                });
            }
            return res.status(400).json({
                status: 'error',
                message: `Gagal memproses file upload: ${err.message}`
            });
        }
        next();
    });
};

module.exports = {
    uploadSingleImage,
    uploadOptionalImage,
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE
};
