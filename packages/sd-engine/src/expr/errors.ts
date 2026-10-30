export class ExprError extends Error {
  readonly detail: string
  readonly pos: number
  readonly source: string

  constructor(detail: string, pos: number, source: string) {
    super(`${detail} (위치 ${pos}): ${source}`)
    this.name = 'ExprError'
    this.detail = detail
    this.pos = pos
    this.source = source
  }
}
