<script setup>
import { computed, markRaw, onMounted, reactive, ref } from 'vue'
import { BookOpen, ChefHat, ClipboardList, Download, KeyRound, Menu, PackageOpen, RefreshCw, Settings, ShoppingBasket, Upload, Utensils, Wifi, WifiOff, X } from '@lucide/vue'
import ModalDialog from './components/ModalDialog.vue'
import DishesPage from './pages/DishesPage.vue'
import IngredientsPage from './pages/IngredientsPage.vue'
import RecipesPage from './pages/RecipesPage.vue'
import OrdersPage from './pages/OrdersPage.vue'
import ShoppingPage from './pages/ShoppingPage.vue'
import { EMPTY_DATA } from './lib/defaultData.js'
import { dataMode, downloadBackup, getAccessKey, loadData, parseBackup, saveData, setAccessKey } from './lib/dataClient.js'
import { makeId } from './lib/ids.js'

const tabs = [
  { id: 'dishes', label: '菜品', icon: markRaw(Utensils), component: markRaw(DishesPage) },
  { id: 'ingredients', label: '配料', icon: markRaw(PackageOpen), component: markRaw(IngredientsPage) },
  { id: 'recipes', label: '配方', icon: markRaw(ChefHat), component: markRaw(RecipesPage) },
  { id: 'orders', label: '订单', icon: markRaw(ClipboardList), component: markRaw(OrdersPage) },
  { id: 'shopping', label: '采购', icon: markRaw(ShoppingBasket), component: markRaw(ShoppingPage) }
]

const activeTab = ref('orders')
const navOpen = ref(false)
const settingsOpen = ref(false)
const accessKey = ref('')
const importInput = ref(null)
const state = reactive({ data: structuredClone(EMPTY_DATA), revision: '', loading: true, pending: 0, lastSaved: null })
const notice = reactive({ show: false, message: '', type: 'success' })
let noticeTimer
let saveQueue = Promise.resolve()

const active = computed(() => tabs.find((tab) => tab.id === activeTab.value))
const pageProps = computed(() => ({
  dishes: state.data.dishes,
  ingredients: state.data.ingredients,
  recipes: state.data.recipes,
  orders: state.data.orders
}))

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function showNotice(message, type = 'success') {
  clearTimeout(noticeTimer); notice.message = message; notice.type = type; notice.show = true
  noticeTimer = setTimeout(() => { notice.show = false }, 3800)
}

async function refresh() {
  state.loading = true
  try {
    const result = await loadData()
    state.data = result.data; state.revision = result.revision; state.lastSaved = new Date()
  } catch (error) {
    showNotice(error.message, 'error')
  } finally {
    state.loading = false
  }
}

function mutate(mutator, successMessage = '已保存') {
  const next = clone(state.data)
  mutator(next)
  state.data = next
  state.pending += 1
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const result = await saveData(next, state.revision)
    state.revision = result.revision
    state.lastSaved = new Date()
    showNotice(successMessage)
  }).catch((error) => {
    showNotice(error.message, 'error')
  }).finally(() => { state.pending = Math.max(0, state.pending - 1) })
  return saveQueue
}

function saveDish(dish) {
  mutate((data) => {
    if (dish.id) Object.assign(data.dishes.find((item) => item.id === dish.id), dish)
    else data.dishes.push({ ...dish, id: makeId('dish') })
  }, dish.id ? '菜品已更新' : '菜品已新增')
}

function removeDish(dish) {
  if (state.data.orders.some((order) => order.items.some((item) => item.dish_id === dish.id))) return showNotice('该菜品已有历史订单，请停用而不是删除', 'error')
  if (!confirm(`确定删除“${dish.name}”及其配方吗？`)) return
  mutate((data) => { data.dishes = data.dishes.filter((item) => item.id !== dish.id); data.recipes = data.recipes.filter((item) => item.dish_id !== dish.id) }, '菜品已删除')
}

function saveIngredient(ingredient) {
  mutate((data) => {
    if (ingredient.id) Object.assign(data.ingredients.find((item) => item.id === ingredient.id), ingredient)
    else data.ingredients.push({ ...ingredient, id: makeId('ingredient') })
  }, ingredient.id ? '配料已更新' : '配料已新增')
}

