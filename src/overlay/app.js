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
  note.textContent = item.contextual ? '针对' : item.averageMinute >= 0 ? `${Math.round(item.averageMinute)}m` : index === 0 ? '优先' : '后续';
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

function renderLineupAnalysis(lineup) {
  const available = Boolean(lineup?.available);
  dom['overlay-analysis'].dataset.state = available ? 'ready' : 'empty';
  dom['overlay-analysis-coverage'].textContent = lineup?.coverageNote ?? '尚未确认 0/5';
  dom['overlay-lineup-summary'].textContent = lineup?.summary ?? '补全敌方英雄后会生成针对策略';
  dom['overlay-threats'].replaceChildren(...(lineup?.threats ?? []).slice(0, 4).map((threat) => {
    const chip = document.createElement('span');
    chip.textContent = `${threat.label} · ${threat.count}`;
    return chip;
  }));

  const priorities = (lineup?.priorities ?? []).slice(0, 2);
  if (priorities.length) {
    dom['overlay-priorities'].replaceChildren(...priorities.map((priority) => {
      const row = document.createElement('li');
      const title = document.createElement('strong');
      const text = document.createElement('span');
      title.textContent = priority.title;
      text.textContent = priority.text;
      row.append(title, text);
      return row;
    }));
  } else {
    const empty = document.createElement('li');
    empty.className = 'empty-analysis';
    empty.textContent = '请在主窗口补全敌方英雄';
    dom['overlay-priorities'].replaceChildren(empty);
  }
}

function render(viewModel) {
  const { status, snapshot, advice, roster } = viewModel ?? {};
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
  dom['enemy-coverage'].textContent = `${number(roster?.enemyCount)} / 5`;
  const enemyNames = roster?.enemies?.filter(Boolean).map((hero) => hero.nameZh) ?? [];
  dom['enemy-heroes'].textContent = enemyNames.length ? enemyNames.join('、') : '请在主窗口补全阵容';
  renderLineupAnalysis(advice?.lineup);

  const itemAdvice = advice?.items;
  dom['item-phase'].textContent = itemAdvice ? `${itemAdvice.phaseLabel} · ${itemAdvice.role?.label ?? '自动'}` : '暂无数据';
  const recommendedItems = itemAdvice?.recommended ?? [];
  if (recommendedItems.length) {
    dom['item-list'].replaceChildren(...recommendedItems.map(createItemRow));
  } else {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = '未找到当前英雄的本地推荐出装';
    dom['item-list'].replaceChildren(empty);
  }
  const counters = itemAdvice?.counters ?? [];
  const alternatives = itemAdvice?.alternatives?.map((item) => item.displayName) ?? [];
  dom['item-alternatives'].classList.toggle('has-counter', counters.length > 0);
  dom['item-alternatives'].textContent = counters.length
    ? `针对阵容：${counters.map((item) => `${item.displayName}（${item.threat}）`).join('、')}`
    : alternatives.length ? `局势备选：${alternatives.join('、')}` : '';
  const hardest = itemAdvice?.matchups?.[0];
  dom['matchup-warning'].textContent = hardest
    ? `对 ${hardest.heroName}：${hardest.level}，校正胜率 ${Math.round(hardest.winRate * 100)}% / ${hardest.matches} 场`
    : '';

  const skill = advice?.skill;
  dom['skill-title'].textContent = skill?.title ?? '暂无已验证加点';
  dom['skill-reason'].textContent = skill?.reason ?? '当前英雄还没有本地技能路线。';
  dom['skill-profile'].textContent = skill?.profile ?? '本地路线';
  const visibleAbilities = (skill?.abilities ?? []).filter((ability) => !ability.innate).slice(0, 6);
  dom['ability-list'].replaceChildren(...visibleAbilities.map((ability) => createAbilityRow(ability, skill?.ability)));

  dom['advice-source'].textContent = itemAdvice?.source
    ? `${itemAdvice.source} · 快照 ${itemAdvice.sourceDate}。仅基于已确认阵容。`
    : '本地离线数据';
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
