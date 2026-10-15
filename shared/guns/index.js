// arsenal: the gun registry. One file per gun in this folder, each exporting
// one plain object (no imports: constants.js reads this). The order below is
// the wire order (snapshots carry an index into it) and the picker order, so
// new guns go on the end. A list, not a folder scan: the single executable
// embeds files and cannot list them. How to add a gun: docs/guns.md.
import pistol from './pistol.js';
import rifle from './rifle.js';
import shotgun from './shotgun.js';
import handcannon from './handcannon.js';

const LIST = [rifle, pistol, shotgun, handcannon];

export const GUN_IDS = LIST.map((g) => g.id);
// auto is derived for readers older than `mode` (feel.js, the bots).
export const GUNS = Object.fromEntries(LIST.map((g) => [g.id, { ...g, auto: g.mode === 'auto' }]));
export const PRIMARIES = GUN_IDS.filter((id) => GUNS[id].slot === 'primary');
export const SECONDARIES = GUN_IDS.filter((id) => GUNS[id].slot === 'secondary');

// Until a gun has its own model, sound and effects, the client draws and
// plays the launch gun nearest its class. Anything else (a power-up id like
// 'bolt') passes through.
const BASE = { pistol: 'pistol', handcannon: 'pistol', machinepistol: 'pistol', shotgun: 'shotgun', rifle: 'rifle', smg: 'rifle', burst: 'rifle', lmg: 'rifle', marksman: 'rifle', sniper: 'rifle' };
export const baseGun = (id) => (GUN_IDS.includes(id) ? BASE[GUNS[id].class] : id);
