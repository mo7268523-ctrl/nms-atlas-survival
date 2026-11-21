"""Build the public catalog from a pinned NMSE game-data export."""
import argparse
import collections
import json
import re
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('nmse_json', type=Path)
p.add_argument('icon_tree', type=Path)
p.add_argument('legacy', type=Path)
p.add_argument('legacy_map', type=Path)
p.add_argument('revision')
a = p.parse_args()
out = Path(__file__).resolve().parent
read = lambda name: json.loads((a.nmse_json / name).read_text())
ru = read('lang/ru-RU.json')
legacy = json.loads(a.legacy.read_text())
legacy_map = json.loads(a.legacy_map.read_text())
icon_files = {Path(line).name for line in a.icon_tree.read_text().splitlines()}
sections = {
    'Buildings':'Buildings', 'Constructed Technology':'ConstructedTechnology',
    'Corvette':'Corvette', 'Curiosities':'Curiosity', 'Exocraft':'Technology',
    'Fish':'Others', 'Food':'Cooking', 'Others':'Others', 'Products':'Products',
    'Raw Materials':'RawMaterials', 'Starships':'Others', 'Station':'Buildings',
    'Technology':'Technology', 'Technology Module':'TechnologyModule',
    'Trade':'TradeItems', 'Upgrades':'TechnologyModule'
}
master = {}
index = collections.defaultdict(set)
def plain(text):
    return re.sub(r'<[^>]+>', '', (text or '')).strip()
def folded(text):
    return plain(text).casefold().replace('ё', 'е')
for filename, section in sections.items():
    file = filename + '.json'
    line_by_id = {}
    current = None
    for number, line in enumerate((a.nmse_json / file).read_text().splitlines(), 1):
        if m := re.fullmatch(r'\t\t"Id": (".*"),?', line):
            current = json.loads(m[1])
            line_by_id[current] = number
        elif current and line.startswith('\t\t"Description":'):
            line_by_id[current] = number
    for row in read(file):
        if not row.get('Id') or not row.get('Name'):
            continue
        id = row['Id']
        assert id not in master, id
        master[id] = (row, file, section)
        row['_source_line'] = line_by_id.get(id)
        index[folded(row['Name'])].add(id)

def matching_id(slug, old):
    primary = legacy_map.get(slug, {}).get('source_id')
    icon_hint = old.get('icon') or ''
    if icon_hint.startswith('https://nomansskyrecipes.com/images/items/'):
        hint = Path(icon_hint).stem
        if hint in master:
            return hint
    if primary in master and folded(master[primary][0]['Name']) == folded(old['name']):
        pool = index[folded(old['name'])]
        costs = [r['inputs'] for r in old['recipes'] if r['kind'] == 'craft']
        if len(pool) > 1 and costs:
            matches = []
            for candidate in pool:
                candidate_row = master[candidate][0]
                required = candidate_row.get('RequiredItems') or []
                old_cost = sorted((folded(k['item']['name']),k['qty']) for k in costs[0])
                new_cost = sorted((folded(master[t['Id']][0]['Name']),t['Quantity']) for t in required if t['Id'] in master)
                if new_cost == old_cost:
                    matches.append(candidate)
            if len(matches) == 1:
                return matches[0]
            # The old translation match identifies a name, not necessarily its variant.
            return None
        if len(pool) > 1:
            candidates = [id for id in pool if master[id][2] == old['catalogue'] and folded(master[id][0].get('Group')) == folded(old.get('group'))]
            if len(candidates) == 1:
                return candidates[0]
            return None
        return primary
    pool = index.get(folded(old['name']), set())
    if len(pool) == 1:
        return next(iter(pool))
    main = [id for id in pool if master[id][2] == old['catalogue'] and folded(master[id][0].get('Group')) == folded(old.get('group'))]
    return main[0] if len(main) == 1 else None

legacy_to_id = {slug: id for slug, old in legacy.items() if (id := matching_id(slug, old))}
old_by_id = collections.defaultdict(list)
for slug, id in legacy_to_id.items():
    old_by_id[id].append(slug)
