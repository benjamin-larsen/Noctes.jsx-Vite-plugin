import t from '@babel/types';
import { transformJSXChildren } from './JSXChildren.js';
import { elementTypes, srcResolveTags, srcsetResolveTags } from '../constants.js';
import { hoistNode, isLiteral } from '../helpers/ast.js';
import { transformJSXAttributeValue } from './JSXAttribute.js';
import { sanatizeTemplateString } from '../helpers/templateString.js';
import { transformFunction, shouldTransformFunction } from '../helpers/functionCache.js';
import { resolveReactAlias } from '../react-alias.js';
import { transformSlots } from './Slots.js';

function resolveElementType(tag) {
  if (tag === "component") return elementTypes.dynamicComponent;

  return /^[A-Z]/.test(tag) ? elementTypes.component : elementTypes.element;
}

function resolveMemberExpression(expr) {
  const { object, property } = expr;

  return t.memberExpression(
    t.isJSXMemberExpression(object) ? resolveMemberExpression(object) : t.identifier(object.name),
    t.identifier(property.name)
  )
}

function resolveTagName(tagName, state) {
  if (t.isJSXNamespacedName(tagName)) {
    return {
      name: `${tagName.namespace.name}:${tagName.name.name}`,
      type: elementTypes.element
    }
  } else if (t.isJSXMemberExpression(tagName)) {
    return {
      name: resolveMemberExpression(tagName),
      type: elementTypes.component
    }
  }

  const type = resolveElementType(tagName.name);

  if (type === elementTypes.component && tagName.name === "Recursive") {
    if (!state.componentObj || !state.renderPath) throw Error("<Recursive> can only be used in Component Files.");

    return {
      name: state.componentObj,
      type: elementTypes.component
    }
  }

  return {
    name: type === elementTypes.component ? t.identifier(tagName.name) : tagName.name,
    type
  };
}

function hoistProperties(props, state) {
  const id = state.file.path.scope.generateUidIdentifier("hoisted");

  state.file.path.unshiftContainer(
    'body',
    hoistNode(t.variableDeclaration("const", [
      t.variableDeclarator(
        id,
        t.objectExpression(props)
      )
    ]), 1)
  )

  return id;
}

// From Vite
const externalRE = /^([a-z]+:)?\/\//
const isExternalUrl = (url) => externalRE.test(url)

const dataUrlRE = /^\s*data:/i
const isDataUrl = (url) => dataUrlRE.test(url)

