<script setup>
import { computed, ref } from 'vue'
import { CalendarDays, PackageCheck, ShoppingBasket } from '@lucide/vue'
import { calcShoppingByDate, formatMoney, formatQty } from '../lib/calc.js'

const props = defineProps({ orders: { type: Array, required: true }, recipes: { type: Array, required: true }, ingredients: { type: Array, required: true } })
const date = ref(new Date().toISOString().slice(0, 10))
const result = computed(() => calcShoppingByDate(date.value, props.orders, props.recipes, props.ingredients))
</script>

<template>
  <section class="page-section">
    <div class="page-heading"><div><p class="eyebrow">按日期合计</p><h1>采购汇总</h1><p>同一配料按名称和单位分别汇总</p></div><label class="date-control"><CalendarDays :size="18" /><input v-model="date" type="date" /></label></div>
    <div class="metric-strip"><div><span>订单</span><strong>{{ result.orderCount }}</strong></div><div><span>预计营业额</span><strong>{{ formatMoney(result.revenue) }}</strong></div><div><span>采购品类</span><strong>{{ result.items.length }}</strong></div></div>
    <div v-if="result.items.length" class="shopping-table">
      <div class="shopping-table__head"><span>配料</span><span>实际需要</span><span>建议采购</span></div>
      <div v-for="item in result.items" :key="item.id" class="shopping-table__row"><div><ShoppingBasket :size="18" /><strong>{{ item.ingredient }}</strong></div><span>{{ formatQty(item.qty) }} {{ item.unit }}</span><strong>{{ formatQty(item.buyQty) }} {{ item.unit }}<small v-if="item.discrete && item.buyQty !== item.qty">已取整</small></strong></div>
    </div>
    <div v-else class="empty-state"><PackageCheck :size="32" /><h3>当天暂无采购量</h3><p>有订单且菜品配置配方后，这里会自动汇总。</p></div>
  </section>
</template>
