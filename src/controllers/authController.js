const supabase = require('../config/database');
const jwt = require('jsonwebtoken');

const otpStore = {};

exports.requestOtp = async (req, res) => {
    const { phoneNumber } =  req.body;

    if (!phoneNumber) {
        return res.status(400).json({ status: "error", message: "Nomor HP wajib diisi" });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    otpStore[phoneNumber] = { otp, expiresAt: Date.now() + 5 * 60000 };

    console.log(`Kode OTP untuk ${phoneNumber} adalah: ${otp}`);

    res.status(200).json({
        status: "success",
        message: "Kode OTP telah dikirim ke WhatsApp Anda"
    });
};

exports.verifyOtp = async (req, res) => {
    const { phoneNumber, otp } = req.body;

    const record = otpStore[phoneNumber];
    if (!record || record.otp !== otp || record.expiresAt < Date.now()) {
        return res.status(401).json({ status: "error", message: "OTP salah atau kedaluwarsa" });
    }

    try {
        let { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();

        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            const { data: newUser, error: insertError } = await supabase
                .from('profiles')
                .insert([{ 
                    phone_number: phoneNumber, 
                    full_name: 'Pengguna Baru', 
                    role: 'STUDENT' 
                }])
                .select()
                .single();

            if (insertError) throw insertError;
            user = newUser;
        }

        delete otpStore[phoneNumber];

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