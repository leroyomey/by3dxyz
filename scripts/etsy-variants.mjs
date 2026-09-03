/** Build website dropdowns from a listing's live Etsy inventory. Do not invent options. */

export const SHOP_COLORS = [
  "Black",
  "Green",
  "Orange",
  "Burnt Orange",
  "Red",
  "Candy Red",
  "Light Pink",
  "Fuchsia",
  "Yellow",
  "Vintage Rose",
  "New Army Green",
];

export const LOCKED_RIB_SIZES = [
  { name: "2in/5.08cm", price: 10 },
  { name: "3in/7.62cm", price: 11 },
  { name: "4in/10.16cm", price: 12 },
  { name: "5in/12.7cm", price: 13 },
  { name: "6in/15.24cm", price: 14 },
  { name: "7in/17.78cm", price: 16.5 },
  { name: "8in/20.32cm", price: 18.5 },
  { name: "Set of 3 - 2/3/4in", price: 28 },
  { name: "Set of 3 - 4/5/6in", price: 32 },
  { name: "Set of 3 - 6/7/8in", price: 40 },
];

export function cleanOptionName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

export function isWhiteColor(name) {
  return /^white$/i.test(cleanOptionName(name));
}

export function isRibSizeName(name) {
  const value = cleanOptionName(name);
  return /^\d+\s*in\b/i.test(value) || /^set of 3\b/i.test(value);
}

function offeringPrice(offering) {
  const price = (offering?.price?.amount ?? 0) / (offering?.price?.divisor || 100);
  return Number(price.toFixed(2));
}

function slugId(name) {
  return (
    cleanOptionName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "option"
  );
}

export function groupIdForProperty(propertyName, existingGroups = []) {
  const prop = cleanOptionName(propertyName);
  const key = prop.toLowerCase();
  const byLabel = existingGroups.find((group) => cleanOptionName(group.label).toLowerCase() === key);
  if (byLabel) return byLabel.id;
  const byId = existingGroups.find((group) => group.id === slugId(prop));
  if (byId) return byId.id;
  if (/colou?r/.test(key)) return "color";
  if (/thickness/.test(key)) return "size";
  if (/\bsize\b/.test(key)) return "size";
  if (/pack|quantity/.test(key)) return "pack";
  if (/style|shelf/.test(key)) return "style";
  if (/back|hanger/.test(key)) return "back";
  return slugId(prop);
}

function defaultLabel(id, prop) {
  if (id === "color") return "Primary color";
  if (id === "size" && /thickness/i.test(prop)) return "Thickness";
  if (id === "size") return "Size";
  if (id === "pack") return "Pack size";
  if (id === "style") return "Shelf style";
  if (id === "back") return "Back / hanger";
  return prop;
}

function defaultPlaceholder(id, prop) {
  if (id === "color") return "Select a color";
  if (id === "size" && /thickness/i.test(prop)) return "Select a thickness";
  if (id === "size") return "Select an option";
  if (id === "pack") return "Select a pack size";
  if (id === "style") return "Select a shelf style";
  if (id === "back") return "Select a back and hanger";
  return `Select a ${prop.toLowerCase()}`;
}

