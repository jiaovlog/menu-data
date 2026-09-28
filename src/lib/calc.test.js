import { describe, expect, it } from 'vitest'
import { calcOrder, calcShoppingByDate, mergeOrderFamily, shoppingToList } from './calc.js'

const ingredients = [
  { id: 'pepper', name: '辣椒', unit: '斤', discrete: false },
  { id: 'lettuce', name: '莴笋', unit: '根', discrete: true }
]
const recipes = [
  { dish_id: 'pork', ingredient_id: 'pepper', qty: 0.5 },
  { dish_id: 'fish', ingredient_id: 'lettuce', qty: 1 }
]

describe('order calculations', () => {
  it('calculates money and ingredients from actual portions', () => {
    const order = {
      items: [
        { dish_id: 'pork', price_snapshot: 38, portions: 10 },
        { dish_id: 'fish', price_snapshot: 58, portions: 11 }
      ]
    }
    expect(calcOrder(order, recipes, ingredients)).toEqual({
      total: 1018,
      shopping: { 'pepper:斤': 5, 'lettuce:根': 11 }
    })
  })

  it('rounds only discrete ingredients for buying advice', () => {
    const list = shoppingToList({ 'lettuce:根': 2.2, 'pepper:斤': 1.25 }, ingredients)
    expect(list.find((item) => item.ingredient === '莴笋').buyQty).toBe(3)
    expect(list.find((item) => item.ingredient === '辣椒').buyQty).toBe(1.25)
  })

  it('merges append orders into date totals', () => {
    const orders = [
      { id: 'root', date: '2026-09-28', items: [{ dish_id: 'fish', price_snapshot: 58, portions: 10 }] },
      { id: 'addon', parent_order_id: 'root', date: '2026-09-28', items: [{ dish_id: 'fish', price_snapshot: 58, portions: 1 }] }
    ]
    expect(mergeOrderFamily(orders[0], orders).items).toHaveLength(2)
    const result = calcShoppingByDate('2026-09-28', orders, recipes, ingredients)
    expect(result.orderCount).toBe(1)
    expect(result.revenue).toBe(638)
    expect(result.items[0].qty).toBe(11)
  })
})
