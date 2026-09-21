const jwt = require('jsonwebtoken');

exports.protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ status: "error", message: "Akses ditolak. Sesi tidak valid atau belum login." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        req.user = decoded; 
        next();
    } catch (err) {
        return res.status(401).json({ status: "error", message: "Token kedaluwarsa atau tidak valid." });
    }
};

exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ status: "error", message: "Anda tidak memiliki izin untuk aksi ini." });
        }
        next();
    };
};