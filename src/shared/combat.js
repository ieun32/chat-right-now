export const STUN_MS = 3000;
export const JUMP_MS = 650;
export const RUN_MULTIPLIER = 1.8;
export const WEAPONS = {
  club: { name: '도깨비방망이', range: .055, width: .085, cooldown: 700, duration: 350, row: 1 },
  gun: { name: '총', range: .24, width: .035, cooldown: 600, duration: 320, row: 2 },
  flame: { name: '화염방사기', range: .13, width: .09, cooldown: 1000, duration: 600, row: 3 },
};
export function stunned(actor, now = Date.now()) { return actor.stunUntil > now; }
export function jumpHeight(actor, now = Date.now()) {
  const t = (now - (actor.jumpStarted ?? -Infinity)) / JUMP_MS;
  return t >= 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
}
export function validAttack(attack) {
  return attack && Object.hasOwn(WEAPONS, attack.weapon) && Number.isFinite(attack.x) && Number.isFinite(attack.y)
    && attack.x >= 0 && attack.x <= 1 && attack.y >= 0 && attack.y <= 1 && [1, -1].includes(attack.facing);
}
export function hits(attack, target) {
  if (!validAttack(attack)) return false;
  const w = WEAPONS[attack.weapon];
  const forward = (target.x - attack.x) * attack.facing;
  return forward >= -.012 && forward <= w.range && Math.abs(target.y - attack.y) <= w.width;
}
