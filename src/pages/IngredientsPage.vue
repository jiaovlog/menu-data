<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { CirclePlus, PackageOpen, Pencil, Search, Trash2 } from '@lucide/vue'
import ModalDialog from '../components/ModalDialog.vue'

const props = defineProps({ ingredients: { type: Array, required: true } })
const emit = defineEmits(['save', 'remove'])
const query = ref('')
const editing = ref(null)
const form = reactive({ name: '', unit: '', discrete: false })
const units = ['斤', '克', '公斤', '根', '个', '条', '把', '袋', '盒', '瓶']

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.ingredients.filter((item) => !needle || item.name.toLowerCase().includes(needle))
})

watch(editing, (item) => {
  form.name = item?.name || ''
  form.unit = item?.unit || ''
  form.discrete = item?.discrete ?? false
})

function open(item = {}) { editing.value = item }
function submit() {
  if (!form.name.trim() || !form.unit.trim()) return
  emit('save', { id: editing.value.id, name: form.name.trim(), unit: form.unit.trim(), discrete: form.discrete })
  editing.value = null
}
</script>

<template>
  <section class="page-section">
    <div class="page-heading">
      <div><p class="eyebrow">基础资料</p><h1>配料</h1><p>{{ ingredients.length }} 种配料，按自然单位汇总</p></div>
      <button class="button button--primary" type="button" @click="open()"><CirclePlus :size="18" />新增配料</button>
    </div>
    <div class="toolbar"><label class="search-field"><Search :size="18" /><input v-model="query" placeholder="搜索配料" /></label></div>
    <div v-if="filtered.length" class="item-grid">
      <article v-for="item in filtered" :key="item.id" class="item-card">
        <div class="item-card__icon item-card__icon--gold"><PackageOpen :size="20" /></div>
        <div class="item-card__main"><div class="item-card__title-row"><h3>{{ item.name }}</h3><span class="unit-chip">{{ item.unit }}</span></div><p>{{ item.discrete ? '离散单位 · 采购向上取整' : '连续用量' }}</p></div>
        <div class="item-card__actions"><button class="icon-button" type="button" title="编辑" @click="open(item)"><Pencil :size="18" /></button><button class="icon-button icon-button--danger" type="button" title="删除" @click="emit('remove', item)"><Trash2 :size="18" /></button></div>
      </article>
    </div>
    <div v-else class="empty-state"><PackageOpen :size="32" /><h3>还没有配料</h3><p>配料建立后，可为每道菜设置一份的用量。</p></div>

    <ModalDialog v-if="editing" :title="editing.id ? '编辑配料' : '新增配料'" @close="editing = null">
      <form class="form-stack" @submit.prevent="submit">
        <label class="field"><span>配料名</span><input v-model="form.name" required maxlength="30" autofocus /></label>
        <label class="field"><span>自然单位</span><input v-model="form.unit" required maxlength="8" list="ingredient-units" /><datalist id="ingredient-units"><option v-for="unit in units" :key="unit" :value="unit" /></datalist></label>
        <label class="switch-row"><span><strong>离散单位</strong><small>根、个、条等无法拆分的单位</small></span><input v-model="form.discrete" type="checkbox" role="switch" /></label>
        <div class="form-actions"><button class="button" type="button" @click="editing = null">取消</button><button class="button button--primary" type="submit">保存</button></div>
      </form>
    </ModalDialog>
  </section>
</template>
