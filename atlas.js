(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const data = window.NMS_ATLAS;
  if (!data?.items) {
    byId('loading').textContent = 'Каталог не загрузился. Обновите страницу.';
    return;
  }

  const kinds = {craft: 'Крафт', refiner: 'Очиститель', cook: 'Переработчик нутриентов', build: 'Строительство', install: 'Установка технологии', repair: 'Ремонт'};
  const categories = {
    RawMaterials: 'Сырьё', Products: 'Изделия', Cooking: 'Кулинария',
    Buildings: 'Строительство', Technology: 'Технологии',
    ConstructedTechnology: 'Устанавливаемые технологии', TechnologyModule: 'Модули улучшений',
    Corvette: 'Корвет', Curiosity: 'Редкости', TradeItems: 'Торговые товары',
    ProceduralProducts: 'Процедурные предметы', Others: 'Прочее'
  };
  const format = new Intl.NumberFormat('ru-RU');
  const collator = new Intl.Collator('ru', {numeric: true});
  const source = "https://github.com/vectorcmdr/NMSE/blob/" + data.revision + "/Resources/json/";
  const iconSource = "https://raw.githubusercontent.com/vectorcmdr/NMSE/" + data.revision + "/Resources/images/";
  const items = new Map(Object.entries(data.items).map(([slug, row]) => [slug, {
    slug, english: row[0], name: row[1] || row[0], category: row[2],
    icon: row[3], recipes: row[4], id: row[5], group: row[6], sourceFile: row[7],
    isResource: row[8], previousSlug: row[9], descriptionKey: row[10], regularStack: row[11], sourceLine: row[12], usedBy: []
  }]));
  function normalize(str) {
    return str.toLocaleLowerCase().replaceAll('ё', 'е').replace(/[‐‑–—-]/g, ' ').trim();
  }
  for (const item of items.values()) {
    item.search = normalize(item.name + ' ' + item.english);
    for (const recipe of item.recipes) {
      for (const ingredient of new Set(recipe[3].map(([slug]) => slug))) {
        items.get(ingredient).usedBy.push({item, recipe});
      }
    }
  }
  const sorted = [...items.values()].sort((a, b) => collator.compare(a.name, b.name));
  const defaultSlug = items.has('stasis-device') ? 'stasis-device' : sorted[0].slug;
  let favorites;
  try {
    const saved = JSON.parse(localStorage.getItem('nms-atlas-favorites') || '[]');
    favorites = new Set(Array.isArray(saved) ? saved : []);
  } catch {
    favorites = new Set();
  }
  const state = {slug: defaultSlug, view: 'recipes', amount: 1, limit: 50, preferred: new Map()};

  function node(tag, text, cls) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  }

  function icon(item, size) {
    const box = node('span', null, 'sprite');
    box.setAttribute('aria-hidden', 'true');
    box.style.width = size + 'px';
    box.style.height = size + 'px';
    if (!item.icon) {
      box.classList.add('empty');
      return box;
    }
    const image = new Image(size, size);
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      box.classList.add('empty');
      image.remove();
    }, {once: true});
    image.src = iconSource + encodeURIComponent(item.icon);
    box.append(image);
    return box;
  }
  function itemLink(item, amount, cls = 'chip') {
    const a = node('a', null, cls);
    a.href = '#' + encodeURIComponent(item.slug);
    a.dataset.item = item.slug;
    const name = node('span', item.name);
    if (amount != null) name.append(' ', node('b', '×' + format.format(amount)));
    a.append(icon(item, cls === 'match' ? 38 : 30), name);
    return a;
  }

  function candidates() {
    const terms = normalize(byId('search').value).split(/\s+/).filter(Boolean);
    const category = byId('category').value;
    const favOnly = byId('favorites-only').checked;
    const showInternal = byId('internal-items').checked;
    return sorted.filter(item => (!category || item.category === category) &&
      (!favOnly || favorites.has(item.slug)) && (showInternal || !item.name.startsWith('[?]')) && terms.every(term => item.search.includes(term)));
  }

  function renderMatches() {
    const matches = candidates();
    const list = byId('matches');
    list.replaceChildren(...matches.slice(0, state.limit).map(item => {
      const li = node('li');
      const a = itemLink(item, null, 'match');
      if (item.slug === state.slug) a.setAttribute('aria-current', 'true');
      a.lastChild.append(node('small', [item.english !== item.name ? item.english : '', item.recipes.length ? format.format(item.recipes.length) + ' рец.' : ''].filter(Boolean).join(' · ')));
      li.append(a);
      return li;
    }));
    byId('match-count').textContent = matches.length ? 'Найдено ' + format.format(matches.length) : 'Ничего не найдено';
    byId('more').hidden = matches.length <= state.limit;
  }

  function show(slug, scroll) {
    if (!items.has(slug)) return;
    if (state.slug !== slug) {
      state.slug = slug;
      state.view = 'recipes';
      state.amount = 1;
    }
    renderMatches();
    render();
    if (scroll) {
      const main = byId('main');
      main.focus({preventScroll: true});
      if (window.matchMedia('(max-width: 760px)').matches) main.scrollIntoView({block: 'start'});
    }
  }

  function selectItem(slug) {
    if (!items.has(slug)) return;
    const hash = '#' + encodeURIComponent(slug);
    if (location.hash !== hash) {
      try { history.pushState(null, '', hash); }
      catch { location.hash = hash; }
    }
    show(slug, true);
  }

  function fromHash() {
    let slug;
    try { slug = decodeURIComponent(location.hash.slice(1)); }
    catch { slug = defaultSlug; }
    slug = data.aliases[slug] || slug;
    show(items.has(slug) ? slug : defaultSlug, false);
  }

  function chosen(item, isRoot) {
    if (state.preferred.has(item.slug)) {
      return item.recipes.find(recipe => recipe[0] === state.preferred.get(item.slug));
    }
    if (!isRoot && item.category === 'RawMaterials') return undefined;
    const usable = item.recipes.filter(recipe => isRoot || !['install', 'repair', 'build'].includes(recipe[1]));
    return usable.find(recipe => recipe[1] === 'craft') || usable[0];
  }

  function empty(text) { return node('p', text, 'card muted'); }
  function cardTitle(card, title) { card.append(node('h3', title)); }
  function button(label, action, cls) {
    const b = node('button', label, cls);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }

  function recipeCard(item, recipe, index, count, inUses = false) {
    const card = node('article', null, 'card');
    if (count > 1 && !inUses) card.append(node('div', 'Вариант ' + (index + 1) + ' / ' + count, 'meta'));
    const isRequirement = recipe[1] === 'install' || recipe[1] === 'repair';
    cardTitle(card, kinds[recipe[1]] + (isRequirement ? ' · материалы' : ' · выход ×' + format.format(recipe[2])));
    if (recipe[4]) card.append(node('p', recipe[4], 'meta'));
    if (recipe[1] === 'refiner' && recipe[3].every(([slug]) => items.get(slug).regularStack)) {
      const maxInput = Math.min(...recipe[3].map(([, amount]) => Math.floor(250 / amount)));
      if (maxInput) card.append(node('p', 'По ёмкости входных слотов: до ' + format.format(maxInput) + ' операций за загрузку.', 'meta'));
    }
    if (recipe[1] === 'repair') card.append(node('p', 'Базовые требования к ремонту из таблиц. Сверь с экраном повреждённой детали.', 'meta'));
    const row = node('div', null, 'row');
    recipe[3].forEach(([slug, amount], index) => {
      if (index) row.append(node('span', '+', 'arrow'));
      row.append(itemLink(items.get(slug), amount));
    });
    row.append(node('span', '→', 'arrow'), itemLink(item, isRequirement ? null : recipe[2]));
    card.append(row);
    if (!inUses) {
      const isSelected = chosen(item, true)?.[0] === recipe[0];
      const controls = node('div', null, 'row');
      controls.append(button(isSelected ? 'Выбран для расчёта' : 'Выбрать для расчёта', () => {
        state.preferred.set(item.slug, recipe[0]);
        render();
      }, isSelected ? 'primary' : undefined), button('Раскрыть цепочку', () => {
        state.preferred.set(item.slug, recipe[0]);
        state.view = 'tree';
        render();
      }));
      card.append(controls);
    }
    return card;
  }

  function calculate(root, amount) {
    const surplus = new Map();
    const resources = new Map();
    let visited = 0;
    const addResource = (item, amount, reason) => {
      const existing = resources.get(item.slug);
      if (existing) {
        existing.amount += amount;
        if (reason) existing.reasons.add(reason);
      } else {
        resources.set(item.slug, {item, amount, reasons: new Set(reason ? [reason] : [])});
      }
    };
    function visit(item, needed, ancestors, isRoot = false) {
      visited++;
      const previous = surplus.get(item.slug) || 0;
      const reused = Math.min(previous, needed);
      surplus.set(item.slug, previous - reused);
      const demand = needed - reused;
      const branch = {item, needed, reused, children: []};
      if (!demand) return branch;
      const recipe = chosen(item, isRoot);
      let reason;
      if (ancestors.has(item.slug)) reason = 'цикл, нужен запас';
      else if (ancestors.size >= 24 || visited > 2000) reason = 'достроить вручную';
      if (reason || !recipe || !Number.isFinite(recipe[2]) || recipe[2] <= 0) {
        branch.note = reason || 'сырьё / получение';
        addResource(item, demand, reason);
        return branch;
      }
      const runs = Math.ceil(demand / recipe[2]);
      branch.runs = runs;
      branch.kind = recipe[1];
      const path = new Set([...ancestors, item.slug]);
      branch.children = recipe[3].map(([slug, qty]) => visit(items.get(slug), qty * runs, path));
      surplus.set(item.slug, (surplus.get(item.slug) || 0) + runs * recipe[2] - demand);
      return branch;
    }
    return {tree: visit(root, amount, new Set(), true), resources, surplus};
  }

  function branchList(branches) {
    const list = node('ul', null, 'tree');
    branches.forEach(branch => {
      const li = node('li');
      li.append(itemLink(branch.item, branch.needed));
      const note = branch.runs ? kinds[branch.kind] + ' · операций ' + format.format(branch.runs)
        : branch.note || 'из остатка';
      li.append(node('small', note));
      if (branch.children.length) li.append(branchList(branch.children));
      list.append(li);
    });
    return list;
  }

  function calculator(item, panel) {
    const card = node('div', null, 'card');
    cardTitle(card, state.view === 'tree' ? 'Производственная цепочка' : 'Ресурсы для изготовления');
    const countRow = node('div', null, 'row');
    const label = node('label', 'Количество');
    label.htmlFor = 'quantity';
    const qty = node('input', null, 'quantity');
    Object.assign(qty, {id: 'quantity', type: 'number', min: 1, max: 9999, step: 1, value: state.amount, inputMode: 'numeric'});
    const result = node('div');
    function update() {
      const amount = Number(qty.value);
      if (!Number.isInteger(amount) || amount < 1 || amount > 9999) {
        result.replaceChildren(node('p', 'Введите целое число от 1 до 9 999.', 'muted'));
        return;
      }
      state.amount = amount;
      if (['install', 'repair'].includes(chosen(item, true)?.[1]) && amount !== 1) {
        result.replaceChildren(node('p', 'Для установки или ремонта здесь указан расход на одну технологию.', 'muted'));
        return;
      }
      const plan = calculate(item, amount);
      if (state.view === 'tree') {
        result.replaceChildren(branchList([plan.tree]));
        return;
      }
      const table = node('table', null, 'materials');
      const header = table.createTHead().insertRow();
      for (const title of ['Ресурс', 'Единиц', 'Ячеек экзокостюма']) {
        const th = node('th', title);
        th.scope = 'col';
        header.append(th);
      }
      const body = table.createTBody();
      const materialRows = [...plan.resources.values()].sort((a, b) => collator.compare(a.item.name, b.item.name));
      for (const row of materialRows) {
        const line = body.insertRow();
        const first = line.insertCell();
        first.append(itemLink(row.item));
        const notes = [...row.reasons].join(', ');
        if (notes) first.append(node('small', ' ' + notes, 'muted'));
        line.insertCell().textContent = format.format(row.amount);
        line.insertCell().textContent = row.item.regularStack ? format.format(Math.ceil(row.amount / 500)) : '—';
      }
      result.replaceChildren(materialRows.length ? table : node('p', 'Расходуемых материалов нет.', 'muted'));
      const remains = plan.surplus.get(item.slug);
      if (remains) result.append(node('p', 'Остаток готового изделия: ' + format.format(remains), 'muted'));
    }
    qty.addEventListener('input', update);
    countRow.append(label, qty);
    card.append(countRow, node('p', 'Расчёт по выбранным рецептам с округлением до целых операций. Природное сырьё считается готовым к использованию, если для него не выбран рецепт. Ячейки рассчитаны для сырья со стопкой 500.', 'meta'), result);
    panel.append(card);
    update();
  }

  const shortNotes = {
    FUEL1: 'Заряжает расщепитель мультитула. Углерод получают из растений и используют в крафте и переработке.',
    FUEL2: 'Концентрированное топливо для технологий, которые принимают углерод. Его можно получить в очистителе.',
    OXYGEN: 'Пополняет жизнеобеспечение экзокостюма. В очистителе кислород служит ингредиентом и участвует в рецептах получения других ресурсов.',
    CATALYST1: 'Пополняет базовую защиту от вредных факторов. Натрий также используют в строительстве и переработке.',
    CATALYST2: 'Концентрированная форма натрия. Пополняет базовую защиту экзокостюма от вредных факторов.',
    LAND1: 'Базовый ресурс для строительства и изготовления металлической обшивки. Добывается расщепителем из подходящих камней.',
    FOOD_M_REX: 'Сырой ингредиент животного происхождения. Его готовят в переработчике нутриентов, например для копчёного мяса и рагу.',
    FOOD_MEAT_STEW: 'Готовое мясное блюдо. Среди вариантов есть рецепт из двух порций чешуйчатого мяса.',
    UT_SURVEY: 'Открывает в анализирующем визоре поиск электромагнитных полей, глубинных залежей и скоплений газа.',
    COOKER: 'Переносное устройство для приготовления еды из одного, двух или трёх ингредиентов.',
    ANY_BONE: 'В этой строке указана группа взаимозаменяемых ингредиентов. Для операции подходит съедобная кость.',
    SWARMDUST: 'Материал, который остаётся после уничтожения роевиков. В очистителе пять единиц перерабатываются в одно скопление нанитов.'
  };

  function describe(item) {
    const info = byId('item-facts');
    const summary = [];
    if (shortNotes[item.id]) summary.push(shortNotes[item.id]);
    else {
      const group = item.group || categories[item.category] || item.category;
      summary.push('Тип в каталоге: ' + group + '.');
      if (item.recipes.length) {
        const modes = [...new Set(item.recipes.map(r => kinds[r[1]].toLowerCase()))];
        summary.push('Доступные операции в таблицах: ' + modes.join(', ') + '.');
      }
      if (item.usedBy.length) {
        const examples = [...new Set(item.usedBy.filter(r => r.item !== item).map(r => r.item.name))].slice(0, 3);
        if (examples.length) summary.push('Примеры применения: ' + examples.join(', ') + '.');
      }
      if (!item.recipes.length && !item.usedBy.length) summary.push('В выгрузке нет производственных операций с этим предметом.');
    }
    const top = node('p', summary.join(' '));
    const links = node('p', 'Игровой ID: ' + item.id + ' · ', 'meta');
    const record = node('a', 'Запись в выгрузке');
    record.href = source + encodeURIComponent(item.sourceFile) + (item.sourceLine ? '#L' + item.sourceLine : '');
    record.rel = 'noreferrer';
    record.target = '_blank';
    links.append(record);
    const detail = node('details');
    detail.append(node('summary', 'Описание в игре'));
    detail.append(node('p', 'В игровом меню откройте «Каталог и руководство» и найдите «' + item.name + '». Если запись ещё закрыта, предмет сначала нужно обнаружить.'));
    if (item.previousSlug) {
      const original = node('a', 'Открыть карточку с английским текстом');
      original.href = 'https://nmscraft.com/item/' + encodeURIComponent(item.previousSlug) + '/';
      original.rel = 'noreferrer';
      original.target = '_blank';
      detail.append(original);
    }
    if (item.descriptionKey) {
      const key = node('p', 'Ключ русской локализации: ' + item.descriptionKey, 'meta');
      detail.append(key);
    }
    info.replaceChildren(top, links, detail);
  }

  function render() {
    const item = items.get(state.slug);
    const heading = byId('item');
    const title = node('div', null, 'title-text');
    title.append(node('h2', item.name));
    if (item.name !== item.english) title.append(node('p', item.english, 'muted'));
    title.append(node('p', categories[item.category] || item.category, 'meta'));
    const marked = favorites.has(item.slug);
    const fav = button(marked ? '★' : '☆', () => {
      if (favorites.has(item.slug)) favorites.delete(item.slug);
      else favorites.add(item.slug);
      try { localStorage.setItem('nms-atlas-favorites', JSON.stringify([...favorites])); }
      catch { /* Favorites still work during this session. */ }
      renderMatches();
      render();
      byId('favorite').focus();
    });
    fav.id = 'favorite';
    fav.setAttribute('aria-label', marked ? 'Убрать из избранного' : 'Добавить в избранное');
    fav.setAttribute('aria-pressed', String(marked));
    heading.replaceChildren(icon(item, 76), title, fav);
    describe(item);
    for (const b of byId('views').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    }
    const panel = byId('panel');
    panel.replaceChildren();
    switch (state.view) {
      case 'recipes':
        if (item.recipes.length) panel.append(...item.recipes.map((recipe, i) => recipeCard(item, recipe, i, item.recipes.length)));
        else panel.append(empty('В этой выгрузке нет рецепта изготовления предмета. Откройте «Где используется», чтобы найти рецепты с ним.'));
        break;
      case 'uses':
        if (item.usedBy.length) {
          panel.append(node('p', 'Рецептов с этим предметом: ' + format.format(item.usedBy.length), 'muted'));
          panel.append(...item.usedBy.map(({item: product, recipe}) => recipeCard(product, recipe, 0, 1, true)));
        } else panel.append(empty('В базе нет рецептов, использующих этот предмет.'));
        break;
      default:
        calculator(item, panel);
    }
  }

  byId('category').append(new Option('Все разделы', ''));
  for (const [key, name] of Object.entries(categories).sort((a, b) => collator.compare(a[1], b[1]))) {
    byId('category').append(new Option(name, key));
  }
  for (const [kind, count] of Object.entries(data.counts)) {
    byId('counts').append(node('li', kinds[kind] + ' · ' + format.format(count)));
  }
  for (const id of ['search', 'category', 'favorites-only', 'internal-items']) {
    byId(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
      state.limit = 50;
      renderMatches();
    });
  }
  byId('search').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const first = candidates()[0];
    if (first) selectItem(first.slug);
  });
  byId('more').addEventListener('click', () => { state.limit += 50; renderMatches(); });
  byId('views').addEventListener('click', event => {
    const view = event.target.closest('button')?.dataset.view;
    if (!view) return;
    state.view = view;
    render();
  });
  document.addEventListener('click', event => {
    const a = event.target.closest('a[data-item]');
    if (!a || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    selectItem(a.dataset.item);
  });
  byId('about-button').addEventListener('click', () => byId('about').showModal());
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
