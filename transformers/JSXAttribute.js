import t from '@babel/types';

export function transformJSXAttributeValue(value, defaultTrue = false) {
  if (value === null) return defaultTrue ? t.booleanLiteral(true) : t.nullLiteral();
  if (t.isJSXExpressionContainer(value)) return value.expression;

  return value;
}