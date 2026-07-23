<script setup lang="ts">
import { resume } from '~/data/resume'

useHead({
  title: resume.meta.title,
  meta: [{ name: 'description', content: resume.meta.description }],
})
</script>

<template>
  <main>
    <BootSequence />

    <section id="sys" data-section="sys" aria-label="System status">
      <SysHero />
    </section>

    <section id="profile" data-section="profile" aria-label="Operator profile">
      <OperatorProfile />
    </section>

    <section id="opslog" data-section="opslog" aria-label="Operations log — work history">
      <OperationsLog />
    </section>

    <section id="fobech" data-section="fobech" aria-label="Fobech — independent systems studio">
      <FobechPanel />
    </section>

    <section id="bays" data-section="bays" aria-label="Project bays">
      <ProjectBays />
    </section>

    <section id="comms" data-section="comms" aria-label="Contact">
      <CommsPanel />
    </section>
  </main>
</template>
