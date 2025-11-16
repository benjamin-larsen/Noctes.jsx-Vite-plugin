import transformJSXElement from './transformers/JSXElement.js';
import transformJSXFragment from './transformers/JSXFragment.js';
import { hashAst } from './helpers/astHash.js';

export default function (api, returnState = {}) {
  const { types: t } = api;

  returnState.isComponent = false;

  return {
    pre(state) {
      const { scope, path: rootPath } = state;

      this.createElement = scope.generateUidIdentifier("createElement")
      this.createComponent = scope.generateUidIdentifier("createComponent")
      this.withDirectives = scope.generateUidIdentifier("withDirectives")
      this.withContext = scope.generateUidIdentifier("withContext")

      rootPath.unshiftContainer('body', t.importDeclaration(
        [
          t.importSpecifier(this.createElement, t.identifier("createElement")),
          t.importSpecifier(this.createComponent, t.identifier("createComponent")),
          t.importSpecifier(this.withDirectives, t.identifier("withDirectives")),
          t.importSpecifier(this.withContext, t.identifier("withContext"))
        ],
        t.stringLiteral("noctes.jsx")
      ))

      rootPath.traverse({
        ExportDefaultDeclaration: (path) => {
          const decleration = path.node.declaration;

          if (t.isIdentifier(decleration)) {
            this.componentObj = decleration;
          } else if (t.isObjectExpression(decleration)) {
            this.componentObj = scope.generateUidIdentifier("componentObj")

            path.replaceWithMultiple([
              t.variableDeclaration("const", [
                t.variableDeclarator(this.componentObj, decleration)
              ]),
              t.exportDefaultDeclaration(this.componentObj)
            ])
          }
        }
      });

      scope.crawl();

      if (!this.componentObj) return;

      const componentBinding = scope.getBinding(this.componentObj.name);
      if (!componentBinding) return;
      if (!componentBinding.path || !componentBinding.path.node) throw Error("Internal Error");
      if (
        !t.isVariableDeclarator(componentBinding.path.node) ||
        !t.isObjectExpression(componentBinding.path.node.init)
      ) return;

      let renderPath = componentBinding.path.get("init").get("properties").findLast(p => {
        const node = p.node;

        if (t.isSpreadElement(node)) return false;
        if (!t.isIdentifier(node.key)) return false;

        return node.key.name === 'render'
      })

      if (!renderPath) return;

      let renderFn = renderPath.node;

      if (!renderFn) return;

      if (t.isObjectMethod(renderFn) && renderFn.kind === "method") {
        renderFn = renderFn;
      } else if (t.isObjectProperty(renderFn) && (t.isArrowFunctionExpression(renderFn.value) || t.isFunctionExpression(renderFn.value))) {
        renderFn = renderFn.value;
      } else {
        renderFn = null;
      }

      if (renderFn === null) {
        console.warn("Warning: Render was not a method. Treating file as non-component.")
        return;
      }

      if (renderFn.params.length < 3) {
        for (var i = renderFn.params.length; i < 3; i++) {
          const skipParam = scope.generateUidIdentifier("unused");

          renderFn.params.push(skipParam);
        }
      }

      if (renderFn.params.length < 4) {
        this.functionCount = 0;
        this.functionCache = scope.generateUidIdentifier("fnCache");
        renderFn.params.push(this.functionCache);
      } else {
        console.warn("Function Cache has been declared inside of Component, skipping automatic caching.")
      }

      this.renderDef = renderPath.node;
      this.renderFn = renderFn;

      returnState.isComponent = true;
      returnState.componentObj = this.componentObj.name;

      // We calculate the AST Hash before transforming JSX, because the JSX elements may hoist properties, etc. which changes the AST even tho it's just related to render.
      returnState.astHash = hashAst(
        state.ast.program,
        this.renderDef
      );
    },

    visitor: {
      JSXElement: transformJSXElement,
      JSXFragment: transformJSXFragment
    }
  }
}
