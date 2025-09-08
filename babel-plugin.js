// Find better way to do this
const standardComponents = new Set([
    "Lazy"
])

export default function ({ types: t }, returnState = {}) {

    // Perhaps push quasis as string in future
    function transformJSXChildren(children, state) {
        const newChildren = [];
        let builder = null;

        function commitTemplate() {
            if (builder !== null) {
                if (builder.quasis.length <= builder.expressions.length) {
                    builder.quasis.push(
                        t.templateElement({ raw: "" })
                    )
                }

                // Trim Start
                const firstQuasis = builder.quasis[0].value
                firstQuasis.raw = firstQuasis.raw.replace(/^\s+/, "")

                // Trim End
                const lastQuasis = builder.quasis[builder.quasis.length - 1].value
                lastQuasis.raw = lastQuasis.raw.replace(/\s+$/, "")

                if (builder.expressions.length === 0 && builder.quasis.map(x=>x.value.raw).join("") === '') {
                    // exclude empty strings
                } else {
                    newChildren.push(t.callExpression(state.createTextNode, [
                        t.templateLiteral(builder.quasis, builder.expressions)
                    ]))
                }
                builder = null
            }
        }

        for (const child of children) {
            if (t.isJSXText(child)) {
                if (builder === null) {
                    builder = {
                        quasis: [],
                        expressions: []
                    }
                }

                builder.quasis.push(
                    t.templateElement({ raw: child.value.replace(/\\/g, "\\\\").replace(/`/g, "\\`") })
                )
            } else if (t.isJSXExpressionContainer(child)) {
                if (builder === null) {
                    builder = {
                        quasis: [
                            t.templateElement({ raw: "" })
                        ],
                        expressions: []
                    }
                }

                builder.expressions.push(child.expression)
            } else {
                commitTemplate()

                newChildren.push(child)
            }
        }

        commitTemplate()

        return newChildren
    }

    return {
        visitor: {
            JSXElement(path) {
                const typeName = path.node.openingElement.name.name;
                const isComponent = /^[A-Z]/.test(typeName)

                if (isComponent) {
                    path.replaceWith(
                        t.callExpression(this.createComponent, [
                            standardComponents.has(typeName) ? t.stringLiteral(typeName) : t.identifier(typeName),
                            t.objectExpression([])
                        ])
                    )
                } else {
                    path.replaceWith(
                        t.callExpression(this.createElement, [
                            t.stringLiteral(typeName),
                            t.objectExpression([]),
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
            this.createTextNode = state.scope.generateUidIdentifier("createTextNode")
            this.createElement = state.scope.generateUidIdentifier("createElement")
            this.createComponent = state.scope.generateUidIdentifier("createComponent")
            this.componentObj = state.scope.generateUidIdentifier("componentObj")

            state.path.unshiftContainer('body', t.importDeclaration(
                [
                    t.importSpecifier(this.createTextNode, t.identifier("createTextNode")),
                    t.importSpecifier(this.createElement, t.identifier("createElement")),
                    t.importSpecifier(this.createComponent, t.identifier("createComponent"))
                ],
                t.stringLiteral("webframework")
            ))
        },
        post() {
            returnState.componentObj = this.componentObj.name;
        }
    }
}