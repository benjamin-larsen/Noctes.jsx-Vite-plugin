import t from '@babel/types';
import { warn } from './error.js';

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
  eventName
}, state) {
  if (!state.functionCache) return false;

  const body = fn.get("body");
  const ctxParam = state.renderPath.get("params.0");

  let shouldTransform = true;

  body.traverse({
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;

      const binding = path.scope.getBinding(path.node.name);
      if (!binding) return;

      // Exception: ctx (first paramater)
      if (binding.path === ctxParam) return;

      const bindingParent = binding.path.find((path) => path == fn || path == state.renderPath);

      if (bindingParent == state.renderPath) {
        shouldTransform = false;
        path.stop();

        warn({
          loc: path.node.loc,
          file: state.file,
          warnLabel: "PerfWarning",
          message: `Event Listener "${eventName}" referenced variable declared in render(), function is not able to be cached. This will incur a performance penalty.`
        })
      }
    }
  })

  return shouldTransform;
}
