'use strict';

const PLAN_KEY = 'personal-dota-helper.plan.v1';
const CHECKPOINT_KEY = 'personal-dota-helper.checkpoints.v1';
const DEFAULT_CHECKPOINTS = [
  { minute: 6, label: '检查补刀目标' },
  { minute: 10, label: '核对下一件装备' },
  { minute: 15, label: '评估买活预留' }
];

const dom = Object.fromEntries(
  Array.from(document.querySelectorAll('[id]')).map((element) => [element.id, element])
);

let viewModel = { status: { listening: false, connected: false, port: 4000 }, snapshot: null };
let previousSnapshot = null;
let events = [];
let plan = loadLocalList(PLAN_KEY, []);
let checkpoints = loadLocalList(CHECKPOINT_KEY, DEFAULT_CHECKPOINTS);
let setup = null;
let compact = false;
let pinned = false;
let overlayVisible = true;
let toastTimer = null;

function loadLocalList(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveLocalList(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function humanizeInternalName(value, prefixes = []) {
  if (!value) return '未知';
  let result = String(value);
  for (const prefix of prefixes) result = result.replace(prefix, '');
  return result.split('_').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}

function formatClock(totalSeconds) {
  const seconds = Math.trunc(number(totalSeconds));
  const sign = seconds < 0 ? '-' : '';
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  return `${sign}${String(minutes).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle('error', error);
  dom.toast.classList.add('visible');
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 2_800);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function switchView(name) {
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === name));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
}

function describeGameState(value) {
  const states = {
    DOTA_GAMERULES_STATE_INIT: '初始化',
    DOTA_GAMERULES_STATE_HERO_SELECTION: '英雄选择',
    DOTA_GAMERULES_STATE_PRE_GAME: '准备阶段',
    DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: '对局进行中',
    DOTA_GAMERULES_STATE_POST_GAME: '对局结束'
  };
  return states[value] ?? (value ? humanizeInternalName(value, ['DOTA_GAMERULES_STATE_']) : '未进入对局');
}

function createInventorySlot(item, index) {
  const slot = document.createElement('div');
  slot.className = 'item-slot';
  if (!item) {
    slot.classList.add('empty');
    slot.textContent = String(index + 1).padStart(2, '0');
    return slot;
  }

  const name = document.createElement('strong');
  name.textContent = item.displayName || humanizeInternalName(item.name, ['item_']);
  const detail = document.createElement('span');
  const details = [];
  if (number(item.charges) > 0) details.push(`${number(item.charges)} 次`);
  if (number(item.cooldown) > 0) details.push(`${number(item.cooldown)}s`);
  detail.textContent = details.join(' · ') || `第 ${index + 1} 格`;
  slot.append(name, detail);
  return slot;
}

function addEvent(label, clock) {
  events.unshift({ label, clock: formatClock(clock), id: `${Date.now()}-${events.length}` });
  events = events.slice(0, 20);
}

function trackSnapshotChanges(snapshot) {
  if (!snapshot || !previousSnapshot) {
    previousSnapshot = snapshot;
    return;
  }

  const clock = snapshot.map.clock_time ?? snapshot.map.game_time ?? 0;
  const previousClock = number(previousSnapshot.map.clock_time ?? previousSnapshot.map.game_time, -1);
  const currentClock = number(clock, -1);
  if (currentClock > previousClock) {
    checkpoints
      .filter((checkpoint) => checkpoint.minute * 60 > previousClock && checkpoint.minute * 60 <= currentClock)
      .forEach((checkpoint) => addEvent(`检查点：${checkpoint.label}`, clock));
  }
  if (number(snapshot.hero.level) > number(previousSnapshot.hero.level)) {
    addEvent(`升到 ${snapshot.hero.level} 级`, clock);
  }
  if (previousSnapshot.hero.alive !== false && snapshot.hero.alive === false) {
    addEvent('英雄阵亡', clock);
  }
  if (previousSnapshot.hero.alive === false && snapshot.hero.alive === true) {
    addEvent('英雄复活', clock);
  }

  const oldItems = new Set(previousSnapshot.items.map((item) => item.name));
  snapshot.items.filter((item) => !oldItems.has(item.name)).forEach((item) => {
    addEvent(`获得 ${item.displayName || humanizeInternalName(item.name, ['item_'])}`, clock);
  });

  previousSnapshot = snapshot;
}

function renderEvents() {
  dom['event-list'].replaceChildren();
  if (!events.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-event';
    empty.textContent = '事件会在本局数据变化时出现';
    dom['event-list'].append(empty);
    return;
  }

  for (const event of events) {
    const row = document.createElement('li');
    const time = document.createElement('time');
    const label = document.createElement('span');
    time.textContent = event.clock;
    label.textContent = event.label;
    row.append(time, label);
    dom['event-list'].append(row);
  }
}

function renderGoal(snapshot) {
  const current = plan[0];
  dom['goal-empty'].classList.toggle('hidden', Boolean(current));
  dom['goal-live'].classList.toggle('hidden', !current);
  if (!current) return;

  const gold = number(snapshot?.player?.gold);
  const cost = Math.max(0, number(current.cost));
  const gap = Math.max(0, cost - gold);
  const gpm = Math.max(0, number(snapshot?.player?.gpm));
  const etaSeconds = gpm > 0 ? Math.ceil(gap / gpm * 60) : null;
  const progress = cost > 0 ? clamp(gold / cost * 100, 0, 100) : 100;

  dom['goal-priority'].textContent = '优先';
  dom['goal-name'].textContent = current.name;
  dom['goal-progress-fill'].style.width = `${progress}%`;
  dom['goal-gap'].textContent = gap > 0 ? `还差 ${gap.toLocaleString('zh-CN')}` : '金币已满足';
  dom['goal-eta'].textContent = gap === 0 ? '已满足' : etaSeconds === null ? '--:--' : `约 ${formatClock(etaSeconds)}`;
}

function renderAdvice(advice) {
  const itemAdvice = advice?.items;
  const items = itemAdvice?.recommended ?? [];
  if (items.length) {
    dom['recommended-items'].replaceChildren(...items.map((item) => {
      const name = document.createElement('strong');
      name.textContent = item.displayName;
      return name;
    }));
  } else {
    const empty = document.createElement('span');
    empty.className = 'advice-empty';
    empty.textContent = itemAdvice ? '当前阶段没有未购买的推荐装备' : '等待英雄数据';
    dom['recommended-items'].replaceChildren(empty);
  }
  dom['item-advice-source'].textContent = itemAdvice?.source
    ? `${itemAdvice.phaseLabel} · ${itemAdvice.source}`
    : '读取游戏内当前默认出装';

  const skill = advice?.skill;
  dom['recommended-skill'].textContent = skill?.title ?? '等待技能数据';
  dom['skill-advice-reason'].textContent = skill?.reason ?? '仅对已验证的英雄给出建议';
}

function renderMatch(nextViewModel) {
  viewModel = nextViewModel ?? viewModel;
  const { status, snapshot, advice } = viewModel;
  const isLive = Boolean(status?.connected && snapshot);

  dom['connection-pill'].dataset.state = status?.error ? 'error' : isLive ? 'live' : 'waiting';
  dom['connection-label'].textContent = status?.error ?? (isLive ? '游戏数据已连接' : status?.listening ? '等待 Dota 2' : '游戏数据未监听');
  dom['connection-pill'].querySelector('code').textContent = `127.0.0.1:${status?.port ?? 4000}`;

  const data = snapshot ?? { map: {}, player: {}, hero: {}, items: [] };
  trackSnapshotChanges(snapshot);

  dom['match-state'].textContent = describeGameState(data.map.game_state);
  dom['match-clock'].textContent = formatClock(data.map.clock_time ?? data.map.game_time);
  dom['radiant-score'].textContent = number(data.map.radiant_score);
  dom['dire-score'].textContent = number(data.map.dire_score);
  dom['phase-label'].querySelector('span').textContent = data.map.daytime === false ? '夜晚' : data.map.daytime === true ? '白天' : '等待数据';

  const heroName = data.hero.displayName || humanizeInternalName(data.hero.name, ['npc_dota_hero_']);
  dom['hero-name'].textContent = data.hero.name ? heroName : '等待连接';
  dom['hero-monogram'].textContent = data.hero.name ? heroName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() : '--';
  dom['hero-level'].textContent = number(data.hero.level);
  dom['life-state'].textContent = data.hero.alive === false ? `复活 ${number(data.hero.respawn_seconds)}s` : data.hero.name ? '存活' : '未激活';
  dom['team-name'].textContent = data.player.team_name === 'RADIANT'
    ? '天辉'
    : data.player.team_name === 'DIRE'
      ? '夜魇'
      : '己方视角';

  const health = number(data.hero.health);
  const maxHealth = number(data.hero.max_health);
  const mana = number(data.hero.mana);
  const maxMana = number(data.hero.max_mana);
  dom['health-text'].textContent = `${health.toLocaleString('zh-CN')} / ${maxHealth.toLocaleString('zh-CN')}`;
  dom['mana-text'].textContent = `${mana.toLocaleString('zh-CN')} / ${maxMana.toLocaleString('zh-CN')}`;
  dom['health-fill'].style.width = `${maxHealth > 0 ? clamp(health / maxHealth * 100, 0, 100) : 0}%`;
  dom['mana-fill'].style.width = `${maxMana > 0 ? clamp(mana / maxMana * 100, 0, 100) : 0}%`;

  dom.kda.textContent = `${number(data.player.kills)} / ${number(data.player.deaths)} / ${number(data.player.assists)}`;
  dom['last-hits'].textContent = `${number(data.player.last_hits)} / ${number(data.player.denies)}`;
  dom['kill-streak'].textContent = number(data.player.kill_streak);
  dom.gold.textContent = number(data.player.gold).toLocaleString('zh-CN');
  dom.gpm.textContent = number(data.player.gpm);
  dom.xpm.textContent = number(data.player.xpm);
  const buybackCost = number(data.hero.buyback_cost);
  const buybackCooldown = number(data.hero.buyback_cooldown);
  dom.buyback.textContent = buybackCooldown > 0 ? `冷却 ${buybackCooldown}s` : buybackCost > 0 ? `${buybackCost.toLocaleString('zh-CN')} 金` : '暂无数据';

  const visibleItems = data.items.filter((item) => /^slot\d+$/.test(item.slot)).slice(0, 9);
  dom['item-count'].textContent = `${visibleItems.length} 件`;
  dom['inventory-grid'].replaceChildren(...Array.from({ length: 9 }, (_, index) => createInventorySlot(visibleItems[index], index)));

  renderGoal(snapshot);
  renderEvents();
  renderAdvice(advice);
}

function createListRow({ index, name, detail, onDelete }) {
  const row = document.createElement('li');
  const order = document.createElement('span');
  const title = document.createElement('strong');
  const meta = document.createElement('small');
  const remove = document.createElement('button');

  order.className = 'drag-index';
  order.textContent = String(index + 1).padStart(2, '0');
  title.textContent = name;
  meta.textContent = detail;
  remove.className = 'row-action';
  remove.type = 'button';
  remove.title = '删除';
  remove.setAttribute('aria-label', `删除 ${name}`);
  remove.innerHTML = '<i data-lucide="x"></i>';
  remove.addEventListener('click', onDelete);
  row.append(order, title, meta, remove);
  return row;
}

function renderPlan() {
  dom['plan-counter'].textContent = `${plan.length} / 8`;
  dom['plan-list'].replaceChildren(...plan.map((goal, index) => createListRow({
    index,
    name: goal.name,
    detail: `${number(goal.cost).toLocaleString('zh-CN')} 金`,
    onDelete: () => {
      plan.splice(index, 1);
      saveLocalList(PLAN_KEY, plan);
      renderPlan();
      renderGoal(viewModel.snapshot);
    }
  })));

  dom['checkpoint-list'].replaceChildren(...checkpoints
    .slice()
    .sort((left, right) => left.minute - right.minute)
    .map((checkpoint, index) => createListRow({
      index,
      name: checkpoint.label,
      detail: `${String(checkpoint.minute).padStart(2, '0')}:00`,
      onDelete: () => {
        checkpoints = checkpoints.filter((entry) => entry !== checkpoint);
        saveLocalList(CHECKPOINT_KEY, checkpoints);
        renderPlan();
      }
    })));
  refreshIcons();
}

function renderSetup(nextSetup) {
  setup = nextSetup;
  dom['selected-path'].textContent = setup.selectedDotaRoot ?? '未检测到安装目录';
  const status = setup.selectedStatus;
  dom['install-config'].disabled = !setup.selectedDotaRoot || status?.managed;
  dom['remove-config'].disabled = !status?.managed;
  const hasForeignConfig = Boolean(status?.installed && !status?.managed);
  dom['setup-status'].dataset.state = hasForeignConfig ? 'error' : status?.managed ? 'live' : 'idle';
  dom['setup-status'].querySelector('span:last-child').textContent = hasForeignConfig
    ? '发现同名非托管配置，已保持不变'
    : status?.managed
      ? '游戏连接配置已安装'
      : setup.selectedDotaRoot
        ? '目录已就绪'
        : '等待选择目录';
}

function handleError(error) {
  showToast(error?.message ?? String(error), true);
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-jump-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.jumpView)));

dom['pin-button'].addEventListener('click', async () => {
  try {
    pinned = await window.dotaHelper.setAlwaysOnTop(!pinned);
    dom['pin-button'].setAttribute('aria-pressed', String(pinned));
  } catch (error) { handleError(error); }
});

dom['compact-button'].addEventListener('click', async () => {
  try {
    compact = await window.dotaHelper.setCompact(!compact);
    document.body.classList.toggle('compact', compact);
    dom['compact-button'].setAttribute('aria-pressed', String(compact));
  } catch (error) { handleError(error); }
});

dom['overlay-button'].addEventListener('click', async () => {
  try {
    overlayVisible = await window.dotaHelper.toggleOverlay();
    dom['overlay-button'].setAttribute('aria-pressed', String(overlayVisible));
  } catch (error) { handleError(error); }
});

dom['demo-button'].addEventListener('click', async () => {
  try {
    const demo = await window.dotaHelper.loadDemo();
    renderMatch(demo);
    showToast('演示对局已载入');
  } catch (error) { handleError(error); }
});

dom['clear-events'].addEventListener('click', () => {
  events = [];
  renderEvents();
});

dom['goal-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  if (plan.length >= 8) return showToast('装备目标最多 8 个', true);
  const name = dom['goal-input'].value.trim();
  const cost = number(dom['cost-input'].value);
  if (!name || cost < 0) return;
  plan.push({ name, cost });
  saveLocalList(PLAN_KEY, plan);
  event.currentTarget.reset();
  renderPlan();
  renderGoal(viewModel.snapshot);
});

dom['checkpoint-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  const minute = number(dom['minute-input'].value, -1);
  const label = dom['checkpoint-input'].value.trim();
  if (!label || minute < 0 || checkpoints.length >= 12) return;
  checkpoints.push({ minute, label });
  saveLocalList(CHECKPOINT_KEY, checkpoints);
  event.currentTarget.reset();
  renderPlan();
});

dom['choose-directory'].addEventListener('click', async () => {
  try { renderSetup(await window.dotaHelper.chooseDotaDirectory()); } catch (error) { handleError(error); }
});

dom['install-config'].addEventListener('click', async () => {
  try {
    renderSetup(await window.dotaHelper.installConfig());
    showToast('游戏连接配置已安装');
  } catch (error) { handleError(error); }
});

dom['remove-config'].addEventListener('click', async () => {
  try {
    renderSetup(await window.dotaHelper.removeConfig());
    showToast('游戏连接配置已移除');
  } catch (error) { handleError(error); }
});

window.dotaHelper.onStateUpdate(renderMatch);

Promise.all([window.dotaHelper.getState(), window.dotaHelper.getSetup()])
  .then(([initialState, initialSetup]) => {
    renderMatch(initialState);
    renderSetup(initialSetup);
    renderPlan();
    refreshIcons();
  })
  .catch(handleError);
