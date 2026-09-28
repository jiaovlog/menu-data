<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { CirclePlus, Pencil, Search, Trash2, Utensils } from '@lucide/vue'
import ModalDialog from '../components/ModalDialog.vue'

const props = defineProps({ dishes: { type: Array, required: true } })
const emit = defineEmits(['save', 'remove'])
const query = ref('')
const editing = ref(null)
const form = reactive({ name: '', price: '', active: true })

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.dishes.filter((dish) => !needle || dish.name.toLowerCase().includes(needle))
})

watch(editing, (dish) => {
  form.name = dish?.name || ''
  form.price = dish?.price ?? ''
  form.active = dish?.active ?? true
})

function open(dish = {}) {
  editing.value = dish
}

function submit() {
  if (!form.name.trim() || Number(form.price) < 0 || form.price === '') return
  emit('save', { id: editing.value.id, name: form.name.trim(), price: Number(form.price), active: form.active })
  editing.value = null
}
</script>

<template>
  <section class="page-section">
    <div class="page-heading">
      <div>
        <p class="eyebrow">菜单管理</p>
        <h1>菜品</h1>
        <p>{{ dishes.length }} 道菜，{{ dishes.filter((dish) => dish.active).length }} 道在售</p>
      </div>
      <button class="button button--primary" type="button" @click="open()"><CirclePlus :size="18" />新增菜品</button>
    </div>

    <div class="toolbar">
      <label class="search-field"><Search :size="18" /><input v-model="query" placeholder="搜索菜名" /></label>
    </div>

    <div v-if="filtered.length" class="item-grid">
      <article v-for="dish in filtered" :key="dish.id" class="item-card">
        <div class="item-card__icon"><Utensils :size="20" /></div>
        <div class="item-card__main">
          <div class="item-card__title-row">
            <h3>{{ dish.name }}</h3>
            <span class="status-dot" :class="dish.active ? 'is-active' : ''">{{ dish.active ? '在售' : '停用' }}</span>
          </div>
          <strong class="price">¥{{ Number(dish.price).toFixed(2) }}</strong>
        </div>
        <div class="item-card__actions">
          <button class="icon-button" type="button" title="编辑" @click="open(dish)"><Pencil :size="18" /></button>
          <button class="icon-button icon-button--danger" type="button" title="删除" @click="emit('remove', dish)"><Trash2 :size="18" /></button>
        </div>
      </article>
    </div>
    <div v-else class="empty-state"><Utensils :size="32" /><h3>还没有菜品</h3><p>新增第一道菜后即可配置配方和点菜。</p></div>

    <ModalDialog v-if="editing" :title="editing.id ? '编辑菜品' : '新增菜品'" @close="editing = null">
      <form class="form-stack" @submit.prevent="submit">
        <label class="field"><span>菜名</span><input v-model="form.name" required maxlength="30" autofocus /></label>
        <label class="field"><span>单价（元）</span><input v-model="form.price" required type="number" min="0" step="0.01" inputmode="decimal" /></label>
        <label class="switch-row"><span><strong>在售</strong><small>停用后不会出现在新订单中</small></span><input v-model="form.active" type="checkbox" role="switch" /></label>
        <div class="form-actions"><button class="button" type="button" @click="editing = null">取消</button><button class="button button--primary" type="submit">保存</button></div>
      </form>
    </ModalDialog>
  </section>
</template>
