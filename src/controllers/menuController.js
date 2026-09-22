const supabase = require('../config/database');

exports.getAllMenus = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('menus')
            .select('*, stands(name, stand_number)')
            .eq('is_available', true);

        if (error) throw error;

        res.status(200).json({ status: "success", data });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};

exports.addMenu = async (req, res) => {
    const { name, price, stock, imageUrl } = req.body;

    try {
        const { data: stand, error: standErr } = await supabase
            .from('stands')
            .select('id')
            .eq('owner_id', req.user.id)
            .single();

        if (standErr || !stand) {
            return res.status(404).json({ status: "error", message: "Stand tidak ditemukan. Anda belum memiliki toko." });
        }

        const { data: newMenu, error } = await supabase
            .from('menus')
            .insert([{
                stand_id: stand.id,
                name,
                price, 
                stock, 
                image_url: imageUrl 
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ status: "success", message: "Menu berhasil ditambahkan", data: newMenu });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
