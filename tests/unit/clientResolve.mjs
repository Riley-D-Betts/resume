// Module-resolution hook for the client-tracker unit tests.
//
// `node --test` runs the suite with native type stripping, but the tracker
// lives in the Nuxt app and speaks Nuxt's aliases: `#shared/...` for the wire
// contract, `~/...` for app modules, and extensionless relative imports. This
// hook teaches Node those three so `tests/unit/clientRules.test.ts` can import
// the real modules instead of a copy of them. Registered from the test file
// (`register('./clientResolve.mjs', import.meta.url)`), which is why it must
// stay a plain .mjs file — a loader cannot be type-stripped by the loader it
// installs. It is not itself a test (`*.test.ts` is what the runner globs).
const ROOT = new URL('../../', import.meta.url)

export function resolve(specifier, context, next) {
  if (specifier.startsWith('#shared/')) {
    return { url: new URL(`shared/${specifier.slice('#shared/'.length)}.ts`, ROOT).href, shortCircuit: true }
  }
  if (specifier.startsWith('~/')) {
    return { url: new URL(`app/${specifier.slice(2)}.ts`, ROOT).href, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context)
  }
  return next(specifier, context)
}
