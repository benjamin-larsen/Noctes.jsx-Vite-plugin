import transformJSXElement from './transformers/JSXElement.js';
import transformJSXFragment from './transformers/JSXFragment.js';
import { hashAst, hoistNode } from './helpers/ast.js';

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

      rootPath.unshiftContainer('body', hoistNode(t.importDeclaration(
        [
          t.importSpecifier(this.createElement, t.identifier("createElement")),
          t.importSpecifier(this.createComponent, t.identifier("createComponent")),
          t.importSpecifier(this.withDirectives, t.identifier("withDirectives")),
          t.importSpecifier(this.withContext, t.identifier("withContext"))
        ],
        t.stringLiteral("noctes.jsx")
      ), 3))

      this.srcMap = new Map();

      const exportDefault = rootPath.get("body").find(p => {
        return p.isExportDefaultDeclaration()
      });

      if (!exportDefault) return;

      hoistNode(exportDefault.node, -1);

      const exportDecleration = exportDefault.get("declaration");
      let componentBinding;

      if (exportDecleration.isIdentifier()) {
        this.componentObj = exportDecleration.node;
        (componentBinding = scope.getBinding(exportDecleration.node.name)) && (componentBinding = componentBinding.path.get("init"));
      } else if (exportDecleration.isObjectExpression()) {
        this.componentObj = scope.generateUidIdentifier("componentObj");

        exportDefault.node.declaration = this.componentObj;

        scope.push({
          kind: "const",
          id: this.componentObj,
          init: exportDecleration.node,
          _blockHoist: 0
        })

        componentBinding = exportDecleration;
      }

      if (!componentBinding) return;
      if (!componentBinding.node) throw Error("Internal Error");
      if (
        !t.isObjectExpression(componentBinding.node)
      ) return;

      let renderPath = componentBinding.get("properties").findLast(p => {
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
        this.renderPath = renderPath;
      } else if (t.isObjectProperty(renderFn) && (t.isArrowFunctionExpression(renderFn.value) || t.isFunctionExpression(renderFn.value))) {
        renderFn = renderFn.value;
        this.renderPath = renderPath.get("value");
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

      const renderDef = renderPath.node;
      this.renderFn = renderFn;

      returnState.isComponent = true;
      returnState.componentObj = this.componentObj.name;

      scope.crawl();

      // We calculate the AST Hash before transforming JSX, because the JSX elements may hoist properties, etc. which changes the AST even tho it's just related to render.
      returnState.astHash = hashAst(
        state.ast.program,
        renderDef
      );
    },

    visitor: {
      JSXElement: transformJSXElement,
      JSXFragment: transformJSXFragment
    }
  }
}
