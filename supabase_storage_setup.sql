-- =========================================================================
-- SUPABASE SQL EDITOR SCRIPT: STORAGE BUCKET & FOTO PRODUK KANTIN
-- =========================================================================
-- Jalankan seluruh query ini di menu 'SQL Editor' pada dashboard Supabase Anda.

-- 1. Buat bucket penyimpanan 'menu-images' jika belum ada (atau update konfigurasi jika sudah ada)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'menu-images',
    'menu-images',
    true,
    5242880, -- Batas maksimal 5 MB per file
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- 2. Kebijakan RLS agar seluruh foto di bucket 'menu-images' dapat dilihat secara publik oleh siapa saja (Siswa & Penjual)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Public Access Menu Images'
    ) THEN
        CREATE POLICY "Public Access Menu Images" 
        ON storage.objects FOR SELECT 
        USING (bucket_id = 'menu-images');
    END IF;
END $$;

-- 3. Kebijakan RLS agar pengguna / service role dapat mengunggah file foto baru
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Allow Upload Menu Images'
    ) THEN
        CREATE POLICY "Allow Upload Menu Images" 
        ON storage.objects FOR INSERT 
        WITH CHECK (bucket_id = 'menu-images');
    END IF;
END $$;

-- 4. Kebijakan RLS agar pengguna / service role dapat memperbarui file foto yang sudah ada
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Allow Update Menu Images'
    ) THEN
        CREATE POLICY "Allow Update Menu Images" 
        ON storage.objects FOR UPDATE 
        USING (bucket_id = 'menu-images');
    END IF;
END $$;

-- 5. Kebijakan RLS agar pengguna / service role dapat menghapus file foto dari bucket
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Allow Delete Menu Images'
    ) THEN
        CREATE POLICY "Allow Delete Menu Images" 
        ON storage.objects FOR DELETE 
        USING (bucket_id = 'menu-images');
    END IF;
END $$;

-- 6. Pastikan kolom image_url pada tabel 'menus' telah tersedia
ALTER TABLE menus ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 7. Verifikasi bahwa bucket telah berhasil dibuat dan aktif
SELECT id, name, public, file_size_limit, allowed_mime_types 
FROM storage.buckets 
WHERE id = 'menu-images';