function removeIngredient(ingredient) {
  if (state.data.recipes.some((recipe) => recipe.ingredient_id === ingredient.id)) return showNotice('该配料正在配方中使用，请先移除对应配方', 'error')
  if (!confirm(`确定删除“${ingredient.name}”吗？`)) return
  mutate((data) => { data.ingredients = data.ingredients.filter((item) => item.id !== ingredient.id) }, '配料已删除')
}

function saveRecipe(recipe) {
  mutate((data) => {
    const index = data.recipes.findIndex((item) => item.dish_id === recipe.dish_id && item.ingredient_id === recipe.ingredient_id)
    if (index >= 0) data.recipes[index] = recipe
    else data.recipes.push(recipe)
  }, '配方已更新')
}

function removeRecipe(recipe) {
  mutate((data) => { data.recipes = data.recipes.filter((item) => !(item.dish_id === recipe.dish_id && item.ingredient_id === recipe.ingredient_id)) }, '配料已从配方移除')
}

function createOrder(payload) {
  mutate((data) => data.orders.push({
    id: makeId('order'), name: payload.name, date: payload.date, tables: payload.tables, status: '未结算', created_at: new Date().toISOString(),
    items: payload.items.map(({ dish, portions }) => ({ dish_id: dish.id, name_snapshot: dish.name, price_snapshot: dish.price, portions: Number(portions), is_addon: false, table_no: null }))
  }), '订单已生成')
}

function addOrderItem({ order, dish, portions, tableNo }) {
  const item = { dish_id: dish.id, name_snapshot: dish.name, price_snapshot: dish.price, portions, is_addon: true, table_no: tableNo }
  mutate((data) => {
    if (order.status === '未结算') data.orders.find((entry) => entry.id === order.id).items.push(item)
    else data.orders.push({ id: makeId('addon'), parent_order_id: order.id, date: order.date, tables: order.tables, status: '加菜', created_at: new Date().toISOString(), items: [item] })
  }, order.status === '未结算' ? '加菜已记入订单' : '追加单已生成')
}

function updateOrderStatus({ order, status }) {
  mutate((data) => { data.orders.find((entry) => entry.id === order.id).status = status }, '订单状态已更新')
}

function updateOrderItem({ sourceOrderId, index, dish, portions }) {
  mutate((data) => {
    const source = data.orders.find((entry) => entry.id === sourceOrderId)
    const current = source?.items[index]
    if (!current) return
    source.items[index] = { ...current, dish_id: dish.id, name_snapshot: dish.name, price_snapshot: dish.price, portions }
  }, '菜品明细已修改')
}

function removeOrderItem({ sourceOrderId, index }) {
  mutate((data) => {
    const source = data.orders.find((entry) => entry.id === sourceOrderId)
    if (source) source.items.splice(index, 1)
  }, '菜品已从订单删除')
}

function updateOrderName({ order, name }) {
  mutate((data) => { data.orders.find((entry) => entry.id === order.id).name = name }, '订单名称已修改')
}

function removeOrder(order) {
  if (!confirm('确定删除该订单及其所有追加单吗？此操作不可撤销。')) return
  mutate((data) => { data.orders = data.orders.filter((entry) => entry.id !== order.id && entry.parent_order_id !== order.id) }, '订单已删除')
}

function saveSettings() {
  setAccessKey(accessKey.value); settingsOpen.value = false
  if (dataMode === 'remote') refresh()
  else showNotice('设置已保存')
}

async function importBackup(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const data = await parseBackup(file)
    if (!confirm('导入会覆盖当前全部数据，确定继续吗？')) return
    state.data = data
    await mutate((target) => Object.assign(target, data), '备份已导入')
    settingsOpen.value = false
  } catch (error) { showNotice(`导入失败：${error.message}`, 'error') }
  finally { event.target.value = '' }
}

function openSettings() { accessKey.value = getAccessKey(); settingsOpen.value = true }
function changeTab(id) { activeTab.value = id; navOpen.value = false }

