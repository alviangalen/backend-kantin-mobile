require('dotenv').config({ path: '/home/galen/Documents/Project/backend-kantin-mobile/.env' });
const supabase = require('/home/galen/Documents/Project/backend-kantin-mobile/src/config/database');

async function check() {
    const { data: profiles } = await supabase.from('profiles').select('*');
    console.log('=== PROFILES ===');
    console.log(profiles);

    const { data: stands } = await supabase.from('stands').select('*');
    console.log('=== STANDS ===');
    console.log(stands);

    const { data: menus } = await supabase.from('menus').select('*');
    console.log('=== MENUS ===');
    console.log(menus);
}

check();
