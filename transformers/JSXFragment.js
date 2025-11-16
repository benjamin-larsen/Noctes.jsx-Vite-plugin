import t from '@babel/types';

export default function transformJSXFragment(path, state) {
  const isRender = path.scope.block === state.renderFn;
  //console.dir(node.getFunctionParent().node, {depth:0})

  path.replaceWith(t.arrayExpression([]))
}
