const supabase = require('../config/database');

exports.getAllStands = async (req, res) => {
    try {
        const { data: stands, error } = await supabase
            .from('stands')
            .select('*');

        if (error) throw error;

        const formattedStands = (stands || []).map(s => ({
            id: s.id,
            name: s.name,
            ownerName: s.owner_name || null,
            counterNumber: s.stand_number,
            counterSlot: s.stand_number,
            isOpen: s.is_open,
            category: s.category,
            rating: 4.8
        }));

        res.status(200).json({
            status: "success",
            data: formattedStands
        });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
};
