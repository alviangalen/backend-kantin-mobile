-- =========================================================================
-- SUPABASE SQL EDITOR SCRIPT: ADMIN ROLE & FITUR SUSPEND AKUN (IS_ACTIVE)
-- =========================================================================
-- Jalankan seluruh query berikut di menu 'SQL Editor' pada dashboard Supabase Anda.

-- 1. Tambahkan nilai 'ADMIN' ke enum user_role jika belum ada
DO $$
BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ADMIN';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Tambahkan kolom 'is_active' pada tabel profiles (default TRUE)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 3. Pastikan seluruh profil yang sudah terdaftar bernilai aktif
UPDATE profiles SET is_active = TRUE WHERE is_active IS NULL;

-- 4. Verifikasi bahwa kolom 'is_active' telah berhasil dibuat
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'profiles' AND column_name = 'is_active';

-- 5. (Opsional) Mengangkat salah satu nomor menjadi ADMIN Kantin
-- Silakan ganti nomor berikut dengan nomor WhatsApp Admin Anda:
-- UPDATE profiles SET role = 'ADMIN' WHERE phone_number IN ('08123456789', '628123456789');
