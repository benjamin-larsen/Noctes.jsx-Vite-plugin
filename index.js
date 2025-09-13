import babelPlugin from "./babel-plugin.js"
import { transformSync } from "@babel/core"
import { createHash } from "crypto"

export default function plugin() {
  let isDev = false;

  return {
    name: 'vite:noctes.jsx',
    enforce: "pre",

    configResolved(config) {
      isDev = config.mode === "development"
    },

    transform(code, id) {
      if (/\.jsx$/.test(id)) {
        const returnState = {}
        let { code: transformed } = transformSync(code, {
          plugins: [
            "@babel/plugin-syntax-jsx",
            [babelPlugin, returnState]
          ]
        })

        if (isDev) {
          const hmrId = createHash('sha256').update(id).digest('hex')

          transformed += `\n${returnState.componentObj}._hmrid = ${JSON.stringify(hmrId)}`
          transformed += `\nwindow.HMR.componentMap.set(${JSON.stringify(hmrId)}, ${returnState.componentObj})`
          transformed += `\nimport.meta.hot.accept((mod) => window.HMR.hotUpdate(${JSON.stringify(hmrId)}, mod.default))`
        }

        return {
          code: transformed,
          map: null,
        }
      }
    }
  }
}