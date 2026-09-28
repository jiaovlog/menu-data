<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Check, CirclePlus, ClipboardList, Pencil, ShoppingBasket, Trash2, X } from '@lucide/vue'
import ModalDialog from './ModalDialog.vue'
import { calcOrder, formatMoney, formatQty, mergeOrderFamily, shoppingToList } from '../lib/calc.js'

const props = defineProps({
  order: { type: Object, required: true },
  orders: { type: Array, required: true },
  dishes: { type: Array, required: true },
  recipes: { type: Array, required: true },
  ingredients: { type: Array, required: true }
})
const emit = defineEmits(['close', 'addon', 'status', 'remove', 'update-item', 'remove-item', 'update-name'])
const adding = ref(false)
const addon = reactive({ dish_id: '', mode: 'one', custom: 1, table_no: '' })
const editingItemKey = ref('')
const editItem = reactive({ dish_id: '', portions: 1 })
const editingName = ref(false)
const nameDraft = ref(props.order.name || '')
const family = computed(() => mergeOrderFamily(props.order, props.orders))
const result = computed(() => calcOrder(family.value, props.recipes, props.ingredients))
const shopping = computed(() => shoppingToList(result.value.shopping, props.ingredients))
const activeDishes = computed(() => props.dishes.filter((dish) => dish.active))
const status = ref(props.order.status)
const familyItems = computed(() => {
  const sources = [props.order, ...props.orders.filter((entry) => entry.parent_order_id === props.order.id)]
  return sources.flatMap((source) => (source.items || []).map((item, index) => ({ ...item, source_order_id: source.id, source_index: index })))
})

watch(() => props.order.status, (value) => { status.value = value })

function portions() {
  if (addon.mode === 'tables') return props.order.tables
  if (addon.mode === 'custom') return Number(addon.custom)
  return 1
}

function submitAddon() {
  const dish = props.dishes.find((entry) => entry.id === addon.dish_id)
  if (!dish || portions() <= 0) return
  emit('addon', { order: props.order, dish, portions: portions(), tableNo: addon.table_no ? Number(addon.table_no) : null })
  addon.dish_id = ''; addon.mode = 'one'; addon.custom = 1; addon.table_no = ''; adding.value = false
}

function changeStatus() { emit('status', { order: props.order, status: status.value }) }

function itemKey(item) { return `${item.source_order_id}:${item.source_index}` }
function editableDishes(item) { return props.dishes.filter((dish) => dish.active || dish.id === item.dish_id) }
function startEdit(item) {
  editingItemKey.value = itemKey(item)
  editItem.dish_id = item.dish_id
  editItem.portions = item.portions
}
function submitItem(item) {
  const dish = props.dishes.find((entry) => entry.id === editItem.dish_id)
  if (!dish || Number(editItem.portions) < 1) return
  emit('update-item', { sourceOrderId: item.source_order_id, index: item.source_index, dish, portions: Number(editItem.portions) })
  editingItemKey.value = ''
}
function removeItem(item) {
  if (!confirm(`确定删除“${item.name_snapshot}”吗？`)) return
  emit('remove-item', { sourceOrderId: item.source_order_id, index: item.source_index })
}
function submitName() {
  if (!nameDraft.value.trim()) return
  emit('update-name', { order: props.order, name: nameDraft.value.trim() })
  editingName.value = false
}
</script>

