import babelPlugin from "./babel-plugin.js"
import { transformSync } from "@babel/core"
import { createHash } from "crypto"

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

      if (config.mode === "development" && config.server && config.server.hmr !== false) {
        const hmrId = createHash('sha256').update(id).digest('hex')

        output.push(`\n${returnState.componentObj}._hmrid = ${JSON.stringify(hmrId)}`)
        output.push(`\nwindow.HMR.componentMap.set(${JSON.stringify(hmrId)}, ${returnState.componentObj})`)
        output.push(
          `import.meta.hot.accept(mod => {`,
          `  if (!mod) return`,
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