<script setup lang="ts">
interface Item {
  label: string
  to?: string
  href?: string
  toast?: string
}

/**
 * NetSuite's "Actions" / "More" menu is a BORDERLESS text menu with a
 * small triangle — not a bordered button.
 */
withDefaults(defineProps<{ label?: string; items: Item[] }>(), { label: 'Actions' })

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const toast = useToast()
const router = useRouter()

function pick(it: Item): void {
  open.value = false
  if (it.toast) toast.show(it.toast)
  else if (it.to) router.push(it.to)
  else if (it.href) window.open(it.href, '_blank', 'noopener')
}

function onDoc(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', onDoc))
onBeforeUnmount(() => document.removeEventListener('click', onDoc))
</script>

<template>
  <div ref="root" class="ns-menu">
    <button type="button" class="ns-menu__btn" :aria-expanded="open" @click.stop="open = !open">
      {{ label }}<span class="ns-menu__tri" aria-hidden="true">▼</span>
    </button>
    <div v-if="open" class="ns-menu__list">
      <button v-for="it in items" :key="it.label" type="button" class="ns-menu__item" @click="pick(it)">
        {{ it.label }}
      </button>
    </div>
  </div>
</template>