onMounted(refresh)
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" :class="{ 'sidebar--open': navOpen }">
      <div class="brand"><div class="brand__mark"><BookOpen :size="22" /></div><div><strong>配菜管理</strong><span>MENU DATA</span></div><button class="icon-button sidebar__close" type="button" aria-label="关闭菜单" @click="navOpen = false"><X :size="20" /></button></div>
      <nav class="side-nav" aria-label="主导航"><button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" type="button" @click="changeTab(tab.id)"><component :is="tab.icon" :size="19" /><span>{{ tab.label }}</span></button></nav>
      <div class="sidebar__foot"><div class="sync-state"><component :is="dataMode === 'remote' ? Wifi : WifiOff" :size="16" /><span>{{ dataMode === 'remote' ? '远程同步' : '本机数据' }}</span></div><button class="side-settings" type="button" @click="openSettings"><Settings :size="18" />数据与设置</button></div>
    </aside>
    <div v-if="navOpen" class="nav-scrim" @click="navOpen = false" />

    <main class="main-area">
      <header class="topbar"><button class="icon-button mobile-menu" type="button" aria-label="打开菜单" @click="navOpen = true"><Menu :size="21" /></button><div class="topbar__title"><component :is="active.icon" :size="18" /><span>{{ active.label }}</span></div><div class="topbar__right"><span class="save-state" :class="{ saving: state.pending }"><RefreshCw v-if="state.pending" :size="14" />{{ state.pending ? '保存中' : '已保存' }}</span><button class="icon-button" type="button" title="刷新数据" :disabled="state.loading || state.pending" @click="refresh"><RefreshCw :size="18" :class="{ spin: state.loading }" /></button><button class="icon-button" type="button" title="数据与设置" @click="openSettings"><Settings :size="18" /></button></div></header>
      <div v-if="state.loading" class="loading-screen"><RefreshCw class="spin" :size="28" /><span>正在读取数据</span></div>
      <component v-else :is="active.component" v-bind="pageProps" @save="activeTab === 'dishes' ? saveDish($event) : activeTab === 'ingredients' ? saveIngredient($event) : saveRecipe($event)" @remove="activeTab === 'dishes' ? removeDish($event) : activeTab === 'ingredients' ? removeIngredient($event) : activeTab === 'recipes' ? removeRecipe($event) : removeOrder($event)" @create="createOrder" @addon="addOrderItem" @status="updateOrderStatus" @update-item="updateOrderItem" @remove-item="removeOrderItem" @update-name="updateOrderName" />
    </main>

    <nav class="bottom-nav" aria-label="移动端主导航"><button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" type="button" @click="changeTab(tab.id)"><component :is="tab.icon" :size="20" /><span>{{ tab.label }}</span></button></nav>

    <ModalDialog v-if="settingsOpen" title="数据与设置" @close="settingsOpen = false">
      <form class="form-stack" @submit.prevent="saveSettings">
        <div class="setting-mode"><component :is="dataMode === 'remote' ? Wifi : WifiOff" :size="20" /><div><strong>{{ dataMode === 'remote' ? '远程同步模式' : '本机模式' }}</strong><span>{{ dataMode === 'remote' ? '通过 Worker 同步 GitHub 文件' : '数据仅保存在当前浏览器' }}</span></div></div>
        <label v-if="dataMode === 'remote'" class="field"><span>访问密钥</span><div class="input-with-icon"><KeyRound :size="18" /><input v-model="accessKey" type="password" autocomplete="current-password" placeholder="APP_ACCESS_KEY" /></div></label>
        <div class="backup-actions"><button class="button" type="button" @click="downloadBackup(state.data)"><Download :size="17" />导出备份</button><button class="button" type="button" @click="importInput.click()"><Upload :size="17" />导入备份</button><input ref="importInput" class="sr-only" type="file" accept="application/json,.json" @change="importBackup" /></div>
        <div class="form-actions"><button class="button" type="button" @click="settingsOpen = false">关闭</button><button v-if="dataMode === 'remote'" class="button button--primary" type="submit">保存并刷新</button></div>
      </form>
    </ModalDialog>

    <transition name="toast"><div v-if="notice.show" class="toast" :class="`toast--${notice.type}`" role="status"><span>{{ notice.message }}</span><button type="button" aria-label="关闭" @click="notice.show = false"><X :size="17" /></button></div></transition>
  </div>
</template>
