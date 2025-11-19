import t from '@babel/types';

export function findAttribute(attributes, name) {
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

export function transformJSXAttributeValue(value, defaultTrue = false) {
  if (value === null) return defaultTrue ? t.booleanLiteral(true) : t.nullLiteral();
  if (t.isJSXExpressionContainer(value)) return value.expression;

  return value;
}