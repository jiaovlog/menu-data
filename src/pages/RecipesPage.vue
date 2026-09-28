<script setup>
import { computed, reactive, ref } from 'vue'
import { ChefHat, CirclePlus, Trash2 } from '@lucide/vue'

const props = defineProps({ dishes: { type: Array, required: true }, ingredients: { type: Array, required: true }, recipes: { type: Array, required: true } })
const emit = defineEmits(['save', 'remove'])
const selectedDishId = ref(props.dishes[0]?.id || '')
const form = reactive({ ingredient_id: '', qty: '', unit: '' })
const selectedDish = computed(() => props.dishes.find((dish) => dish.id === selectedDishId.value))
const currentRecipes = computed(() => props.recipes.filter((recipe) => recipe.dish_id === selectedDishId.value))
const availableIngredients = computed(() => props.ingredients.filter((item) => !currentRecipes.value.some((recipe) => recipe.ingredient_id === item.id)))

function ingredientFor(id) { return props.ingredients.find((item) => item.id === id) }
function submit() {
  if (!selectedDishId.value || !form.ingredient_id || Number(form.qty) <= 0) return
  const ingredient = ingredientFor(form.ingredient_id)
  emit('save', { dish_id: selectedDishId.value, ingredient_id: form.ingredient_id, qty: Number(form.qty), unit: form.unit.trim() && form.unit.trim() !== ingredient.unit ? form.unit.trim() : undefined })
  form.ingredient_id = ''; form.qty = ''; form.unit = ''
}
</script>

<template>
  <section class="page-section">
    <div class="page-heading"><div><p class="eyebrow">每份用量</p><h1>配方</h1><p>选择菜品，配置制作一份所需配料</p></div></div>
    <div v-if="!dishes.length || !ingredients.length" class="empty-state"><ChefHat :size="32" /><h3>资料还不完整</h3><p>至少需要一道菜和一种配料才能配置配方。</p></div>
    <template v-else>
      <div class="recipe-picker"><label class="field"><span>当前菜品</span><select v-model="selectedDishId"><option v-for="dish in dishes" :key="dish.id" :value="dish.id">{{ dish.name }}</option></select></label></div>
      <div class="recipe-layout">
        <div class="recipe-list">
          <div class="section-label"><span>{{ selectedDish?.name }}</span><strong>{{ currentRecipes.length }} 种配料</strong></div>
          <article v-for="recipe in currentRecipes" :key="recipe.ingredient_id" class="recipe-row">
            <div><strong>{{ ingredientFor(recipe.ingredient_id)?.name || '未知配料' }}</strong><span>{{ recipe.qty }} {{ recipe.unit || ingredientFor(recipe.ingredient_id)?.unit }}</span></div>
            <button class="icon-button icon-button--danger" type="button" title="移除" @click="emit('remove', recipe)"><Trash2 :size="18" /></button>
          </article>
          <div v-if="!currentRecipes.length" class="inline-empty">这道菜还没有配方</div>
        </div>
        <form class="recipe-form" @submit.prevent="submit">
          <h2><CirclePlus :size="19" />添加配料</h2>
          <label class="field"><span>配料</span><select v-model="form.ingredient_id" required><option value="" disabled>请选择</option><option v-for="item in availableIngredients" :key="item.id" :value="item.id">{{ item.name }}（{{ item.unit }}）</option></select></label>
          <label class="field"><span>每份用量</span><input v-model="form.qty" type="number" min="0.001" step="0.001" inputmode="decimal" required /></label>
          <label class="field"><span>覆盖单位（可选）</span><input v-model="form.unit" maxlength="8" :placeholder="form.ingredient_id ? `默认：${ingredientFor(form.ingredient_id)?.unit}` : '先选择配料'" /></label>
          <button class="button button--primary button--full" type="submit" :disabled="!availableIngredients.length">加入配方</button>
        </form>
      </div>
    </template>
  </section>
</template>
