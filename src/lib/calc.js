export function calcOrder(order, recipes, ingredients) {
  let total = 0
  const shopping = {}

  for (const item of order.items || []) {
    const portions = Number(item.portions) || 0
    total += (Number(item.price_snapshot) || 0) * portions

    for (const recipe of recipes.filter((entry) => entry.dish_id === item.dish_id)) {
      const ingredient = ingredients.find((entry) => entry.id === recipe.ingredient_id)
      if (!ingredient) continue
      const unit = recipe.unit || ingredient.unit
      const key = `${recipe.ingredient_id}:${unit}`
      shopping[key] = (shopping[key] || 0) + (Number(recipe.qty) || 0) * portions
    }
  }

  return { total, shopping }
}

export function mergeOrderFamily(order, orders) {
  const children = orders.filter((entry) => entry.parent_order_id === order.id)
  return {
    ...order,
    items: [...(order.items || []), ...children.flatMap((entry) => entry.items || [])]
  }
}

export function shoppingToList(shopping, ingredients) {
  return Object.entries(shopping)
    .map(([key, qty]) => {
      const separator = key.lastIndexOf(':')
      const ingredientId = key.slice(0, separator)
      const unit = key.slice(separator + 1)
      const ingredient = ingredients.find((entry) => entry.id === ingredientId)
      if (!ingredient) return null
      return {
        id: key,
        ingredient: ingredient.name,
        unit,
        qty,
        discrete: ingredient.discrete,
        buyQty: ingredient.discrete ? Math.ceil(qty) : qty
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.ingredient.localeCompare(b.ingredient, 'zh-CN'))
}

export function calcShoppingByDate(date, orders, recipes, ingredients) {
  const rootOrders = orders.filter((order) => order.date === date && !order.parent_order_id)
  const combined = rootOrders.map((order) => mergeOrderFamily(order, orders))
  const shopping = {}
  let revenue = 0

  for (const order of combined) {
    const result = calcOrder(order, recipes, ingredients)
    revenue += result.total
    for (const [key, qty] of Object.entries(result.shopping)) {
      shopping[key] = (shopping[key] || 0) + qty
    }
  }

  return {
    orderCount: rootOrders.length,
    revenue,
    items: shoppingToList(shopping, ingredients)
  }
}

export function formatQty(value) {
  return Number(value.toFixed(3)).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
}

export function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2
  })
}
