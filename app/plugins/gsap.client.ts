import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'

/**
 * Client-only GSAP setup. Registers every plugin once; section
 * components import from 'gsap' inside onMounted and get the same
 * registered instance.
 */
export default defineNuxtPlugin(() => {
  gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin)

  return {
    provide: {
      gsap,
      ScrollTrigger,
    },
  }
})