<template>
  <ModalDialog :title="order.name || `订单 ${order.id.slice(-8)}`" wide @close="$emit('close')">
    <div class="order-detail-head">
      <div class="order-identity">
        <span>{{ order.date }} · {{ order.tables }} 桌</span>
        <form v-if="editingName" class="inline-name-edit" @submit.prevent="submitName"><input v-model="nameDraft" maxlength="30" required autofocus /><button class="icon-button" type="submit" title="保存名称"><Check :size="17" /></button><button class="icon-button" type="button" title="取消" @click="editingName = false"><X :size="17" /></button></form>
        <div v-else class="order-name"><strong>{{ order.name || '未命名订单' }}</strong><button class="icon-button" type="button" title="修改订单名称" @click="nameDraft = order.name || ''; editingName = true"><Pencil :size="16" /></button></div>
      </div>
      <label class="compact-select"><span>状态</span><select v-model="status" @change="changeStatus"><option>未结算</option><option>已采购</option><option>已结算</option></select></label>
    </div>
    <div class="detail-metrics"><div><span>总金额</span><strong>{{ formatMoney(result.total) }}</strong></div><div><span>总份数</span><strong>{{ family.items.reduce((sum, item) => sum + Number(item.portions), 0) }}</strong></div><div><span>配料种类</span><strong>{{ shopping.length }}</strong></div></div>

    <div class="detail-columns">
      <section class="detail-section">
        <div class="section-label"><span><ClipboardList :size="17" />菜品明细</span><button class="button button--small button--primary" type="button" @click="adding = !adding"><CirclePlus :size="16" />加菜</button></div>
        <form v-if="adding" class="addon-form" @submit.prevent="submitAddon">
          <label class="field"><span>菜品</span><select v-model="addon.dish_id" required><option value="" disabled>请选择</option><option v-for="dish in activeDishes" :key="dish.id" :value="dish.id">{{ dish.name }} · {{ formatMoney(dish.price) }}</option></select></label>
          <div class="field"><span>加菜份数</span><div class="segmented"><label><input v-model="addon.mode" type="radio" value="one" /><span>1 份</span></label><label><input v-model="addon.mode" type="radio" value="tables" /><span>{{ order.tables }} 份</span></label><label><input v-model="addon.mode" type="radio" value="custom" /><span>自定义</span></label></div></div>
          <div class="form-row"><label v-if="addon.mode === 'custom'" class="field"><span>份数</span><input v-model="addon.custom" type="number" min="1" step="1" required /></label><label class="field"><span>桌号（可选）</span><input v-model="addon.table_no" type="number" min="1" step="1" placeholder="例如 3" /></label></div>
          <p v-if="order.status !== '未结算'" class="info-note">该订单已{{ order.status === '已结算' ? '结算' : '采购' }}，本次加菜会记录为独立追加单。</p>
          <div class="form-actions"><button class="button" type="button" @click="adding = false">取消</button><button class="button button--primary" type="submit">确认加菜</button></div>
        </form>
        <div class="line-list">
          <div v-for="item in familyItems" :key="itemKey(item)" class="line-item line-item--editable">
            <form v-if="editingItemKey === itemKey(item)" class="line-item-edit" @submit.prevent="submitItem(item)">
              <select v-model="editItem.dish_id" aria-label="菜品"><option v-for="dish in editableDishes(item)" :key="dish.id" :value="dish.id">{{ dish.name }} · {{ formatMoney(dish.price) }}</option></select>
              <label><input v-model="editItem.portions" type="number" min="1" step="1" aria-label="份数" /><span>份</span></label>
              <div><button class="icon-button" type="submit" title="保存修改"><Check :size="17" /></button><button class="icon-button" type="button" title="取消" @click="editingItemKey = ''"><X :size="17" /></button></div>
            </form>
            <template v-else>
              <div><strong>{{ item.name_snapshot }}</strong><span v-if="item.is_addon" class="addon-chip">加菜<span v-if="item.table_no"> · {{ item.table_no }} 桌</span></span></div>
              <span>{{ item.portions }} 份 × {{ formatMoney(item.price_snapshot) }}</span>
              <strong>{{ formatMoney(item.portions * item.price_snapshot) }}</strong>
              <div v-if="order.status === '未结算'" class="line-item__actions"><button class="icon-button" type="button" title="修改菜品" @click="startEdit(item)"><Pencil :size="17" /></button><button class="icon-button icon-button--danger" type="button" title="删除菜品" @click="removeItem(item)"><Trash2 :size="17" /></button></div>
            </template>
          </div>
        </div>
      </section>
      <section class="detail-section">
        <div class="section-label"><span><ShoppingBasket :size="17" />配菜汇总</span></div>
        <div v-if="shopping.length" class="line-list"><div v-for="item in shopping" :key="item.id" class="line-item"><strong>{{ item.ingredient }}</strong><span>{{ formatQty(item.qty) }} {{ item.unit }}</span><small v-if="item.discrete && item.buyQty !== item.qty">建议 {{ formatQty(item.buyQty) }} {{ item.unit }}</small></div></div>
        <div v-else class="inline-empty">当前菜品尚未配置配方</div>
      </section>
    </div>
    <div class="danger-zone"><button class="button button--danger" type="button" @click="emit('remove', order)"><Trash2 :size="17" />删除订单</button></div>
  </ModalDialog>
</template>
