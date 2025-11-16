import { createHash } from "node:crypto"

const commonExclude = [
  'start',
  'end',
  'loc',
  'leadingComments',
  'trailingComments',
  'innerComments'
];

export function astToJSON(ast, excludeNode) {
  const json =JSON.stringify(ast, (key, value) => {
    if (excludeNode && value === excludeNode) {
      return undefined;
    }

    if (commonExclude.includes(key)) return undefined;

    return value;
  });

  console.log(json)
  return json;
} 

export function hashAst(ast, excludeNode) {
  return createHash('sha256').update(astToJSON(ast, excludeNode)).digest("hex")
}
