require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const supabase = require('./config/database');

const authRoutes = require('./routes/authRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');

require('./jobs/penaltyJob');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet()); 
app.use(cors());   
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, 
    max: 100, 
    message: { status: "error", message: "Terlalu banyak request, coba lagi nanti." }
});
app.use(limiter);

app.get('/api/v1/health', async (req, res) => {
    try {
        const { data, error } = await supabase.rpc('now'); 
        
        if (error) throw error;

        res.status(200).json({
            status: "success",
            message: "Server E-Kantin API Berjalan Normal",
            database: "Terhubung ke Supabase",
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: "Koneksi Database Gagal",
            error: err.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`[SERVER] API berjalan di http://localhost:${PORT}`);
    console.log(`[ENV] Mode: ${process.env.NODE_ENV}`);
});

app.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (req.path === '/api/v1/health') return next(); 
    
    if (apiKey !== process.env.APP_SECRET_KEY) {
        return res.status(403).json({ status: "error", message: "Akses Ditolak: Aplikasi Tidak Valid" });
    }
    next();
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/menus', menuRoutes);
app.use('/api/v1/orders', orderRoutes);