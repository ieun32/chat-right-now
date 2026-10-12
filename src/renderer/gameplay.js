import { WEAPONS, STUN_MS, JUMP_MS, stunned, validAttack, hits } from '../shared/combat.js';
import { MSG } from '../shared/protocol.js';
import { posAt, settle, applyMove } from '../shared/world.js';
import { drawWeaponPreview } from './render.js';

export function createGameplay({ state, recomputeDirection, pushHotspots }) {
  const inventory = document.getElementById('inventory');
  const slots = [...inventory.querySelectorAll('[data-weapon]')];
  let lastAttack = -Infinity;
  function inventoryOpen(open) {
    state.inventoryOpen = open;
    inventory.classList.toggle('hidden', !open);
    recomputeDirection();
    pushHotspots();
  }
  function equip(weapon) {
    if (!Object.hasOwn(WEAPONS, weapon) || !state.local || stunned(state.local)) return;
    state.local.weapon = weapon;
    if (state.mesh) state.mesh.self.weapon = weapon;
    state.mesh?.sendAction({ type: MSG.EQUIP, weapon });
    slots.forEach(slot => slot.classList.toggle('selected', slot.dataset.weapon === weapon));
    inventoryOpen(false);
    document.getElementById('stage').focus();
  }
  slots.forEach(slot => {
    drawWeaponPreview(slot.querySelector('canvas').getContext('2d'), slot.dataset.weapon);
    slot.addEventListener('click', () => equip(slot.dataset.weapon));
  });
  slots[0].classList.add('selected');
  function attack() {
    const actor = state.local, now = Date.now();
    if (!actor || state.hidden || state.chatOpen || state.inventoryOpen || stunned(actor, now)) return;
    const weapon = actor.weapon || 'club';
    if (now - lastAttack < WEAPONS[weapon].cooldown) return;
    lastAttack = now;
    const action = { type: MSG.ATTACK, weapon, ...posAt(actor, now), facing: actor.facing };
    actor.attack = { ...action, at: now };
    state.mesh?.sendAction(action);
  }
  function jump() {
    const actor = state.local, now = Date.now();
    if (!actor || stunned(actor, now) || state.inventoryOpen || now - (actor.jumpStarted ?? -Infinity) < JUMP_MS) return;
    actor.jumpStarted = now;
    state.mesh?.sendAction({ type: MSG.JUMP });
  }
  function stunLocal(now) {
    const actor = state.local;
    actor.stunUntil = now + STUN_MS;
    actor.jumpStarted = -Infinity;
    actor.attack = null;
    state.keys = { left: false, right: false, up: false, down: false };
    inventoryOpen(false);
    settle(actor, now);
    const stopped = { x: actor.x, y: actor.y, vx: 0, vy: 0 };
    applyMove(actor, stopped, now);
    state.mesh?.sendMove(stopped);
    state.mesh?.sendAction({ type: MSG.STUN, x: actor.x, y: actor.y });
  }
  return {
    close: () => inventoryOpen(false),
    keydown(e) {
      if (!state.joined || state.chatOpen || state.hidden) return false;
      if (e.key === 'Shift') { state.sprinting = true; recomputeDirection(); return false; }
      const key = e.key.toLowerCase();
      if (!['e', 'f', ' ', '1', '2', '3'].includes(key)) return false;
      e.preventDefault();
      if (e.repeat || stunned(state.local)) return true;
      if (key === 'e') inventoryOpen(!state.inventoryOpen);
      else if (key === 'f') attack();
      else if (key === ' ') jump();
      else if (state.inventoryOpen) equip(Object.keys(WEAPONS)[Number(key) - 1]);
      return true;
    },
    receive(id, action) {
      const actor = state.world.get(id), now = Date.now();
      if (!actor || !action || actor.hidden) return;
      if (action.type === MSG.ATTACK && validAttack(action)) {
        if (stunned(actor, now) || now - (actor.lastAttackAt ?? -Infinity) < WEAPONS[action.weapon].cooldown) return;
        actor.lastAttackAt = now;
        actor.attack = { ...action, at: now };
        actor.weapon = action.weapon;
        const local = state.local;
        if (local && !state.hidden && !stunned(local, now) && hits(action, posAt(local, now))) stunLocal(now);
      } else if (action.type === MSG.STUN) {
        if (stunned(actor, now)) return;
        actor.stunUntil = now + STUN_MS;
        actor.jumpStarted = -Infinity;actor.attack = null;
        settle(actor, now);
        const x = Number.isFinite(action.x) ? action.x : actor.x;
        const y = Number.isFinite(action.y) ? action.y : actor.y;
        applyMove(actor, { x, y, vx: 0, vy: 0 }, now);
      } else if (action.type === MSG.JUMP && !stunned(actor, now) && now - (actor.jumpStarted ?? -Infinity) >= JUMP_MS) {
        actor.jumpStarted = now;
      } else if (action.type === MSG.EQUIP && Object.hasOwn(WEAPONS, action.weapon)) actor.weapon = action.weapon;
    },
    tick() {
      if (!state.inventoryOpen || !state.local) return;
      const p = posAt(state.local);
      const left = Math.max(4, Math.min(window.innerWidth - 244, p.x * window.innerWidth - 120));
      const top = Math.max(4, Math.min(window.innerHeight - 264, p.y * window.innerHeight - 160));
      inventory.style.left = `${left}px`;inventory.style.top = `${top}px`;
    },
  };
}
