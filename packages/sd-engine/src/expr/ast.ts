export type Node =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'unary'; op: '-' | '+' | 'NOT'; arg: Node; pos: number }
  | { kind: 'binary'; op: BinaryOp; left: Node; right: Node; pos: number }
  | { kind: 'call'; name: string; args: Node[]; pos: number }
  | { kind: 'array'; items: Node[]; pos: number }

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '<'
  | '>'
  | '<='
  | '>='
  | '='
  | '<>'
  | 'AND'
  | 'OR'
