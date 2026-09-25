/**
 * WhatsApp Gateway Service menggunakan Fonnte API
 * Dokumentasi Fonnte: https://docs.fonnte.com/
 */

/**
 * Normalisasi format nomor telepon agar sesuai dengan standar WhatsApp/Fonnte.
 * Contoh:
 * - '08123456789' -> '628123456789'
 * - '+628123456789' -> '628123456789'
 * - '628123456789' -> '628123456789'
 * - '8123456789' -> '628123456789'
 *
 * @param {string} phone
 * @returns {string}
 */
const formatWhatsAppTarget = (phone) => {
    if (!phone) return '';
    let cleaned = phone.toString().replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
    } else if (cleaned.startsWith('8')) {
        cleaned = '62' + cleaned;
    }
    return cleaned;
};

/**
 * Mengirim pesan OTP via WhatsApp menggunakan Fonnte API
 * @param {string} phoneNumber - Nomor WhatsApp tujuan (bisa format 08... atau 628...)
 * @param {string} otp - Kode OTP 4 digit
 * @returns {Promise<{success: boolean, message?: string, reason?: string, isConfigMissing?: boolean}>}
 */
const sendWhatsAppOtp = async (phoneNumber, otp) => {
    const fonnteToken = process.env.FONNTE_TOKEN;

    if (!fonnteToken || fonnteToken.trim() === '' || fonnteToken === 'isi_token_fonnte_anda') {
        return {
            success: false,
            reason: 'FONNTE_TOKEN belum diatur di file .env',
            isConfigMissing: true
        };
    }

    const target = formatWhatsAppTarget(phoneNumber);
    const message = `*E-KANTIN SPENSA* 🍽️\n\nKode Verifikasi (OTP) Anda adalah:\n*${otp}*\n\nKode ini berlaku selama *5 menit*.\nDemi keamanan akun Anda, jangan bagikan kode ini kepada siapa pun.`;

    try {
        const response = await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: {
                'Authorization': fonnteToken.trim(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target: target,
                message: message,
                countryCode: '62'
            })
        });

        const data = await response.json();

        if (data.status === true) {
            return {
                success: true,
                message: 'Pesan OTP berhasil dikirim via WhatsApp',
                detail: data
            };
        } else {
            console.error('[WHATSAPP SERVICE] Fonnte error:', data);
            return {
                success: false,
                reason: data.reason || 'Pesan gagal dikirim oleh Fonnte',
                detail: data
            };
        }
    } catch (error) {
        console.error('[WHATSAPP SERVICE] Network error:', error.message);
        return {
            success: false,
            reason: `Gagal menghubungi server WhatsApp: ${error.message}`
        };
    }
};

module.exports = {
    formatWhatsAppTarget,
    sendWhatsAppOtp
};
