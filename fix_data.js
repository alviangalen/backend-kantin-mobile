require('dotenv').config({ path: '/home/galen/Documents/Project/backend-kantin-mobile/.env' });
const supabase = require('/home/galen/Documents/Project/backend-kantin-mobile/src/config/database');

async function fixData() {
    console.log('Checking orders linked to stand 4376f549...');
    const { data: orders } = await supabase
        .from('orders')
        .select('*')
        .eq('stand_id', '4376f549-c300-46fa-a6bc-00bf9c011709');
    console.log('Orders found:', orders?.length || 0);

    // Update menus belonging to 4376f549 to point to Bang Ijul's stand 5c4c639b
    console.log('Moving menus to Bang Ijul stand 5c4c639b-10b1-4af4-a55d-2e6bfc4913ac...');
    const { data: updatedMenus, error: menuErr } = await supabase
        .from('menus')
        .update({ stand_id: '5c4c639b-10b1-4af4-a55d-2e6bfc4913ac' })
        .eq('stand_id', '4376f549-c300-46fa-a6bc-00bf9c011709')
        .select();

    if (menuErr) {
        console.error('Error updating menus:', menuErr);
    } else {
        console.log('Updated menus:', updatedMenus);
    }

    // Also update any orders from 4376f549 to 5c4c639b if any
    if (orders && orders.length > 0) {
        await supabase
            .from('orders')
            .update({ stand_id: '5c4c639b-10b1-4af4-a55d-2e6bfc4913ac' })
            .eq('stand_id', '4376f549-c300-46fa-a6bc-00bf9c011709');
        console.log('Moved orders to 5c4c639b');
    }

    // Delete the duplicate stand 4376f549
    const { error: delErr } = await supabase
        .from('stands')
        .delete()
        .eq('id', '4376f549-c300-46fa-a6bc-00bf9c011709');
    if (delErr) {
        console.error('Error deleting duplicate stand:', delErr);
    } else {
        console.log('Deleted duplicate stand 4376f549');
    }

    // Verify Bang Ijul's menus
    const { data: bangIjulMenus } = await supabase
        .from('menus')
        .select('*')
        .eq('stand_id', '5c4c639b-10b1-4af4-a55d-2e6bfc4913ac');
    console.log('=== BANG IJUL MENUS NOW ===');
    console.log(bangIjulMenus);
}

fixData();
