import standardComponents from 'noctes.jsx/framework/standardComponents/index.js'
import { decodeHTML } from 'entities'
import parser from '@babel/parser'

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

function isEvent(propName) {
  if (propName.length < 3) return false;
  if (propName[0] !== 'o') return false;
  if (propName[1] !== 'n') return false;
  if (propName.charCodeAt(2) < 65) return false;
  if (propName.charCodeAt(2) > 90) return false;

  return true;
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
  
  function isLiteral(node) {
    if (t.isTemplateLiteral(node)) {
      return node.expressions.length === 0
    }
    return t.isLiteral(node)
  }

  function transformJSXChildren(children) {
    const newChildren = [];
    let builder = null;

    function commitTemplate(isLast) {
      if (builder === null) return;

      if (builder.quasis.length <= builder.expressions.length) {
        builder.quasis.push("")
      }

      for (const index in builder.quasis) {
        const lines = builder.quasis[index].split("\n");
        let output = [];

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          let line = lines[lineIndex].replace(/\r/g, "")

          if (lineIndex !== 0) {
            line = line.replace(/^\s+/, "")
          }

          if ((lineIndex === 0 && line !== "") || line.replace(/\s+/g, "") !== "") {
            output.push(line)
          }
        }

        builder.quasis[index] = output.join(" ").replace(/[\r\t\f\v ]+/g, " ");
      }

      // Trim End
      if (isLast) {
        builder.quasis[builder.quasis.length - 1] = builder.quasis[builder.quasis.length - 1].replace(/\s+$/, "")
      }

      // Decode HTML Entities.
      for (const index in builder.quasis) {
        const str = builder.quasis[index];

        builder.quasis[index] = decodeHTML(str)
      }

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

    for (const index in children) {
      const child = children[index]

      if (t.isJSXText(child)) {
        ensureBuilder()

        if (builder.lastType === 'string') {
          // Must never have two sequential strings, only between expressions.
          builder.quasis[builder.quasis.length - 1] += child.extra.raw
        } else {
          builder.lastType = "string"
          builder.quasis.push(
            child.extra.raw
          )
        }
      } else if (t.isJSXExpressionContainer(child)) {
        const isEmpty = t.isJSXEmptyExpression(child.expression);

        if (!isStringTemplate()) {
          commitTemplate(false)

          if (!isEmpty) {
            newChildren.push(child.expression)
          }

          continue;
        }

        if (isEmpty) continue;

        ensureBuilder()

        // Must always have a quasis between every expression.
        if (builder.lastType !== 'string') {
          builder.quasis.push("")
        }

        builder.lastType = "expression"
        builder.expressions.push(child.expression)
      } else {
        commitTemplate(false)

        if (t.isJSXSpreadChild(child)) {
          newChildren.push(
            t.spreadElement(child.expression)
          )
        } else {
          newChildren.push(child)
        }
      }
    }

    commitTemplate(true)

    return newChildren
  }
  
  function findAttribute(attributes, name) {
    for (const attr of attributes) {
      if (!t.isJSXAttribute(attr)) continue;

      let attrName = attr.name;
  
      if (t.isJSXNamespacedName(attrName)) {
        attrName = attrName.name.name
      } else {
        attrName = attrName.name
      }

      if (attrName === name) return attr;
    }
  }

  function parseParams(paramString, file, loc) {
    try {
      const result = parser.parseExpression(`(${paramString})=>{}`);

      return result.params;
    } catch (e) {
      if (e.loc) {
        const location = {
          /**
           * Offset source line by error line, subtracting 1 because first line starts at 1.
           */
          line: e.loc.line + loc.start.line - 1,
          /**
           * Offset source column by error column if error line is on the first line. Because the first line doesn't start on first column.
           * Set column to error column if not first line.
           */
          column: e.loc.line === 1 ? loc.start.column + e.loc.column : e.loc.column
        }

        const errMessage = `${e.message.replace(/\s*\(\d+:\d+\)$/, "")} (${location.line}:${location.column})`

        throw file.buildCodeFrameError({
          loc: { start: location }
        }, errMessage);
      }
    }
  }

  function transformSlots(children, self) {
    const slotsExpression = {}

    for (const child of children) {
      if (t.isJSXText(child)) {
        if (/^\s+$/g.test(child.value)) continue; // Allow to skip empty text
      }
      if (!t.isJSXElement(child)) throw Error("Can only have <slot> elements in Component.")
      
      const attributes = child.openingElement.attributes;
      const attrName = findAttribute(attributes, "name");
      let attrParams = findAttribute(attributes, "params");

      if (attrParams) {
        const attrValue = attrParams.value;
        if (t.isJSXExpressionContainer(attrValue)) throw Error("Slot Params must be a String of Params (same syntax as JS Functions).");

        attrParams = parseParams(attrValue.value, self.file, attrValue.loc);
      }

      let typeName = child.openingElement.name;
      let slotName = "default";

      if (t.isJSXNamespacedName(typeName)) {
        if (attrName)
          throw Error("Can't have both name attribute and namespace on <slot>.");

        slotName = typeName.name.name
        typeName = typeName.namespace.name
      } else {
        if (attrName) {
          if (attrName.value === null) throw Error("You must specify a Slot Name in <slot name=?>")
          if (t.isJSXExpressionContainer(attrName.value)) throw Error("Dynamic Slot Names are not supported.");

          slotName = attrName.value.value;
        }

        typeName = typeName.name
      }
      
      if (typeName !== "slot") throw Error("Can only have <slot> elements in Component.")

      if (slotsExpression[slotName]) throw Error(`Slot "${slotName}" already exists.`)

      if (child.children.length === 0) throw Error(`Slot "${slotName}" is empty.`)

      const childrenTransformed = transformJSXChildren(child.children)

      slotsExpression[slotName] = {
        block: childrenTransformed.length > 1 ? t.arrayExpression(childrenTransformed) : childrenTransformed[0],
        attrParams: attrParams || []
      }
    }

    const objectProps = Object.entries(slotsExpression).map(
      ([slotName, slot]) => t.objectProperty(
        t.stringLiteral(slotName),
        t.callExpression(
          self.withContext,
          [
            t.functionExpression(
              null,
              slot.attrParams,
              t.blockStatement(
                [
                  t.returnStatement(slot.block)
                ]
              )
            )
          ]
        )
      )
    )

    return objectProps.length > 0 ? t.objectExpression(objectProps) : t.nullLiteral()
  }

  return {
    visitor: {
      JSXElement(path, state) {
        let propExpression = []
        const directives = []
        let isStatic = true
        let hasKey = false

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
            // No way of knowing if this has key, or is static. Document this.
            isStatic = false
            propExpression.push(
              t.spreadElement(attr.argument)
            )
          } else if (t.isJSXAttribute(attr)) {
            let attrName = attr.name;
            let attrValue = attr.value;

            if (t.isJSXNamespacedName(attrName)) {
              attrName = attrName.name.name
              console.warn("Namespaces not supported yet.")
            } else {
              attrName = attrName.name
            }

            if (/^n[A-Z]/.test(attrName) && !isComponent) {
              directives.push(t.objectExpression([
                t.objectProperty(
                  t.identifier("dir"),
                  t.identifier(attrName)
                ),
                t.objectProperty(
                  t.identifier("value"),
                  t.isJSXExpressionContainer(attrValue) ? attrValue.expression : attrValue !== null ? t.stringLiteral(attrValue.value) : t.nullLiteral()
                )
              ]))
              continue;
            }

            if (typeName === "component" && attrName === "is" && attrValue !== null) {
              componentExpression = t.isJSXExpressionContainer(attrValue) ? attrValue.expression : t.stringLiteral(attrValue.value)
              continue;
            }

            if (attrName === 'className') attrName = 'class'

            if (attrName === 'key') hasKey = true

            if (isEvent(attrName)) {
              if (attrValue === null || !t.isJSXExpressionContainer(attrValue)) throw Error("Invalid Event Listener: expected Function, found String.");

              let isFunction = t.isFunctionExpression(attrValue.expression) || t.isArrowFunctionExpression(attrValue.expression);
              let isIdentifier = t.isIdentifier(attrValue.expression) || t.isMemberExpression(attrValue.expression) || t.isOptionalMemberExpression(attrValue.expression);

              function bindFunctionCall() {
                if (attrValue.expression.arguments.length > 0) {
                  isFunction = true;
                  attrValue.expression = t.callExpression(
                    t.memberExpression(attrValue.expression.callee, t.identifier("bind")),
                    [
                      t.nullLiteral(),
                      ...attrValue.expression.arguments
                    ]
                  );
                } else {
                  isIdentifier = true;
                  attrValue.expression = attrValue.expression.callee;
                }
              }

              if (t.isCallExpression(attrValue.expression)) {
                const callee = attrValue.expression.callee;
                if (t.isMemberExpression(callee)) {
                  if (t.isIdentifier(callee.property) && callee.property.name === 'apply') {
                    isFunction = true;
                    callee.property = t.identifier("bind");
                    attrValue.expression.arguments = [
                      attrValue.expression.arguments[0],
                      t.spreadElement(attrValue.expression.arguments[1])
                    ]
                  } else if (t.isIdentifier(callee.property) && callee.property.name === 'call') {
                    isFunction = true;
                    callee.property = t.identifier("bind");
                  } else if (t.isIdentifier(callee.property) && callee.property.name === 'bind') {
                    isFunction = true;
                  } else {
                    bindFunctionCall()
                  }
                } else {
                  bindFunctionCall()
                }
              }

              if (isFunction) {
                console.warn("Event Listeners should be a Reference to a Function, as inline may cause Worse Performance.")
              } else if (!isIdentifier) {
                throw Error("Invalid Event Listener: expected Function.")
              }
            }

            if (t.isJSXExpressionContainer(attrValue) && !isLiteral(attrValue.expression)) {
              isStatic = false
            }

            propExpression.push(
              t.objectProperty(
                t.stringLiteral(attrName),
                t.isJSXExpressionContainer(attrValue) ? attrValue.expression : attrValue !== null ? t.stringLiteral(attrValue.value) : t.booleanLiteral(true)
              )
            )
          }
        }

        /*if (!hasKey) {
          const symbol = t.callExpression(
            t.identifier("Symbol"),
            []
          )

          if (isStatic) {
            propExpression.push(
              t.objectProperty(
                t.stringLiteral("key"),
                symbol
              )
            )
          } else {
            const id = state.file.path.scope.generateUidIdentifier("key");

            state.file.path.unshiftContainer('body', t.variableDeclaration("const", [
              t.variableDeclarator(
                id,
                symbol
              )
            ]))

            propExpression.push(
              t.objectProperty(
                t.stringLiteral("key"),
                id
              )
            )
          }
        }*/

        if (propExpression.length === 0) {
          propExpression = t.nullLiteral()
        } else if (isStatic) {
          const id = state.file.path.scope.generateUidIdentifier("hoisted");

          state.file.path.unshiftContainer('body', t.variableDeclaration("const", [
            t.variableDeclarator(
              id,
              t.objectExpression(propExpression)
            )
          ]))

          propExpression = id
        } else {
          propExpression = t.objectExpression(propExpression)
        }

        if (isComponent) {
          path.replaceWith(
            t.callExpression(this.createComponent, [
              typeName === "Recursive" ? this.componentObj : standardComponents[typeName] ? t.stringLiteral(typeName) : t.identifier(typeName),
              propExpression,
              transformSlots(path.node.children, this)
            ])
          )
        } else if (typeName === "component") {
          if (!componentExpression) throw Error("You must specify 'is' property on Dynamic Components.")

          path.replaceWith(
            t.callExpression(this.createComponent, [
              componentExpression,
              propExpression,
              transformSlots(path.node.children, this)
            ])
          )
        } else {
          const el = t.callExpression(this.createElement, [
            t.stringLiteral(typeName),
            propExpression,
            ...transformJSXChildren(path.node.children)
          ]);

          if (directives.length > 0) {
            path.replaceWith(
              t.callExpression(this.withDirectives, [
                el,
                t.arrayExpression(directives)
              ])
            )
          } else {
            path.replaceWith(el)
          }
        }
      },

      JSXFragment(path) {
        const children = transformJSXChildren(path.node.children);

        if (children.length === 1 && t.isSpreadElement(children[0])) {
          // We expect that the Exprsesion of the Spread Element is an array therefore a Fragment.
          path.replaceWith(
            children[0].argument
          )
        } else {
          path.replaceWith(
            t.arrayExpression(children)
          )
        }
      }
    },

    pre(state) {
      this.createElement = state.scope.generateUidIdentifier("createElement")
      this.createComponent = state.scope.generateUidIdentifier("createComponent")
      this.withDirectives = state.scope.generateUidIdentifier("withDirectives")
      this.withContext = state.scope.generateUidIdentifier("withContext")
      this.componentObj = state.scope.generateUidIdentifier("componentObj")

      state.path.unshiftContainer('body', t.importDeclaration(
        [
          t.importSpecifier(this.createElement, t.identifier("createElement")),
          t.importSpecifier(this.createComponent, t.identifier("createComponent")),
          t.importSpecifier(this.withDirectives, t.identifier("withDirectives")),
          t.importSpecifier(this.withContext, t.identifier("withContext"))
        ],
        t.stringLiteral("noctes.jsx")
      ))

      const self = this;

      state.path.traverse({
        ExportDefaultDeclaration(path) {
          if (!t.isObjectExpression(path.node.declaration)) {
            if (t.isIdentifier(path.node.declaration)) {
              self.componentObj = path.node.declaration
            }
            return;
          }

          path.replaceWithMultiple([
            t.variableDeclaration("const", [
              t.variableDeclarator(self.componentObj, path.node.declaration)
            ]),
            t.exportDefaultDeclaration(self.componentObj)
          ])
        }
      })
    },

    post() {
      returnState.componentObj = this.componentObj.name;
    }
  }
}