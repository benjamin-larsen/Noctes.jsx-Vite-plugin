import babelPlugin from "./babel-plugin.js"
import { transformSync } from "@babel/core"
import { createHash } from "node:crypto"

export default function plugin() {
  let config = {};

  return {
    name: 'vite:noctes.jsx',
    enforce: "pre",

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    async transform(code, id) {
      if (!/\.jsx$/.test(id)) return;

      const returnState = {}
      let { code: transformed, map } = transformSync(code, {
        plugins: [
          "@babel/plugin-syntax-jsx",
          [babelPlugin, returnState]
        ],
        filename: id,
        sourceMaps: true
      })

      const output = [
        transformed
      ]

      if (
        returnState.isComponent &&
        config.mode === "development" &&
        config.server &&
        config.server.hmr !== false
      ) {
        const hmrId = createHash('sha256').update(id).digest('hex')

        output.push(`${returnState.componentObj}._astHash = ${JSON.stringify(returnState.astHash)}`)
        output.push(`${returnState.componentObj}._hmrid = ${JSON.stringify(hmrId)}`)
        output.push(`window.HMR.componentMap.set(${JSON.stringify(hmrId)}, ${returnState.componentObj})`)
        output.push(
          `import.meta.hot.accept(mod => {`,
          `  if (!mod) return`,
          `  if (!mod.default || mod.default._hmrid !== ${JSON.stringify(hmrId)}) return import.meta.hot.invalidate()`,
          `  window.HMR.hotUpdate(${JSON.stringify(hmrId)}, mod.default)`,
          `})`
        )
      }

      return {
        code: output.join("\n"),
        map,
      }
    }
  }
}
