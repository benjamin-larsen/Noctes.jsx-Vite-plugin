import t from '@babel/types';

export default function transformJSXElement(path, state) {
  const isRender = path.scope.block === state.renderFn;
  //console.dir(node.getFunctionParent().node, {depth:0})

  path.replaceWith(t.callExpression(state.createElement, [
    t.stringLiteral("test"),
    t.nullLiteral()
  ]))
}
