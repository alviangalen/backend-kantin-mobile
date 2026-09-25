const supabase = require('../config/database');
const jwt = require('jsonwebtoken');
const { sendWhatsAppOtp, formatWhatsAppTarget } = require('../services/whatsappService');

const otpStore = {};

exports.requestOtp = async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Nomor HP wajib diisi" });
    }

    const cleanPhone = phoneNumber.toString().trim();
    const target = formatWhatsAppTarget(cleanPhone);
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Simpan OTP dengan masa berlaku 5 menit
    const expiresAt = Date.now() + 5 * 60000;
    otpStore[cleanPhone] = { otp, expiresAt };
    if (target && target !== cleanPhone) {
        otpStore[target] = { otp, expiresAt };
    }

    // Auto-cleanup setelah 10 menit (unref agar tidak menahan proses)
    const cleanupTimer = setTimeout(() => {
        delete otpStore[cleanPhone];
        if (target) delete otpStore[target];
    }, 10 * 60000);
    if (cleanupTimer.unref) cleanupTimer.unref();

    // Kirim pesan WhatsApp menggunakan Fonnte
    const waResult = await sendWhatsAppOtp(cleanPhone, otp);

    if (!waResult.success) {
        console.error(`[AUTH] Gagal mengirim OTP ke WhatsApp (${cleanPhone}):`, waResult.reason);

        // Jika dalam mode development, log kode di console untuk kemudahan debugging developer
        if (process.env.NODE_ENV === 'development') {
            console.log(`[DEV MODE] Kode OTP cadangan untuk ${cleanPhone} adalah: ${otp}`);
        }

        return res.status(500).json({
            status: "error",
            message: `Gagal mengirim kode OTP ke WhatsApp: ${waResult.reason}`
        });
    }

    console.log(`[AUTH] Kode OTP berhasil dikirim via WhatsApp ke ${cleanPhone}`);

    return res.status(200).json({
        status: "success",
        message: "Kode OTP telah dikirim ke WhatsApp Anda"
    });
};

exports.verifyOtp = async (req, res) => {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
        return res.status(400).json({ status: "error", message: "Nomor HP dan kode OTP wajib diisi" });
    }

    const cleanPhone = phoneNumber.toString().trim();
    const target = formatWhatsAppTarget(cleanPhone);
    const record = otpStore[cleanPhone] || (target ? otpStore[target] : null);

    if (!record || record.otp !== otp.toString().trim() || record.expiresAt < Date.now()) {
        return res.status(401).json({ status: "error", message: "OTP salah atau kedaluwarsa" });
    }

    try {
        let { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone_number', cleanPhone)
            .maybeSingle();

        if (!user && target && target !== cleanPhone) {
            const { data: userByTarget } = await supabase
                .from('profiles')
                .select('*')
                .eq('phone_number', target)
                .maybeSingle();
            if (userByTarget) user = userByTarget;
        }

        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            const { data: newUser, error: insertError } = await supabase
                .from('profiles')
                .insert([{ 
                    phone_number: cleanPhone, 
                    full_name: 'Pengguna Baru', 
                    role: 'STUDENT' 
                }])
                .select()
                .single();

            if (insertError) throw insertError;
            user = newUser;
        }

        delete otpStore[cleanPhone];
        if (target) delete otpStore[target];

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(200).json({
            status: "success",
            message: "Verifikasi berhasil",
            data: {
                token,
                user: {
                    id: user.id,
                    fullName: user.full_name,
                    role: user.role,
                    isNewUser
                }
            }
        });

    } catch (err) {
        res.status(500).json({ status: "error", message: "Terjadi kesalahan server", error: err.message });
    }
};
