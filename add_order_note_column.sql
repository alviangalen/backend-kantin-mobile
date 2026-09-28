-- =========================================================================
-- SUPABASE SQL EDITOR SCRIPT: MENAMBAHKAN KOLOM CATATAN PEMESANAN (NOTE)
-- =========================================================================
-- Jalankan query berikut di menu 'SQL Editor' pada dashboard Supabase Anda.

-- 1. Tambahkan kolom 'note' pada tabel 'orders' untuk catatan pesanan umum (misal: "Pedas ya bang, jangan pakai daun bawang")
ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT;

-- 2. Tambahkan kolom 'note' pada tabel 'order_items' untuk catatan khusus per item menu (misal: "Es sedikit")
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS note TEXT;

-- 3. Verifikasi bahwa kolom 'note' telah berhasil ditambahkan
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'orders' AND column_name = 'note';
