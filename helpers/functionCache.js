import t from '@babel/types';
import { warn } from './error.js';
import { decodeCommentOverrides } from './ast.js';
import { cacheCheckpoint } from '../constants.js';

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

export function shouldTransformFunction({
  fn,
  errMsg
}, state) {
  if (!state.functionCache) return false;

  const body = fn.get("body");
  const ctxParam = state.renderPath.get("params.0");

  let shouldTransform = true;

  const commentCommands = decodeCommentOverrides(fn.node);
  const hasOverride = commentCommands.includes("@cache") || commentCommands.includes("@no-cache");

  if (hasOverride) {
    const shouldTransform = commentCommands.includes("@cache") ? true : false;

    fn[cacheCheckpoint] = false;
    return shouldTransform;
  }

  body.traverse({
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;

      const binding = path.scope.getBinding(path.node.name);
      if (!binding) return;

      // Exception: ctx (first paramater)
      if (binding.path === ctxParam) return;

      const bindingParent = binding.path.find((path) => path == fn || cacheCheckpoint in path);

      if (bindingParent && bindingParent[cacheCheckpoint] === false) {
        shouldTransform = false;
        path.stop();

        warn({
          loc: path.node.loc,
          file: state.file,
          warnLabel: "PerfWarning",
          message: errMsg
        })
      }
    }
  })

  fn[cacheCheckpoint] = false;

  return shouldTransform;
}
