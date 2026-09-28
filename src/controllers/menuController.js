const supabase = require('../config/database');
const { uploadMenuImage, deleteMenuImage } = require('../services/storageService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 1. Get all menus untuk siswa / umum (hanya yang tersedia)
exports.getAllMenus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('menus')
            .select('*, stands(id, name, stand_number)')
            .eq('is_available', true);

        if (error) throw error;

        res.status(200).json({ status: "success", data: data || [] });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 2. Get menus milik stand seller yang sedang login (termasuk yang stok habis)
exports.getMyMenus = async (req, res) => {
    try {
        let { data: stand } = await supabase
            .from('stands')
            .select('id')
            .eq('owner_id', req.user.id)
            .maybeSingle();

        if (!stand) {
            return res.status(200).json({ status: "success", data: [] });
        }

        const { data: menus, error } = await supabase
            .from('menus')
            .select('*, stands(id, name, stand_number)')
            .eq('stand_id', stand.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.status(200).json({ status: "success", data: menus || [] });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 3. Upload file foto produk secara standalone (mengembalikan URL publik Supabase Storage)
exports.uploadImage = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            status: "error",
            message: "File gambar tidak ditemukan. Sertakan file gambar pada form field 'image'."
        });
    }

    try {
        const result = await uploadMenuImage(req.file);

        res.status(200).json({
            status: "success",
            message: "Foto produk berhasil diunggah",
            data: {
                imageUrl: result.imageUrl,
                image_url: result.imageUrl,
                fileName: result.fileName
            }
        });
    } catch (err) {
        console.error('[STORAGE] Error upload foto:', err.message);
        res.status(500).json({
            status: "error",
            message: err.message || "Gagal mengunggah foto produk ke server"
        });
    }
};