function uniqueByName(values) {
  const out = [];
  const seen = new Set();
  for (const row of values || []) {
    const name = cleanOptionName(row?.name);
    if (!name || isWhiteColor(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const next = { name };
    if (typeof row.price === "number" && row.price > 0) next.price = Number(row.price.toFixed(2));
    out.push(next);
  }
  return out;
}

function sortColorValues(values) {
  const rank = new Map(SHOP_COLORS.map((name, i) => [name.toLowerCase(), i]));
  return [...values].sort((a, b) => {
    const left = rank.has(a.name.toLowerCase()) ? rank.get(a.name.toLowerCase()) : 1000;
    const right = rank.has(b.name.toLowerCase()) ? rank.get(b.name.toLowerCase()) : 1000;
    return left - right || a.name.localeCompare(b.name);
  });
}

function valueRow(name, price) {
  const row = { name };
  if (typeof price === "number" && price > 0) row.price = Number(price.toFixed(2));
  return row;
}

export function groupsFromInventory(inventory) {
  const order = [];
  const buckets = new Map();

  for (const row of inventory?.products || []) {
    if (row.is_deleted) continue;
    const offering =
      (row.offerings || []).find((item) => item.is_enabled !== false && item.is_deleted !== true) ||
      row.offerings?.[0];
    if (!offering || offering.is_deleted) continue;
    const price = offeringPrice(offering);

    for (const pv of row.property_values || []) {
      const prop = cleanOptionName(pv.property_name);
      if (!prop) continue;
      if (!buckets.has(prop)) {
        buckets.set(prop, new Map());
        order.push(prop);
      }
      for (const raw of pv.values || []) {
        const name = cleanOptionName(raw);
        if (!name || isWhiteColor(name)) continue;
        const bucket = buckets.get(prop);
        if (!bucket.has(name)) bucket.set(name, new Set());
        if (Number.isFinite(price) && price > 0) bucket.get(name).add(price);
      }
    }
  }

  return order
    .map((prop) => {
      const valueMap = buckets.get(prop);
      const singles = [];
      for (const [name, prices] of valueMap) {
        singles.push({ name, price: prices.size === 1 ? [...prices][0] : undefined });
      }
      const distinct = new Set(singles.map((row) => row.price).filter((price) => price != null));
      const attach = distinct.size > 1;
      const id = groupIdForProperty(prop, []);
      return {
        id,
        label: defaultLabel(id, prop),
        placeholder: defaultPlaceholder(id, prop),
        propertyName: prop,
        values: singles.map((row) => (attach ? valueRow(row.name, row.price) : { name: row.name })),
      };
    })
    .filter((group) => group.values.length);
}

function cloneGroup(group) {
  return {
    id: group.id,
    label: group.label,
    placeholder: group.placeholder,
    values: (group.values || []).map((row) => valueRow(row.name, row.price)).filter((row) => row.name),
  };
}

export function groupsEqual(left, right) {
  return JSON.stringify((left || []).map(cloneGroup)) === JSON.stringify((right || []).map(cloneGroup));
}

function mergeColorValues(existingValues, liveValues, keepShopColors) {
  const live = uniqueByName(liveValues);
  if (!keepShopColors) return sortColorValues(live);
  return sortColorValues(uniqueByName([...(existingValues || []), ...live]));
}

function applyLiveOntoExisting(existing, live, { replaceNonColor, keepShopColors, dropUnused }) {
  const used = new Set();
  const extras = [];
  const out = [];

  for (const liveGroup of live || []) {
    const id = groupIdForProperty(liveGroup.propertyName || liveGroup.label, existing);
    const current = (existing || []).find((group) => group.id === id);
    if (current) {
      used.add(current.id);
      const isColor = current.id === "color";
      const values = isColor
        ? mergeColorValues(current.values, liveGroup.values, keepShopColors)
        : replaceNonColor
          ? uniqueByName(liveGroup.values)
          : uniqueByName([...(current.values || []), ...liveGroup.values]);
      out.push({
        id: current.id,
        label: current.label,
        placeholder: current.placeholder,
        values,
      });
      continue;
    }
    extras.push({
      id,
      label: liveGroup.label || defaultLabel(id, liveGroup.propertyName || ""),
      placeholder: liveGroup.placeholder || defaultPlaceholder(id, liveGroup.propertyName || ""),
      values: uniqueByName(liveGroup.values),
    });
  }

  if (!dropUnused) {
    for (const group of existing || []) {
      if (used.has(group.id)) continue;
      out.push(cloneGroup(group));
    }
  }

  out.push(...extras);
  return out;
}

function dropRibSizes(groups) {
  return (groups || [])
    .map((group) => ({
      ...group,
      values: (group.values || []).filter((row) => !isRibSizeName(row.name)),
    }))
    .filter((group) => group.values.length);
}

function listingIdOf(product) {
  return String(product?.etsyListingId || "");
}

export function syncVariantData({ products, inventories, variantFiles }) {
  const notes = [];
  const changedFileIds = [];
  let productsChanged = false;
  const nextFiles = { ...variantFiles };
  const users = new Map();

  for (const product of products || []) {
    if (product.variantSet) users.set(product.variantSet, (users.get(product.variantSet) || 0) + 1);
  }

  const liveBySku = new Map();
  for (const product of products || []) {
    const inventory = inventories?.get(listingIdOf(product));
    if (!inventory) continue;
    let live = groupsFromInventory(inventory);
    if (product.variantSet !== "rib") live = dropRibSizes(live);
    if (live.length) liveBySku.set(product.sku, live);
  }

  for (const [setId, fileData] of Object.entries(variantFiles || {})) {
    const members = (products || []).filter((product) => product.variantSet === setId && liveBySku.has(product.sku));
    if (!members.length || !fileData?.groups) continue;
    const existing = fileData.groups;
    const sole = (users.get(setId) || 0) === 1;

    if (setId === "rib") {
      const colorLive = [];
      const extraSizes = new Set();
      for (const product of members) {
        for (const group of liveBySku.get(product.sku) || []) {
          const id = groupIdForProperty(group.propertyName || group.label, existing);
          if (id === "color") colorLive.push(...group.values);
          if (id === "size") {
            for (const row of group.values || []) {
              if (isRibSizeName(row.name) && !LOCKED_RIB_SIZES.some((locked) => locked.name === row.name)) {
                extraSizes.add(row.name);
              }
            }
          }
        }
      }
      if (extraSizes.size) {
        notes.push(`Rib locked sizes kept; skipped extra Etsy sizes: ${[...extraSizes].join(", ")}`);
      }
      const next = existing.map((group) => {
        if (group.id === "size") return { ...cloneGroup(group), values: LOCKED_RIB_SIZES.map((row) => ({ ...row })) };
        if (group.id === "color") {
          return { ...cloneGroup(group), values: mergeColorValues(group.values, colorLive, true) };
        }
        return cloneGroup(group);
      });
      if (!groupsEqual(existing, next)) {
        nextFiles[setId] = { ...fileData, groups: next };
        changedFileIds.push(setId);
        notes.push("Update rib-variants.json colors from live Etsy (sizes locked)");
      }
      continue;
    }

    if (sole) {
      const live = liveBySku.get(members[0].sku);
      const next = applyLiveOntoExisting(existing, live, {
        replaceNonColor: true,
        keepShopColors: false,
        dropUnused: true,
      });
      if (!groupsEqual(existing, next)) {
        nextFiles[setId] = { ...fileData, groups: next };
        changedFileIds.push(setId);
        notes.push(`Update ${setId}-variants.json from ${members[0].sku} live Etsy options`);
      }
      continue;
    }

    const unionById = new Map();
    const extrasBySku = new Map();
    for (const product of members) {
      for (const liveGroup of liveBySku.get(product.sku) || []) {
        const id = groupIdForProperty(liveGroup.propertyName || liveGroup.label, existing);
        if (existing.some((group) => group.id === id)) {
          if (!unionById.has(id)) unionById.set(id, []);
          unionById.get(id).push(...liveGroup.values);
        } else {
          if (!extrasBySku.has(product.sku)) extrasBySku.set(product.sku, []);
          extrasBySku.get(product.sku).push({
            id,
            label: liveGroup.label || defaultLabel(id, liveGroup.propertyName || ""),
            placeholder: liveGroup.placeholder || defaultPlaceholder(id, liveGroup.propertyName || ""),
            values: uniqueByName(liveGroup.values),
          });
        }
      }
    }

    const next = existing.map((group) => {
      const liveVals = unionById.get(group.id) || [];
      if (group.id === "color") {
        return { ...cloneGroup(group), values: mergeColorValues(group.values, liveVals, true) };
      }
      if (!liveVals.length) return cloneGroup(group);
      return { ...cloneGroup(group), values: uniqueByName(liveVals) };
    });

    if (!groupsEqual(existing, next)) {
      nextFiles[setId] = { ...fileData, groups: next };
      changedFileIds.push(setId);
      notes.push(`Update ${setId}-variants.json from live Etsy options`);
    }

    for (const [sku, extras] of extrasBySku) {
      const product = products.find((row) => row.sku === sku);
      if (!product) continue;
      product.variants = [...next.map(cloneGroup), ...extras];
      productsChanged = true;
      notes.push(`${sku}: added listing-only options (${extras.map((group) => group.label).join(", ")})`);
    }
  }

  for (const product of products || []) {
    const live = liveBySku.get(product.sku);
    if (!live) continue;
    if (product.variantSet) continue;
    if (product.variants?.length) {
      const next = applyLiveOntoExisting(product.variants, live, {
        replaceNonColor: true,
        keepShopColors: false,
        dropUnused: true,
      });
      if (!groupsEqual(product.variants, next)) {
        product.variants = next;
        productsChanged = true;
        notes.push(`Update ${product.sku} inline variants from live Etsy`);
      }
      continue;
    }
    product.variants = live.map(cloneGroup);
    productsChanged = true;
    notes.push(`Add ${product.sku} options from live Etsy`);
  }

  return { variantFiles: nextFiles, notes, changedFileIds, productsChanged };
}