def slugify(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
slugs = {}
taken = set()
# Retain each unambiguous existing deep link before allocating new links.
for id in sorted(old_by_id):
    old = min(old_by_id[id], key=lambda slug: (len(slug), slug))
    slugs[id] = old
    taken.add(old)
for id, (row, _, _) in master.items():
    if id in slugs:
        continue
    base = slugify(row['Name']) or 'item'
    slug = base if base not in taken and len(index[folded(row['Name'])]) == 1 else base + '-' + slugify(id)
    assert slug not in taken, (slug,id)
    slugs[id] = slug
    taken.add(slug)

def localized(row, key):
    return plain(ru.get(row.get(key) or ''))

records = {}
recipes_seen = set()
for id, (row, filename, section) in master.items():
    icon = row.get('Icon') or ''
    old_slug = min(old_by_id[id], key=lambda slug: (len(slug), slug)) if id in old_by_id else ''
    # Placed objects carry nominal values unrelated to acquiring the part or its blueprint.
    valuation = row.get('BaseValueUnits')
    can_display = (row.get('CurrencyType') == 'Credits' and isinstance(valuation, (int, float))
                   and valuation > 0 and row.get('Rarity') != 'Impossible'
                   and row.get('Group') not in {'Ingredient Category', 'Reward Item'}
                   and not plain(row.get('Name')).startswith('[?]')
                   and row.get('SourceTable') in {'Product', 'Substance'}
                   and section not in {'Buildings', 'ConstructedTechnology'})
    stat = [row.get('Quality'), row.get('FishSize'), row.get('FishingTime'),
            row.get('Biomes'), row.get('NeedsStorm')] if filename == 'Fish.json' else None
    records[slugs[id]] = [
        plain(row['Name']), localized(row, 'NameLower_LocStr') or localized(row, 'Name_LocStr'),
        section, icon if icon in icon_files else '', [], id,
        localized(row, 'Subtitle_LocStr') or plain(row.get('Group')), filename,
        row.get('SourceTable') == 'Substance', old_slug, row.get('Description_LocStr') or '',
        section == 'RawMaterials' and row.get('MaxStackSize') == 1, row['_source_line'],
        valuation if can_display else None, plain(row.get('Group')),
        row.get('Consumable') is True, row.get('GoodForSelling') is True, stat
    ]

def add_recipe(rid, kind, id, result, ingredients, operation=''):
    assert rid not in recipes_seen, rid
    assert id in slugs and result > 0 and ingredients
    assert all(key in slugs and val > 0 for key, val in ingredients), (rid, ingredients)
    recipes_seen.add(rid)
    records[slugs[id]][4].append([rid, kind, result, [[slugs[key], val] for key, val in ingredients], operation])

source = read('Recipes.json')
for recipe in source:
    add_recipe(recipe['Id'], 'cook' if recipe['Cooking'] else 'refiner',
               recipe['Result']['Id'], recipe['Result']['Amount'],
               [(t['Id'], t['Amount']) for t in recipe['Ingredients']],
               localized(recipe, 'RecipeName_LocStr') or localized(recipe, 'RecipeType_LocStr') or plain(recipe.get('RecipeName')))

unknown_requirements = []
for id, (row, _, section) in master.items():
    requirements = row.get('RequiredItems') or []
    if not requirements:
        continue
    if row.get('SourceTable') == 'Technology':
        kind = 'repair' if row.get('Category') == 'Maintenance' or 'damaged' in folded(row.get('Group')) or 'DMG' in id else 'install'
    elif row.get('IsCraftable') is True:
        kind = 'build' if section in {'Buildings','Technology','ConstructedTechnology','Corvette'} else 'craft'
    else:
        continue
    if any(x['Id'] not in slugs or x['Quantity'] <= 0 for x in requirements):
        unknown_requirements.append(id)
        continue
    out_amount = row.get('CraftAmountMultiplier') or 1 if kind == 'craft' else 1
    add_recipe('require-' + id, kind, id, out_amount, [(t['Id'], t['Quantity']) for t in requirements])

count = collections.Counter(r[1] for x in records.values() for r in x[4])
assert (count['cook'], count['refiner']) == (1323, 361)
source_ids = {x['Id'] for x in source}
assert source_ids.issubset(recipes_seen)
old_icon_count = sum(bool(r[3]) for r in records.values())
source_audit = dict(
    extraction=a.revision, items=len(records), iconPaths=old_icon_count,
    missingIcons=len(records)-old_icon_count, counts=dict(count),
    skippedRequirements=unknown_requirements, matchedLegacy=len(legacy_to_id),
    legacyRows=len(legacy), mergedLegacyAliases=len(legacy_to_id)-len(old_by_id),
    nameTranslations=sum(bool(r[1]) for r in records.values()),
    descriptionPointers=sum(bool(r[10]) for r in records.values()),
    exactRecordLines=sum(bool(r[12]) for r in records.values()),
    cardsWithBaseValue=sum(r[13] is not None for r in records.values()))
result = {
    'version':'Forsaken · выгрузка NMSE', 'revision':a.revision,
    'aliases':{slug:slugs[id] for slug,id in legacy_to_id.items() if slug != slugs[id] and slug not in taken},
    'counts':dict(count), 'audit':source_audit, 'items':records
}
(out / 'data.js').write_text('window.NMS_ATLAS = ' + json.dumps(result, ensure_ascii=False, separators=(',',':')) + ';\n')
(out / 'audit.json').write_text(json.dumps(source_audit, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(source_audit, ensure_ascii=False, indent=2))
