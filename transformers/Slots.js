import t from '@babel/types';
import parser from '@babel/parser'
import { findAttribute } from './JSXAttribute.js';
import { transformJSXChildren } from './JSXChildren.js';
import { throwError, TransformError } from '../helpers/error.js';
import { shouldTransformSlot, transformFunction } from '../helpers/functionCache.js';

function parseParams(paramString, file, loc) {
  try {
    const result = parser.parseExpression(`(${paramString})=>{}`);

    return result.params;
  } catch (e) {
    if (e.loc) {
      throwError({
        loc,
        offset: e.loc,
        message: e.message,
        file,
        errType: SyntaxError
      });
    }
  }
}

function getDirectDefault(children) {
  let shouldReturn = false;
  let returnChildren = []

  for (const child of children) {
    if (t.isJSXText(child)) {
      returnChildren.push(child)
      if (!/^\s*$/g.test(child.value)) shouldReturn = true;
    }

    if (t.isJSXElement(child)) {
      const typeName = child.openingElement.name;

      if (t.isJSXNamespacedName(typeName)) {
        if (typeName.namespace.name !== "slot") {
          returnChildren.push(child)
          shouldReturn = true;
        }
      } else if (typeName.name !== "slot") {
        returnChildren.push(child)
        shouldReturn = true;
      }
    }

    if (t.isJSXFragment(child)) {
      returnChildren.push(child)
      shouldReturn = true;
    }
    if (t.isJSXSpreadChild(child)) {
      returnChildren.push(child)
      shouldReturn = true;
    }
    if (t.isJSXExpressionContainer(child)) {
      returnChildren.push(child)
      shouldReturn = true;
    }
  }

  return shouldReturn ? returnChildren : null;
}

function createSlotFunction(slot, path, state, hasCache) {
  const node = t.functionExpression(
    null,
    slot.attrParams,
    t.blockStatement(
      [
        t.returnStatement(slot.block)
      ]
    )
  );

  const withCtx = t.callExpression(
    state.withContext,
    [ node ]
  );

  return (hasCache && shouldTransformSlot({
    node,
    path,
    name: slot.isDynamic ? "Dynamic Slot" : 'Slot "' + slot.name.value + '"'
  }, state)) ? transformFunction(withCtx, state) : withCtx;
}

export function transformSlots({
  children,
  nSlot,
  path,
  hasCache
}, state) {
  const slotsExpression = []
  const dupSet = new Set()

  let directDefault = getDirectDefault(children);
  let directDefaultParams = [];

  if (nSlot) {
    if (!t.isStringLiteral(nSlot.value)) throwError({
      loc: nSlot.value ? t.isJSXExpressionContainer(nSlot.value) ? nSlot.value.expression.loc : nSlot.value.loc : {
        start: {
          line: nSlot.loc.end.line,
          column: nSlot.loc.end.column - 1
        }
      },
      displayColumnOffset: nSlot.value ? 0 : 1,
      file: state.file,
      message: "nSlot must be a string of Function Paramaters (same syntax as JS Functions).",
      errType: TypeError
    });

    directDefaultParams = parseParams(nSlot.value.value, state.file, nSlot.value.loc);
  }

  for (const child of children) {
    if (!t.isJSXElement(child)) continue;

    const attributes = child.openingElement.attributes;
    const attrName = findAttribute(attributes, "name");
    let attrParams = findAttribute(attributes, "params");

    let typeName = child.openingElement.name;
    let slotName = "default";
    let isDynamic = false;

    if (t.isJSXNamespacedName(typeName)) {
      slotName = typeName.name.name
      typeName = typeName.namespace.name

      if (typeName !== "slot") continue;

      if (attrName) throwError({
        loc: attrName.loc,
        file: state.file,
        message: "Can't have both name attribute and namespace on <slot>.",
        errType: TypeError
      });
    } else {
      typeName = typeName.name;

      if (typeName !== "slot") continue;

      if (attrName) {
        if (t.isJSXExpressionContainer(attrName.value)) {
          slotName = attrName.value.expression
          isDynamic = true
        } else if (t.isStringLiteral(attrName.value)) {
          slotName = attrName.value.value;
        } else {
          throwError({
            loc: attrName.value ? attrName.value.loc : {
              start: {
                line: attrName.loc.end.line,
                column: attrName.loc.end.column - 1
              }
            },
            displayColumnOffset: attrName.value ? 0 : 1,
            file: state.file,
            message: "You must specify slot name as either Expression or String.",
            errType: TypeError
          });
        }
      }
    }

    if (attrParams) {
      const attrValue = attrParams.value;
      if (!t.isStringLiteral(attrValue)) throwError({
        loc: attrValue ? t.isJSXExpressionContainer(attrValue) ? attrValue.expression.loc : attrValue.loc : {
          start: {
            line: attrParams.loc.end.line,
            column: attrParams.loc.end.column - 1
          }
        },
        displayColumnOffset: attrValue ? 0 : 1,
        file: state.file,
        message: "Slot 'params' must be a string of Function Paramaters (same syntax as JS Functions).",
        errType: TypeError
      });

      attrParams = parseParams(attrValue.value, state.file, attrValue.loc);
    }

    if (!isDynamic) {
      if (dupSet.has(slotName)) throwError({
        loc: child.openingElement.loc,
        file: state.file,
        message: `Slot "${slotName}" already exists.`,
        errType: TransformError
      });
      dupSet.add(slotName);

      if (slotName === 'default' && directDefault) throwError({
        loc: child.openingElement.loc,
        file: state.file,
        message: "Can't have explicit default slot combined with implicit default slot.",
        errType: TransformError
      });

      slotName = t.stringLiteral(slotName);
    }

    if (child.children.length === 0) throwError({
      loc: {
        start: {
          line: child.openingElement.loc.end.line,
          column: child.openingElement.loc.end.column - 1
        }
      },
      displayColumnOffset: 1,
      file: state.file,
      message: `${isDynamic ? "Dynamic Slot" : 'Slot "' + slotName.value + '"'} is empty.`,
      errType: TransformError
    });

    const childrenTransformed = transformJSXChildren(child.children)

    slotsExpression.push({
      name: slotName,
      isDynamic,
      block: childrenTransformed.length > 1 ? t.arrayExpression(childrenTransformed) : childrenTransformed[0],
      attrParams: attrParams || []
    })
  }

  if (directDefault) {
    const childrenTransformed = transformJSXChildren(directDefault)

    slotsExpression.push({
      name: t.stringLiteral("default"),
      isDynamic: false,
      block: childrenTransformed.length > 1 ? t.arrayExpression(childrenTransformed) : childrenTransformed[0],
      attrParams: directDefaultParams
    })
  }

  const objectProps = slotsExpression.map(
    (slot) => t.objectProperty(
      slot.name,
      createSlotFunction(slot, path, state, hasCache),
      slot.isDynamic
    )
  )

  return objectProps.length > 0 ? t.objectExpression(objectProps) : t.nullLiteral()
}