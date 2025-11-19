import t from '@babel/types';
import { transformJSXChildren } from './JSXChildren.js';

export default function transformJSXFragment(path) {
  const { node } = path;

  const children = transformJSXChildren(node.children);

  if (
    children.length === 1 &&
    t.isSpreadElement(children[0])
  ) {
    path.replaceWith(children[0].argument);
    return;
  }

  path.replaceWith(
    t.arrayExpression(children)
  )
}
