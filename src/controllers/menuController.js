const supabase = require('../config/database');

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

// 3. Tambah menu baru oleh seller
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
                image_url: imageUrl || image || null,
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

// 4. Update data menu (nama, harga, stok, isAvailable)
exports.updateMenu = async (req, res) => {
    const { menuId } = req.params;
    const { name, price, stock, isAvailable, is_available, imageUrl, image } = req.body;

    // Validasi format UUID untuk mencegah Postgres 500 error pada ID dummy seperti '3'
    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: `Menu dengan ID '${menuId}' tidak valid. Silakan sinkronkan daftar menu Anda.`
        });
    }

    try {
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
        if (imageUrl !== undefined || image !== undefined) updateData.image_url = imageUrl || image;

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
            message: "Menu berhasil diperbarui",
            data: updatedMenu
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

// 5. Update stok menu secara spesifik
exports.updateMenuStock = async (req, res) => {
    const { menuId } = req.params;
    const { stock, isAvailable } = req.body;

    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: `Menu dengan ID '${menuId}' tidak valid. Silakan sinkronkan daftar menu Anda.`
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

// 6. Hapus menu
exports.deleteMenu = async (req, res) => {
    const { menuId } = req.params;

    if (!UUID_REGEX.test(menuId)) {
        return res.status(404).json({
            status: "error",
            message: `Menu dengan ID '${menuId}' tidak valid.`
        });
    }

    try {
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
