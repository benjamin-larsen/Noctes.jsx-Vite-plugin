import t from '@babel/types';
import { warn } from './error.js';
import { decodeCommentOverrides } from './ast.js';
import traverseLib from "@babel/traverse";
const { default: traverse } = traverseLib;

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

  const commentCommands = decodeCommentOverrides(fn.node);
  const hasOverride = commentCommands.includes("@cache") || commentCommands.includes("@no-cache");

  if (hasOverride) return commentCommands.includes("@cache") ? true : false;

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

export function shouldTransformSlot({
  node,
  path,
  name
}, state) {
  if (!state.functionCache) return false;

  const ctxParam = state.renderPath.get("params.0");
  let shouldTransform = true;

  const local_sym = Symbol("local");

  traverse(node, {
    Identifier: {
      enter(path) {
        if (!path.isBindingIdentifier()) return;

        path.scope.registerBinding("unknown", path, local_sym);
      },

      exit(path) {
        if (!path.parentPath || !path.scope || !path.isReferencedIdentifier()) return;

        const binding = path.scope.getBinding(path.node.name);
        if (!binding || binding.path === local_sym) return;

        if (binding.path === ctxParam) return;

        const bindingParent = binding.path.find((path) => path == state.renderPath);

        if (bindingParent) {
          shouldTransform = false;
          path.stop();

          warn({
            loc: path.node.loc,
            file: state.file,
            warnLabel: "PerfWarning",
            message: `${name} referenced variable declared in render(), slot is not able to be cached. This will incur a performance penalty.`
          })
        }
      }
    }
  }, path.scope, state, path);

  return shouldTransform;
}
