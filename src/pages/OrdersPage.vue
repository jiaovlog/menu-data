<script setup>
import { computed, ref } from 'vue'
import { CalendarDays, ChevronRight, CirclePlus, ClipboardList } from '@lucide/vue'
import ModalDialog from '../components/ModalDialog.vue'
import OrderDetailDialog from '../components/OrderDetailDialog.vue'
import { calcOrder, formatMoney, mergeOrderFamily } from '../lib/calc.js'

const props = defineProps({ dishes: { type: Array, required: true }, ingredients: { type: Array, required: true }, recipes: { type: Array, required: true }, orders: { type: Array, required: true } })
const emit = defineEmits(['create', 'addon', 'status', 'remove', 'update-item', 'remove-item', 'update-name'])
const creating = ref(false)
const selectedOrderId = ref('')
const orderName = ref('')
const date = ref(new Date().toISOString().slice(0, 10))
const tables = ref(1)
const drafts = ref([])

const rootOrders = computed(() => props.orders.filter((order) => !order.parent_order_id).sort((a, b) => (b.created_at || b.date).localeCompare(a.created_at || a.date)))
const activeDishes = computed(() => props.dishes.filter((dish) => dish.active))
const selectedOrder = computed(() => props.orders.find((order) => order.id === selectedOrderId.value))

function metrics(order) { return calcOrder(mergeOrderFamily(order, props.orders), props.recipes, props.ingredients) }
function openCreate() {
  orderName.value = ''; date.value = new Date().toISOString().slice(0, 10); tables.value = 1
  drafts.value = activeDishes.value.map((dish) => ({ dish, selected: false, portions: 1 }))
  creating.value = true
}
function syncPortions() {
  for (const item of drafts.value) if (!item.touched) item.portions = Number(tables.value)
}
function touch(item) { item.touched = true }
function submit() {
  const items = drafts.value.filter((item) => item.selected && Number(item.portions) > 0)
  if (!orderName.value.trim() || !date.value || Number(tables.value) < 1 || !items.length) return
  emit('create', { name: orderName.value.trim(), date: date.value, tables: Number(tables.value), items })
  creating.value = false
}
</script>

<template>
  <section class="page-section">
    <div class="page-heading"><div><p class="eyebrow">点菜与加菜</p><h1>订单</h1><p>{{ rootOrders.length }} 张主订单</p></div><button class="button button--primary" type="button" :disabled="!activeDishes.length" @click="openCreate"><CirclePlus :size="18" />新建订单</button></div>
    <div v-if="rootOrders.length" class="order-list">
      <button v-for="order in rootOrders" :key="order.id" class="order-card" type="button" @click="selectedOrderId = order.id">
        <div class="order-card__date"><CalendarDays :size="19" /><div><strong>{{ order.name || '未命名订单' }}</strong><span>{{ order.date }} · {{ order.tables }} 桌 · {{ mergeOrderFamily(order, orders).items.reduce((sum, item) => sum + Number(item.portions), 0) }} 份</span></div></div>
        <div class="order-card__summary"><span class="status-pill" :class="`status-pill--${order.status}`">{{ order.status }}</span><strong>{{ formatMoney(metrics(order).total) }}</strong><ChevronRight :size="19" /></div>
      </button>
    </div>
    <div v-else class="empty-state"><ClipboardList :size="32" /><h3>还没有订单</h3><p>新建订单时，选中的菜品会默认按桌数生成份数。</p></div>

    <ModalDialog v-if="creating" title="新建订单" wide @close="creating = false">
      <form class="form-stack" @submit.prevent="submit">
        <label class="field"><span>订单名称</span><input v-model="orderName" required maxlength="30" placeholder="例如：张先生" autofocus /></label>
        <div class="form-row"><label class="field"><span>日期</span><input v-model="date" type="date" required /></label><label class="field"><span>桌数</span><input v-model="tables" type="number" min="1" step="1" required @input="syncPortions" /></label></div>
        <div class="field"><span>选择菜品和实际份数</span><div class="dish-selector"><label v-for="item in drafts" :key="item.dish.id" class="dish-select-row" :class="{ selected: item.selected }"><input v-model="item.selected" type="checkbox" /><span><strong>{{ item.dish.name }}</strong><small>{{ formatMoney(item.dish.price) }}</small></span><input v-model="item.portions" type="number" min="1" step="1" :disabled="!item.selected" aria-label="份数" @input="touch(item)" /><em>份</em></label></div></div>
        <p v-if="!drafts.some((item) => item.selected)" class="form-hint">请至少选择一道菜</p>
        <div class="form-actions"><button class="button" type="button" @click="creating = false">取消</button><button class="button button--primary" type="submit">生成订单</button></div>
      </form>
    </ModalDialog>

    <OrderDetailDialog v-if="selectedOrder" :order="selectedOrder" :orders="orders" :dishes="dishes" :recipes="recipes" :ingredients="ingredients" @close="selectedOrderId = ''" @addon="emit('addon', $event)" @status="emit('status', $event)" @update-item="emit('update-item', $event)" @remove-item="emit('remove-item', $event)" @update-name="emit('update-name', $event)" @remove="emit('remove', $event); selectedOrderId = ''" />
  </section>
</template>