function _resolveSrc(rawUrl, state) {
  let [, url = "", extra = ""] = rawUrl.match(/^([^#?]*)(#.*|\?.*)?$/)

  if (!url || isDataUrl(rawUrl) || isExternalUrl(rawUrl)) return [rawUrl];


  if (state.srcMap.has(url)) {
    const id = state.srcMap.get(url);

    return extra ? [id, extra] : [id]
  } else {
    const id = state.file.path.scope.generateUidIdentifier("imported");
    state.srcMap.set(url, id);

    state.file.path.unshiftContainer('body', hoistNode(t.importDeclaration(
      [
        t.importDefaultSpecifier(id)
      ],
      t.stringLiteral(url + "?url")
    ), 2))

    return extra ? [id, extra] : [id]
  }
}

function resolveSrc(rawUrl, state) {
  const resolved = _resolveSrc(rawUrl, state);

  if (resolved.length === 1) {
    return typeof resolved[0] === 'string' ? t.stringLiteral(resolved[0]) : resolved[0]
  } else if (resolved.length === 2) {
    return t.templateLiteral(
      [
        t.templateElement({ raw: "" }),
        sanatizeTemplateString(resolved[1])
      ],
      [
        resolved[0]
      ]
    )
  }
}

function resolveSrcset(rawSet, state) {
  const set = rawSet.split(",").map(candidate => {
    const [url, ...descriptors] = candidate.trim().split(" ")

    return {
      url,
      descriptor: descriptors.join(" ")
    }
  })

  let quasis = [];
  let expressions = [];
  let lastType = null;

  for (let index = 0; index < set.length; index++) {
    const candidate = set[index];
    const isLast = index === (set.length - 1);
    const resolved = _resolveSrc(candidate.url, state);

    if (resolved.length === 1) {
      if (typeof resolved[0] === 'string') {
        if (lastType === 'string') {
          quasis[quasis.length - 1] += resolved[0]
        } else {
          quasis.push(resolved[0])
          lastType = 'string'
        }
      } else {
        if (lastType !== 'string') {
          quasis.push("")
        }

        lastType = 'expression'
        expressions.push(resolved[0])
      }
    } else if (resolved.length === 2) {
      if (lastType !== 'string') {
        quasis.push("")
      }

      expressions.push(resolved[0])
      quasis.push(resolved[1])

      lastType = 'string'
    }

    // Add descriptor
    if (lastType === 'string') {
      quasis[quasis.length - 1] += (" " + candidate.descriptor)
    } else {
      quasis.push(" " + candidate.descriptor)
      lastType = 'string'
    }

    // Add comma seperator
    if (!isLast) {
      if (lastType === 'string') {
        quasis[quasis.length - 1] += ","
      } else {
        quasis.push(",")
        lastType = 'string'
      }
    }
  }

  if (lastType !== 'string') {
    quasis.push("")
  }

  return t.templateLiteral(quasis.map(str => sanatizeTemplateString(str)), expressions);
}

function isEvent(propName) {
  if (propName.length < 3) return false;
  if (propName[0] !== 'o') return false;
  if (propName[1] !== 'n') return false;
  if (propName.charCodeAt(2) < 65) return false;
  if (propName.charCodeAt(2) > 90) return false;

  return true;
}

function transformProperties({
  name: elName,
  attributes,
  type,
  hasCache
}, state) {
  const isElement = type === elementTypes.element;

  let directives = [];
  let props = [];
  let isStatic = true;

  const srcsetTag = isElement && srcsetResolveTags[elName] || undefined;
  const srcTag = isElement && srcResolveTags[elName] || [];
  let componentExpression = null;

  for (const attr of attributes) {
    const { node: attrNode } = attr;

    if (attr.isJSXSpreadAttribute()) {
      isStatic = false;
      props.push(
        t.spreadElement(attrNode.argument)
      )
      continue;
    }

    if (!attr.isJSXAttribute()) continue;

    const { name: _attrName, value: _attrValue } = attrNode;
    let attrName;

    if (t.isJSXNamespacedName(_attrName)) {
      attrName = `${_attrName.namespace.name}:${_attrName.name.name}`;
    } else {
      attrName = resolveReactAlias(_attrName.name);

      if (isElement && /^n[A-Z]/.test(attrName)) {
        directives.push(t.objectExpression([
          t.objectProperty(
            t.identifier("dir"),
            t.identifier(attrName)
          ),
          t.objectProperty(
            t.identifier("value"),
            transformJSXAttributeValue(_attrValue, false)
          )
        ]))

        continue;
      }
    }

    if (type === elementTypes.dynamicComponent && attrName === "is" && _attrValue !== null) {
      componentExpression = transformJSXAttributeValue(_attrValue, false);
      continue;
    }

    if (t.isJSXExpressionContainer(_attrValue) && !isLiteral(_attrValue.expression)) {
      isStatic = false;
    }

    let attrValue;

    if (isEvent(attrName)) {
      if (_attrValue === null || !t.isJSXExpressionContainer(_attrValue)) throw Error("Invalid Event Listener: expected Function or Identifier.");

      const isFunction = t.isFunctionExpression(_attrValue.expression) || t.isArrowFunctionExpression(_attrValue.expression);
      const isIdentifier = t.isIdentifier(_attrValue.expression) || t.isMemberExpression(_attrValue.expression) || t.isOptionalMemberExpression(_attrValue.expression);

      if (isFunction) {
        attrValue = (hasCache && shouldTransformFunction({
          fn: attr.get("value.expression"),
          eventName: attrName
        }, state)) ? transformFunction(_attrValue.expression, state) : _attrValue.expression;
      } else if (isIdentifier) {
        attrValue = _attrValue.expression;
      } else {
        throw Error("Invalid Event Listener: expected Function.")
      }
    } else if (t.isStringLiteral(_attrValue)) {
      if (srcsetTag === attrName.toLowerCase()) {
        attrValue = resolveSrcset(_attrValue.value, state)
      } else if (srcTag.includes(attrName.toLowerCase())) {
        attrValue = resolveSrc(_attrValue.value, state)
      } else {
        attrValue = _attrValue;
      }
    } else {
      attrValue = transformJSXAttributeValue(_attrValue, true);
    }

    props.push(
      t.objectProperty(
        t.stringLiteral(attrName),
        attrValue
      )
    )
  }

  return {
    props: props.length == 0 ? t.nullLiteral() : isStatic ? hoistProperties(props, state) : t.objectExpression(props),
    directives,
    componentExpression
  }
}

function transformComponent({
  path,
  hasCache,
  name,
  type
}, state) {
  const { node } = path;
  const { props, componentExpression } = transformProperties({
    name,
    attributes: path.get("openingElement.attributes"),
    type,
    hasCache
  }, state);

  if (type === elementTypes.dynamicComponent && !componentExpression) throw Error("You must specify 'is' property on Dynamic Components.")

  path.replaceWith(t.callExpression(state.createComponent, [
    type === elementTypes.dynamicComponent ? componentExpression : name,
    props,
    transformSlots()
  ]));
}

function transformElement({
  path,
  hasCache,
  name
}, state) {
  const { node } = path;
  const { props, directives } = transformProperties({
    name,
    attributes: path.get("openingElement.attributes"),
    type: elementTypes.element,
    hasCache
  }, state);

  const el = t.callExpression(state.createElement, [
    t.stringLiteral(name),
    props,
    ...transformJSXChildren(node.children)
  ]);

  path.replaceWith(
    directives.length > 0 ?
      t.callExpression(state.withDirectives, [
        el,
        t.arrayExpression(directives)
      ]) : el
  )
}

export default function transformJSXElement(path, state) {
  const hasCache = state.functionCache && path.scope.hasBinding(state.functionCache.name);

  const {
    name,
    type
  } = resolveTagName(path.node.openingElement.name, state);

  if (type === elementTypes.element) {
    transformElement({
      path,
      hasCache,
      name
    }, state)
  } else {
    transformComponent({
      path,
      hasCache,
      name,
      type
    }, state)
  }
}
