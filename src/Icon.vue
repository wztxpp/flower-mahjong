<script setup>
defineProps({ name: String, size: { type: Number, default: 20 } })
const paths = {
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  copy: 'M9 9h11v11H9zM15 5V3H3v12h2',
  link: 'm10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  book: 'M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H4zm9 3a3 3 0 0 1 3-3h5v16h-5a3 3 0 0 0-3 2M7 7h3M7 11h3m6-4h2m-2 4h2',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zm-4 9 3 3 5-6',
  soundoff: 'm11 5-6 4H2v6h3l6 4zm6 4 5 6m-5 0 5-6',
  exit: 'M9 4H4v16h5m6-4 4-4-4-4M8 12h11',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  trophy: 'M8 3h8v6a4 4 0 0 1-8 0zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v6m-4 2h8',
  sparkle: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.info"/></svg></template>
