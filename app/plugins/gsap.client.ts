import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { Observer } from 'gsap/Observer'
import { CustomEase } from 'gsap/CustomEase'

/**
 * Client-only GSAP setup. Registers every plugin once; section
 * components import from 'gsap' inside onMounted and get the same
 * registered instance.
 *
 * Two signature eases keep the whole console moving with one accent:
 * - "console": sharp arrival with a tiny electrical overshoot
 * - "slam": near-instant hit for stamps and relay clicks
 */
export default defineNuxtPlugin(() => {
  gsap.registerPlugin(
    ScrollTrigger,
    SplitText,
    ScrambleTextPlugin,
    DrawSVGPlugin,
    MotionPathPlugin,
    Observer,
    CustomEase,
  )

  CustomEase.create('console', 'M0,0 C0.2,0 0.25,1.04 0.45,1.04 0.7,1.04 0.7,1 1,1')
  CustomEase.create('slam', 'M0,0 C0.6,0 0.7,1 1,1')

  return {
    provide: {
      gsap,
      ScrollTrigger,
    },
  }
})
