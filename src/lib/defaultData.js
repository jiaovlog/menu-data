const today = new Date().toISOString().slice(0, 10)

export const EMPTY_DATA = {
  schema_version: 1,
  dishes: [],
  ingredients: [],
  recipes: [],
  orders: []
}

export const DEMO_DATA = {
  schema_version: 1,
  dishes: [
    { id: 'd1', name: '辣椒炒肉', price: 38, active: true },
    { id: 'd2', name: '鳝鱼', price: 58, active: true },
    { id: 'd3', name: '清炒时蔬', price: 22, active: true }
  ],
  ingredients: [
    { id: 'i1', name: '莴笋', unit: '根', discrete: true },
    { id: 'i2', name: '辣椒', unit: '斤', discrete: false },
    { id: 'i3', name: '猪肉', unit: '斤', discrete: false },
    { id: 'i4', name: '时蔬', unit: '斤', discrete: false }
  ],
  recipes: [
    { dish_id: 'd1', ingredient_id: 'i2', qty: 0.5 },
    { dish_id: 'd1', ingredient_id: 'i3', qty: 0.5 },
    { dish_id: 'd2', ingredient_id: 'i1', qty: 1 },
    { dish_id: 'd3', ingredient_id: 'i4', qty: 0.6 }
  ],
  orders: [
    {
      id: 'o-demo',
      name: '示例宴席',
      date: today,
      tables: 1,
      status: '未结算',
      created_at: new Date().toISOString(),
      items: [
        { dish_id: 'd1', name_snapshot: '辣椒炒肉', price_snapshot: 38, portions: 1, is_addon: false, table_no: null },
        { dish_id: 'd2', name_snapshot: '鳝鱼', price_snapshot: 58, portions: 1, is_addon: false, table_no: null }
      ]
    }
  ]
}