// 4. Tambah menu baru oleh seller (Mendukung upload file foto langsung via multipart/form-data atau link string JSON)
exports.addMenu = async (req, res) => {
    const { standId, name, price, stock, imageUrl, image, isAvailable, is_available } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ status: "error", message: "Nama menu wajib diisi" });
    }

    try {
        let targetStandId = standId;

        // Jika standId tidak disertakan, cari stand milik seller yang sedang login
        if (!targetStandId) {
            let { data: stand } = await supabase
                .from('stands')
                .select('id')
                .eq('owner_id', req.user.id)
                .maybeSingle();

            if (!stand) {
                const { data: newStand, error: standCreateErr } = await supabase
                    .from('stands')
                    .insert([{
                        owner_id: req.user.id,
                        name: 'Stand Kantin',
                        stand_number: 'Stand 01',
                        category: 'Makanan',
                        is_open: true
                    }])
                    .select('id')
                    .single();
                if (standCreateErr) throw standCreateErr;
                stand = newStand;
            }
            targetStandId = stand.id;
        }

        // Tentukan image_url: jika ada file upload via multipart, upload ke Supabase Storage
        let finalImageUrl = imageUrl || image || null;
        if (req.file) {
            try {
                const uploadResult = await uploadMenuImage(req.file);
                finalImageUrl = uploadResult.imageUrl;
            } catch (uploadErr) {
                return res.status(500).json({
                    status: "error",
                    message: "Gagal mengunggah file foto: " + uploadErr.message
                });
            }
        }

        const parsedPrice = parseInt(price, 10) || 0;
        const parsedStock = parseInt(stock, 10) || 0;
        const avail = isAvailable !== undefined ? Boolean(isAvailable) : (is_available !== undefined ? Boolean(is_available) : parsedStock > 0);

        const { data: newMenu, error } = await supabase
            .from('menus')
            .insert([{
                stand_id: targetStandId,
                name: name.trim(),
                price: parsedPrice, 
                stock: parsedStock, 
                image_url: finalImageUrl,
                is_available: avail
            }])
            .select('*, stands(id, name, stand_number)')
            .single();

        if (error) throw error;

        res.status(201).json({
            status: "success",
            message: "Menu berhasil ditambahkan",
            data: newMenu
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 5. Update data menu (nama, harga, stok, isAvailable, foto produk)
exports.updateMenu = async (req, res) => {
    const { menuId } = req.params;
    const { name, price, stock, isAvailable, is_available, imageUrl, image } = req.body;

    // Validasi format UUID untuk mencegah Postgres 500 error pada ID dummy
    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: "Menu dengan ID '" + menuId + "' tidak valid. Silakan sinkronkan daftar menu Anda."
        });
    }

    try {
        // Ambil data menu saat ini untuk melihat foto lama
        const { data: existingMenu, error: fetchErr } = await supabase
            .from('menus')
            .select('*')
            .eq('id', menuId)
            .maybeSingle();

        if (fetchErr || !existingMenu) {
            return res.status(404).json({ status: "error", message: "Menu tidak ditemukan di database" });
        }

        const updateData = {};
        if (name !== undefined && name !== null) updateData.name = name.trim();
        if (price !== undefined && price !== null) updateData.price = parseInt(price, 10);
        if (stock !== undefined && stock !== null) {
            updateData.stock = parseInt(stock, 10);
            if (isAvailable === undefined && is_available === undefined) {
                updateData.is_available = updateData.stock > 0;
            }
        }
        const avail = isAvailable !== undefined ? isAvailable : is_available;
        if (avail !== undefined) updateData.is_available = Boolean(avail);

        // Handle foto baru jika ada file yang diunggah
        if (req.file) {
            try {
                const uploadResult = await uploadMenuImage(req.file);
                updateData.image_url = uploadResult.imageUrl;

                // Hapus foto lama jika ada
                if (existingMenu.image_url) {
                    await deleteMenuImage(existingMenu.image_url);
                }
            } catch (uploadErr) {
                return res.status(500).json({
                    status: "error",
                    message: "Gagal memperbarui foto: " + uploadErr.message
                });
            }
        } else if (imageUrl !== undefined || image !== undefined) {
            const newImg = imageUrl || image;
            if (!newImg || newImg.trim() === '') {
                // Seller ingin menghapus foto
                if (existingMenu.image_url) {
                    await deleteMenuImage(existingMenu.image_url);
                }
                updateData.image_url = null;
            } else {
                updateData.image_url = newImg;
            }
        }

        const { data: updatedMenu, error } = await supabase
            .from('menus')
            .update(updateData)
            .eq('id', menuId)
            .select('*, stands(id, name, stand_number)')
            .single();

        if (error) throw error;

        res.status(200).json({
            status: "success",
            message: "Menu berhasil diperbarui",
            data: updatedMenu
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 6. Update khusus foto produk pada menu tertentu
exports.updateMenuImage = async (req, res) => {
    const { menuId } = req.params;

    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: "Menu dengan ID '" + menuId + "' tidak valid."
        });
    }

    if (!req.file) {
        return res.status(400).json({
            status: "error",
            message: "File gambar tidak ditemukan. Sertakan file gambar pada form field 'image'."
        });
    }

    try {
        const { data: existingMenu, error: fetchErr } = await supabase
            .from('menus')
            .select('*')
            .eq('id', menuId)
            .maybeSingle();

        if (fetchErr || !existingMenu) {
            return res.status(404).json({ status: "error", message: "Menu tidak ditemukan di database" });
        }

        // Upload foto baru
        const uploadResult = await uploadMenuImage(req.file);

        // Hapus foto lama jika ada
        if (existingMenu.image_url) {
            await deleteMenuImage(existingMenu.image_url);
        }

        // Update database
        const { data: updatedMenu, error: updateErr } = await supabase
            .from('menus')
            .update({ image_url: uploadResult.imageUrl })
            .eq('id', menuId)
            .select('*, stands(id, name, stand_number)')
            .single();

        if (updateErr) throw updateErr;

        res.status(200).json({
            status: "success",
            message: "Foto produk berhasil diperbarui",
            data: updatedMenu
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 7. Hapus khusus foto produk pada menu tertentu (set image_url = null)
exports.deleteMenuImage = async (req, res) => {
    const { menuId } = req.params;

    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: "Menu dengan ID '" + menuId + "' tidak valid."
        });
    }

    try {
        const { data: existingMenu, error: fetchErr } = await supabase
            .from('menus')
            .select('*')
            .eq('id', menuId)
            .maybeSingle();

        if (fetchErr || !existingMenu) {
            return res.status(404).json({ status: "error", message: "Menu tidak ditemukan di database" });
        }

        if (existingMenu.image_url) {
            await deleteMenuImage(existingMenu.image_url);
        }

        const { data: updatedMenu, error: updateErr } = await supabase
            .from('menus')
            .update({ image_url: null })
            .eq('id', menuId)
            .select('*, stands(id, name, stand_number)')
            .single();

        if (updateErr) throw updateErr;

        res.status(200).json({
            status: "success",
            message: "Foto produk berhasil dihapus",
            data: updatedMenu
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 8. Update stok menu secara spesifik
exports.updateMenuStock = async (req, res) => {
    const { menuId } = req.params;
    const { stock, isAvailable } = req.body;

    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: "Menu dengan ID '" + menuId + "' tidak valid. Silakan sinkronkan daftar menu Anda."
        });
    }

    try {
        const parsedStock = parseInt(stock, 10) || 0;
        const avail = isAvailable !== undefined ? Boolean(isAvailable) : parsedStock > 0;

        const updateData = {
            stock: parsedStock,
            is_available: avail
        };

        const { data: updatedMenu, error } = await supabase
            .from('menus')
            .update(updateData)
            .eq('id', menuId)
            .select('*, stands(id, name, stand_number)')
            .maybeSingle();

        if (error) throw error;
        if (!updatedMenu) {
            return res.status(404).json({ status: "error", message: "Menu tidak ditemukan di database" });
        }

        res.status(200).json({
            status: "success",
            message: "Stok menu berhasil diperbarui",
            data: updatedMenu
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 9. Hapus menu beserta fotonya dari storage
exports.deleteMenu = async (req, res) => {
    const { menuId } = req.params;

    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: "Menu dengan ID '" + menuId + "' tidak valid."
        });
    }

    try {
        const { data: existingMenu } = await supabase
            .from('menus')
            .select('image_url')
            .eq('id', menuId)
            .maybeSingle();

        if (existingMenu && existingMenu.image_url) {
            await deleteMenuImage(existingMenu.image_url);
        }

        const { error } = await supabase
            .from('menus')
            .delete()
            .eq('id', menuId);

        if (error) throw error;

        res.status(200).json({
            status: "success",
            message: "Menu berhasil dihapus"
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
