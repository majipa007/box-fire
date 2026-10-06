// Game feel that lives only on the client: the camera kick from recoil.
import { WEAPONS, KICK_SPRAY_GAP_MS, KICK_CLIMB_SHOTS, KICK_WOBBLE } from '../shared/constants.js';

let spray = 0;
let lastShotAt = -Infinity;

// The camera kick for one shot as [pitch, yaw] radians: a step per shot plus
// a climb per shot of a spray. The next packet simply carries the new aim.
export function recoilKick(weapon, now) {
  spray = now - lastShotAt < KICK_SPRAY_GAP_MS ? spray + 1 : 1;
  lastShotAt = now;
  const [base, climb] = WEAPONS[weapon].kick;
  const rad = ((base + climb * Math.min(spray, KICK_CLIMB_SHOTS)) * Math.PI) / 180;
  return [rad, (Math.random() - 0.5) * rad * KICK_WOBBLE];
}
