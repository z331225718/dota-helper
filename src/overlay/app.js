'use strict';

const dom = Object.fromEntries(
  Array.from(document.querySelectorAll('[id]')).map((element) => [element.id, element])
);

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function formatClock(totalSeconds) {
  const seconds = Math.trunc(number(totalSeconds));
  const sign = seconds < 0 ? '-' : '';
  const absolute = Math.abs(seconds);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function createItemRow(item, index) {
  const row = document.createElement('li');
  const order = document.createElement('span');
  const name = document.createElement('strong');
  const note = document.createElement('small');
  order.className = 'item-index';
  order.textContent = String(index + 1).padStart(2, '0');
  name.textContent = item.displayName;
  note.textContent = index === 0 ? '优先' : '后续';
  row.append(order, name, note);
  return row;
}

function createAbilityRow(ability, recommendedName) {
  const row = document.createElement('li');
  const name = document.createElement('span');
  const level = document.createElement('strong');
  row.classList.toggle('recommended', ability.name === recommendedName);
  name.textContent = ability.displayName;
  level.textContent = ability.maxLevel ? `${number(ability.level)}/${ability.maxLevel}` : String(number(ability.level));
  row.append(name, level);
  return row;
}

function render(viewModel) {
  const { status, snapshot, advice } = viewModel ?? {};
  const live = Boolean(status?.connected && snapshot);
  dom['overlay-shell'].dataset.state = status?.error ? 'error' : live ? 'live' : 'waiting';
  dom['connection-label'].textContent = status?.error ?? (live ? '数据已连接' : status?.listening ? '等待 Dota 2' : '监听未启动');
  dom['waiting-state'].classList.toggle('hidden', live);
  dom['live-content'].classList.toggle('hidden', !live);
  if (!live) return;

  dom['hero-name'].textContent = snapshot.hero.displayName || '未知英雄';
  dom['hero-level'].textContent = number(snapshot.hero.level);
  dom['match-clock'].textContent = formatClock(snapshot.map.clock_time ?? snapshot.map.game_time);
  dom.gold.textContent = number(snapshot.player.gold).toLocaleString('zh-CN');

  const itemAdvice = advice?.items;
  dom['item-phase'].textContent = itemAdvice ? `${itemAdvice.phaseLabel} · 本地` : '暂无数据';
  const recommendedItems = itemAdvice?.recommended ?? [];
  if (recommendedItems.length) {
    dom['item-list'].replaceChildren(...recommendedItems.map(createItemRow));
  } else {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = '未找到当前英雄的本地推荐出装';
    dom['item-list'].replaceChildren(empty);
  }
  const alternatives = itemAdvice?.alternatives?.map((item) => item.displayName) ?? [];
  dom['item-alternatives'].textContent = alternatives.length ? `局势备选：${alternatives.join('、')}` : '';

  const skill = advice?.skill;
  dom['skill-title'].textContent = skill?.title ?? '暂无已验证加点';
  dom['skill-reason'].textContent = skill?.reason ?? '当前英雄还没有本地技能路线。';
  dom['skill-profile'].textContent = skill?.profile ?? '本地路线';
  const visibleAbilities = (skill?.abilities ?? []).filter((ability) => !ability.innate).slice(0, 6);
  dom['ability-list'].replaceChildren(...visibleAbilities.map((ability) => createAbilityRow(ability, skill?.ability)));

  const sources = [itemAdvice?.source, skill?.source].filter(Boolean);
  dom['advice-source'].textContent = sources.length ? `${sources.join(' · ')}。建议会随版本变化，请结合阵容判断。` : '本地离线数据';
}

let locked = false;

dom['lock-overlay'].addEventListener('click', async () => {
  locked = await window.dotaOverlay.setLocked(!locked);
  dom['lock-overlay'].setAttribute('aria-pressed', String(locked));
});
dom['close-overlay'].addEventListener('click', () => window.dotaOverlay.hide());
window.dotaOverlay.onLockedChange((nextLocked) => {
  locked = nextLocked;
  dom['lock-overlay'].setAttribute('aria-pressed', String(locked));
});
window.dotaOverlay.onStateUpdate(render);
window.dotaOverlay.getState().then(render);
if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
