import { createHash } from "node:crypto"
import t from '@babel/types';

export function hoistNode(node, value) {
  node._blockHoist = value;
  return node;
}

const commonExclude = [
  'start',
  'end',
  'loc',
  'leadingComments',
  'trailingComments',
  'innerComments'
];

export function astToJSON(ast, excludeNode) {
  return JSON.stringify(ast, (key, value) => {
    if (excludeNode && value === excludeNode) {
      return undefined;
    }

    if (commonExclude.includes(key)) return undefined;

    return value;
  });
} 

export function hashAst(ast, excludeNode) {
  return createHash('sha256').update(astToJSON(ast, excludeNode)).digest("hex")
}

export function isLiteral(node) {
  if (t.isTemplateLiteral(node)) {
    return node.expressions.length === 0
  }
  return t.isLiteral(node)
}
