import t from '@babel/types';

export function transformFunction(fn, state) {
  if (!state.functionCache) return fn;

  const id = state.functionCount++;

  const cacheEntry = t.memberExpression(
    state.functionCache,
    t.numericLiteral(id),
    true
  );

  // cache[id] || (cache[id] = fn)
  return t.logicalExpression(
    '||',
    cacheEntry,
    t.assignmentExpression(
      '=',
      cacheEntry,
      fn
    )
  )
}
