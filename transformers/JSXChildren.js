import t from '@babel/types';
import { sanatizeTemplateString } from '../helpers/templateString.js';
import { decodeHTML } from 'entities'

class TextParser {
  constructor(resultArray) {
    this.resultArray = resultArray;
    this.currentBuilder = null;
  }

  ensureBuilder() {
    if (this.currentBuilder) return;

    this.currentBuilder = {
      quasis: [],
      expressions: [],
      lastType: null
    }
  }

  parseText(text) {
    this.ensureBuilder();

    const { currentBuilder } = this;
    const { quasis } = currentBuilder;

    if (currentBuilder.lastType === 'string') {
      quasis[quasis.length - 1] += text;
      return;
    }

    currentBuilder.lastType = 'string';
    quasis.push(text);
  }

  parseExpr(expr) {
    this.ensureBuilder();

    const { currentBuilder } = this;

    currentBuilder.lastType = 'expression'
    currentBuilder.expressions.push(expr)
  }

  isStringTemplate() {
    if (!this.currentBuilder) return false;

    const { lastType, quasis } = this.currentBuilder;

    if (lastType !== "string") return false;

    const lastIndex = quasis.length - 1;

    if (quasis[lastIndex].slice(-1) === "$") {
      quasis[lastIndex] = quasis[lastIndex].slice(0, -1)
      return true;
    }

    return false;
  }

  commit(isLast) {
    if (!this.currentBuilder) return;

    const { quasis, expressions } = this.currentBuilder;

    if (quasis.length <= expressions.length) {
      quasis.push("")
    }

    for (const index in quasis) {
      const lines = quasis[index].split("\n");
      let output = [];

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let line = lines[lineIndex].replace(/\r/g, "")

        if (lineIndex !== 0) {
          line = line.replace(/^\s+/, "")
        }

        if ((lineIndex === 0 && line !== "") || line.replace(/\s+/g, "") !== "") {
          output.push(line)
        }
      }

      quasis[index] = output.join(" ").replace(/[\r\t\f\v ]+/g, " ");
    }

    // Trim End
    const lastLineIndex = quasis.length - 1;

    if (isLast && quasis[lastLineIndex].replace(/\s+/g, "") === "") {
      quasis[lastLineIndex] = quasis[lastLineIndex].replace(/\s+$/, "")
    }

    // Decode HTML Entities.
    for (const index in quasis) {
      const str = quasis[index];

      quasis[index] = decodeHTML(str)
    }

    if (expressions.length === 0 && quasis.join("") === '') {
      // exclude empty strings
    } else if (expressions.length > 0) {
      this.resultArray.push(
        t.templateLiteral(quasis.map(str => sanatizeTemplateString(str, '`')), expressions)
      )
    } else {
      this.resultArray.push(
        t.stringLiteral(quasis.join(""))
      )
    }

    this.currentBuilder = null;
  }
}

export function transformJSXChildren(children) {
  const transformedChildren = [];
  const textParser = new TextParser(transformedChildren);

  for (const child of children) {
    if (t.isJSXText(child)) {
      textParser.parseText(child.extra.raw);
    } else if (t.isJSXExpressionContainer(child)) {
      const { expression } = child;

      if (textParser.isStringTemplate()) {
        textParser.parseExpr(expression)
      } else {
        textParser.commit(false)

        if (!t.isJSXEmptyExpression(expression)) {
          transformedChildren.push(expression);
        }
      }
    } else {
      textParser.commit(false)

      if (t.isJSXSpreadChild(child)) {
        transformedChildren.push(
          t.spreadElement(child.expression)
        )
      } else {
        transformedChildren.push(child)
      }
    }
  }

  textParser.commit(true)

  return transformedChildren;
}