// Find better way to do this
const standardComponents = new Set([
  "Lazy"
])

const escapeMap = {
  "\\": "\\\\",
  "\r": "\\r",
  "\n": "\\n",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
  "\0": "\\0",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029"
}

function escapeUnicodeHex(code) {
  return `\\u${code.toString(16).toUpperCase()}`
}

export default function ({ types: t }, returnState = {}) {

  function sanatizeTemplateString(templateString, qoute = '`') {
    // Regex and Code from jsesc

    return t.templateElement({
      raw: templateString.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|([\uD800-\uDFFF])|[^]/g, (char, pair, lone, index, str) => {
        if (pair) {
          return escapeUnicodeHex(char.charCodeAt(0)) + escapeUnicodeHex(char.charCodeAt(1))
        }

        if (lone) {
          return escapeUnicodeHex(char.charCodeAt(0))
        }

        if (char === qoute) {
          return "\\" + qoute
        }

        if (escapeMap[char]) return escapeMap[char]

        return char
      })
    })
  }

  function transformJSXChildren(children, state) {
    const newChildren = [];
    let builder = null;

    function commitTemplate() {
      if (builder === null) return;

      if (builder.quasis.length <= builder.expressions.length) {
        builder.quasis.push("")
      }

      // Trim Start
      builder.quasis[0] = builder.quasis[0].replace(/^\s+/, "")

      // Trim End
      builder.quasis[builder.quasis.length - 1] = builder.quasis[builder.quasis.length - 1].replace(/\s+$/, "")

      if (builder.expressions.length === 0 && builder.quasis.join("") === '') {
        // exclude empty strings
      } else if (builder.expressions.length > 0) {
        newChildren.push(t.templateLiteral(builder.quasis.map(str => sanatizeTemplateString(str, '`')), builder.expressions))
      } else {
        newChildren.push(t.stringLiteral(builder.quasis.join("")))
      }

      builder = null
    }

    function ensureBuilder() {
      if (builder === null) {
        builder = {
          quasis: [],
          expressions: [],
          lastType: null
        }
      }
    }

    function isStringTemplate() {
      if (builder === null) return false;
      if (builder.lastType !== "string") return false;
      if (builder.quasis[builder.quasis.length - 1].slice(-1) === "$") {
        builder.quasis[builder.quasis.length - 1] = builder.quasis[builder.quasis.length - 1].slice(0, -1)
        return true;
      }

      return false;
    }

    for (const child of children) {
      if (t.isJSXText(child)) {
        ensureBuilder()

        if (builder.lastType === 'string') {
          // Must never have two sequential strings, only between expressions.
          builder.quasis[builder.quasis.length - 1] += child.value
        } else {
          builder.lastType = "string"
          builder.quasis.push(
            child.value
          )
        }
      } else if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;

        if (!isStringTemplate()) {
          commitTemplate()
          newChildren.push(child.expression)

          continue;
        }

        ensureBuilder()

        // Must always have a quasis between every expression.
        if (builder.lastType !== 'string') {
          builder.quasis.push("")
        }

        builder.lastType = "expression"
        builder.expressions.push(child.expression)
      } else {
        commitTemplate()

        if (t.isJSXSpreadChild(child)) {
          newChildren.push(
            t.spreadElement(child.expression)
          )
        } else {
          newChildren.push(child)
        }
      }
    }

    commitTemplate()

    return newChildren
  }

  return {
    visitor: {
      JSXElement(path) {
        const propExpression = []

        let componentExpression = null;
        let typeName = path.node.openingElement.name;

        if (t.isJSXNamespacedName(typeName)) {
          typeName = typeName.name.name
          console.warn("Namespaces not supported yet.")
        } else if (t.isJSXMemberExpression(typeName)) {
          throw Error("Member Expressions not supportyed yet.")
        } else {
          typeName = typeName.name
        }

        const isComponent = /^[A-Z]/.test(typeName)

        for (const attr of path.node.openingElement.attributes) {
          if (t.isJSXSpreadAttribute(attr)) {
            propExpression.push(
              t.spreadElement(attr.argument)
            )
          } else if (t.isJSXAttribute(attr)) {
            let attrName = attr.name;

            if (t.isJSXNamespacedName(attrName)) {
              attrName = attrName.name.name
              console.warn("Namespaces not supported yet.")
            } else {
              attrName = attrName.name
            }

            if (typeName === "component" && attrName === "is" && attr.value !== null) {
              componentExpression = t.isJSXExpressionContainer(attr.value) ? attr.value.expression : t.stringLiteral(attr.value.value)
              continue;
            }

            if (attrName === 'className') attrName = 'class'

            propExpression.push(
              t.objectProperty(
                t.stringLiteral(attrName),
                t.isJSXExpressionContainer(attr.value) ? attr.value.expression : attr.value !== null ? t.stringLiteral(attr.value.value) : t.booleanLiteral(true)
              )
            )
          }
        }

        if (isComponent) {
          path.replaceWith(
            t.callExpression(this.createComponent, [
              standardComponents.has(typeName) ? t.stringLiteral(typeName) : t.identifier(typeName),
              t.objectExpression(propExpression)
            ])
          )
        } else if (typeName === "component") {
          if (!componentExpression) throw Error("You must specify 'is' property on Dynamic Components.")

          path.replaceWith(
            t.callExpression(this.createComponent, [
              componentExpression,
              t.objectExpression(propExpression)
            ])
          )
        } else {
          path.replaceWith(
            t.callExpression(this.createElement, [
              t.stringLiteral(typeName),
              t.objectExpression(propExpression),
              ...transformJSXChildren(path.node.children, this)
            ])
          )
        }
      },

      JSXFragment(path) {
        path.replaceWith(
          t.arrayExpression(transformJSXChildren(path.node.children, this))
        )
      },

      ExportDefaultDeclaration(path) {
        if (!t.isObjectExpression(path.node.declaration)) {
          if (t.isIdentifier(path.node.declaration)) {
            this.componentObj = path.node.declaration
          }
          return;
        }

        path.replaceWithMultiple([
          t.variableDeclaration("const", [
            t.variableDeclarator(this.componentObj, path.node.declaration)
          ]),
          t.exportDefaultDeclaration(this.componentObj)
        ])
      }
    },

    pre(state) {
      this.createElement = state.scope.generateUidIdentifier("createElement")
      this.createComponent = state.scope.generateUidIdentifier("createComponent")
      this.componentObj = state.scope.generateUidIdentifier("componentObj")

      state.path.unshiftContainer('body', t.importDeclaration(
        [
          t.importSpecifier(this.createElement, t.identifier("createElement")),
          t.importSpecifier(this.createComponent, t.identifier("createComponent"))
        ],
        t.stringLiteral("noctes.jsx")
      ))
    },

    post() {
      returnState.componentObj = this.componentObj.name;
    }
  }
}