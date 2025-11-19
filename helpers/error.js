import { codeFrameColumns } from "@babel/code-frame";

export class TransformError extends Error {
  constructor(message) {
    super(message);

    this.name = "TransformError";
  }
}

export function throwError({
  loc,
  offset = {
    line: 1,
    column: 0
  },
  displayColumnOffset = 0,
  message,
  file,
  errType = SyntaxError
}) {
  const location = {
    /**
     * Offset source line by error line, subtracting 1 because first line starts at 1.
     */
    line: offset.line + loc.start.line - 1,
    /**
     * Offset source column by error column if error line is on the first line. Because the first line doesn't start on first column.
     * Set column to error column if not first line.
     */
    column: offset.line === 1 ? loc.start.column + offset.column : offset.column
  }

  const errMessage = `${message.replace(/\s*\(\d+:\d+\)$/, "")} (${location.line}:${location.column + 1 + displayColumnOffset})`;

  throw file.buildCodeFrameError({
    loc: { start: location }
  }, errMessage, errType);
}

export function warn({
  loc,
  offset = {
    line: 1,
    column: 0
  },
  displayColumnOffset = 0,
  message,
  warnLabel = "",
  file
}) {
  const location = {
    /**
     * Offset source line by error line, subtracting 1 because first line starts at 1.
     */
    line: offset.line + loc.start.line - 1,
    /**
     * Offset source column by error column if error line is on the first line. Because the first line doesn't start on first column.
     * Set column to error column if not first line.
     */
    column: (offset.line === 1 ? loc.start.column + offset.column : offset.column) + 1
  }

  const errMessage = `${message.replace(/\s*\(\d+:\d+\)$/, "")} (${location.line}:${location.column + displayColumnOffset})`;


  const codeframe = codeFrameColumns(file.code, {
    start: location
  }, {
    highlightCode: true
  });

  console.warn((warnLabel ? `${warnLabel}: ` : '') + (file.opts.filename || "unknown file") + ": " + errMessage + "\n" + codeframe);
}